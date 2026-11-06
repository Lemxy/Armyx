//! Project scanner: turns an arbitrary code/docs folder into a graph of `.deso` notes.
//! One note per source file (capped), edges from relative imports, plus a `project-map` overview.
//! Everything is computed first and written in one batch, so a failed scan leaves nothing half-written.
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

const MAX_FILES: usize = 4000; // files examined
const MAX_NODES: usize = 150; // notes written (most connected / largest first)
const MAX_BYTES: u64 = 512 * 1024;
const MAX_LINKS: usize = 25;
const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "out", "vendor", "venv", "__pycache__", "coverage", "bin", "obj"];
const EXTS: &[&str] = &["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "kt", "c", "h", "cpp", "hpp", "cs", "rb", "php", "swift", "md", "sh", "html", "css", "toml", "yml", "yaml"];

struct File {
    rel: String, // forward slashes
    ext: String,
    lines: usize,
    bytes: usize,
    about: String,
    exports: Vec<String>,
    imports: Vec<String>, // resolved rel paths (may point to files not in the set)
    degree: usize,
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
            if is_doc && !c.is_empty() { about = c.chars().take(100).collect() }
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
        files.push(File { rel: r, ext, lines: src.lines().count(), bytes: src.len(), about, exports, imports, degree: 0 });
    }
    if files.is_empty() { return vec![] }

    let mut deg: HashMap<String, usize> = HashMap::new();
    for f in &files {
        for i in &f.imports { *deg.entry(i.clone()).or_default() += 1; *deg.entry(f.rel.clone()).or_default() += 1 }
    }
    for f in &mut files { f.degree = deg.get(&f.rel).copied().unwrap_or(0) }
    let total = files.len();
    let source_bytes: usize = files.iter().map(|f| f.bytes).sum(); // all scanned files, not just the indexed ones
    // Keep the most useful nodes; ties broken by size, then path (deterministic).
    files.sort_by(|a, b| (b.degree * 100 + b.lines.min(99)).cmp(&(a.degree * 100 + a.lines.min(99))).then(a.rel.cmp(&b.rel)));
    files.truncate(MAX_NODES);
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
        if !f.exports.is_empty() { s += &format!("?exports: {}\n", f.exports.join(", ")) }
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
    let mut m = format!("# project-map\n?root: {name}\n?generated: scan\n?files: {total} scanned, {} indexed\n?source_bytes: {source_bytes}\n#overview\n", files.len());
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
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn join_normalizes() {
        assert_eq!(join("src/ui", "../lib/x"), "src/lib/x");
        assert_eq!(join("", "./a"), "a");
    }
}
