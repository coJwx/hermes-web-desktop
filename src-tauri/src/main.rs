#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod about;
mod bridge;
mod dashboard_lifecycle;
mod desktop_menu;
mod desktop_preferences;
mod diagnostics;
mod instance;
mod leave_gate;
mod native_dialog;
mod persistence;
mod preference_recovery;
mod settings;
mod startup;
mod titlebar;
mod trusted_ui;
mod window_state;

use std::path::PathBuf;
use tauri::{Emitter, Manager, WebviewWindow, WebviewWindowBuilder};

struct DesktopState {
    settings_path: PathBuf,
    bridge: tokio::sync::Mutex<Option<bridge::Bridge>>,
    webview_dir: PathBuf,
    connection_error: std::sync::Mutex<Option<String>>,
    operations: tokio::sync::Mutex<()>,
}

fn trusted(window: &WebviewWindow) -> Result<(), String> {
    if !trusted_ui::matches(
        window.label(),
        "connection",
        &window.url().map_err(|e| e.to_string())?,
        "desktop-connection.html",
    ) {
        return Err(
            "Native connection commands are only available in the connection window.".into(),
        );
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct ConnectionSettings {
    backend_url: String,
    data_directory: String,
    error: Option<String>,
    servers: Vec<settings::ServerProfile>,
    active_id: Option<String>,
}

#[tauri::command]
fn connection_settings(
    window: WebviewWindow,
    state: tauri::State<'_, DesktopState>,
) -> Result<ConnectionSettings, String> {
    trusted(&window)?;
    let (backend_url, servers, active_id, read_error) =
        match settings::load_connection_data(&state.settings_path) {
            Ok(Some(data)) => (data.backend_url, data.servers, data.active_id, None),
            Ok(None) => (settings::DEFAULT_BACKEND.to_string(), Vec::new(), None, None),
            Err(error) => (
                String::new(),
                Vec::new(),
                None,
                Some(format!("{error}。请输入新地址以修复连接设置。")),
            ),
        };
    Ok(ConnectionSettings {
        backend_url,
        data_directory: state
            .settings_path
            .parent()
            .ok_or("连接配置路径无效")?
            .display()
            .to_string(),
        error: read_error.or_else(|| {
            state
                .connection_error
                .lock()
                .expect("connection error lock poisoned")
                .clone()
        }),
        servers,
        active_id,
    })
}

#[tauri::command]
fn save_server_profile(
    window: WebviewWindow,
    state: tauri::State<'_, DesktopState>,
    name: String,
    url: String,
    id: Option<String>,
) -> Result<settings::ServerProfile, String> {
    trusted(&window)?;
    settings::upsert_profile(&state.settings_path, &name, &url, id.as_deref())
}

#[tauri::command]
fn remove_server_profile(
    window: WebviewWindow,
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<(), String> {
    trusted(&window)?;
    settings::remove_profile(&state.settings_path, &id)
}

#[tauri::command]
async fn connect_backend(
    window: WebviewWindow,
    app: tauri::AppHandle,
    backend_url: String,
) -> Result<(), String> {
    trusted(&window)?;
    let result = open_dashboard(&app, &backend_url).await;
    if result.is_err() {
        diagnostics::record("connection.request_failed");
    }
    result
}

async fn open_dashboard(app: &tauri::AppHandle, backend_url: &str) -> Result<(), String> {
    let state = app.state::<DesktopState>();
    let _operation = state.operations.lock().await;
    let backend = settings::validate(backend_url)?;
    let mut active = state.bridge.lock().await;
    // Reconnecting the same server must not create competing cookie jars over one file.
    if let Some(current) = active.as_ref().filter(|current| current.backend == backend) {
        if app.get_window("dashboard").is_some() {
            let Some(permit) = dashboard_lifecycle::check_leave(app, current, "重新连接").await?
            else {
                return Err("已取消重新连接。".into());
            };
            settings::save(&state.settings_path, &backend)?;
            dashboard_lifecycle::content(app)?
                .eval("window.location.reload()")
                .map_err(|e| e.to_string())?;
            permit.complete();
            finish_connection(app);
            return Ok(());
        }
    }
    let state_root = state.settings_path.parent().ok_or("连接配置路径无效")?;
    let candidate = bridge::start(backend, state_root).await?;
    let mut permit = None;
    if app.get_window("dashboard").is_some() {
        if let Some(previous) = active.as_ref() {
            permit = dashboard_lifecycle::check_leave(app, previous, "切换后端").await?;
            if permit.is_none() {
                return Err("已取消切换，原连接保持不变。".into());
            }
        }
        let _ = desktop_menu::snapshot_zoom(app).await;
    }
    let had_previous = active.is_some();
    let mut host = dashboard_lifecycle::NativeSwitch {
        app,
        candidate: &candidate,
        previous: active.as_ref(),
    };
    if let Err(error) = dashboard_lifecycle::replace(&mut host, had_previous).await {
        diagnostics::record("connection.rollback");
        show_connection(app);
        return Err(error);
    }
    *active = Some(candidate);
    if let Some(permit) = permit {
        permit.complete();
    }
    diagnostics::record("connection.committed");
    finish_connection(app);
    Ok(())
}

fn finish_connection(app: &tauri::AppHandle) {
    let state = app.state::<DesktopState>();
    let warnings = diagnostics::take_warnings();
    if !warnings.is_empty() {
        tauri::async_runtime::spawn_blocking(move || {
            native_dialog::warning(&warnings.join("\n\n"))
        });
    }
    *state
        .connection_error
        .lock()
        .expect("connection error lock poisoned") = None;
    if let Some(window) = app.get_webview_window("connection") {
        if window.hide().is_err() {
            diagnostics::record("window.connection_hide_failed");
        }
    }
}

fn show_connection(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("connection") {
        let top = app
            .state::<desktop_preferences::DesktopPreferences>()
            .snapshot()
            .always_on_top;
        if let Err(error) = window
            .set_always_on_top(top)
            .and_then(|_| window.show())
            .and_then(|_| window.set_focus())
        {
            eprintln!("Could not show connection settings: {error}");
        }
    }
}

fn setup_desktop(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let storage = startup::select_storage(
        &app.path().app_config_dir()?,
        &app.path().app_local_data_dir()?,
        &std::env::current_exe()?,
    )?;
    let webview_dir = storage.webview_dir.clone();
    let portable = storage.portable;
    let root = storage.settings_path.parent().ok_or("连接配置路径无效")?;
    app.manage(instance::InstanceLock::acquire(root)?);
    diagnostics::init(root);
    let saved_backend = settings::load_saved(&storage.settings_path);
    let desktop_preferences = desktop_preferences::DesktopPreferences::open(
        storage
            .settings_path
            .parent()
            .ok_or("连接配置路径无效")?
            .join("desktop.json"),
    )?;
    let auto_connect = desktop_preferences.snapshot().auto_connect;
    app.manage(desktop_preferences);
    app.manage(window_state::WindowState::open(
        storage
            .settings_path
            .parent()
            .ok_or("连接配置路径无效")?
            .join("window.json"),
    )?);
    app.manage(DesktopState {
        settings_path: storage.settings_path,
        webview_dir,
        bridge: tokio::sync::Mutex::new(None),
        connection_error: std::sync::Mutex::new(None),
        operations: tokio::sync::Mutex::new(()),
    });
    desktop_menu::install(app)?;
    let config = app.config().app.windows.first().ok_or("缺少连接窗口配置")?;
    let window = WebviewWindowBuilder::from_config(app.handle(), config)?
        .data_directory(storage.webview_dir)
        .visible(false)
        .devtools(false)
        .on_navigation(|url| {
            trusted_ui::matches("connection", "connection", url, "desktop-connection.html")
        })
        .build()?;
    window.remove_menu()?;
    if portable {
        window.set_title("Hermes — 后端连接（便携模式）")?;
    }
    let warnings = diagnostics::take_warnings();
    if !warnings.is_empty() {
        tauri::async_runtime::spawn_blocking(move || {
            native_dialog::warning(&warnings.join("\n\n"))
        });
    }
    match saved_backend {
        Ok(Some(url)) if auto_connect => {
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = open_dashboard(&app, &url).await {
                    diagnostics::record("connection.autoconnect_failed");
                    *app.state::<DesktopState>()
                        .connection_error
                        .lock()
                        .expect("connection error lock poisoned") =
                        Some(format!("自动连接失败：{error}。请重试或修改后端地址。"));
                    if let Err(error) = app.emit_to("connection", "connection-status-changed", ()) {
                        eprintln!("Could not update connection status: {error}");
                    }
                    show_connection(&app);
                }
            });
        }
        _ => show_connection(app.handle()),
    }
    Ok(())
}

fn main() {
    let result = tauri::Builder::default()
        .setup(|app| {
            if let Err(error) = setup_desktop(app) {
                startup::report_error(error);
                app.handle().exit(1);
            }
            Ok(())
        })
        .on_menu_event(|app, event| desktop_menu::handle(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            if window.label() == "dashboard"
                && matches!(
                    event,
                    tauri::WindowEvent::Resized(_)
                        | tauri::WindowEvent::Moved(_)
                        | tauri::WindowEvent::CloseRequested { .. }
                )
            {
                window_state::remember(window);
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if window.label() == "connection" && app.get_window("dashboard").is_some() {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        eprintln!("Hide failed: {error}");
                    }
                } else if matches!(window.label(), "dashboard" | "connection") {
                    api.prevent_close();
                    desktop_menu::quit(app.clone());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            connection_settings,
            connect_backend,
            save_server_profile,
            remove_server_profile,
            titlebar::titlebar_action,
            about::about_details
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        startup::report_error(error);
    }
}
