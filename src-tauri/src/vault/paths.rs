//! Vault-relative paths always use `/` separators, never start with `/`,
//! and never contain `.` or `..` segments.

use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

pub fn normalize_rel(rel: &str) -> AppResult<String> {
    let cleaned = rel.trim().replace('\\', "/");
    let mut parts = Vec::new();
    for part in cleaned.split('/') {
        match part {
            "" | "." => continue,
            ".." => return Err(AppError::InvalidPath(rel.to_string())),
            p => parts.push(p),
        }
    }
    if parts.is_empty() {
        return Err(AppError::InvalidPath(rel.to_string()));
    }
    Ok(parts.join("/"))
}

/// Joins a vault-relative path onto the vault root, refusing anything that
/// would land outside it (including through symlinks of existing paths).
pub fn resolve_in_vault(root: &Path, rel: &str) -> AppResult<PathBuf> {
    let rel = normalize_rel(rel)?;
    let full = root.join(&rel);
    if let Ok(canon) = full.canonicalize() {
        let root_canon = root.canonicalize()?;
        if !canon.starts_with(&root_canon) {
            return Err(AppError::InvalidPath(rel));
        }
    }
    Ok(full)
}

pub fn to_rel(root: &Path, full: &Path) -> Option<String> {
    let rel = full.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for c in rel.components() {
        match c {
            Component::Normal(s) => parts.push(s.to_str()?.to_string()),
            _ => return None,
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

pub fn is_hidden_rel(rel: &str) -> bool {
    rel.split('/').any(|p| p.starts_with('.'))
}

pub fn parent_dir(path: &str) -> &str {
    match path.rfind('/') {
        Some(i) => &path[..i],
        None => "",
    }
}

pub fn file_name(path: &str) -> &str {
    match path.rfind('/') {
        Some(i) => &path[i + 1..],
        None => path,
    }
}

/// `Some(path without .md)` when the path is a markdown note.
pub fn note_stem(path: &str) -> Option<&str> {
    let n = path.len();
    if n > 3 && path.is_char_boundary(n - 3) && path[n - 3..].eq_ignore_ascii_case(".md") {
        Some(&path[..n - 3])
    } else {
        None
    }
}

pub fn is_note(path: &str) -> bool {
    note_stem(path).is_some()
}

pub fn title_of(path: &str) -> String {
    let name = file_name(path);
    note_stem(name).unwrap_or(name).to_string()
}

/// Joins `rel` onto `dir`, resolving `.` and `..`. Returns `None` if the
/// result would climb above the vault root.
pub fn join_normalize(dir: &str, rel: &str) -> Option<String> {
    let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    for part in rel.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            p => parts.push(p),
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

/// Relative path from directory `from_dir` to file `to`, both vault-relative.
pub fn relative_path(from_dir: &str, to: &str) -> String {
    let from: Vec<&str> = from_dir.split('/').filter(|p| !p.is_empty()).collect();
    let to_parts: Vec<&str> = to.split('/').filter(|p| !p.is_empty()).collect();
    let common = from
        .iter()
        .zip(to_parts.iter())
        .take_while(|(a, b)| a == b)
        .count();
    let mut out: Vec<&str> = Vec::new();
    for _ in common..from.len() {
        out.push("..");
    }
    out.extend_from_slice(&to_parts[common..]);
    out.join("/")
}

pub fn encode_md_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for c in path.chars() {
        match c {
            ' ' => out.push_str("%20"),
            '(' => out.push_str("%28"),
            ')' => out.push_str("%29"),
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            _ => out.push(c),
        }
    }
    out
}

pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(hi * 16 + lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_rejects_traversal() {
        assert!(normalize_rel("../etc/passwd").is_err());
        assert!(normalize_rel("a/../../b").is_err());
        assert!(normalize_rel("").is_err());
        assert_eq!(normalize_rel("/a//b/./c.md").unwrap(), "a/b/c.md");
    }

    #[test]
    fn stems_and_titles() {
        assert_eq!(note_stem("A/B.md"), Some("A/B"));
        assert_eq!(note_stem("A/B.MD"), Some("A/B"));
        assert_eq!(note_stem("img.png"), None);
        assert_eq!(title_of("Folder/My Note.md"), "My Note");
        assert_eq!(title_of("img.png"), "img.png");
    }

    #[test]
    fn joins_and_relatives() {
        assert_eq!(join_normalize("a/b", "../c.md").as_deref(), Some("a/c.md"));
        assert_eq!(join_normalize("", "../c.md"), None);
        assert_eq!(relative_path("a/b", "a/c/d.md"), "../c/d.md");
        assert_eq!(relative_path("", "x/y.md"), "x/y.md");
        assert_eq!(relative_path("x", "x/y.md"), "y.md");
    }

    #[test]
    fn percent_round_trip() {
        assert_eq!(percent_decode("My%20Note.md"), "My Note.md");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(encode_md_path("a b (1).md"), "a%20b%20%281%29.md");
    }
}
