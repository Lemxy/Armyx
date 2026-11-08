//! Sandbox for an orchestra run: a git worktree on its own branch, next to the project (`<parent>/.armyx-worktrees/<project>-<id>`).
//! Agents work there with no permission prompts; the project is untouched until `apply` (a patch of everything they changed).
//! shortcut: one worktree per orchestra, so parallel agents share it; it starts from HEAD, so uncommitted work in the project is not in it.
use std::{fs, io::Write, path::{Path, PathBuf}, process::{Command, Stdio}};

fn git(dir: &Path, args: &[&str], input: Option<&[u8]>) -> Result<String, String> {
    let mut child = Command::new("git").arg("-C").arg(dir).args(args)
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|e| format!("git: {e}"))?;
    if let Some(i) = input { child.stdin.take().unwrap().write_all(i).map_err(|e| e.to_string())?; }
    let o = child.wait_with_output().map_err(|e| e.to_string())?;
    if o.status.success() { Ok(String::from_utf8_lossy(&o.stdout).into_owned()) } else { Err(String::from_utf8_lossy(&o.stderr).trim().to_string()) }
}

fn check(id: &str) -> Result<(), String> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') { Ok(()) } else { Err(format!("bad worktree id: {id}")) }
}

pub fn dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    check(id)?;
    let abs = std::path::absolute(root).map_err(|e| e.to_string())?;
    let name = abs.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(abs.parent().unwrap_or(&abs).join(".armyx-worktrees").join(format!("{name}-{id}")))
}

/// Creates the worktree (or reuses the existing one) and returns its folder. Fails if the project is not a git repo with a commit.
pub fn create(root: &Path, id: &str) -> Result<PathBuf, String> {
    let d = dir(root, id)?;
    if d.is_dir() { return Ok(d) }
    fs::create_dir_all(d.parent().unwrap()).map_err(|e| e.to_string())?;
    let _ = git(root, &["worktree", "prune"], None); // a folder deleted by hand leaves a stale entry that blocks `add`
    git(root, &["worktree", "add", "-B", &format!("armyx/{id}"), &d.to_string_lossy(), "HEAD"], None).map_err(|e| format!("cannot isolate (needs a git repository with a commit): {e}"))?;
    Ok(d)
}

/// What the agents changed so far: a file summary and the patch.
pub fn diff(root: &Path, id: &str) -> Result<String, String> {
    let d = dir(root, id)?;
    git(&d, &["add", "-A"], None)?;
    let stat = git(&d, &["diff", "--cached", "HEAD", "--stat"], None)?;
    Ok(if stat.trim().is_empty() { String::new() } else { format!("{stat}\n{}", git(&d, &["diff", "--cached", "HEAD"], None)?) })
}

/// A fingerprint of the code the agents see (HEAD, changes to tracked files, names of untracked ones), so a cached answer is not reused
/// after the code changed. Empty outside git. shortcut: an edit inside an already untracked file does not change it.
pub fn stamp(dir: &Path) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for a in [&["rev-parse", "HEAD"][..], &["diff", "HEAD"], &["status", "--porcelain"]] { git(dir, a, None).unwrap_or_default().hash(&mut h); }
    format!("{:x}", h.finish())
}

pub fn discard(root: &Path, id: &str) -> Result<(), String> {
    let d = dir(root, id)?;
    let _ = git(root, &["worktree", "remove", "--force", &d.to_string_lossy()], None);
    let _ = fs::remove_dir_all(&d);
    let _ = git(root, &["worktree", "prune"], None);
    let _ = git(root, &["branch", "-D", &format!("armyx/{id}")], None);
    Ok(())
}

/// Applies the agents' changes to the project's working tree (not committed), then removes the worktree.
/// Returns false when they changed nothing. On a conflict the project is left as it was and the worktree is kept.
pub fn apply(root: &Path, id: &str) -> Result<bool, String> {
    let d = dir(root, id)?;
    git(&d, &["add", "-A"], None)?;
    let patch = git(&d, &["diff", "--cached", "HEAD", "--binary"], None)?;
    if !patch.is_empty() { git(root, &["apply", "--whitespace=nowarn", "-"], Some(patch.as_bytes()))?; }
    discard(root, id)?;
    Ok(!patch.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sh(d: &Path, a: &[&str]) { git(d, &["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false"].iter().chain(a).copied().collect::<Vec<_>>().as_slice(), None).unwrap(); }

    #[test]
    fn isolate_review_apply_and_discard() {
        let base = std::env::temp_dir().join(format!("armyx-wt-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let root = base.join("proj");
        fs::create_dir_all(&root).unwrap();
        sh(&root, &["init", "-q"]);
        fs::write(root.join("a.txt"), "one\n").unwrap();
        sh(&root, &["add", "-A"]);
        sh(&root, &["commit", "-qm", "init"]);

        assert!(create(&root, "../x").is_err());
        let wt = create(&root, "t1").unwrap();
        assert_eq!(create(&root, "t1").unwrap(), wt); // reused
        let before = stamp(&root);
        fs::write(root.join("a.txt"), "edited
").unwrap();
        assert_ne!(stamp(&root), before);
        fs::write(root.join("a.txt"), "one
").unwrap();
        assert_eq!(stamp(&root), before);
        assert_eq!(diff(&root, "t1").unwrap(), "");
        fs::write(wt.join("a.txt"), "two\n").unwrap();
        fs::write(wt.join("b.txt"), "new\n").unwrap();
        assert!(diff(&root, "t1").unwrap().contains("a.txt"));
        assert_ne!(stamp(&wt), stamp(&root));
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "one\n"); // the project is untouched until apply

        assert!(apply(&root, "t1").unwrap());
        let lf = |f: &str| fs::read_to_string(root.join(f)).unwrap().replace("\r\n", "\n"); // autocrlf may write CRLF
        assert_eq!(lf("a.txt"), "two\n");
        assert_eq!(lf("b.txt"), "new\n");
        assert!(!wt.exists());

        let wt = create(&root, "t2").unwrap();
        fs::write(wt.join("c.txt"), "x\n").unwrap();
        discard(&root, "t2").unwrap();
        assert!(!wt.exists() && !root.join("c.txt").exists());
        let _ = fs::remove_dir_all(&base);
    }
}
