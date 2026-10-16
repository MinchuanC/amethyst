pub mod index;
pub mod parser;
pub mod paths;
pub mod resolver;
pub mod scanner;
pub mod similar;
pub mod watcher;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use index::{ChangeSet, Index};
use paths::{is_note, resolve_in_vault};

pub const APP_DIR: &str = ".amethyst";
pub const TRASH_DIR: &str = ".trash";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub root: String,
    pub name: String,
    pub note_count: usize,
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub new_path: String,
    pub updated_files: Vec<String>,
    pub updated_links: usize,
}

pub struct Vault {
    pub root: PathBuf,
    pub name: String,
    pub index: Index,
}

impl Vault {
    pub fn open(path: &Path) -> AppResult<Vault> {
        let root = path.canonicalize()?;
        if !root.is_dir() {
            return Err(AppError::NotFound(path.display().to_string()));
        }
        let name = root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Vault".to_string());
        let index = Index::build(&root)?;
        Ok(Vault { root, name, index })
    }

    pub fn info(&self) -> VaultInfo {
        let files: Vec<_> = self.index.files().collect();
        VaultInfo {
            root: self.root.to_string_lossy().into_owned(),
            name: self.name.clone(),
            note_count: files.iter().filter(|f| is_note(&f.path)).count(),
            file_count: files.len(),
        }
    }

    pub fn read_note(&self, rel: &str) -> AppResult<String> {
        let full = resolve_in_vault(&self.root, rel)?;
        if !full.is_file() {
            return Err(AppError::NotFound(rel.to_string()));
        }
        let bytes = fs::read(full)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// Writes in place (not write-then-rename) so the file keeps its
    /// creation date, which the time-lapse relies on.
    pub fn write_note(&mut self, rel: &str, contents: &str) -> AppResult<ChangeSet> {
        let rel = paths::normalize_rel(rel)?;
        let full = resolve_in_vault(&self.root, &rel)?;
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&full, contents)?;
        self.index.update_file(&self.root, &rel)
    }

    pub fn create_note(&mut self, rel: &str, contents: &str) -> AppResult<(String, ChangeSet)> {
        let mut rel = paths::normalize_rel(rel)?;
        if !is_note(&rel) {
            rel.push_str(".md");
        }
        let rel = self.unique_path(&rel)?;
        let full = resolve_in_vault(&self.root, &rel)?;
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&full, contents)?;
        let cs = self.index.refresh(&self.root)?;
        Ok((rel, cs))
    }

    pub fn create_folder(&mut self, rel: &str) -> AppResult<(String, ChangeSet)> {
        let rel = self.unique_path(&paths::normalize_rel(rel)?)?;
        fs::create_dir_all(resolve_in_vault(&self.root, &rel)?)?;
        let cs = self.index.refresh(&self.root)?;
        Ok((rel, cs))
    }

    fn unique_path(&self, rel: &str) -> AppResult<String> {
        if !resolve_in_vault(&self.root, rel)?.exists() {
            return Ok(rel.to_string());
        }
        let name = paths::file_name(rel);
        let split = name.rfind('.').filter(|&i| i > 0).map(|i| rel.len() - name.len() + i);
        let (stem, ext) = match split {
            Some(i) => (&rel[..i], &rel[i..]),
            None => (rel, ""),
        };
        for i in 1..1000 {
            let candidate = format!("{stem} {i}{ext}");
            if !resolve_in_vault(&self.root, &candidate)?.exists() {
                return Ok(candidate);
            }
        }
        Err(AppError::AlreadyExists(rel.to_string()))
    }

    /// Saves pasted or dropped bytes as an attachment: into a top-level
    /// `attachments` folder when the vault has one, otherwise beside the note.
    pub fn save_attachment(&mut self, name: &str, bytes: &[u8], near: Option<&str>) -> AppResult<(String, ChangeSet)> {
        let cleaned: String = name
            .chars()
            .map(|c| if matches!(c, '/' | '\\' | ':' | '[' | ']' | '#' | '^' | '|' | '?' | '*') { '-' } else { c })
            .collect();
        let cleaned = cleaned.trim().trim_start_matches('.');
        let file = if cleaned.is_empty() { "attachment" } else { cleaned };
        let folder = fs::read_dir(&self.root)?
            .filter_map(Result::ok)
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .find(|n| n.eq_ignore_ascii_case("attachments"))
            .unwrap_or_else(|| near.map(|p| paths::parent_dir(p).to_string()).unwrap_or_default());
        let rel = if folder.is_empty() { file.to_string() } else { format!("{folder}/{file}") };
        let rel = self.unique_path(&paths::normalize_rel(&rel)?)?;
        let full = resolve_in_vault(&self.root, &rel)?;
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&full, bytes)?;
        let cs = self.index.refresh(&self.root)?;
        Ok((rel, cs))
    }

    /// Moves a file or folder and rewrites every link that pointed into it.
    pub fn rename(&mut self, from: &str, to: &str) -> AppResult<(RenameResult, ChangeSet)> {
        let from = paths::normalize_rel(from)?;
        let mut to = paths::normalize_rel(to)?;
        let from_full = resolve_in_vault(&self.root, &from)?;
        if !from_full.exists() {
            return Err(AppError::NotFound(from));
        }
        if is_note(&from) && !is_note(&to) && from_full.is_file() {
            to.push_str(".md");
        }
        if from == to {
            return Ok((
                RenameResult { new_path: to, updated_files: vec![], updated_links: 0 },
                ChangeSet::default(),
            ));
        }
        let to_full = resolve_in_vault(&self.root, &to)?;
        if to_full.exists() && !from.eq_ignore_ascii_case(&to) {
            return Err(AppError::AlreadyExists(to));
        }

        let mut moves: HashMap<String, String> = HashMap::new();
        if from_full.is_dir() {
            let prefix = format!("{from}/");
            for f in self.index.files() {
                if let Some(rest) = f.path.strip_prefix(&prefix) {
                    moves.insert(f.path.clone(), format!("{to}/{rest}"));
                }
            }
        } else {
            moves.insert(from.clone(), to.clone());
        }
        let edits = self.index.plan_link_edits(&moves);
        let (old_nodes, old_edges) = self.index.graph_maps();

        if let Some(parent) = to_full.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&from_full, &to_full)?;
        let mut cs = self.index.refresh(&self.root)?;

        let mut by_source: HashMap<String, Vec<(usize, usize, String, String)>> = HashMap::new();
        for edit in &edits {
            if let Some(new_text) = index::rewritten_target(self.index.resolver(), edit) {
                by_source.entry(edit.source.clone()).or_default().push((
                    edit.target_start,
                    edit.target_end,
                    edit.original.clone(),
                    new_text,
                ));
            }
        }
        let mut updated_files = Vec::new();
        let mut updated_links = 0;
        for (source, mut list) in by_source {
            let full = resolve_in_vault(&self.root, &source)?;
            let Ok(mut text) = fs::read_to_string(&full) else { continue };
            list.sort_by(|a, b| b.0.cmp(&a.0));
            let mut applied = 0;
            for (start, end, original, replacement) in list {
                if text.get(start..end) == Some(original.as_str()) {
                    text.replace_range(start..end, &replacement);
                    applied += 1;
                }
            }
            if applied > 0 {
                fs::write(&full, text)?;
                updated_links += applied;
                updated_files.push(source);
            }
        }
        if !updated_files.is_empty() {
            let second = self.index.refresh(&self.root)?;
            cs.changed.extend(second.changed);
        }
        cs.delta = self.index.diff_since(&old_nodes, &old_edges);
        cs.changed.sort();
        cs.changed.dedup();
        Ok((RenameResult { new_path: to, updated_files, updated_links }, cs))
    }

    /// Moves to `<vault>/.trash/`, matching Obsidian's "move to Obsidian
    /// trash" option, so nothing is permanently deleted.
    pub fn delete(&mut self, rel: &str) -> AppResult<ChangeSet> {
        let rel = paths::normalize_rel(rel)?;
        let full = resolve_in_vault(&self.root, &rel)?;
        if !full.exists() {
            return Err(AppError::NotFound(rel));
        }
        let trash = self.root.join(TRASH_DIR);
        fs::create_dir_all(&trash)?;
        let name = paths::file_name(&rel).to_string();
        let mut dest = trash.join(&name);
        let mut i = 1;
        while dest.exists() {
            dest = trash.join(format!("{i} {name}"));
            i += 1;
        }
        fs::rename(&full, &dest)?;
        self.index.refresh(&self.root)
    }

    /// Replaces a plain-text mention with a wikilink to `target`.
    pub fn link_mention(&mut self, source: &str, offset: usize, length: usize, target: &str) -> AppResult<ChangeSet> {
        let mut text = self.read_note(source)?;
        let found = text
            .get(offset..offset + length)
            .ok_or_else(|| AppError::Conflict("The note changed; refresh mentions and try again".into()))?
            .to_string();
        let link_text = self.index.resolver().link_text_for(target);
        let record = self.index.file(target).ok_or_else(|| AppError::NotFound(target.to_string()))?;
        let found_lower = found.to_lowercase();
        let matches_name = paths::title_of(target).to_lowercase() == found_lower
            || record.parsed.aliases.iter().any(|a| a.to_lowercase() == found_lower);
        if !matches_name {
            return Err(AppError::Conflict("The note changed; refresh mentions and try again".into()));
        }
        let replacement = if paths::file_name(&link_text) == found {
            format!("[[{link_text}]]")
        } else {
            format!("[[{link_text}|{found}]]")
        };
        text.replace_range(offset..offset + length, &replacement);
        self.write_note(source, &text)
    }

    pub fn read_app_file(&self, name: &str) -> AppResult<Option<String>> {
        let path = self.app_file_path(name)?;
        match fs::read_to_string(path) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn write_app_file(&self, name: &str, contents: &str) -> AppResult<()> {
        let path = self.app_file_path(name)?;
        fs::create_dir_all(path.parent().unwrap())?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, contents)?;
        fs::rename(tmp, path)?;
        Ok(())
    }

    fn app_file_path(&self, name: &str) -> AppResult<PathBuf> {
        let valid = !name.is_empty()
            && name.len() <= 40
            && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if !valid {
            return Err(AppError::InvalidPath(name.to_string()));
        }
        Ok(self.root.join(APP_DIR).join(format!("{name}.json")))
    }
}
