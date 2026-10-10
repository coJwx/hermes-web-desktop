use serde::Serialize;
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

fn trusted(label: &str, url: &url::Url) -> bool {
    crate::trusted_ui::matches(label, "about", url, "desktop-about.html")
}

pub fn show(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("about") {
        window
            .eval("window.refreshAbout?.()")
            .map_err(|e| e.to_string())?;
        return window
            .show()
            .and_then(|_| window.set_focus())
            .map_err(|e| e.to_string());
    }
    let state = app.state::<crate::DesktopState>();
    let builder =
        WebviewWindowBuilder::new(app, "about", WebviewUrl::App("desktop-about.html".into()))
            .title("关于 Hermes Dashboard")
            .inner_size(520.0, 370.0)
            .resizable(false)
            .data_directory(state.webview_dir.clone())
            .devtools(false)
            .on_navigation(|url| trusted("about", url));
    #[cfg(windows)]
    let builder = if let Some(parent) = app.get_window("dashboard") {
        builder.owner_raw(parent.hwnd().map_err(|e| e.to_string())?)
    } else {
        builder
    };
    let window = builder.build().map_err(|e| e.to_string())?;
    window.remove_menu().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct Details {
    client_version: String,
    backend_url: String,
    data_directory: String,
    webview_directory: String,
}
#[tauri::command]
pub fn about_details(window: WebviewWindow, app: tauri::AppHandle) -> Result<Details, String> {
    if !trusted(window.label(), &window.url().map_err(|e| e.to_string())?) {
        return Err("应用信息仅供本地关于窗口读取。".into());
    }
    let state = app.state::<crate::DesktopState>();
    Ok(Details {
        client_version: app.package_info().version.to_string(),
        backend_url: crate::settings::load(&state.settings_path)
            .unwrap_or_else(|e| format!("读取失败：{e}")),
        data_directory: state
            .settings_path
            .parent()
            .ok_or("配置目录无效。")?
            .display()
            .to_string(),
        webview_directory: state.webview_dir.display().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn about_metadata_requires_its_bundled_window_and_local_origin() {
        for url in [
            "http://tauri.localhost/desktop-about.html",
            "tauri://localhost/desktop-about.html",
        ] {
            let url = url::Url::parse(url).unwrap();
            assert!(trusted("about", &url));
            assert!(!trusted("dashboard-content", &url));
            assert!(!trusted("connection", &url));
        }
        for url in [
            "http://127.0.0.1/desktop-about.html",
            "https://tauri.localhost/desktop-about.html",
            "http://tauri.localhost/desktop-connection.html",
        ] {
            assert!(!trusted("about", &url::Url::parse(url).unwrap()));
        }
    }
}
