use std::collections::BTreeSet;
use std::fs::Metadata;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use walkdir::WalkDir;

use super::paths::{is_note, to_rel};
use crate::error::AppResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    Note,
    Attachment,
}

#[derive(Debug, Clone)]
pub struct ScannedFile {
    pub path: String,
    pub kind: FileKind,
    pub modified: i64,
    pub created: i64,
    pub size: u64,
}

pub struct Scan {
    pub files: Vec<ScannedFile>,
    pub folders: BTreeSet<String>,
}

/// Walks the vault, skipping every dot-folder and dot-file (`.obsidian`,
/// `.amethyst`, `.git`, `.trash`, ...), the same set Obsidian ignores.
pub fn scan(root: &Path) -> AppResult<Scan> {
    let mut files = Vec::new();
    let mut folders = BTreeSet::new();
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'));
    for entry in walker.filter_map(Result::ok) {
        if entry.depth() == 0 {
            continue;
        }
        let Some(rel) = to_rel(root, entry.path()) else {
            continue;
        };
        let ft = entry.file_type();
        if ft.is_dir() {
            folders.insert(rel);
        } else if ft.is_file() {
            let Ok(meta) = entry.metadata() else { continue };
            files.push(scanned(rel, &meta));
        }
    }
    Ok(Scan { files, folders })
}

pub fn scanned(path: String, meta: &Metadata) -> ScannedFile {
    let modified = meta.modified().map(ms).unwrap_or(0);
    let created = meta.created().map(ms).unwrap_or(modified);
    ScannedFile {
        kind: if is_note(&path) { FileKind::Note } else { FileKind::Attachment },
        path,
        modified,
        created,
        size: meta.len(),
    }
}

fn ms(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}
