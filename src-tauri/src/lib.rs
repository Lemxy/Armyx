pub mod scan;
mod worktree;

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
async fn list_notes() -> Result<Vec<Note>, String> {
    // Sync commands run on the UI thread; reading a big scanned graph there freezes the window.
    tauri::async_runtime::spawn_blocking(notes).await.map_err(|e| e.to_string())?
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

// A picture saved next to the notes (`images/<name>.<ext>`); returns its absolute path (the CLIs read images by path).
#[tauri::command]
fn save_image(name: String, ext: String, bytes: Vec<u8>) -> Result<String, String> {
    valid(&name)?;
    if !["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) { return Err(format!("bad image type: {ext}")) }
    let d = data_dir().join("images");
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let f = d.join(format!("{name}.{ext}"));
    fs::write(&f, bytes).map_err(|e| e.to_string())?;
    Ok(f.to_string_lossy().into_owned())
}

/// Where an agent should write a picture it draws: `images/<name>.<ext>` next to the notes (the folder is created).
#[tauri::command]
fn image_path(name: String, ext: String) -> Result<String, String> {
    valid(&name)?;
    if !["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) { return Err(format!("bad image type: {ext}")) }
    let d = data_dir().join("images");
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d.join(format!("{name}.{ext}")).to_string_lossy().into_owned())
}

/// The bytes of a picture written to the path `image_path` gave for this name.
#[tauri::command]
fn read_image(name: String, ext: String) -> Result<Vec<u8>, String> {
    valid(&name)?;
    if !["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) { return Err(format!("bad image type: {ext}")) }
    fs::read(data_dir().join("images").join(format!("{name}.{ext}"))).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_note(name: String) -> Result<(), String> {
    valid(&name)?;
    fs::remove_file(data_dir().join(format!("{name}.deso"))).map_err(|e| e.to_string())
}

/// A project file named by a note's `?path:`. It must exist and stay inside the project folder (a `..` or a symlink cannot leave it); `.git` is off limits.
fn source_path(rel: &str) -> Result<PathBuf, String> {
    let r = fs::canonicalize(root()).map_err(|e| e.to_string())?;
    let p = fs::canonicalize(r.join(rel)).map_err(|e| e.to_string())?;
    if !p.starts_with(&r) || !p.is_file() || p.components().any(|c| c.as_os_str() == ".git") { return Err(format!("not a project file: {rel}")) }
    Ok(p)
}

/// The text of a project file, to edit it in the app (never launched). Binary or huge files are refused.
#[tauri::command]
fn read_source(path: String) -> Result<String, String> {
    let p = source_path(&path)?;
    if fs::metadata(&p).map_err(|e| e.to_string())?.len() > 2_000_000 { return Err("file is too large to edit here (over 2 MB)".into()) }
    fs::read_to_string(&p).map_err(|_| "not a text file".into())
}

#[tauri::command]
fn save_source(path: String, content: String) -> Result<(), String> {
    fs::write(source_path(&path)?, content).map_err(|e| e.to_string())
}

const GENERATED: &str = "?generated: scan";

/// Brings the generated notes in `dir` in line with a fresh scan, touching only what changed (a reader such as the hook never sees a
/// half-rewritten graph): new and changed notes are written, notes of deleted files are removed, hand-written notes are never touched.
/// Returns how many files changed.
fn write_graph(dir: &std::path::Path, found: &[(String, String)]) -> Result<usize, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut old: std::collections::HashMap<String, String> = fs::read_dir(dir).map_err(|e| e.to_string())?.flatten()
        .filter_map(|e| { let p = e.path(); let n = p.file_stem()?.to_str()?.to_string(); (p.extension()? == "deso").then(|| fs::read_to_string(&p).ok().map(|c| (n, c)))? }).collect();
    let mut changed = 0;
    for (name, content) in found {
        valid(name)?;
        match old.remove(name) {
            Some(prev) if !prev.contains(GENERATED) || prev == *content => continue, // hand-written, or unchanged
            _ => { fs::write(dir.join(format!("{name}.deso")), content).map_err(|e| e.to_string())?; changed += 1 }
        }
    }
    for (name, prev) in old.iter().filter(|(_, c)| c.contains(GENERATED)) { // what is left was not found again: its file is gone
        let _ = prev; fs::remove_file(dir.join(format!("{name}.deso"))).map_err(|e| e.to_string())?; changed += 1;
    }
    Ok(changed)
}

fn graph_dir() -> PathBuf {
    let r = root();
    if has_deso(&r) { r.clone() } else { r.join(HIDDEN) }
}

/// Scan the project folder and write its graph as notes in one batch. Returns how many notes the scan found.
/// `force` re-generates: it replaces previously generated notes (`?generated: scan`) and keeps hand-written ones.
/// Without `force` it does nothing when notes already exist.
#[tauri::command]
async fn index_project(force: bool) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !force && !notes()?.is_empty() { return Ok(0) }
        let found = scan::scan_cached(&root(), force); // the button (force) forgets what the watcher learned; the first open fills it
        if found.is_empty() { return Ok(0) }
        write_graph(&graph_dir(), &found)?;
        Ok(found.len())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---- API keys: one keychain entry holding all of them as JSON (see src/keys.ts) ----
const KEYCHAIN: (&str, &str) = ("dev.deso.vault", "api-keys");

fn keys_get(entry: (&str, &str)) -> Result<String, String> {
    match keyring::Entry::new(entry.0, entry.1).map_err(|e| e.to_string())?.get_password() {
        Ok(s) => Ok(s),
        Err(keyring::Error::NoEntry) => Ok("{}".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn keys_load() -> Result<String, String> { keys_get(KEYCHAIN) }

#[tauri::command]
fn keys_save(json: String) -> Result<(), String> {
    keyring::Entry::new(KEYCHAIN.0, KEYCHAIN.1).and_then(|e| e.set_password(&json)).map_err(|e| e.to_string())
}

// ---- Keeping the graph current: a watcher re-scans (only the changes are written) when the project's files change ----
static WATCHER: std::sync::Mutex<Option<notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>> = std::sync::Mutex::new(None);

/// A change worth a re-scan: not inside the graph itself, a build folder, version control or an agent worktree.
fn relevant(p: &std::path::Path) -> bool {
    !p.components().any(|c| { let c = c.as_os_str().to_string_lossy(); scan::SKIP_DIRS.contains(&&*c) || [".git", HIDDEN, ".armyx", ".armyx-worktrees", ".claude"].contains(&&*c) })
}

/// Starts watching the open project (replacing the watcher of the previous one). A scanned project is re-scanned two seconds after
/// the last change and the app gets a `graph-changed` event; a folder of hand-written notes is left alone.
#[tauri::command]
fn watch_project(app: tauri::AppHandle) -> Result<(), String> {
    use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
    use tauri::Emitter;
    let r = root();
    let mut deb = new_debouncer(std::time::Duration::from_secs(2), move |res: notify_debouncer_mini::DebounceEventResult| {
        if !res.is_ok_and(|evs| evs.iter().any(|e| relevant(&e.path))) { return }
        let scanned = notes().is_ok_and(|n| n.iter().any(|n| n.content.contains(GENERATED)));
        if !scanned { return }
        let found = scan::scan_cached(&root(), false); // only the files that changed are read again
        if !found.is_empty() && write_graph(&graph_dir(), &found).is_ok_and(|n| n > 0) { let _ = app.emit("graph-changed", ()); }
    }).map_err(|e| e.to_string())?;
    deb.watcher().watch(&r, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    *WATCHER.lock().unwrap_or_else(|e| e.into_inner()) = Some(deb);
    Ok(())
}

// shortcut: fixed allow-list, no .cmd shim lookup on Windows; add PATHEXT handling if `claude` is an npm shim.
// `claude` reads the prompt from stdin (no length limit); `agy -p` only takes it as an argument (~32k chars on Windows),
// so a longer prompt goes through a temp file the agent is told to read.
// Runs off the UI thread.
#[derive(Serialize)]
struct Answer { text: String, input: u64, cached: u64, output: u64, cost: f64, files: Vec<String>, wide: bool }

/// `p` relative to `base` with forward slashes; None when it lies outside.
fn rel_to(p: &str, base: &std::path::Path) -> Option<String> {
    let (p, b) = (p.replace('\\', "/"), base.to_string_lossy().replace('\\', "/"));
    if !p.contains(':') && !p.starts_with('/') { return Some(p) } // already relative
    let b = b.trim_end_matches('/');
    p.get(..b.len()).filter(|h| h.eq_ignore_ascii_case(b)).and_then(|_| p[b.len()..].strip_prefix('/')).map(str::to_string)
}

/// What a `claude` run touched, from its stream of events: the project files it opened (relative paths), and whether its answer may
/// rest on more than those files (`wide`: it searched, ran a command, wrote, or read outside the project).
fn opened(raw: &str, base: &std::path::Path) -> (Vec<String>, bool) {
    let (mut files, mut wide) = (vec![], false);
    for j in raw.lines().filter_map(|l| serde_json::from_str::<serde_json::Value>(l.trim()).ok()).filter(|j| j["type"] == "assistant") {
        for b in j["message"]["content"].as_array().into_iter().flatten().filter(|b| b["type"] == "tool_use") {
            if b["name"] != "Read" { wide = true }
            match b["input"]["file_path"].as_str().map(|p| rel_to(p, base)) {
                Some(Some(r)) => if !files.contains(&r) { files.push(r) },
                Some(None) => wide = true,
                None => {}
            }
        }
    }
    (files, wide)
}

/// `agy` prints one JSON object (`--output-format json`); `claude` prints one event per line (`stream-json`), the `result` event being
/// that same object. It gives the answer plus its token usage. None = not JSON (print the raw output).
fn parse_answer(cli: &str, raw: &str) -> Option<Result<Answer, String>> {
    let j: serde_json::Value = if cli == "claude" { raw.lines().filter_map(|l| serde_json::from_str::<serde_json::Value>(l.trim()).ok()).find(|j| j["type"] == "result" || j["result"].is_string())? }
        else { serde_json::from_str(raw.trim()).ok()? };
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
        Answer { text, input: n("input_tokens") + n("cache_creation_input_tokens"), cached: n("cache_read_input_tokens"), output: n("output_tokens"), cost: j["total_cost_usd"].as_f64().unwrap_or(0.0), files: vec![], wide: true }
    } else {
        Answer { text, input: n("input_tokens"), cached: n("cache_read_tokens"), output: n("output_tokens") + n("thinking_tokens"), cost: 0.0, files: vec![], wide: true }
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
    Some(Ok(Answer { text, input: n("input_tokens").saturating_sub(n("cached_input_tokens")), cached: n("cached_input_tokens"), output: n("output_tokens"), cost: 0.0, files: vec![], wide: true }))
}

/// session: a UUID to start (resume = false) or continue (resume = true) a `claude` conversation; tools: None = all, "" = none;
/// system: appended to claude's system prompt (agy has no such flag: it is prepended to the prompt); budget: USD cap per call.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn run_agent(cli: String, prompt: String, model: Option<String>, effort: Option<String>, session: Option<String>, resume: Option<bool>, tools: Option<String>, system: Option<String>, budget: Option<f64>, max_turns: Option<u32>, worktree: Option<String>) -> Result<Answer, String> {
    let cwd = match worktree.filter(|w| !w.is_empty()) { Some(id) => Some(worktree::dir(&root(), &id)?), None => None }; // never silently fall back to the real project
    if cwd.as_ref().is_some_and(|d| !d.is_dir()) { return Err("the isolated worktree is gone: run the orchestra again".into()) }
    let model_opt = model.clone();
    let mut args: Vec<String> = model.filter(|m| !m.is_empty()).map(|m| vec!["--model".into(), m]).unwrap_or_default();
    if let Some(e) = effort.filter(|e| !e.is_empty()) { args.extend(["--effort".into(), e]) }
    args.extend(["--output-format".into(), if cli == "claude" { "stream-json" } else { "json" }.into()]);
    let base = cwd.clone().unwrap_or_else(root);
    let system = system.filter(|s| !s.is_empty());
    let mut temp: Option<PathBuf> = None;
    let stdin_prompt = match cli.as_str() {
        "claude" => {
            // Lean start: no MCP servers, no user/project hooks or plugins; their tool descriptions cost tokens on every call.
            args.extend(["--strict-mcp-config".into(), "--setting-sources".into(), "".into()]);
            args.push("--verbose".into()); // stream-json needs it: the events name the files the agent opened
            // A subagent is a whole second Claude Code run; agents spawning them is where the limit goes fastest.
            args.extend(["--disallowedTools".into(), "Agent,Task".into()]);
            if let Some(t) = tools { args.extend(["--tools".into(), t]) }
            if let Some(s) = system { args.extend(["--append-system-prompt".into(), s]) }
            if let Some(b) = budget { args.extend(["--max-budget-usd".into(), b.to_string()]) }
            if let Some(n) = max_turns { args.extend(["--max-turns".into(), n.to_string()]) } // stops an agent looping on reads; a hidden flag, absent from --help
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
        let run = spawn_in(&cli, &args, stdin_prompt, cwd);
        if let Some(f) = temp { let _ = fs::remove_file(f); }
        let (o, writer) = run?;
        if let Some(w) = writer { let _ = w.join(); }
        let said = String::from_utf8_lossy(&o.stdout).into_owned();
        if cli == "codex" { if let Some(r) = parse_codex(&said) { return r } }
        else if let Some(r) = parse_answer(&cli, &said) {
            return r.map(|mut a| { if cli == "claude" { (a.files, a.wide) = opened(&said, &base) } a })
        }
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

type Spawned = Result<(std::process::Output, Option<std::thread::JoinHandle<()>>), String>;
fn spawn(cli: &str, args: &[String], input: Option<String>) -> Spawned { spawn_in(cli, args, input, None) }

/// `cwd` = a worktree for an isolated run; otherwise agents work inside the active project folder, not the folder `tauri dev` runs from.
fn spawn_in(cli: &str, args: &[String], input: Option<String>, cwd: Option<PathBuf>) -> Spawned {
    let mut cmd = std::process::Command::new(if cfg!(windows) && cli == "codex" { "codex.cmd" } else { cli }); // npm installs codex as a .cmd shim
    match cwd { Some(d) => { cmd.current_dir(d); } None => if root().is_dir() { cmd.current_dir(root()); } }
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

#[tauri::command]
async fn worktree_create(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || worktree::create(&root(), &id).map(|d| d.to_string_lossy().into_owned())).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn project_stamp(worktree: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let r = root();
        let d = match worktree.filter(|w| !w.is_empty()) { Some(id) => worktree::dir(&r, &id)?, None => r };
        Ok(worktree::stamp(&d))
    }).await.map_err(|e| e.to_string())?
}
/// Size and modification time of the given project files (relative paths): an answer built from those files alone stays good
/// until one of them changes, whatever else changed in the project.
#[tauri::command]
fn files_stamp(paths: Vec<String>, worktree: Option<String>) -> Result<String, String> {
    let base = match worktree.filter(|w| !w.is_empty()) { Some(id) => worktree::dir(&root(), &id)?, None => root() };
    Ok(paths.iter().map(|p| {
        if p.contains("..") || std::path::Path::new(p).is_absolute() { return format!("{p}:outside") }
        match fs::metadata(base.join(p)) { Ok(m) => format!("{p}:{}:{:?}", m.len(), m.modified().ok()), Err(_) => format!("{p}:gone") }
    }).collect::<Vec<_>>().join("\n"))
}
#[tauri::command]
async fn worktree_diff(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || worktree::diff(&root(), &id)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn worktree_apply(id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || worktree::apply(&root(), &id)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn worktree_discard(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || worktree::discard(&root(), &id)).await.map_err(|e| e.to_string())?
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
    use super::*;

    #[test]
    fn write_graph_touches_only_what_changed() {
        let dir = std::env::temp_dir().join(format!("armyx-wg-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let note = |n: &str, t: &str| (n.to_string(), format!("# {n}
?generated: scan
{t}
"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("mine.deso"), "# mine
hand-written
").unwrap();
        let a = vec![note("a", "one"), note("b", "two"), ("mine".to_string(), "# generated over it
?generated: scan
".to_string())];
        assert_eq!(write_graph(&dir, &a).unwrap(), 2); // a and b; "mine" is never clobbered
        assert_eq!(fs::read_to_string(dir.join("mine.deso")).unwrap(), "# mine
hand-written
");
        assert_eq!(write_graph(&dir, &a).unwrap(), 0); // nothing changed, nothing written
        let b = vec![note("a", "changed"), note("c", "new")];
        assert_eq!(write_graph(&dir, &b).unwrap(), 3); // a rewritten, c added, b removed
        assert!(!dir.join("b.deso").exists() && dir.join("c.deso").exists() && dir.join("mine.deso").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn source_files_stay_inside_the_project() {
        let base = std::env::temp_dir().join(format!("armyx-src-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let proj = base.join("proj");
        fs::create_dir_all(proj.join("src")).unwrap();
        fs::write(proj.join("src/a.py"), "print(1)").unwrap();
        fs::write(base.join("secret.txt"), "no").unwrap();
        *ROOT.lock().unwrap_or_else(|e| e.into_inner()) = Some(proj.clone());
        assert_eq!(read_source("src/a.py".into()).unwrap(), "print(1)");
        save_source("src/a.py".into(), "print(2)".into()).unwrap();
        assert_eq!(read_source("src/a.py".into()).unwrap(), "print(2)");
        assert!(read_source("../secret.txt".into()).is_err()); // cannot climb out
        assert!(save_source("src/new.py".into(), "x".into()).is_err()); // never creates files
        assert!(read_source("src".into()).is_err()); // a folder is not a file
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn watcher_ignores_the_graph_and_build_folders() {
        for p in ["/p/src/a.rs", "/p/README.md"] { assert!(relevant(std::path::Path::new(p)), "{p}") }
        for p in ["/p/.desovault/a.deso", "/p/node_modules/x/i.js", "/p/.git/index", "/p/.armyx/graph/a.deso", "/p/target/debug/x"] { assert!(!relevant(std::path::Path::new(p)), "{p}") }
    }

    // Touches the real keychain (a throwaway entry), so it does not run on a headless CI box: cargo test -- --ignored
    #[test]
    #[ignore]
    fn keychain_round_trip() {
        let e = ("dev.deso.vault.test", "api-keys");
        assert_eq!(keys_get(e).unwrap(), "{}");
        keyring::Entry::new(e.0, e.1).unwrap().set_password("{\"deepseek\":\"sk-test\"}").unwrap();
        assert!(keys_get(e).unwrap().contains("sk-test"));
        keyring::Entry::new(e.0, e.1).unwrap().delete_credential().unwrap();
    }

    #[test]
    fn claude_events_give_the_answer_and_the_files_it_opened() {
        let base = std::path::Path::new(r"C:\proj");
        let raw = [
            r#"{"type":"system","subtype":"init"}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"c:\\proj\\src\\a.ts"}}]}}"#,
            r#"{"type":"result","result":"alpha","is_error":false,"usage":{"input_tokens":5,"cache_read_input_tokens":7,"output_tokens":2},"total_cost_usd":0.5}"#,
            r#"{"type":"system","subtype":"task_summary"}"#,
        ].join("\n");
        let a = parse_answer("claude", &raw).unwrap().unwrap();
        assert_eq!((a.text.as_str(), a.input, a.cached, a.output, a.cost), ("alpha", 5, 7, 2, 0.5));
        assert_eq!(opened(&raw, base), (vec!["src/a.ts".to_string()], false));
        let grep = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"x"}},{"type":"tool_use","name":"Read","input":{"file_path":"D:\\other\\b.ts"}}]}}"#;
        assert_eq!(opened(grep, base), (vec![], true)); // a search, and a file outside the project
        assert_eq!(rel_to(r"C:\project2\a.ts", base), None); // a folder that only starts the same
    }

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
        .invoke_handler(tauri::generate_handler![list_notes, read_note, save_note, save_image, read_source, save_source, image_path, read_image, delete_note, run_agent, files_stamp, stop_agents, agy_models, claude_usage, agy_usage, keys_load, keys_save, watch_project, worktree_create, project_stamp, worktree_diff, worktree_apply, worktree_discard, index_project, set_root, get_root, open_root])
        .run(tauri::generate_context!())
        .expect("error while running Taurium");
}
