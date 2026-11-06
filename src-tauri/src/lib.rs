pub mod scan;

use serde::Serialize;
use std::{fs, io::Write, path::PathBuf, process::Stdio};

// Vault dir: $DESO_VAULT, else ../vault (tauri dev runs from src-tauri).
static ROOT: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

fn root() -> PathBuf {
    ROOT.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_else(|| PathBuf::from(std::env::var("DESO_VAULT").unwrap_or_else(|_| "../vault".into())))
}

/// Switch the active vault folder (created if missing); returns the resolved path.
#[tauri::command]
fn set_root(path: String) -> Result<String, String> {
    let p = PathBuf::from(path.trim());
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    *ROOT.lock().unwrap_or_else(|e| e.into_inner()) = Some(p.clone());
    Ok(p.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_root() -> String {
    root().to_string_lossy().into_owned()
}

const HIDDEN: &str = ".desovault";

fn has_deso(dir: &std::path::Path) -> bool {
    fs::read_dir(dir).map(|rd| rd.flatten().any(|e| e.path().extension().and_then(|x| x.to_str()) == Some("deso"))).unwrap_or(false)
}

/// Where notes live: the folder itself when it already holds .deso files (or is empty), otherwise
/// `<folder>/.desovault`, so indexing someone's code project never scatters files through it.
fn data_dir() -> PathBuf {
    let r = root();
    if has_deso(&r) { return r }
    let hidden = r.join(HIDDEN);
    let empty = fs::read_dir(&r).map(|rd| rd.flatten().all(|e| e.file_name().to_string_lossy().starts_with('.'))).unwrap_or(true);
    if hidden.is_dir() || !empty { hidden } else { r }
}

#[derive(Serialize)]
struct Note {
    name: String,
    content: String,
}

fn valid(name: &str) -> Result<(), String> {
    if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        Ok(())
    } else {
        Err(format!("bad note name: {name}"))
    }
}

fn notes() -> Result<Vec<Note>, String> {
    let mut out = vec![];
    // A missing data dir just means no notes yet.
    let Ok(rd) = fs::read_dir(data_dir()) else { return Ok(out) };
    for e in rd {
        let p = e.map_err(|e| e.to_string())?.path();
        if p.extension().and_then(|x| x.to_str()) == Some("deso") {
            let name = p.file_stem().unwrap().to_string_lossy().into_owned();
            // One unreadable file must not hide the whole vault.
            if let Ok(content) = fs::read_to_string(&p) { out.push(Note { name, content }) }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
fn list_notes() -> Result<Vec<Note>, String> {
    notes()
}

#[tauri::command]
fn read_note(name: String) -> Result<String, String> {
    valid(&name)?;
    fs::read_to_string(data_dir().join(format!("{name}.deso"))).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_note(name: String, content: String) -> Result<(), String> {
    valid(&name)?;
    let d = data_dir();
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    fs::write(d.join(format!("{name}.deso")), content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_note(name: String) -> Result<(), String> {
    valid(&name)?;
    fs::remove_file(data_dir().join(format!("{name}.deso"))).map_err(|e| e.to_string())
}

/// Scan the project folder and write its graph as notes in one batch. Returns how many notes were written.
/// `force` re-generates: it replaces previously generated notes (`?generated: scan`) and keeps hand-written ones.
/// Without `force` it does nothing when notes already exist.
#[tauri::command]
async fn index_project(force: bool) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let r = root();
        if !force && !notes()?.is_empty() { return Ok(0) }
        let found = scan::scan(&r);
        if found.is_empty() { return Ok(0) }
        let dir = if has_deso(&r) { r.clone() } else { r.join(HIDDEN) };
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        if force {
            for n in notes()?.iter().filter(|n| n.content.contains("?generated: scan")) {
                let _ = fs::remove_file(dir.join(format!("{}.deso", n.name)));
            }
        }
        for (name, content) in &found {
            valid(name)?;
            if force && dir.join(format!("{name}.deso")).exists() { continue } // never clobber a hand-written note
            fs::write(dir.join(format!("{name}.deso")), content).map_err(|e| e.to_string())?;
        }
        Ok(found.len())
    })
    .await
    .map_err(|e| e.to_string())?
}

// shortcut: fixed allow-list, no .cmd shim lookup on Windows; add PATHEXT handling if `claude` is an npm shim.
// `claude` reads the prompt from stdin (no length limit); `agy -p` only takes it as an argument (~32k chars on Windows).
// Runs off the UI thread.
#[tauri::command]
async fn run_agent(cli: String, prompt: String, model: Option<String>, effort: Option<String>) -> Result<String, String> {
    let mut args: Vec<String> = model.filter(|m| !m.is_empty()).map(|m| vec!["--model".into(), m]).unwrap_or_default();
    let stdin_prompt = match cli.as_str() {
        "claude" => {
            if let Some(e) = effort.filter(|e| !e.is_empty()) { args.extend(["--effort".into(), e]) }
            args.push("-p".into());
            Some(prompt)
        }
        "agy" => { args.extend(["-p".into(), prompt]); None }
        _ => return Err(format!("unknown agent cli: {cli}")),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let (o, writer) = spawn(&cli, &args, stdin_prompt)?;
        if let Some(w) = writer { let _ = w.join(); }
        if o.status.success() { Ok(String::from_utf8_lossy(&o.stdout).into_owned()) } else { Err(String::from_utf8_lossy(&o.stderr).into_owned()) }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn spawn(cli: &str, args: &[String], input: Option<String>) -> Result<(std::process::Output, Option<std::thread::JoinHandle<()>>), String> {
    let mut child = std::process::Command::new(cli)
        .args(args)
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{cli}: {e}"))?;
    // Write on a thread so a large prompt can't deadlock against a full stdout pipe.
    let writer = input.map(|text| {
        let mut stdin = child.stdin.take().unwrap();
        std::thread::spawn(move || { let _ = stdin.write_all(text.as_bytes()); })
    });
    Ok((child.wait_with_output().map_err(|e| e.to_string())?, writer))
}

/// Models the installed `agy` CLI accepts: (id, label) from `agy models`.
#[tauri::command]
async fn agy_models() -> Result<Vec<(String, String)>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (o, _) = spawn("agy", &["models".into()], None)?;
        Ok(String::from_utf8_lossy(&o.stdout)
            .lines()
            .filter_map(|l| l.split_once('\t'))
            .map(|(id, label)| (id.trim().to_string(), label.trim().to_string()))
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::valid;

    #[test]
    fn valid_rejects_paths() {
        for bad in ["", "../a", "a/b", r"a\b", "a b", "a.deso", "ü"] { assert!(valid(bad).is_err(), "{bad}") }
        for ok in ["a", "kernel-arch", "x_1"] { assert!(valid(ok).is_ok(), "{ok}") }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![list_notes, read_note, save_note, delete_note, run_agent, agy_models, index_project, set_root, get_root])
        .run(tauri::generate_context!())
        .expect("error while running DesoVault");
}
