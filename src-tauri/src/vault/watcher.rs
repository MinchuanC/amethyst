use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify_debouncer_full::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
use tauri::AppHandle;

use super::paths::{is_hidden_rel, to_rel};
use super::Vault;
use crate::events::{emit_change, Origin};

pub type SharedVault = Arc<Mutex<Option<Vault>>>;

/// Dropping the handle stops the watcher thread (and its debouncer).
pub struct WatchHandle {
    stop: Arc<AtomicBool>,
}

impl Drop for WatchHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

pub fn start(app: AppHandle, shared: SharedVault, root: PathBuf) -> WatchHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    std::thread::spawn(move || {
        let (tx, rx) = channel::<DebounceEventResult>();
        let mut debouncer = match new_debouncer(Duration::from_millis(300), None, tx) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("amethyst: watcher failed to start: {e}");
                return;
            }
        };
        if let Err(e) = debouncer.watch(&root, RecursiveMode::Recursive) {
            eprintln!("amethyst: cannot watch {}: {e}", root.display());
            return;
        }
        while !stop_flag.load(Ordering::SeqCst) {
            let events = match rx.recv_timeout(Duration::from_millis(400)) {
                Ok(Ok(events)) => events,
                Ok(Err(_)) | Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break,
            };
            let relevant = events.iter().any(|e| {
                e.paths.iter().any(|p| match to_rel(&root, p) {
                    Some(rel) => !is_hidden_rel(&rel),
                    None => true,
                })
            });
            if !relevant || stop_flag.load(Ordering::SeqCst) {
                continue;
            }
            let change = {
                let mut guard = shared.lock().unwrap_or_else(|p| p.into_inner());
                match guard.as_mut() {
                    Some(v) if v.root == root => v.index.refresh(&v.root).ok(),
                    _ => None,
                }
            };
            if let Some(cs) = change {
                if !cs.is_empty() {
                    emit_change(&app, cs, Origin::External);
                }
            }
        }
    });
    WatchHandle { stop }
}
