//! Project scanner: turns an arbitrary code/docs folder into a graph of `.deso` notes.
//! One note per source file (capped), edges from relative imports, plus a `project-map` overview.
//! Everything is computed first and written in one batch, so a failed scan leaves nothing half-written.
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

const MAX_FILES: usize = 20000; // files examined
const MAX_NODES: usize = 5000; // notes written (most connected / largest first)
const MAX_BYTES: u64 = 512 * 1024;
const MAX_LINKS: usize = 25;
const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "out", "vendor", "venv", "__pycache__", "coverage", "bin", "obj"];
const MAX_CALLS: usize = 8; // symbol edges kept per file, strongest first
const EXTS: &[&str] = &["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "kt", "c", "h", "cpp", "hpp", "cs", "rb", "php", "swift", "md", "sh", "html", "css", "toml", "yml", "yaml"];

struct File {
    rel: String, // forward slashes
    ext: String,
    lines: usize,
    bytes: usize,
    about: String,
    doc: String, // what the comments and docstrings inside the file say, so a question phrased like them finds the file
    exports: Vec<String>,
    imports: Vec<String>, // resolved rel paths (may point to files not in the set), later also cross-project edges
    syms: Syms,
    degree: usize,
    idents: HashSet<String>, // identifiers of 5+ characters used in the file, dropped after the symbol edges are built
    calls: Vec<(String, Vec<String>)>, // other file -> the symbols of it that this file uses
    callers: Vec<String>, // files that use symbols defined here
}

/// What a file defines (searchable symbols) and what it refers to (HTTP routes, Tauri commands), for edges across projects.
#[derive(Default)]
struct Syms {
    routes: Vec<String>,
    cmds: Vec<String>,
    other: Vec<String>, // UPPER_CASE constants and environment variables
    uses_routes: Vec<String>,
    uses_cmds: Vec<String>,
}

fn walk(dir: &Path, root: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        if out.len() >= MAX_FILES { return }
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') { continue }
        let Ok(t) = e.file_type() else { continue };
        if t.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) { walk(&p, root, out) }
        } else if t.is_file() {
            let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
            let keep = EXTS.contains(&ext.as_str()) || name.eq_ignore_ascii_case("makefile") || name.eq_ignore_ascii_case("dockerfile");
            if keep && e.metadata().map(|m| m.len() <= MAX_BYTES).unwrap_or(false) { out.push(p) }
        }
    }
}

fn rel(p: &Path, root: &Path) -> String {
    p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

/// Join + normalize `.`/`..` on forward-slash paths.
fn join(dir: &str, rel: &str) -> String {
    let mut parts: Vec<&str> = if dir.is_empty() { vec![] } else { dir.split('/').collect() };
    for seg in rel.split('/') {
        match seg {
            "" | "." => {}
            ".." => { parts.pop(); }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

fn dir_of(rel: &str) -> &str { rel.rsplit_once('/').map(|x| x.0).unwrap_or("") }

fn quoted(line: &str) -> Vec<&str> {
    let mut out = vec![];
    for q in ['"', '\''] {
        let mut it = line.split(q).skip(1).step_by(2);
        while let Some(s) = it.next() { out.push(s) }
    }
    out
}

/// First lines of the docstrings (Python) and the comment lines of a file, up to ~700 characters: the text a question is most
/// likely to be phrased like, which names and the one-line `about` do not carry.
fn doc_text(ext: &str, src: &str) -> String {
    let mut out = String::new();
    let mut after_def = false;
    for raw in src.lines() {
        let t = raw.trim();
        let text = if ext == "py" && after_def && (t.starts_with("\"\"\"") || t.starts_with("'''")) { Some(t.trim_matches(|c| c == '"' || c == '\'')) }
            else if t.starts_with("//") || (t.starts_with('#') && ext != "md" && !t.starts_with("#!")) { Some(t.trim_start_matches(|c: char| matches!(c, '/' | '#' | '!' | ' '))) }
            else { None };
        after_def = ext == "py" && (t.starts_with("def ") || t.starts_with("class ") || t.starts_with("async def ")) && t.ends_with(':');
        if let Some(x) = text.map(str::trim).filter(|x| x.split_whitespace().count() >= 3) {
            out.extend(x.chars().take(90).chain(std::iter::once(' ')));
            if out.len() >= 700 { break }
        }
    }
    out.trim().to_string()
}

fn ident(s: &str) -> String {
    s.trim_start().chars().take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$').collect()
}

fn parse(rel_path: &str, ext: &str, src: &str, all: &HashSet<String>) -> (String, Vec<String>, Vec<String>) {
    let dir = dir_of(rel_path);
    let mut exports = vec![];
    let mut imports = vec![];
    let mut about = String::new();
    let add = |e: &mut Vec<String>, s: String| { if !s.is_empty() && !e.contains(&s) && e.len() < 8 { e.push(s) } };
    let try_resolve = |imports: &mut Vec<String>, base: String, cands: &[&str]| {
        for c in cands {
            let p = format!("{base}{c}");
            if all.contains(&p) { if !imports.contains(&p) { imports.push(p) } return }
        }
    };
    for (i, raw) in src.lines().enumerate() {
        let line = raw.trim_end();
        let t = line.trim_start();
        if about.is_empty() && i < 12 {
            let c = t.trim_start_matches(|c: char| matches!(c, '/' | '*' | '#' | '!' | '"' | '\'' | ' ')).trim();
            let is_doc = t.starts_with("//") || t.starts_with("/*") || t.starts_with("\"\"\"") || (t.starts_with('#') && ext != "md" && !t.starts_with("#!")) || (ext == "md" && t.starts_with("# "));
            if is_doc && !c.is_empty() { about = c.trim_end_matches(['"', '\'', '*', '/', ' ']).chars().take(100).collect() }
        }
        match ext {
            "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => {
                if t.starts_with("export ") {
                    let rest = t["export ".len()..].trim_start_matches("default ").trim_start_matches("async ").trim_start_matches("declare ");
                    let rest = ["function*", "function", "const", "let", "class", "interface", "type", "enum"].iter().find_map(|k| rest.strip_prefix(*k)).unwrap_or(rest);
                    add(&mut exports, ident(rest));
                }
                if t.starts_with("import ") || t.starts_with("export ") || t.contains("require(") || t.contains("import(") {
                    for q in quoted(t).into_iter().filter(|q| q.starts_with("./") || q.starts_with("../")) {
                        let base = join(dir, q);
                        try_resolve(&mut imports, base, &["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"]);
                    }
                }
            }
            "py" => {
                if let Some(n) = t.strip_prefix("def ").or_else(|| t.strip_prefix("class ")).filter(|_| line.len() == t.len()) { add(&mut exports, ident(n)) }
                let (lead, rest) = if let Some(r) = t.strip_prefix("from ") { (true, r) } else if let Some(r) = t.strip_prefix("import ") { (false, r) } else { continue };
                let module = rest.split_whitespace().next().unwrap_or("");
                let dots = module.chars().take_while(|c| *c == '.').count();
                let path = module.trim_start_matches('.').replace('.', "/");
                let mut base_dir = dir.to_string();
                for _ in 1..dots { base_dir = dir_of(&base_dir).to_string() }
                let bases = if dots > 0 { vec![join(&base_dir, &path)] } else { vec![join("", &path), join(dir, &path)] };
                for b in bases { try_resolve(&mut imports, b, &[".py", "/__init__.py"]) }
                let _ = lead;
            }
            "rs" => {
                if let Some(n) = ["pub fn ", "pub struct ", "pub enum ", "pub trait ", "pub mod "].iter().find_map(|k| t.strip_prefix(*k)) { add(&mut exports, ident(n)) }
                let m = t.strip_prefix("pub mod ").or_else(|| t.strip_prefix("mod ")).and_then(|r| r.strip_suffix(';'));
                if let Some(name) = m {
                    let stem = rel_path.rsplit('/').next().unwrap_or("").trim_end_matches(".rs");
                    let base = if matches!(stem, "main" | "lib" | "mod") { dir.to_string() } else { join(dir, stem) };
                    try_resolve(&mut imports, join(&base, name.trim()), &[".rs", "/mod.rs"]);
                }
            }
            "go" => { if let Some(n) = t.strip_prefix("func ").filter(|n| !n.starts_with('(')) { add(&mut exports, ident(n)) } }
            "md" => {
                let mut rest = t;
                while let Some(i) = rest.find("](") {
                    rest = &rest[i + 2..];
                    let target = rest.split(')').next().unwrap_or("").split('#').next().unwrap_or("");
                    if !target.is_empty() && !target.contains("://") { try_resolve(&mut imports, join(dir, target), &[""]) }
                }
            }
            _ => {}
        }
    }
    (about, exports, imports)
}

fn all_caps(s: &str) -> bool { s.len() >= 4 && s.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') && s.chars().next().is_some_and(|c| c.is_ascii_uppercase()) }

fn push(v: &mut Vec<String>, s: String) { if !s.is_empty() && !v.contains(&s) && v.len() < 60 { v.push(s) } }

/// Route normal form: parameters and query cut off, so `/api/friends/:id` and `/api/friends/${id}` meet at `/api/friends`.
fn route_key(r: &str) -> String {
    let end = ["/:", "${", "{", "?", "`", "\""].iter().filter_map(|m| r.find(m)).min().unwrap_or(r.len());
    r[..end].trim_end_matches('/').to_string()
}

fn syms(ext: &str, src: &str) -> Syms {
    let mut y = Syms::default();
    let js = matches!(ext, "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs");
    let mut after_cmd = false;
    for raw in src.lines() {
        let t = raw.trim();
        if js && [".get(", ".post(", ".put(", ".delete(", ".patch(", ".all("].iter().any(|m| t.contains(m)) {
            if let Some(q) = quoted(t).into_iter().find(|q| q.starts_with('/')) { push(&mut y.routes, route_key(q)) }
        }
        if ext == "rs" {
            if after_cmd && !t.starts_with("#[") {
                if let Some(i) = t.find("fn ") { push(&mut y.cmds, ident(&t[i + 3..])) }
            }
            after_cmd = t.starts_with("#[tauri::command") || (after_cmd && t.starts_with("#["));
        }
        // every named function / class / method, so a question about a small helper still finds its file
        let named = match ext {
            "py" => t.strip_prefix("async ").unwrap_or(t).strip_prefix("def ").or_else(|| t.strip_prefix("class ")),
            "rs" => t.find("fn ").filter(|i| *i == 0 || t[..*i].ends_with(' ')).map(|i| &t[i + 3..]),
            _ if js => t.trim_start_matches("export ").trim_start_matches("default ").trim_start_matches("async ").strip_prefix("function ").or_else(|| t.trim_start_matches("export ").strip_prefix("class ")),
            _ => None,
        };
        if let Some(n) = named { let n = ident(n); if n.len() > 3 && !n.starts_with("__") { push(&mut y.other, n) } }
        if js || ext == "rs" {
            let rest = t.trim_start_matches("export ").trim_start_matches("pub(crate) ").trim_start_matches("pub ");
            if let Some(n) = rest.strip_prefix("const ").or_else(|| rest.strip_prefix("static ")) { let n = ident(n); if all_caps(&n) { push(&mut y.other, n) } }
            if let Some(i) = t.find("process.env.") { let n = ident(&t[i + 12..]); if all_caps(&n) { push(&mut y.other, n) } }
            if t.contains("env!(") || t.contains("env::var(") { for q in quoted(t) { if all_caps(q) { push(&mut y.other, q.to_string()) } } }
        }
        let mut rest = t;
        while let Some(i) = rest.find("/api/") {
            rest = &rest[i..];
            let end = rest.find(|c: char| !(c.is_ascii_alphanumeric() || "/-_.:".contains(c))).unwrap_or(rest.len());
            push(&mut y.uses_routes, route_key(&rest[..end]));
            rest = &rest[end..];
        }
        if let Some(i) = t.find("invoke") {
            if let Some(q) = quoted(&t[i..]).first() { if q.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') { push(&mut y.uses_cmds, q.to_string()) } }
        }
    }
    y
}

fn ident_set(src: &str) -> HashSet<String> {
    src.split(|c: char| !(c.is_alphanumeric() || c == '_')).filter(|w| w.len() >= 5 && !w.starts_with(|c: char| c.is_ascii_digit())).map(str::to_string).collect()
}

fn note_name(rel: &str, used: &mut HashSet<String>) -> String {
    let mut n: String = rel.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c.to_ascii_lowercase() } else { '-' }).collect();
    n.truncate(60);
    let base = n.clone();
    let mut i = 2;
    while !used.insert(n.clone()) { n = format!("{base}-{i}"); i += 1 }
    n
}

fn clean(s: &str) -> String { s.replace('\n', " ").trim().to_string() }

/// Returns `(note name, content)` pairs. Empty when the folder has nothing indexable.
/// Note format version: bump when a property changes meaning, so a stale graph can be told from a current one.
pub const SCHEMA: u32 = 2; // 2: `~` before a file in ?calls / ?callers marks a link guessed by symbol name

pub fn scan(root: &Path) -> Vec<(String, String)> {
    let mut paths = vec![];
    walk(root, root, &mut paths);
    paths.sort();
    let all: HashSet<String> = paths.iter().map(|p| rel(p, root)).collect();

    let mut files: Vec<File> = vec![];
    for p in &paths {
        let Ok(src) = fs::read_to_string(p) else { continue };
        let r = rel(p, root);
        let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
        let (about, exports, imports) = parse(&r, &ext, &src, &all);
        let syms = syms(&ext, &src);
        files.push(File { rel: r, doc: doc_text(&ext, &src), ext, lines: src.lines().count(), bytes: src.len(), about, exports, imports, syms, degree: 0, idents: ident_set(&src), calls: vec![], callers: vec![] });
    }
    if files.is_empty() { return vec![] }

    // A file that mentions a route or Tauri command points at the file that defines it (server <-> launcher <-> bot).
    let mut route_def: HashMap<String, Vec<String>> = HashMap::new();
    let mut cmd_def: HashMap<String, Vec<String>> = HashMap::new();
    for f in &files {
        for r in f.syms.routes.iter().filter(|r| r.len() > 5) { route_def.entry(r.clone()).or_default().push(f.rel.clone()) }
        for c in &f.syms.cmds { cmd_def.entry(c.clone()).or_default().push(f.rel.clone()) }
    }
    for f in &mut files {
        let found: Vec<String> = f.syms.uses_routes.iter().filter_map(|r| route_def.get(r)).chain(f.syms.uses_cmds.iter().filter_map(|c| cmd_def.get(c))).flatten().cloned().collect();
        for d in found { if d != f.rel && !f.imports.contains(&d) { f.imports.push(d) } }
    }

    // Edges named in the source (import line, route, command) are certain; the symbol edges below are a guess by name and get a `~`.
    let explicit: Vec<HashSet<String>> = files.iter().map(|f| f.imports.iter().cloned().collect()).collect();
    // Symbol-level edges, deeper than imports: a file that uses a function, class or constant defined in exactly one other file
    // points at it (calls, inheritance, shared constants), even without an import line (dynamic loading, same package, other language).
    let mut def_in: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, f) in files.iter().enumerate() { for y in f.syms.other.iter().filter(|y| y.len() >= 6 || (y.len() == 5 && y.starts_with(char::is_uppercase)) || y.contains('_')) { def_in.entry(y.as_str()).or_default().push(i) } }
    let mut found: Vec<Vec<(usize, Vec<String>)>> = vec![];
    for (i, f) in files.iter().enumerate() {
        let mut by_file: HashMap<usize, Vec<String>> = HashMap::new();
        for w in &f.idents { if let Some([j]) = def_in.get(w.as_str()).map(|v| v.as_slice()) { if *j != i { by_file.entry(*j).or_default().push(w.clone()) } } }
        let mut v: Vec<(usize, Vec<String>)> = by_file.into_iter().collect();
        for (_, syms) in &mut v { syms.sort() }
        v.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(files[a.0].rel.cmp(&files[b.0].rel)));
        v.truncate(MAX_CALLS);
        found.push(v);
    }
    for (i, v) in found.into_iter().enumerate() {
        for (j, syms) in v {
            let (from, to) = (files[i].rel.clone(), files[j].rel.clone());
            let mark = if explicit[i].contains(&to) { "" } else { "~" };
            if !files[i].imports.contains(&to) { files[i].imports.push(to.clone()) }
            files[j].callers.push(format!("{mark}{from}"));
            files[i].calls.push((format!("{mark}{to}"), syms.into_iter().take(3).collect()));
        }
    }
    for f in &mut files { f.idents = HashSet::new(); f.callers.sort_by_key(|c| (c.starts_with('~'), c.clone())); f.callers.truncate(MAX_CALLS) }

    let mut deg: HashMap<String, usize> = HashMap::new();
    for f in &files {
        for i in &f.imports { *deg.entry(i.clone()).or_default() += 1; *deg.entry(f.rel.clone()).or_default() += 1 }
    }
    for f in &mut files { f.degree = deg.get(&f.rel).copied().unwrap_or(0) }
    let total = files.len();
    let source_bytes: usize = files.iter().map(|f| f.bytes).sum(); // all scanned files, not just the indexed ones
    // Keep the most useful nodes; ties broken by size, then path (deterministic).
    files.sort_by(|a, b| (b.degree * 100 + b.lines.min(99)).cmp(&(a.degree * 100 + a.lines.min(99))).then(a.rel.cmp(&b.rel)));
    files.truncate(std::env::var("ARMYX_MAX_NODES").ok().and_then(|v| v.parse().ok()).unwrap_or(MAX_NODES)); // the env override is for the CLI and benchmarks; the app keeps its cap
    files.sort_by(|a, b| a.rel.cmp(&b.rel));

    let mut used: HashSet<String> = HashSet::from(["project-map".to_string()]);
    let names: HashMap<String, String> = files.iter().map(|f| (f.rel.clone(), note_name(&f.rel, &mut used))).collect();

    let mut out: Vec<(String, String)> = vec![];
    let mut by_dir: BTreeMap<String, usize> = BTreeMap::new();
    for f in &files {
        let top = f.rel.split('/').next().filter(|_| f.rel.contains('/')).unwrap_or(".");
        *by_dir.entry(top.to_string()).or_default() += 1;
        let mut s = format!("# {}\n?path: {}\n?kind: {}\n?lines: {}\n?generated: scan\n", f.rel, f.rel, f.ext, f.lines);
        if !f.about.is_empty() { s += &format!("?about: {}\n", clean(&f.about)) }
        if !f.doc.is_empty() { s += &format!("?doc: {}
", clean(&f.doc)) }
        if !f.calls.is_empty() { s += &format!("?calls: {}
", f.calls.iter().map(|(p, y)| format!("{p}({})", y.join("+"))).collect::<Vec<_>>().join(", ")) }
        if !f.callers.is_empty() { s += &format!("?callers: {}
", f.callers.join(", ")) }
        if !f.exports.is_empty() { s += &format!("?exports: {}\n", f.exports.join(", ")) }
        let sy: Vec<&str> = f.syms.routes.iter().chain(&f.syms.cmds).chain(&f.syms.other).map(|x| x.as_str()).take(60).collect();
        if !sy.is_empty() { s += &format!("?symbols: {}\n", sy.join(", ")) }
        let tag: String = top.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        s += &format!("#{}", if f.ext.is_empty() { "file" } else { &f.ext });
        if tag.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) { s += &format!(" #{tag}") }
        s += "\n";
        for i in f.imports.iter().filter_map(|i| names.get(i)).take(MAX_LINKS) { s += &format!("->@{i}\n") }
        out.push((names[&f.rel].clone(), s));
    }

    let mut hubs: Vec<&File> = files.iter().collect();
    hubs.sort_by(|a, b| b.degree.cmp(&a.degree).then(a.rel.cmp(&b.rel)));
    let name = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mut m = format!("# project-map\n?root: {name}\n?generated: scan\n?schema: {SCHEMA}\n?files: {total} scanned, {} indexed\n?source_bytes: {source_bytes}\n#overview\n", files.len());
    for (d, n) in &by_dir { m += &format!("{d}: {n} files\n") }
    m += "Hubs (most connected):\n";
    for h in hubs.iter().filter(|h| h.degree > 0).take(12) { m += &format!("->@{}\n", names[&h.rel]) }
    out.push(("project-map".into(), m));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_imports_and_names() {
        let dir = std::env::temp_dir().join(format!("deso-scan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src/ui")).unwrap();
        fs::create_dir_all(dir.join("node_modules/x")).unwrap();
        fs::write(dir.join("src/app.ts"), "// entry point\nimport { b } from './ui/b'\nexport function main() {}\n").unwrap();
        fs::write(dir.join("src/ui/b.ts"), "export const b = 1\n").unwrap();
        fs::write(dir.join("node_modules/x/i.js"), "x").unwrap();
        let notes = scan(&dir);
        let get = |n: &str| notes.iter().find(|x| x.0 == n).unwrap().1.clone();
        let app = get("src-app-ts");
        assert!(app.contains("->@src-ui-b-ts"), "{app}");
        assert!(app.contains("?exports: main"));
        assert!(app.contains("?about: entry point"));
        assert!(notes.iter().all(|n| !n.0.contains("node-modules")));
        assert!(get("project-map").contains("->@src-ui-b-ts"));
        assert!(get("project-map").contains("?source_bytes: "));
        assert!(get("project-map").contains(&format!("?schema: {SCHEMA}")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn links_files_by_the_symbols_they_use_without_an_import() {
        let dir = std::env::temp_dir().join(format!("deso-scan-sym-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("rules.py"), "def compute_discount(total):
    return total

class BaseRule:
    pass
").unwrap();
        fs::write(dir.join("shop.py"), "def checkout(cart):
    return compute_discount(cart)

class Premium(BaseRule):
    pass
").unwrap();
        let notes = scan(&dir);
        let get = |n: &str| notes.iter().find(|x| x.0 == n).unwrap().1.clone();
        let (shop, rules) = (get("shop-py"), get("rules-py"));
        assert!(shop.contains("?calls: ~rules.py(BaseRule+compute_discount)"), "{shop}"); // guessed by name, so marked
        assert!(shop.contains("->@rules-py"), "{shop}");
        assert!(rules.contains("?callers: ~shop.py"), "{rules}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_import_line_makes_the_link_certain() {
        let dir = std::env::temp_dir().join(format!("deso-scan-c-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("lib.ts"), "export function computeDiscount() {}
").unwrap();
        fs::write(dir.join("shop.ts"), "import { computeDiscount } from './lib'
export function checkout() { computeDiscount() }
").unwrap();
        let notes = scan(&dir);
        let shop = &notes.iter().find(|x| x.0 == "shop-ts").unwrap().1;
        assert!(shop.contains("?calls: lib.ts(computeDiscount)"), "{shop}");
        assert!(!shop.contains('~'), "{shop}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn links_routes_and_commands_across_projects() {
        let dir = std::env::temp_dir().join(format!("deso-scan-x-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("Server")).unwrap();
        fs::create_dir_all(dir.join("App/src-tauri")).unwrap();
        fs::create_dir_all(dir.join("App/src")).unwrap();
        fs::write(dir.join("Server/pay.js"), "router.post('/api/pay/create', (req, res) => {})
const PAY_LIMIT = 1
").unwrap();
        fs::write(dir.join("App/src-tauri/auth.rs"), "#[tauri::command]
pub async fn auth_pay() {
  post(format!(\"{BASE}/api/pay/create\"))
}
").unwrap();
        fs::write(dir.join("App/src/Page.tsx"), "invoke('auth_pay')
").unwrap();
        let notes = scan(&dir);
        let get = |n: &str| notes.iter().find(|x| x.0 == n).unwrap().1.clone();
        assert!(get("server-pay-js").contains("?symbols: /api/pay/create, PAY_LIMIT"), "{}", get("server-pay-js"));
        assert!(get("app-src-tauri-auth-rs").contains("->@server-pay-js"));
        assert!(get("app-src-page-tsx").contains("->@app-src-tauri-auth-rs"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn join_normalizes() {
        assert_eq!(join("src/ui", "../lib/x"), "src/lib/x");
        assert_eq!(join("", "./a"), "a");
    }
}
