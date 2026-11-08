//! `cargo run --example scan -- <project dir> <out dir>`: write the scanned graph as .deso files (used by bench/).
use std::{env, fs, path::Path};

fn main() {
    let a: Vec<String> = env::args().collect();
    let (src, out) = (a.get(1).expect("project dir"), a.get(2).expect("out dir"));
    fs::create_dir_all(out).unwrap();
    // a rescan must not leave notes of deleted files behind
    for e in fs::read_dir(out).unwrap().flatten() { if e.path().extension().is_some_and(|x| x == "deso") { let _ = fs::remove_file(e.path()); } }
    let notes = deso_vault_lib::scan::scan(Path::new(src));
    for (n, c) in &notes { fs::write(Path::new(out).join(format!("{n}.deso")), c).unwrap() }
    println!("{} notes", notes.len());
}
