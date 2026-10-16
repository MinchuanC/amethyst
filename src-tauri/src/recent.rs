use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::vault::VaultInfo;

const MAX_RECENT: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentVault {
    pub path: String,
    pub name: String,
    pub last_opened: i64,
}

fn store_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_config_dir().map_err(|e| AppError::Other(e.to_string()))?;
    Ok(dir.join("recent-vaults.json"))
}

fn load(app: &AppHandle) -> Vec<RecentVault> {
    store_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, list: &[RecentVault]) -> AppResult<()> {
    let path = store_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(list)?)?;
    Ok(())
}

pub fn list(app: &AppHandle) -> Vec<RecentVault> {
    load(app).into_iter().filter(|r| Path::new(&r.path).is_dir()).collect()
}

pub fn touch(app: &AppHandle, info: &VaultInfo) -> AppResult<()> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    let mut list = load(app);
    list.retain(|r| r.path != info.root);
    list.insert(0, RecentVault { path: info.root.clone(), name: info.name.clone(), last_opened: now });
    list.truncate(MAX_RECENT);
    save(app, &list)
}

pub fn remove(app: &AppHandle, path: &str) -> AppResult<()> {
    let mut list = load(app);
    list.retain(|r| r.path != path);
    save(app, &list)
}
