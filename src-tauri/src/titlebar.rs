use tauri::{
    menu::ContextMenu, LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewBuilder,
    WebviewUrl, Window, WindowBuilder,
};

const HEIGHT: f64 = 30.0;
const CHROME: &str = "desktop-titlebar";
const CONTENT: &str = "dashboard-content";

fn local_chrome(label: &str, url: &url::Url) -> bool {
    crate::trusted_ui::matches(label, CHROME, url, "desktop-titlebar.html")
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Action {
    Menu,
    Drag,
    Minimize,
    Maximize,
    Close,
}

#[tauri::command]
pub async fn titlebar_action(
    webview: Webview,
    action: Action,
    menu_x: Option<f64>,
) -> Result<bool, String> {
    if !local_chrome(webview.label(), &webview.url().map_err(|e| e.to_string())?) {
        return Err("Window controls are restricted to the bundled titlebar.".into());
    }
    let window = webview.window();
    let result = match action {
        Action::Menu => {
            crate::desktop_menu::refresh(webview.app_handle()).await?;
            let width = window
                .inner_size()
                .map_err(|e| e.to_string())?
                .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?)
                .width;
            let x = menu_x
                .filter(|x| x.is_finite())
                .unwrap_or(0.0)
                .clamp(0.0, width);
            webview
                .state::<crate::desktop_menu::DesktopMenu>()
                .root
                .popup_at(window.clone(), LogicalPosition::new(x, HEIGHT))
        }
        Action::Drag => window.start_dragging(),
        Action::Minimize => window.minimize(),
        Action::Maximize => {
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        Action::Close => return window.close().map(|_| false).map_err(|e| e.to_string()),
    };
    result.map_err(|e| e.to_string())?;
    window.is_maximized().map_err(|e| e.to_string())
}

fn content_bounds(width: f64, height: f64) -> Rect {
    Rect {
        position: LogicalPosition::new(0.0, HEIGHT).into(),
        size: LogicalSize::new(width, (height - HEIGHT).max(0.0)).into(),
    }
}

fn resize(window: &Window) -> tauri::Result<()> {
    let size = window
        .inner_size()?
        .to_logical::<f64>(window.scale_factor()?);
    if let Some(content) = window.get_webview(CONTENT) {
        content.set_bounds(content_bounds(size.width, size.height))?;
    }
    if let Some(chrome) = window.get_webview(CHROME) {
        chrome.set_size(LogicalSize::new(size.width, HEIGHT))?;
        chrome.eval(format!(
            "window.dispatchEvent(new CustomEvent('window-state', {{detail: {}}}))",
            window.is_maximized()?
        ))?;
    }
    Ok(())
}

pub fn create(
    app: &tauri::AppHandle,
    title: &str,
    entry: url::Url,
    data: &std::path::Path,
) -> tauri::Result<()> {
    let window_state = app.state::<crate::window_state::WindowState>();
    let window_prefs = window_state.snapshot();
    let maximized = window_prefs.maximized;
    let preferences = app
        .state::<crate::desktop_preferences::DesktopPreferences>()
        .snapshot();

    let initial_width = window_prefs.width.unwrap_or(1360.0);
    let initial_height = window_prefs.height.unwrap_or(900.0);

    let mut builder = WindowBuilder::new(app, "dashboard")
        .title(title)
        .inner_size(initial_width, initial_height)
        .min_inner_size(800.0, 600.0)
        .maximized(maximized)
        .always_on_top(preferences.always_on_top)
        .decorations(false)
        .shadow(true)
        .visible(false);

    if let (Some(x), Some(y)) = (window_prefs.x, window_prefs.y) {
        builder = builder.position(x, y);
    }

    let window = builder.build()?;
    let setup = (|| {
        // Keep native menu accelerators, but replace its separate row with the titlebar button.
        window.hide_menu()?;
        let size = window
            .inner_size()?
            .to_logical::<f64>(window.scale_factor()?);
        let content = window.add_child(
            WebviewBuilder::new(CONTENT, WebviewUrl::External(entry))
                .zoom_hotkeys_enabled(true)
                .devtools(true)
                .data_directory(data.to_path_buf())
                .on_navigation(|url| matches!(url.scheme(), "http" | "https")),
            LogicalPosition::new(0.0, HEIGHT),
            LogicalSize::new(size.width, (size.height - HEIGHT).max(0.0)),
        )?;
        content.set_zoom(preferences.initial_zoom())?;
        window.add_child(
            WebviewBuilder::new(CHROME, WebviewUrl::App("desktop-titlebar.html".into()))
                .devtools(false)
                .data_directory(data.to_path_buf())
                .initialization_script(format!(
                    "window.__HERMES_TITLE__ = {}; window.__HERMES_MAXIMIZED__ = {maximized};",
                    serde_json::to_string(title).expect("string serializes")
                ))
                .on_navigation(|url| local_chrome(CHROME, url)),
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(size.width, HEIGHT),
        )?;
        let resized = window.clone();
        window.on_window_event(move |event| {
            if matches!(
                event,
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) {
                if let Err(error) = resize(&resized) {
                    crate::diagnostics::record("window.layout_failed");
                    eprintln!("Titlebar layout failed: {error}");
                }
            }
        });
        window.show()?;
        window.set_focus()
    })();
    if setup.is_err() {
        window.destroy()?;
    }
    setup
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_actions_are_only_for_the_local_titlebar() {
        for url in [
            "http://tauri.localhost/desktop-titlebar.html",
            "tauri://localhost/desktop-titlebar.html",
        ] {
            let url = url::Url::parse(url).unwrap();
            assert!(local_chrome(CHROME, &url));
            assert!(!local_chrome(CONTENT, &url));
            assert!(!local_chrome("connection", &url));
        }
        for url in [
            "http://127.0.0.1/desktop-titlebar.html",
            "https://tauri.localhost/desktop-titlebar.html",
            "http://tauri.localhost/desktop-connection.html",
        ] {
            assert!(!local_chrome(CHROME, &url::Url::parse(url).unwrap()));
        }
    }
    #[test]
    fn content_starts_below_chrome_and_fills_remaining_height() {
        for (width, height) in [(800.0, 600.0), (1360.0, 900.0), (2048.0, 1214.0)] {
            let bounds = content_bounds(width, height);
            assert_eq!(bounds.position, LogicalPosition::new(0.0, HEIGHT).into());
            assert_eq!(bounds.size, LogicalSize::new(width, height - HEIGHT).into());
        }
    }
}
