mod commands;
mod error;
mod events;
mod menu;
mod recent;
pub mod vault;

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WindowEvent};

/// Asks the window to save pending edits and quit. If it doesn't answer
/// within two seconds (a hung page), quit anyway.
fn request_quit(app: &AppHandle) {
    let _ = app.emit(events::MENU, "app.quit");
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2));
        handle.exit(0);
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::new())
        .menu(menu::build)
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            if id == "app.quit" {
                request_quit(app);
            } else {
                let _ = app.emit(events::MENU, id);
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                request_quit(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::pick_vault_folder,
            commands::open_vault,
            commands::close_vault,
            commands::current_vault,
            commands::list_recent_vaults,
            commands::remove_recent_vault,
            commands::list_files,
            commands::graph_snapshot,
            commands::link_targets,
            commands::read_note,
            commands::write_note,
            commands::create_note,
            commands::create_folder,
            commands::rename_path,
            commands::delete_path,
            commands::resolve_link,
            commands::note_links,
            commands::unlinked_mentions,
            commands::link_mention,
            commands::search,
            commands::similar_notes,
            commands::ghost_links,
            commands::read_app_file,
            commands::write_app_file,
            commands::reveal_in_finder,
            commands::reveal_vault,
            commands::open_in_default_app,
            commands::save_attachment,
            commands::quit_app,
            commands::open_external,
            commands::install_sample_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Amethyst");
}
