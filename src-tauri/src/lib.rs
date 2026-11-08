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

/// Show the project folder in the system file manager (explorer's exit code is 1 even on success, so it is not checked).
#[tauri::command]
fn open_root() -> Result<(), String> {
    let opener = if cfg!(windows) { "explorer" } else if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    std::process::Command::new(opener).arg(fs::canonicalize(root()).map_err(|e| e.to_string())?).spawn().map(|_| ()).map_err(|e| e.to_string())
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
// `claude` reads the prompt from stdin (no length limit); `agy -p` only takes it as an argument (~32k chars on Windows),
// so a longer prompt goes through a temp file the agent is told to read.
// Runs off the UI thread.
#[derive(Serialize)]
struct Answer { text: String, input: u64, cached: u64, output: u64, cost: f64 }

/// Both CLIs run with `--output-format json`; that gives the answer plus its token usage. None = not JSON (print the raw output).
fn parse_answer(cli: &str, raw: &str) -> Option<Result<Answer, String>> {
    let j: serde_json::Value = serde_json::from_str(raw.trim()).ok()?;
    let u = &j["usage"];
    let n = |k: &str| u[k].as_u64().unwrap_or(0);
    let (text, ok) = if cli == "claude" {
        (j["result"].as_str().unwrap_or_default().to_string(), j["is_error"].as_bool() != Some(true))
    } else {
        (j["response"].as_str().unwrap_or_default().to_string(), j["status"].as_str() == Some("SUCCESS"))
    };
    if !ok || text.trim().is_empty() {
        let why = j["subtype"].as_str().or(j["status"].as_str()).unwrap_or("empty answer");
        return Some(Err(if text.trim().is_empty() { format!("{cli}: {why}") } else { text }));
    }
    Some(Ok(if cli == "claude" {
        Answer { text, input: n("input_tokens") + n("cache_creation_input_tokens"), cached: n("cache_read_input_tokens"), output: n("output_tokens"), cost: j["total_cost_usd"].as_f64().unwrap_or(0.0) }
    } else {
        Answer { text, input: n("input_tokens"), cached: n("cache_read_tokens"), output: n("output_tokens") + n("thinking_tokens"), cost: 0.0 }
    }))
}

/// `codex exec --json` prints one JSON event per line: the last agent_message is the answer, turn.completed carries usage.
fn parse_codex(raw: &str) -> Option<Result<Answer, String>> {
    let (mut text, mut err, mut u, mut any) = (String::new(), None, serde_json::Value::Null, false);
    for j in raw.lines().filter_map(|l| serde_json::from_str::<serde_json::Value>(l.trim()).ok()) {
        any = true;
        match j["type"].as_str() {
            Some("item.completed") if j["item"]["type"].as_str() == Some("agent_message") => text = j["item"]["text"].as_str().unwrap_or_default().to_string(),
            Some("turn.completed") => u = j["usage"].clone(),
            Some("error") => err = j["message"].as_str().map(String::from),
            Some("turn.failed") => err = j["error"]["message"].as_str().map(String::from).or(err),
            _ => {}
        }
    }
    if !any { return None }
    let n = |k: &str| u[k].as_u64().unwrap_or(0);
    if text.trim().is_empty() { return Some(Err(err.unwrap_or_else(|| "codex: empty answer".into()))) }
    Some(Ok(Answer { text, input: n("input_tokens").saturating_sub(n("cached_input_tokens")), cached: n("cached_input_tokens"), output: n("output_tokens"), cost: 0.0 }))
}

/// session: a UUID to start (resume = false) or continue (resume = true) a `claude` conversation; tools: None = all, "" = none;
/// system: appended to claude's system prompt (agy has no such flag: it is prepended to the prompt); budget: USD cap per call.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn run_agent(cli: String, prompt: String, model: Option<String>, effort: Option<String>, session: Option<String>, resume: Option<bool>, tools: Option<String>, system: Option<String>, budget: Option<f64>) -> Result<Answer, String> {
    let model_opt = model.clone();
    let mut args: Vec<String> = model.filter(|m| !m.is_empty()).map(|m| vec!["--model".into(), m]).unwrap_or_default();
    if let Some(e) = effort.filter(|e| !e.is_empty()) { args.extend(["--effort".into(), e]) }
    args.extend(["--output-format".into(), "json".into()]);
    let system = system.filter(|s| !s.is_empty());
    let mut temp: Option<PathBuf> = None;
    let stdin_prompt = match cli.as_str() {
        "claude" => {
            // Lean start: no MCP servers, no user/project hooks or plugins; their tool descriptions cost tokens on every call.
            args.extend(["--strict-mcp-config".into(), "--setting-sources".into(), "".into()]);
            // A subagent is a whole second Claude Code run; agents spawning them is where the limit goes fastest.
            args.extend(["--disallowedTools".into(), "Agent,Task".into()]);
            if let Some(t) = tools { args.extend(["--tools".into(), t]) }
            if let Some(s) = system { args.extend(["--append-system-prompt".into(), s]) }
            if let Some(b) = budget { args.extend(["--max-budget-usd".into(), b.to_string()]) }
            if let Some(id) = session.filter(|s| !s.is_empty()) { args.extend([if resume == Some(true) { "--resume" } else { "--session-id" }.into(), id]) }
            // The user explicitly asked for agents to run with no permission prompts: they can edit files AND run commands unasked.
            args.extend(["--dangerously-skip-permissions".into(), "-p".into()]);
            Some(prompt)
        }
        "agy" => {
            let prompt = match system { Some(s) => format!("{s}\n\n{prompt}"), None => prompt };
            let prompt = if prompt.len() > 30000 {
                let dir = std::env::temp_dir();
                let f = dir.join(format!("deso-prompt-{}.md", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
                fs::write(&f, &prompt).map_err(|e| e.to_string())?;
                args.extend(["--add-dir".into(), dir.to_string_lossy().into_owned()]);
                let short = format!("Your full instructions are in the file {}. Read all of it first, then do exactly what it says.", f.display());
                temp = Some(f);
                short
            } else { prompt };
            args.extend(["--dangerously-skip-permissions".into(), "-p".into(), prompt]);
            None
        }
        "codex" => {
            // shortcut: no effort/session flags; Codex uses its own config defaults. Prompt goes through stdin ("-").
            args = vec!["exec".into(), "--json".into(), "--skip-git-repo-check".into(), "--dangerously-bypass-approvals-and-sandbox".into()];
            if let Some(m) = model_opt.filter(|m| !m.is_empty()) { args.extend(["-m".into(), m]) }
            args.push("-".into());
            Some(match system { Some(s) => format!("{s}\n\n{prompt}"), None => prompt })
        }
        _ => return Err(format!("unknown agent cli: {cli}")),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let run = spawn(&cli, &args, stdin_prompt);
        if let Some(f) = temp { let _ = fs::remove_file(f); }
        let (o, writer) = run?;
        if let Some(w) = writer { let _ = w.join(); }
        let said = String::from_utf8_lossy(&o.stdout).into_owned();
        if cli == "codex" { if let Some(r) = parse_codex(&said) { return r } }
        else if let Some(r) = parse_answer(&cli, &said) { return r }
        // Not JSON: the CLI failed before answering (bad model, not signed in, killed by Stop); show whatever it printed.
        let msg = [&o.stderr, &o.stdout].iter().map(|b| String::from_utf8_lossy(b).trim().to_string()).find(|m| !m.is_empty());
        Err(msg.unwrap_or_else(|| if o.status.success() { format!("{cli} returned an empty answer") } else { format!("{cli} exited with {}", o.status) }))
    })
    .await
    .map_err(|e| e.to_string())?
}

// PIDs of running agent processes, so Stop can kill them.
static RUNNING: std::sync::Mutex<Vec<u32>> = std::sync::Mutex::new(Vec::new());

/// Kills every running agent (with its child processes); their run_agent calls then fail and the orchestra stops.
#[tauri::command]
fn stop_agents() {
    let pids = std::mem::take(&mut *RUNNING.lock().unwrap_or_else(|e| e.into_inner()));
    for pid in pids {
        let pid = pid.to_string();
        let _ = if cfg!(windows) { std::process::Command::new("taskkill").args(["/PID", &pid, "/T", "/F"]).output() }
            else { std::process::Command::new("kill").args(["-TERM", &pid]).output() };
    }
}

fn spawn(cli: &str, args: &[String], input: Option<String>) -> Result<(std::process::Output, Option<std::thread::JoinHandle<()>>), String> {
    // Agents work inside the active project folder, not the folder `tauri dev` happens to run from.
    let mut cmd = std::process::Command::new(if cfg!(windows) && cli == "codex" { "codex.cmd" } else { cli }); // npm installs codex as a .cmd shim
    if root().is_dir() { cmd.current_dir(root()); }
    let mut child = cmd
        .args(args)
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{cli}: {e}"))?;
    let pid = child.id();
    RUNNING.lock().unwrap_or_else(|e| e.into_inner()).push(pid);
    // Write on a thread so a large prompt can't deadlock against a full stdout pipe.
    let writer = input.map(|text| {
        let mut stdin = child.stdin.take().unwrap();
        std::thread::spawn(move || { let _ = stdin.write_all(text.as_bytes()); })
    });
    let out = child.wait_with_output();
    RUNNING.lock().unwrap_or_else(|e| e.into_inner()).retain(|p| *p != pid);
    Ok((out.map_err(|e| e.to_string())?, writer))
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

/// Real Claude plan limits (5 h / 7 days) from Anthropic, using Claude Code's own login.
/// The token never leaves Rust: it goes to curl through stdin, and only the usage JSON is returned.
/// shortcut: undocumented endpoint, and an expired token is not refreshed here; running `claude` once refreshes it.
#[tauri::command]
async fn claude_usage() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).map_err(|e| e.to_string())?;
        let raw = fs::read_to_string(PathBuf::from(home).join(".claude").join(".credentials.json")).map_err(|_| "Claude is not signed in (run `claude` once)".to_string())?;
        let j: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let token = j["claudeAiOauth"]["accessToken"].as_str().ok_or("no Claude login found")?;
        let cfg = format!("header = \"Authorization: Bearer {token}\"
header = \"anthropic-beta: oauth-2025-04-20\"
");
        let (o, w) = spawn("curl", &["-s".into(), "-f".into(), "-m".into(), "15".into(), "--config".into(), "-".into(), "https://api.anthropic.com/api/oauth/usage".into()], Some(cfg))?;
        if let Some(w) = w { let _ = w.join(); }
        if o.status.success() { Ok(String::from_utf8_lossy(&o.stdout).into_owned()) } else { Err("Claude usage unavailable (token expired? run `claude` once)".into()) }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Real Antigravity quota (5 h / weekly, per model group) from the CLI's own `/usage` command: free, no model call.
#[tauri::command]
async fn agy_usage() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (o, _) = spawn("agy", &["-p".into(), "/usage".into(), "--output-format".into(), "json".into()], None)?;
        if o.status.success() { Ok(String::from_utf8_lossy(&o.stdout).into_owned()) } else { Err(String::from_utf8_lossy(&o.stderr).into_owned()) }
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
        .invoke_handler(tauri::generate_handler![list_notes, read_note, save_note, delete_note, run_agent, stop_agents, agy_models, claude_usage, agy_usage, index_project, set_root, get_root, open_root])
        .run(tauri::generate_context!())
        .expect("error while running Taurium");
}
