use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use url::Url;

#[derive(Clone)]
pub struct BackendFiles {
    pub directory: PathBuf,
    pub identity: String,
}
impl BackendFiles {
    pub fn new(root: &Path, backend: &Url) -> Self {
        let identity = backend.as_str().to_owned();
        let key = format!("{:x}", Sha256::digest(identity.as_bytes()));
        Self {
            directory: root.join("servers").join(key),
            identity,
        }
    }
    pub fn cookie_path(&self) -> PathBuf {
        self.directory.join("session.dpapi")
    }
}

/// Never write cookie plaintext to temporary files: callers encrypt before this function.
pub fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("存储路径无效")?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建存储目录：{e}"))?;
    let temporary = parent.join(format!(".write-{}", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    let write = file.write_all(data).and_then(|_| file.sync_all());
    drop(file);
    let result = write
        .and_then(|_| fs::rename(&temporary, path))
        .map_err(|e| format!("无法保存 {}：{e}", path.display()));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Appearance {
    pub theme: Option<String>,
    pub font: Option<String>,
    pub locale: Option<String>,
}

fn validate_appearance(value: &Appearance) -> Result<(), String> {
    for text in [&value.theme, &value.font, &value.locale]
        .into_iter()
        .flatten()
    {
        if text.is_empty() || text.len() > 256 || text.chars().any(char::is_control) {
            return Err("主题、字体或语言标识无效".into());
        }
    }
    Ok(())
}

pub struct AppearanceStore {
    path: PathBuf,
    values: Mutex<Appearance>,
    write_error: Option<String>,
}
impl AppearanceStore {
    pub fn open(files: &BackendFiles) -> Result<Self, String> {
        let path = files.directory.join("preferences.json");
        let recovered = crate::preference_recovery::load::<Appearance>(&path, validate_appearance);
        Ok(Self {
            path,
            values: Mutex::new(recovered.value),
            write_error: recovered.write_error,
        })
    }
    pub fn update(&self, patch: Appearance) -> Result<(), String> {
        validate_appearance(&patch)?;
        crate::preference_recovery::ensure_writable(&self.write_error)?;
        let mut values = self.values.lock().expect("appearance lock poisoned");
        let mut next = values.clone();
        if patch.theme.is_some() {
            next.theme = patch.theme;
        }
        if patch.font.is_some() {
            next.font = patch.font;
        }
        if patch.locale.is_some() {
            next.locale = patch.locale;
        }
        atomic_write(
            &self.path,
            &serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?,
        )?;
        *values = next;
        Ok(())
    }
    /// Runs before the bundled frontend reads localStorage, independently of the random bridge port.
    pub fn bootstrap(&self) -> String {
        let values = self.values.lock().expect("appearance lock poisoned");
        let json = serde_json::to_string(&*values)
            .expect("serializable appearance")
            .replace('<', "\\u003c");
        let mut script = format!(
            "<script>window.__HERMES_DESKTOP__=true;window.__HERMES_DESKTOP_APPEARANCE__={json};"
        );
        for (key, value) in [
            ("hermes-dashboard-theme", &values.theme),
            ("hermes-dashboard-font", &values.font),
            ("hermes-locale", &values.locale),
        ] {
            if let Some(value) = value {
                let json = serde_json::to_string(value)
                    .expect("serializable preference")
                    .replace('<', "\\u003c");
                script.push_str(&format!("localStorage.setItem(\"{key}\",{json});"));
            }
        }
        script.push_str("</script>");
        script
    }
}

pub mod cookies;
pub mod protect;
