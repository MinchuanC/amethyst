use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::vault::index::ChangeSet;

pub const VAULT_CHANGED: &str = "vault:changed";
pub const MENU: &str = "menu";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    App,
    External,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultChanged {
    origin: Origin,
    #[serde(flatten)]
    change: ChangeSet,
}

pub fn emit_change(app: &AppHandle, change: ChangeSet, origin: Origin) {
    if let Err(e) = app.emit(VAULT_CHANGED, VaultChanged { origin, change }) {
        eprintln!("amethyst: failed to emit change: {e}");
    }
}
