use crate::{bridge::Bridge, leave_gate::Decision};
use tauri::Manager;

/// Aborted native work unfreezes the original editor; successful work replaces or closes it.
pub struct LeavePermit {
    webview: tauri::Webview,
    id: Option<String>,
}
impl LeavePermit {
    pub fn complete(mut self) {
        self.id = None;
    }
}
impl Drop for LeavePermit {
    fn drop(&mut self) {
        if let Some(id) = &self.id {
            let id = serde_json::to_string(id).expect("request id");
            let _ = self
                .webview
                .eval(format!("window.__HERMES_DESKTOP_CANCEL_LEAVE__?.({id});"));
        }
    }
}

pub fn content(app: &tauri::AppHandle) -> Result<tauri::Webview, String> {
    app.get_webview("dashboard-content")
        .or_else(|| app.get_webview("dashboard"))
        .ok_or_else(|| "Dashboard 尚未连接。".into())
}

async fn force_confirmation(action: &str) -> bool {
    let message = format!("当前页面没有响应或不支持编辑状态确认。强制{action}可能丢失未保存的修改。\n\n是否仍要继续？");
    tauri::async_runtime::spawn_blocking(move || crate::native_dialog::confirm_force(&message))
        .await
        .unwrap_or(false)
}

pub async fn check_leave(
    app: &tauri::AppHandle,
    bridge: &Bridge,
    action: &str,
) -> Result<Option<LeavePermit>, String> {
    let webview = content(app)?;
    if webview.url().map_err(|e| e.to_string())?.origin() != bridge.entry_url.origin() {
        return Ok(force_confirmation(action)
            .await
            .then_some(LeavePermit { webview, id: None }));
    }
    let (id, response) = bridge.leave.begin()?;
    let id_json = serde_json::to_string(&id).expect("request id");
    let script = format!(
        r#"if (typeof window.__HERMES_DESKTOP_REQUEST_LEAVE__ === 'function') {{
        window.__HERMES_DESKTOP_REQUEST_LEAVE__({id_json});
    }} else {{
        fetch('/__desktop/leave', {{method:'POST',credentials:'same-origin',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{request_id:{id_json},decision:'unsupported'}})}}).catch(()=>{{}});
    }}"#
    );
    if let Some(window) = app.get_window("dashboard") {
        let _ = window.set_focus();
    }
    let decision = if webview.eval(&script).is_ok() {
        crate::leave_gate::wait(response).await
    } else {
        Decision::Unsupported
    };
    bridge.leave.cancel(&id);
    // Clear a timed-out/cancelled dialog. Approval is kept until the native operation completes.
    if decision != Decision::Allow {
        let _ = webview.eval(format!(
            "window.__HERMES_DESKTOP_CANCEL_LEAVE__?.({id_json});"
        ));
    }
    match decision {
        Decision::Allow => Ok(Some(LeavePermit {
            webview,
            id: Some(id),
        })),
        Decision::Busy => Err("页面正在保存，请等待完成后再操作。".into()),
        Decision::Unsupported => Ok(force_confirmation(action)
            .await
            .then_some(LeavePermit { webview, id: None })),
        _ => Ok(None),
    }
}

pub fn create(app: &tauri::AppHandle, bridge: &Bridge, entry: url::Url) -> Result<(), String> {
    let state = app.state::<crate::DesktopState>();
    let title = format!(
        "Hermes Dashboard — {}",
        bridge.backend.host_str().unwrap_or("remote")
    );
    #[cfg(windows)]
    {
        crate::titlebar::create(app, &title, entry, &state.webview_dir).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        tauri::WebviewWindowBuilder::new(app, "dashboard", tauri::WebviewUrl::External(entry))
            .title(title)
            .data_directory(state.webview_dir.clone())
            .inner_size(1360.0, 900.0)
            .min_inner_size(800.0, 600.0)
            .maximized(app.state::<crate::window_state::WindowState>().maximized())
            .on_navigation(|url| matches!(url.scheme(), "http" | "https"))
            .build()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

/// The real window/settings operations are injected so failure ordering is exercised without a GUI.
pub trait SwitchHost {
    fn destroy(&mut self) -> impl std::future::Future<Output = Result<(), String>> + Send;
    fn create(&mut self, previous: bool) -> Result<(), String>;
    fn commit(&mut self) -> Result<(), String>;
}

pub async fn replace(host: &mut impl SwitchHost, has_previous: bool) -> Result<(), String> {
    host.destroy().await?;
    let result = host.create(false).and_then(|_| host.commit());
    if let Err(error) = result {
        if let Err(cleanup) = host.destroy().await {
            return Err(format!(
                "切换失败：{error}；清理新窗口失败：{cleanup}。旧配置未提交，请重新连接。"
            ));
        }
        if has_previous {
            host.create(true).map_err(|rollback| {
                format!("切换失败：{error}；恢复旧窗口失败：{rollback}。旧配置已保留，请重新连接。")
            })?;
            return Err(format!("切换失败：{error}。已恢复原连接，原地址未更改。"));
        }
        return Err(error);
    }
    Ok(())
}

pub struct NativeSwitch<'a> {
    pub app: &'a tauri::AppHandle,
    pub candidate: &'a Bridge,
    pub previous: Option<&'a Bridge>,
}
impl SwitchHost for NativeSwitch<'_> {
    async fn destroy(&mut self) -> Result<(), String> {
        if let Some(window) = self.app.get_window("dashboard") {
            window.destroy().map_err(|e| e.to_string())?;
        }
        // Wry destroy() enqueues an event; labels cannot be reused until cleanup finishes.
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while self.app.get_window("dashboard").is_some()
                || self.app.get_webview("dashboard-content").is_some()
                || self.app.get_webview("desktop-titlebar").is_some()
            {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .map_err(|_| "等待旧窗口关闭超时，未创建新连接窗口。".to_string())
    }
    fn create(&mut self, previous: bool) -> Result<(), String> {
        let bridge = if previous {
            self.previous.ok_or("没有可恢复的连接")?
        } else {
            self.candidate
        };
        create(self.app, bridge, bridge.issue_entry())
    }
    fn commit(&mut self) -> Result<(), String> {
        crate::settings::save(
            &self.app.state::<crate::DesktopState>().settings_path,
            &self.candidate.backend,
        )
    }
}

pub fn notify(app: &tauri::AppHandle, error: String) {
    crate::diagnostics::record("desktop.operation_failed");
    if let Some(chrome) = app.get_webview("desktop-titlebar") {
        let _ = chrome.eval(format!(
            "window.showMenuError?.({});",
            serde_json::to_string(&error).expect("error string")
        ));
    } else {
        tauri::async_runtime::spawn_blocking(move || crate::native_dialog::warning(&error));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct Host {
        events: Vec<&'static str>,
        fail_create: bool,
        fail_commit: bool,
        fail_restore: bool,
        saved: &'static str,
    }
    impl SwitchHost for Host {
        async fn destroy(&mut self) -> Result<(), String> {
            self.events.push("destroy");
            Ok(())
        }
        fn create(&mut self, previous: bool) -> Result<(), String> {
            self.events
                .push(if previous { "restore" } else { "create" });
            if (previous && self.fail_restore) || (!previous && self.fail_create) {
                Err("create failed".into())
            } else {
                Ok(())
            }
        }
        fn commit(&mut self) -> Result<(), String> {
            self.events.push("commit");
            if self.fail_commit {
                Err("save failed".into())
            } else {
                self.saved = "new";
                Ok(())
            }
        }
    }
    #[tokio::test]
    async fn replacement_commits_only_after_create_and_rolls_back_both_failure_paths() {
        for (fail_create, fail_commit) in [(true, false), (false, true)] {
            let mut host = Host {
                fail_create,
                fail_commit,
                saved: "old",
                ..Default::default()
            };
            assert!(replace(&mut host, true).await.is_err());
            assert_eq!(host.saved, "old");
            assert_eq!(host.events.last(), Some(&"restore"));
        }
        let mut host = Host::default();
        replace(&mut host, false).await.unwrap();
        assert_eq!(host.events, ["destroy", "create", "commit"]);
        assert_eq!(host.saved, "new");
    }
    #[tokio::test]
    async fn rollback_failure_is_explicit_and_does_not_commit_new_settings() {
        let mut host = Host {
            fail_commit: true,
            fail_restore: true,
            saved: "old",
            ..Default::default()
        };
        assert!(replace(&mut host, true)
            .await
            .unwrap_err()
            .contains("恢复旧窗口失败"));
        assert_eq!(host.saved, "old");
    }
}
