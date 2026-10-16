use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::error::{AppError, AppResult};
use crate::events::{emit_change, Origin};
use crate::recent::{self, RecentVault};
use crate::vault::index::{FileEntry, GraphSnapshot, LinkTarget, Mention, NoteLinks, SearchHit};
use crate::vault::similar::{GhostLink, SimilarNote};
use crate::vault::watcher::{self, SharedVault, WatchHandle};
use crate::vault::{paths, RenameResult, Vault, VaultInfo};

#[derive(Default)]
pub struct AppState {
    vault: SharedVault,
    watcher: Mutex<Option<WatchHandle>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState { vault: Arc::new(Mutex::new(None)), watcher: Mutex::new(None) }
    }

    fn with<T>(&self, f: impl FnOnce(&mut Vault) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self.vault.lock().unwrap_or_else(|p| p.into_inner());
        let vault = guard.as_mut().ok_or(AppError::NoVault)?;
        f(vault)
    }
}

#[tauri::command]
pub async fn pick_vault_folder(app: AppHandle) -> AppResult<Option<String>> {
    let picked = app.dialog().file().set_title("Choose a folder to open as a vault").blocking_pick_folder();
    Ok(picked
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn open_vault(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<VaultInfo> {
    let vault = Vault::open(Path::new(&path))?;
    let info = vault.info();
    let root = vault.root.clone();
    let _ = app.asset_protocol_scope().allow_directory(&root, true);
    *state.watcher.lock().unwrap_or_else(|p| p.into_inner()) = None;
    *state.vault.lock().unwrap_or_else(|p| p.into_inner()) = Some(vault);
    let handle = watcher::start(app.clone(), state.vault.clone(), root);
    *state.watcher.lock().unwrap_or_else(|p| p.into_inner()) = Some(handle);
    recent::touch(&app, &info)?;
    Ok(info)
}

#[tauri::command]
pub async fn close_vault(state: State<'_, AppState>) -> AppResult<()> {
    *state.watcher.lock().unwrap_or_else(|p| p.into_inner()) = None;
    *state.vault.lock().unwrap_or_else(|p| p.into_inner()) = None;
    Ok(())
}

#[tauri::command]
pub async fn current_vault(state: State<'_, AppState>) -> AppResult<Option<VaultInfo>> {
    let guard = state.vault.lock().unwrap_or_else(|p| p.into_inner());
    Ok(guard.as_ref().map(|v| v.info()))
}

#[tauri::command]
pub async fn list_recent_vaults(app: AppHandle) -> AppResult<Vec<RecentVault>> {
    Ok(recent::list(&app))
}

#[tauri::command]
pub async fn remove_recent_vault(app: AppHandle, path: String) -> AppResult<()> {
    recent::remove(&app, &path)
}

#[tauri::command]
pub async fn list_files(state: State<'_, AppState>) -> AppResult<Vec<FileEntry>> {
    state.with(|v| Ok(v.index.list_files()))
}

#[tauri::command]
pub async fn graph_snapshot(state: State<'_, AppState>) -> AppResult<GraphSnapshot> {
    state.with(|v| Ok(v.index.snapshot()))
}

#[tauri::command]
pub async fn link_targets(state: State<'_, AppState>) -> AppResult<Vec<LinkTarget>> {
    state.with(|v| Ok(v.index.link_targets()))
}

#[tauri::command]
pub async fn read_note(state: State<'_, AppState>, path: String) -> AppResult<String> {
    state.with(|v| v.read_note(&path))
}

#[tauri::command]
pub async fn write_note(app: AppHandle, state: State<'_, AppState>, path: String, contents: String) -> AppResult<()> {
    let cs = state.with(|v| v.write_note(&path, &contents))?;
    emit_change(&app, cs, Origin::App);
    Ok(())
}

#[tauri::command]
pub async fn create_note(app: AppHandle, state: State<'_, AppState>, path: String, contents: Option<String>) -> AppResult<String> {
    let (rel, cs) = state.with(|v| v.create_note(&path, contents.as_deref().unwrap_or("")))?;
    emit_change(&app, cs, Origin::App);
    Ok(rel)
}

#[tauri::command]
pub async fn create_folder(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<String> {
    let (rel, cs) = state.with(|v| v.create_folder(&path))?;
    emit_change(&app, cs, Origin::App);
    Ok(rel)
}

#[tauri::command]
pub async fn rename_path(app: AppHandle, state: State<'_, AppState>, from: String, to: String) -> AppResult<RenameResult> {
    let (result, cs) = state.with(|v| v.rename(&from, &to))?;
    emit_change(&app, cs, Origin::App);
    Ok(result)
}

#[tauri::command]
pub async fn delete_path(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<()> {
    let cs = state.with(|v| v.delete(&path))?;
    emit_change(&app, cs, Origin::App);
    Ok(())
}

#[tauri::command]
pub async fn resolve_link(state: State<'_, AppState>, target: String, from: String) -> AppResult<Option<String>> {
    state.with(|v| Ok(v.index.resolver().resolve(&target, &from, false).map(str::to_string)))
}

#[tauri::command]
pub async fn note_links(state: State<'_, AppState>, path: String) -> AppResult<NoteLinks> {
    state.with(|v| Ok(v.index.note_links(&path)))
}

#[tauri::command]
pub async fn unlinked_mentions(state: State<'_, AppState>, path: String) -> AppResult<Vec<Mention>> {
    state.with(|v| Ok(v.index.unlinked_mentions(&path)))
}

#[tauri::command]
pub async fn link_mention(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
    offset: usize,
    length: usize,
    target: String,
) -> AppResult<()> {
    let cs = state.with(|v| v.link_mention(&source, offset, length, &target))?;
    emit_change(&app, cs, Origin::App);
    Ok(())
}

#[tauri::command]
pub async fn search(state: State<'_, AppState>, query: String, limit: Option<usize>) -> AppResult<Vec<SearchHit>> {
    state.with(|v| Ok(v.index.search(&query, limit.unwrap_or(80))))
}

#[tauri::command]
pub async fn similar_notes(state: State<'_, AppState>, path: String, limit: Option<usize>) -> AppResult<Vec<SimilarNote>> {
    state.with(|v| Ok(v.index.similarity().similar(&path, limit.unwrap_or(8))))
}

#[tauri::command]
pub async fn ghost_links(state: State<'_, AppState>, threshold: Option<f32>, per_note: Option<usize>) -> AppResult<Vec<GhostLink>> {
    state.with(|v| {
        let linked = v.index.linked_pairs();
        Ok(v.index.similarity().ghost_links(threshold.unwrap_or(0.22), per_note.unwrap_or(2), &linked))
    })
}

#[tauri::command]
pub async fn read_app_file(state: State<'_, AppState>, name: String) -> AppResult<Option<String>> {
    state.with(|v| v.read_app_file(&name))
}

#[tauri::command]
pub async fn write_app_file(state: State<'_, AppState>, name: String, contents: String) -> AppResult<()> {
    state.with(|v| v.write_app_file(&name, &contents))
}

/// Copies the bundled sample vault into Application Support on first use
/// and returns its path.
#[tauri::command]
pub async fn install_sample_vault(app: AppHandle) -> AppResult<String> {
    let dest = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(e.to_string()))?
        .join("Sample Vault");
    if !dest.exists() {
        let src = app
            .path()
            .resolve("sample-vault", BaseDirectory::Resource)
            .map_err(|e| AppError::Other(e.to_string()))?;
        copy_dir(&src, &dest)?;
    }
    Ok(dest.to_string_lossy().into_owned())
}

fn copy_dir(from: &Path, to: &Path) -> AppResult<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if name == ".amethyst" || name == ".trash" {
            continue;
        }
        let dest = to.join(&name);
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

/// Opens a web or mail link in the default app. Only explicit user clicks
/// reach this; nothing is fetched by Amethyst itself.
#[tauri::command]
pub async fn open_external(url: String) -> AppResult<()> {
    let lower = url.to_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")) {
        return Err(AppError::InvalidPath(url));
    }
    std::process::Command::new("open").arg(&url).spawn()?;
    Ok(())
}

#[tauri::command]
pub async fn reveal_in_finder(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let full = state.with(|v| paths::resolve_in_vault(&v.root, &path))?;
    std::process::Command::new("open").arg("-R").arg(full).spawn()?;
    Ok(())
}

#[tauri::command]
pub async fn reveal_vault(state: State<'_, AppState>) -> AppResult<()> {
    let root = state.with(|v| Ok(v.root.clone()))?;
    std::process::Command::new("open").arg(root).spawn()?;
    Ok(())
}

/// Opens a vault file (a PDF, an image) in the app macOS uses for it.
#[tauri::command]
pub async fn open_in_default_app(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let full = state.with(|v| paths::resolve_in_vault(&v.root, &path))?;
    std::process::Command::new("open").arg(full).spawn()?;
    Ok(())
}

/// Stores pasted or dropped file bytes (base64) and returns the new vault path.
#[tauri::command]
pub async fn save_attachment(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    data: String,
    near: Option<String>,
) -> AppResult<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| AppError::Other(format!("Couldn't read the pasted file: {e}")))?;
    let (rel, cs) = state.with(|v| v.save_attachment(&name, &bytes, near.as_deref()))?;
    emit_change(&app, cs, Origin::App);
    Ok(rel)
}

/// Called by the window once unsaved edits are flushed.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
