use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Wry};

fn item(app: &AppHandle, id: &str, label: &str, accel: Option<&str>) -> tauri::Result<tauri::menu::MenuItem<Wry>> {
    let mut b = MenuItemBuilder::with_id(id, label);
    if let Some(a) = accel {
        b = b.accelerator(a);
    }
    b.build(app)
}

/// Text formatting (bold, italic, ...) is handled by the editor's own keymap,
/// not the menu, so a shortcut never toggles twice.
pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let app_menu = SubmenuBuilder::new(app, "Amethyst")
        .about(None)
        .separator()
        .item(&item(app, "settings.open", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&item(app, "app.quit", "Quit Amethyst", Some("CmdOrCtrl+Q"))?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item(app, "note.new", "New Note", Some("CmdOrCtrl+N"))?)
        .item(&item(app, "folder.new", "New Folder", None)?)
        .item(&item(app, "note.today", "Today’s Daily Note", None)?)
        .separator()
        .item(&item(app, "vault.open", "Open Vault…", Some("CmdOrCtrl+Shift+O"))?)
        .item(&item(app, "vault.reveal", "Show Vault in Finder", None)?)
        .item(&item(app, "vault.close", "Close Vault", None)?)
        .separator()
        .item(&item(app, "note.rename", "Rename Note…", None)?)
        .item(&item(app, "note.duplicate", "Make a Copy", None)?)
        .item(&item(app, "note.copyLink", "Copy Link to Note", None)?)
        .item(&item(app, "note.reveal", "Reveal in Finder", None)?)
        .item(&item(app, "note.delete", "Move Note to Trash", None)?)
        .separator()
        .item(&item(app, "tab.close", "Close Tab", Some("CmdOrCtrl+W"))?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item(app, "palette.open", "Command Palette", Some("CmdOrCtrl+K"))?)
        .item(&item(app, "switcher.open", "Quick Switcher", Some("CmdOrCtrl+O"))?)
        .item(&item(app, "search.open", "Search Vault", Some("CmdOrCtrl+Shift+F"))?)
        .separator()
        .item(&item(app, "mode.toggle", "Toggle Graph Mode", Some("CmdOrCtrl+G"))?)
        .item(&item(app, "graph.dimension", "Toggle 2D / 3D", Some("CmdOrCtrl+Shift+D"))?)
        .item(&item(app, "note.reading", "Toggle Reading View", Some("CmdOrCtrl+E"))?)
        .item(&item(app, "view.left", "Toggle Sidebar", Some("CmdOrCtrl+\\"))?)
        .separator()
        .item(&item(app, "graph.radar", "Vault Radar", Some("CmdOrCtrl+Shift+R"))?)
        .item(&item(app, "graph.path", "Find Path Between Notes", Some("CmdOrCtrl+Shift+P"))?)
        .item(&item(app, "graph.timelapse", "Time-lapse", Some("CmdOrCtrl+Shift+T"))?)
        .separator()
        .fullscreen()
        .build()?;

    let go = SubmenuBuilder::new(app, "Go")
        .item(&item(app, "nav.back", "Back", Some("CmdOrCtrl+["))?)
        .item(&item(app, "nav.forward", "Forward", Some("CmdOrCtrl+]"))?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;

    MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &view, &go, &window]).build()
}
