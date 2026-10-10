use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use url::Url;

pub const DEFAULT_BACKEND: &str = "http://10.144.1.2:9119";

#[derive(Serialize, Deserialize)]
struct Settings {
    backend_url: String,
}

pub fn validate(raw: &str) -> Result<Url, String> {
    let mut url = Url::parse(raw.trim()).map_err(|_| "请输入完整的 HTTP 或 HTTPS 地址。")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("仅支持 HTTP 或 HTTPS 后端地址。".into());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("地址不能包含用户名、密码、查询参数或锚点。请在服务器登录页登录。".into());
    }
    let path = format!("{}/", url.path().trim_end_matches('/'));
    url.set_path(&path);
    Ok(url)
}

pub fn load_saved(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => {
            let settings: Settings =
                serde_json::from_str(&raw).map_err(|e| format!("连接配置损坏：{e}"))?;
            Ok(Some(validate(&settings.backend_url)?.to_string()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("无法读取连接配置：{e}")),
    }
}

pub fn load(path: &Path) -> Result<String, String> {
    Ok(load_saved(path)?.unwrap_or_else(|| DEFAULT_BACKEND.into()))
}

pub fn save(path: &Path, url: &Url) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("连接配置路径无效")?).map_err(|e| e.to_string())?;
    let data = serde_json::to_vec_pretty(&Settings {
        backend_url: url.to_string(),
    })
    .map_err(|e| e.to_string())?;
    crate::persistence::atomic_write(path, &data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn locked_connection_file_keeps_previous_address_and_removes_temporary_writes() {
        use std::os::windows::fs::OpenOptionsExt;
        let root =
            std::env::temp_dir().join(format!("hermes-atomic-settings-{}", uuid::Uuid::new_v4()));
        let file = root.join("connection.json");
        let old = validate("https://old.example/").unwrap();
        save(&file, &old).unwrap();
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&file)
            .unwrap();
        assert!(save(&file, &validate("https://new.example/").unwrap()).is_err());
        drop(locked);
        assert_eq!(load(&file).unwrap(), old.as_str());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_file(file).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn automatic_connect_requires_a_saved_valid_address() {
        let root = std::env::temp_dir().join(format!("hermes-settings-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("connection.json");
        assert_eq!(load_saved(&file).unwrap(), None);
        assert_eq!(load(&file).unwrap(), DEFAULT_BACKEND);
        let backend = validate("https://example.com/hermes").unwrap();
        save(&file, &backend).unwrap();
        assert_eq!(
            load_saved(&file).unwrap().as_deref(),
            Some(backend.as_str())
        );
        fs::write(&file, "broken configuration").unwrap();
        assert!(load_saved(&file).is_err());
        fs::remove_file(&file).unwrap();
        fs::remove_dir(&root).unwrap();
    }
}
