use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use url::Url;

pub const DEFAULT_BACKEND: &str = "http://10.144.1.2:9119";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ServerProfile {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub last_used: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConnectionSettingsData {
    pub backend_url: String,
    #[serde(default)]
    pub servers: Vec<ServerProfile>,
    #[serde(default)]
    pub active_id: Option<String>,
}

impl Default for ConnectionSettingsData {
    fn default() -> Self {
        Self {
            backend_url: DEFAULT_BACKEND.to_string(),
            servers: Vec::new(),
            active_id: None,
        }
    }
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

pub fn load_connection_data(path: &Path) -> Result<Option<ConnectionSettingsData>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => {
            let data: ConnectionSettingsData =
                serde_json::from_str(&raw).map_err(|e| format!("连接配置损坏：{e}"))?;
            let mut validated_url = validate(&data.backend_url)?.to_string();
            let mut servers = data.servers;
            let mut active_id = data.active_id;

            // If we have an active_id, make sure backend_url reflects the active server
            if let Some(ref aid) = active_id {
                if let Some(active_server) = servers.iter().find(|s| &s.id == aid) {
                    validated_url = active_server.url.clone();
                }
            } else if let Some(first) = servers.first() {
                active_id = Some(first.id.clone());
                validated_url = first.url.clone();
            } else {
                // If servers list is empty, initialize it with the validated backend_url
                let id = uuid::Uuid::new_v4().to_string();
                active_id = Some(id.clone());
                servers.push(ServerProfile {
                    id,
                    name: validated_url.clone(),
                    url: validated_url.clone(),
                    last_used: None,
                });
            }

            Ok(Some(ConnectionSettingsData {
                backend_url: validated_url,
                servers,
                active_id,
            }))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("无法读取连接配置：{e}")),
    }
}

pub fn load_saved(path: &Path) -> Result<Option<String>, String> {
    load_connection_data(path).map(|opt| opt.map(|d| d.backend_url))
}

pub fn load(path: &Path) -> Result<String, String> {
    Ok(load_saved(path)?.unwrap_or_else(|| DEFAULT_BACKEND.into()))
}

pub fn save_connection_data(path: &Path, data: &ConnectionSettingsData) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("连接配置路径无效")?).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(data).map_err(|e| e.to_string())?;
    crate::persistence::atomic_write(path, &bytes)
}

pub fn save(path: &Path, url: &Url) -> Result<(), String> {
    let url_str = url.to_string();
    let mut data = load_connection_data(path)?.unwrap_or_else(ConnectionSettingsData::default);
    data.backend_url = url_str.clone();

    // Find or add profile
    if let Some(existing) = data.servers.iter_mut().find(|s| s.url == url_str) {
        data.active_id = Some(existing.id.clone());
    } else {
        let new_id = uuid::Uuid::new_v4().to_string();
        data.active_id = Some(new_id.clone());
        data.servers.push(ServerProfile {
            id: new_id,
            name: url_str.clone(),
            url: url_str,
            last_used: None,
        });
    }

    save_connection_data(path, &data)
}

pub fn upsert_profile(
    path: &Path,
    name: &str,
    url: &str,
    id: Option<&str>,
) -> Result<ServerProfile, String> {
    let valid_url = validate(url)?.to_string();
    let mut data = load_connection_data(path)?.unwrap_or_else(ConnectionSettingsData::default);

    let profile = if let Some(existing_id) = id {
        if let Some(p) = data.servers.iter_mut().find(|s| s.id == existing_id) {
            p.name = name.trim().to_string();
            p.url = valid_url.clone();
            p.clone()
        } else {
            let p = ServerProfile {
                id: existing_id.to_string(),
                name: name.trim().to_string(),
                url: valid_url.clone(),
                last_used: None,
            };
            data.servers.push(p.clone());
            p
        }
    } else {
        let new_id = uuid::Uuid::new_v4().to_string();
        let p = ServerProfile {
            id: new_id,
            name: name.trim().to_string(),
            url: valid_url.clone(),
            last_used: None,
        };
        data.servers.push(p.clone());
        p
    };

    save_connection_data(path, &data)?;
    Ok(profile)
}

pub fn remove_profile(path: &Path, id: &str) -> Result<(), String> {
    let mut data = load_connection_data(path)?.unwrap_or_else(ConnectionSettingsData::default);
    data.servers.retain(|s| s.id != id);
    if data.active_id.as_deref() == Some(id) {
        data.active_id = data.servers.first().map(|s| s.id.clone());
        if let Some(first) = data.servers.first() {
            data.backend_url = first.url.clone();
        }
    }
    save_connection_data(path, &data)
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
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn server_profiles_support_upsert_and_removal() {
        let root = std::env::temp_dir().join(format!("hermes-profiles-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("connection.json");

        let p1 = upsert_profile(&file, "生产机", "http://10.0.0.1:9119", None).unwrap();
        assert_eq!(p1.name, "生产机");
        let data = load_connection_data(&file).unwrap().unwrap();
        assert_eq!(data.servers.len(), 1);

        let p2 = upsert_profile(&file, "GPU服务器", "http://10.0.0.2:9119", None).unwrap();
        let data = load_connection_data(&file).unwrap().unwrap();
        assert_eq!(data.servers.len(), 2);

        // Edit p1
        upsert_profile(&file, "核心生产机", "http://10.0.0.1:9119", Some(&p1.id)).unwrap();
        let data = load_connection_data(&file).unwrap().unwrap();
        assert_eq!(data.servers[0].name, "核心生产机");

        // Remove p2
        remove_profile(&file, &p2.id).unwrap();
        let data = load_connection_data(&file).unwrap().unwrap();
        assert_eq!(data.servers.len(), 1);

        fs::remove_file(file).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
