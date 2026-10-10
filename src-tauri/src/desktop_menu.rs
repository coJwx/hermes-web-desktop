use crate::dashboard_lifecycle::content;
use crate::desktop_preferences::DesktopPreferences;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    Manager,
};

pub struct DesktopMenu {
    pub root: Submenu<tauri::Wry>,
    auto_connect: CheckMenuItem<tauri::Wry>,
    remember_zoom: CheckMenuItem<tauri::Wry>,
    always_on_top: CheckMenuItem<tauri::Wry>,
    zoom_label: MenuItem<tauri::Wry>,
    operations: tokio::sync::Mutex<()>,
}

#[derive(Clone, Copy)]
enum Command {
    Connection,
    Reload,
    Quit,
    ZoomIn,
    ZoomOut,
    SetZoom(f64),
    AlwaysOnTop,
    AutoConnect,
    RememberZoom,
    Devtools,
    DataDirectory,
    About,
}
const COMMANDS: &[(&str, Command)] = &[
    ("connection", Command::Connection),
    ("reload", Command::Reload),
    ("quit", Command::Quit),
    ("zoom-in", Command::ZoomIn),
    ("zoom-out", Command::ZoomOut),
    ("zoom-reset", Command::SetZoom(1.0)),
    ("zoom-80", Command::SetZoom(0.8)),
    ("zoom-100", Command::SetZoom(1.0)),
    ("zoom-125", Command::SetZoom(1.25)),
    ("zoom-150", Command::SetZoom(1.5)),
    ("zoom-200", Command::SetZoom(2.0)),
    ("always-on-top", Command::AlwaysOnTop),
    ("auto-connect", Command::AutoConnect),
    ("remember-zoom", Command::RememberZoom),
    ("devtools", Command::Devtools),
    ("data-directory", Command::DataDirectory),
    ("about", Command::About),
];

pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let p = app.state::<DesktopPreferences>().snapshot();
    let connection = MenuItem::with_id(
        app,
        "connection",
        "修改后端地址…",
        true,
        Some("Ctrl+Shift+S"),
    )?;
    let reload = MenuItem::with_id(app, "reload", "重新加载", true, Some("Ctrl+R"))?;
    let connection_group = Submenu::with_items(app, "连接", true, &[&connection, &reload])?;
    let zoom_in = MenuItem::with_id(app, "zoom-in", "放大", true, Some("Ctrl+="))?;
    let zoom_out = MenuItem::with_id(app, "zoom-out", "缩小", true, Some("Ctrl+-"))?;
    let reset = MenuItem::with_id(app, "zoom-reset", "恢复 100%", true, Some("Ctrl+0"))?;
    let presets: Vec<_> = [
        ("zoom-80", "80%"),
        ("zoom-100", "100%"),
        ("zoom-125", "125%"),
        ("zoom-150", "150%"),
        ("zoom-200", "200%"),
    ]
    .into_iter()
    .map(|(id, text)| MenuItem::with_id(app, id, text, true, None::<&str>))
    .collect::<tauri::Result<_>>()?;
    let preset_group = Submenu::with_items(
        app,
        "选择比例",
        true,
        &presets
            .iter()
            .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
            .collect::<Vec<_>>(),
    )?;
    let zoom_label = MenuItem::with_id(
        app,
        "zoom-label",
        format!("当前缩放：{:.0}%", p.initial_zoom() * 100.0),
        false,
        None::<&str>,
    )?;
    let always_on_top = CheckMenuItem::with_id(
        app,
        "always-on-top",
        "窗口始终置顶",
        true,
        p.always_on_top,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let view_group = Submenu::with_items(
        app,
        "视图",
        true,
        &[
            &zoom_label,
            &zoom_in,
            &zoom_out,
            &reset,
            &preset_group,
            &separator,
            &always_on_top,
        ],
    )?;
    let auto_connect = CheckMenuItem::with_id(
        app,
        "auto-connect",
        "启动时自动连接",
        true,
        p.auto_connect,
        None::<&str>,
    )?;
    let remember_zoom = CheckMenuItem::with_id(
        app,
        "remember-zoom",
        "记住缩放比例",
        true,
        p.remember_zoom,
        None::<&str>,
    )?;
    let settings_group = Submenu::with_items(app, "设置", true, &[&auto_connect, &remember_zoom])?;
    let devtools = MenuItem::with_id(app, "devtools", "打开开发者工具", true, Some("F12"))?;
    let dev_group = Submenu::with_items(app, "开发", true, &[&devtools])?;
    let data = MenuItem::with_id(
        app,
        "data-directory",
        "打开本机数据目录",
        true,
        None::<&str>,
    )?;
    let about = MenuItem::with_id(app, "about", "关于应用…", true, None::<&str>)?;
    let help_group = Submenu::with_items(app, "帮助", true, &[&data, &about])?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let bottom_separator = PredefinedMenuItem::separator(app)?;
    let root = Submenu::with_items(
        app,
        "菜单",
        true,
        &[
            &connection_group,
            &view_group,
            &settings_group,
            &dev_group,
            &help_group,
            &bottom_separator,
            &quit,
        ],
    )?;
    app.set_menu(Menu::with_items(app, &[&root])?)?;
    app.manage(DesktopMenu {
        root,
        auto_connect,
        remember_zoom,
        always_on_top,
        zoom_label,
        operations: tokio::sync::Mutex::new(()),
    });
    Ok(())
}

/// Read the actual browser zoom, including changes from Ctrl-wheel/hotkeys; never block the UI thread.
pub async fn snapshot_zoom(app: &tauri::AppHandle) -> Result<f64, String> {
    let webview = content(app)?;
    #[cfg(windows)]
    let value = {
        let (tx, rx) = tokio::sync::oneshot::channel();
        webview
            .with_webview(move |native| {
                let mut value = 1.0;
                // Tauri runs this closure on the native WebView's UI thread.
                let result = unsafe { native.controller().ZoomFactor(&mut value) }
                    .map(|_| value)
                    .map_err(|e| e.to_string());
                let _ = tx.send(result);
            })
            .map_err(|e| e.to_string())?;
        tokio::time::timeout(std::time::Duration::from_secs(2), rx)
            .await
            .map_err(|_| "读取窗口缩放超时。".to_string())?
            .map_err(|e| e.to_string())??
    };
    #[cfg(not(windows))]
    let value = app.state::<DesktopPreferences>().snapshot().initial_zoom();
    if app
        .state::<DesktopPreferences>()
        .record_zoom(value)
        .is_err()
    {
        crate::diagnostics::record("preferences.zoom_save_failed");
    }
    Ok(value)
}

pub async fn refresh(app: &tauri::AppHandle) -> Result<(), String> {
    let p = app.state::<DesktopPreferences>().snapshot();
    let zoom = snapshot_zoom(app).await.unwrap_or_else(|_| {
        crate::diagnostics::record("window.zoom_read_failed");
        p.initial_zoom()
    });
    let menu = app.state::<DesktopMenu>();
    menu.zoom_label
        .set_text(format!("当前缩放：{:.0}%", zoom * 100.0))
        .map_err(|e| e.to_string())?;
    menu.auto_connect
        .set_checked(p.auto_connect)
        .map_err(|e| e.to_string())?;
    menu.remember_zoom
        .set_checked(p.remember_zoom)
        .map_err(|e| e.to_string())?;
    let actual = app
        .get_window("dashboard")
        .ok_or("Dashboard 尚未连接。")?
        .is_always_on_top()
        .map_err(|e| e.to_string())?;
    menu.always_on_top
        .set_checked(actual)
        .map_err(|e| e.to_string())
}

fn next_zoom(current: f64, increase: bool) -> f64 {
    let steps = [
        0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0,
    ];
    if increase {
        steps
            .into_iter()
            .find(|x| *x > current + 0.001)
            .unwrap_or(current)
    } else {
        steps
            .into_iter()
            .rev()
            .find(|x| *x < current - 0.001)
            .unwrap_or(current)
    }
}
async fn apply_zoom(app: &tauri::AppHandle, value: f64) -> Result<(), String> {
    crate::desktop_preferences::validate_zoom(value)?;
    content(app)?.set_zoom(value).map_err(|e| e.to_string())?;
    app.state::<DesktopPreferences>().record_zoom(value)?;
    app.state::<DesktopMenu>()
        .zoom_label
        .set_text(format!("当前缩放：{:.0}%", value * 100.0))
        .map_err(|e| e.to_string())
}

pub fn quit(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<crate::DesktopState>();
        let Ok(_operation) = state.operations.try_lock() else {
            return;
        };
        let active = state.bridge.lock().await;
        let mut permit = None;
        if app.get_window("dashboard").is_some() {
            if let Some(bridge) = active.as_ref() {
                match crate::dashboard_lifecycle::check_leave(&app, bridge, "退出").await {
                    Ok(Some(approved)) => {
                        permit = Some(approved);
                    }
                    Ok(None) => return,
                    Err(error) => {
                        crate::dashboard_lifecycle::notify(&app, error);
                        return;
                    }
                }
            }
            if let Some(window) = app.get_window("dashboard") {
                crate::window_state::remember(&window);
            }
            if snapshot_zoom(&app).await.is_err() {
                crate::diagnostics::record("window.exit_zoom_failed");
            }
        }
        crate::diagnostics::record("desktop.exiting");
        if let Some(permit) = permit {
            permit.complete();
        }
        app.exit(0);
    });
}

pub fn handle(app: &tauri::AppHandle, id: &str) {
    let Some(command) = COMMANDS
        .iter()
        .find_map(|(key, action)| (*key == id).then_some(*action))
    else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = execute(&app, command).await {
            crate::diagnostics::record("menu.action_failed");
            eprintln!("Desktop menu action failed: {error}");
            if let Some(chrome) = app.get_webview("desktop-titlebar") {
                if let Err(eval) = chrome.eval(format!(
                    "window.showMenuError({});",
                    serde_json::to_string(&error).expect("string serializes")
                )) {
                    eprintln!("Could not report menu error: {eval}");
                }
            }
        }
    });
}
async fn execute(app: &tauri::AppHandle, command: Command) -> Result<(), String> {
    let menu = app.state::<DesktopMenu>();
    // Rapid accelerator presses must read the zoom left by the preceding action.
    let _operation = menu.operations.lock().await;
    let preferences = app.state::<DesktopPreferences>();
    match command {
        Command::Connection => {
            crate::show_connection(app);
            Ok(())
        }
        Command::Reload => {
            let state = app.state::<crate::DesktopState>();
            let _operation = state.operations.lock().await;
            let active = state.bridge.lock().await;
            let mut permit = None;
            if let Some(bridge) = active.as_ref() {
                permit = crate::dashboard_lifecycle::check_leave(app, bridge, "重新加载").await?;
                if permit.is_none() {
                    return Ok(());
                }
            }
            let _ = snapshot_zoom(app).await;
            content(app)?
                .eval("window.location.reload()")
                .map_err(|e| e.to_string())?;
            if let Some(permit) = permit {
                permit.complete();
            }
            Ok(())
        }
        Command::Quit => {
            quit(app.clone());
            Ok(())
        }
        Command::ZoomIn | Command::ZoomOut => {
            let value = snapshot_zoom(app).await?;
            apply_zoom(app, next_zoom(value, matches!(command, Command::ZoomIn))).await
        }
        Command::SetZoom(value) => apply_zoom(app, value).await,
        Command::AlwaysOnTop => {
            let window = app.get_window("dashboard").ok_or("Dashboard 尚未连接。")?;
            let enabled = !window.is_always_on_top().map_err(|e| e.to_string())?;
            window
                .set_always_on_top(enabled)
                .map_err(|e| e.to_string())?;
            if let Err(error) = preferences.set_always_on_top(enabled) {
                window
                    .set_always_on_top(!enabled)
                    .map_err(|e| e.to_string())?;
                return Err(error);
            }
            app.state::<DesktopMenu>()
                .always_on_top
                .set_checked(enabled)
                .map_err(|e| e.to_string())
        }
        Command::AutoConnect => {
            let enabled = !preferences.snapshot().auto_connect;
            preferences.set_auto_connect(enabled)?;
            app.state::<DesktopMenu>()
                .auto_connect
                .set_checked(enabled)
                .map_err(|e| e.to_string())
        }
        Command::RememberZoom => {
            let zoom = snapshot_zoom(app).await?;
            let enabled = !preferences.snapshot().remember_zoom;
            preferences.set_remember_zoom(enabled, zoom)?;
            app.state::<DesktopMenu>()
                .remember_zoom
                .set_checked(enabled)
                .map_err(|e| e.to_string())
        }
        Command::Devtools => {
            content(app)?.open_devtools();
            Ok(())
        }
        Command::DataDirectory => open_data_directory(app),
        Command::About => crate::about::show(app),
    }
}

fn open_data_directory(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<crate::DesktopState>();
    let path = state.settings_path.parent().ok_or("配置目录无效。")?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(path)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("打开数据目录目前仅支持 Windows 客户端。".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zoom_steps_are_monotonic_and_all_menu_commands_have_unique_ids() {
        for zoom in [0.2, 0.25, 0.33, 0.8, 1.0, 1.25, 2.0, 5.0, 10.0] {
            assert!(next_zoom(zoom, true) >= zoom);
            assert!(next_zoom(zoom, false) <= zoom);
            crate::desktop_preferences::validate_zoom(next_zoom(zoom, true)).unwrap();
            crate::desktop_preferences::validate_zoom(next_zoom(zoom, false)).unwrap();
        }
        let ids: std::collections::HashSet<_> = COMMANDS.iter().map(|(id, _)| id).collect();
        assert_eq!(ids.len(), COMMANDS.len());
    }
}
