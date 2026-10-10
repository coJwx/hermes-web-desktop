use std::{
    fs,
    path::{Path, PathBuf},
};

pub struct Storage {
    pub settings_path: PathBuf,
    pub webview_dir: PathBuf,
    pub portable: bool,
}

fn writable_directory(path: &Path) -> Result<(), std::io::Error> {
    fs::create_dir_all(path)?;
    let probe = path.join(format!(".write-check-{}", uuid::Uuid::new_v4()));
    let file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)?;
    drop(file);
    fs::remove_file(probe)
}

/// Both windows and URL settings must use the same successfully checked storage mode.
pub fn select_storage(
    config_dir: &Path,
    data_dir: &Path,
    executable: &Path,
) -> Result<Storage, String> {
    let portable = executable
        .parent()
        .ok_or("无法确定 exe 所在目录。")?
        .join("hermes-dashboard-data");
    // Do not switch a previously used portable profile just because AppData becomes writable later.
    if portable.join("connection.json").is_file() {
        writable_directory(&portable)
            .map_err(|e| format!("已保存的便携数据目录不可写：{}：{e}", portable.display()))?;
        return Ok(Storage {
            settings_path: portable.join("connection.json"),
            webview_dir: portable.join("webview"),
            portable: true,
        });
    }
    let standard = writable_directory(data_dir).and_then(|_| writable_directory(config_dir));
    match standard {
        Ok(()) => Ok(Storage {
            settings_path: config_dir.join("connection.json"),
            webview_dir: data_dir.to_path_buf(),
            portable: false,
        }),
        Err(primary_error) => {
            writable_directory(&portable).map_err(|error| format!(
                "无法创建应用数据目录。\n\n默认数据目录：{}\n默认配置目录：{}\n错误：{primary_error}\n\n便携目录：{}\n错误：{error}\n\n请把 exe 放到你有写入权限的文件夹后重试。无需管理员权限。",
                data_dir.display(), config_dir.display(), portable.display()))?;
            Ok(Storage {
                settings_path: portable.join("connection.json"),
                webview_dir: portable.join("webview"),
                portable: true,
            })
        }
    }
}

pub fn report_error(error: impl std::fmt::Display) {
    let message = format!("Hermes Dashboard 无法启动：\n\n{error}");
    eprintln!("{message}");
    #[cfg(target_os = "windows")]
    {
        // A failed WebView cannot display its own error. Use the OS dialog without another plugin.
        #[link(name = "user32")]
        unsafe extern "system" {
            fn MessageBoxW(
                hwnd: *mut std::ffi::c_void,
                text: *const u16,
                caption: *const u16,
                flags: u32,
            ) -> i32;
        }
        let text: Vec<u16> = message.encode_utf16().chain(std::iter::once(0)).collect();
        let caption: Vec<u16> = "Hermes — 启动失败"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        // Both UTF-16 strings remain alive and NUL-terminated for the synchronous Win32 call.
        unsafe {
            MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), 0x10);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("hermes-storage-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn clean_file(path: &Path) {
        fs::remove_file(path).unwrap();
    }
    fn clean_dir(path: &Path) {
        fs::remove_dir(path).unwrap();
    }

    #[test]
    fn writable_profile_keeps_standard_storage_and_saved_url() {
        let root = root();
        let config = root.join("config");
        let data = root.join("data");
        let storage = select_storage(&config, &data, &root.join("hermes-dashboard.exe")).unwrap();
        assert!(!storage.portable);
        assert_eq!(storage.webview_dir, data);
        assert_eq!(storage.settings_path, config.join("connection.json"));
        let url = crate::settings::validate("https://example.com/hermes/").unwrap();
        crate::settings::save(&storage.settings_path, &url).unwrap();
        assert_eq!(
            crate::settings::load(&storage.settings_path).unwrap(),
            url.as_str()
        );
        assert_eq!(fs::read_dir(&data).unwrap().count(), 0);
        clean_file(&storage.settings_path);
        clean_dir(&config);
        clean_dir(&data);
        clean_dir(&root);
    }

    #[test]
    fn unavailable_profile_uses_writable_portable_storage_or_reports_both_failures() {
        let root = root();
        let blocked = root.join("not-a-directory");
        fs::write(&blocked, "blocked").unwrap();
        let exe = root.join("hermes-dashboard.exe");
        let storage = select_storage(&blocked, &blocked, &exe).unwrap();
        assert!(storage.portable);
        assert_eq!(
            storage.webview_dir,
            root.join("hermes-dashboard-data/webview")
        );
        let url = crate::settings::validate("https://another.example/").unwrap();
        crate::settings::save(&storage.settings_path, &url).unwrap();
        let restarted = select_storage(
            &root.join("now-writable-config"),
            &root.join("now-writable-data"),
            &exe,
        )
        .unwrap();
        assert!(restarted.portable);
        assert_eq!(
            crate::settings::load(&restarted.settings_path).unwrap(),
            url.as_str()
        );
        clean_file(&storage.settings_path);
        clean_dir(&root.join("hermes-dashboard-data"));
        fs::write(root.join("hermes-dashboard-data"), "blocked").unwrap();
        let error = select_storage(&blocked, &blocked, &exe).err().unwrap();
        assert!(error.contains(blocked.to_str().unwrap()));
        assert!(error.contains(root.join("hermes-dashboard-data").to_str().unwrap()));
        clean_file(&root.join("hermes-dashboard-data"));
        clean_file(&blocked);
        clean_dir(&root);
    }
}
