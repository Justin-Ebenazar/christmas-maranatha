use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_wallpaper::{PinRequest, WallpaperExt}; // Import for the pin feature

fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit("settings-visible", true);
    }
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    show_settings(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // must be first: a second launch just opens settings
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_settings(app)))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        // Register the wallpaper plugin for the pin feature
        .plugin(tauri_plugin_wallpaper::init())
        .invoke_handler(tauri::generate_handler![open_settings])
        .setup(|app| {
            // Initial placement (JS refines it when taskbarHeight changes)
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let size = monitor.size();
                    let pos = monitor.position();
                    let h = (48.0 * monitor.scale_factor()).round() as u32;
                    let _ = window.set_size(PhysicalSize::new(size.width, h));
                    let _ = window.set_position(PhysicalPosition::new(
                        pos.x,
                        pos.y + size.height as i32 - h as i32,
                    ));
                }
                
                // PIN the main window so it stays above the taskbar and survives Win+D
                if let Err(e) = app.wallpaper().pin(PinRequest::new("main")) {
                    eprintln!("Failed to pin main window: {}", e);
                }
                
                let _ = window.show();
            }

            // Closing the settings window hides it instead of destroying it
            if let Some(w) = app.get_webview_window("settings") {
                let win = w.clone();
                let handle = app.handle().clone();
                w.on_window_event(move |e| {
                    if let WindowEvent::CloseRequested { api, .. } = e {
                        api.prevent_close();
                        let _ = win.hide();
                        let _ = handle.emit("settings-visible", false);
                    }
                });
            }

            // Tray: right-click menu
            let settings_i = MenuItem::with_id(app, "settings", "Open settings", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Maranatha", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings_i, &quit_i])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Maranatha")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => show_settings(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_settings(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}