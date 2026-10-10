use serde::{Deserialize, Serialize};
#[cfg(test)]
use std::fs;
use std::{path::PathBuf, sync::Mutex};

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(default)]
pub struct Preferences {
    pub auto_connect: bool,
    pub always_on_top: bool,
    pub remember_zoom: bool,
    pub zoom: f64,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            auto_connect: true,
            always_on_top: false,
            remember_zoom: true,
            zoom: 1.0,
        }
    }
}
impl Preferences {
    pub fn initial_zoom(&self) -> f64 {
        if self.remember_zoom {
            self.zoom
        } else {
            1.0
        }
    }
}

pub struct DesktopPreferences {
    path: PathBuf,
    values: Mutex<Preferences>,
    write_error: Option<String>,
}
impl DesktopPreferences {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let recovered =
            crate::preference_recovery::load::<Preferences>(&path, |p: &Preferences| {
                validate_zoom(p.zoom)
            });
        Ok(Self {
            path,
            values: Mutex::new(recovered.value),
            write_error: recovered.write_error,
        })
    }
    pub fn snapshot(&self) -> Preferences {
        self.values
            .lock()
            .expect("desktop preferences lock poisoned")
            .clone()
    }
    fn update(&self, change: impl FnOnce(&mut Preferences)) -> Result<(), String> {
        let mut values = self
            .values
            .lock()
            .expect("desktop preferences lock poisoned");
        let mut next = values.clone();
        change(&mut next);
        validate_zoom(next.zoom)?;
        if next == *values {
            return Ok(());
        }
        crate::preference_recovery::ensure_writable(&self.write_error)?;
        crate::persistence::atomic_write(
            &self.path,
            &serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?,
        )?;
        *values = next;
        Ok(())
    }
    pub fn set_auto_connect(&self, enabled: bool) -> Result<(), String> {
        self.update(|p| p.auto_connect = enabled)
    }
    pub fn set_always_on_top(&self, enabled: bool) -> Result<(), String> {
        self.update(|p| p.always_on_top = enabled)
    }
    pub fn set_remember_zoom(&self, enabled: bool, current: f64) -> Result<(), String> {
        validate_zoom(current)?;
        self.update(|p| {
            p.remember_zoom = enabled;
            if enabled {
                p.zoom = current;
            }
        })
    }
    pub fn record_zoom(&self, current: f64) -> Result<(), String> {
        validate_zoom(current)?;
        self.update(|p| {
            if p.remember_zoom {
                p.zoom = current;
            }
        })
    }
}

pub fn validate_zoom(value: f64) -> Result<(), String> {
    if !value.is_finite() || !(0.2..=10.0).contains(&value) {
        return Err("缩放比例必须在 20% 到 1000% 之间。".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "hermes-desktop-preferences-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
    fn clean(root: &std::path::Path) {
        for file in fs::read_dir(root).unwrap() {
            fs::remove_file(file.unwrap().path()).unwrap();
        }
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn preferences_restore_without_changing_existing_connection_or_window_state() {
        let root = root();
        fs::write(root.join("connection.json"), "connection sentinel").unwrap();
        fs::write(root.join("window.json"), r#"{"maximized":true}"#).unwrap();
        let path = root.join("desktop.json");
        let store = DesktopPreferences::open(path.clone()).unwrap();
        assert!(store.snapshot().auto_connect);
        assert!(!store.snapshot().always_on_top);
        store.set_auto_connect(false).unwrap();
        store.set_always_on_top(true).unwrap();
        store.record_zoom(1.5).unwrap();
        let reopened = DesktopPreferences::open(path.clone()).unwrap().snapshot();
        assert!(!reopened.auto_connect && reopened.always_on_top);
        assert_eq!(reopened.initial_zoom(), 1.5);
        store.set_remember_zoom(false, 1.5).unwrap();
        store.record_zoom(2.0).unwrap();
        assert_eq!(
            DesktopPreferences::open(path.clone())
                .unwrap()
                .snapshot()
                .initial_zoom(),
            1.0
        );
        store.set_remember_zoom(true, 1.25).unwrap();
        assert_eq!(
            DesktopPreferences::open(path.clone())
                .unwrap()
                .snapshot()
                .initial_zoom(),
            1.25
        );
        assert_eq!(
            fs::read_to_string(root.join("connection.json")).unwrap(),
            "connection sentinel"
        );
        assert_eq!(
            fs::read_to_string(root.join("window.json")).unwrap(),
            r#"{"maximized":true}"#
        );
        clean(&root);
    }
    #[test]
    fn invalid_or_failed_preferences_never_commit_in_memory_or_corrupt_saved_data() {
        let root = root();
        let path = root.join("desktop.json");
        fs::write(&path, r#"{"auto_connect":false}"#).unwrap();
        let store = DesktopPreferences::open(path.clone()).unwrap();
        assert_eq!(store.snapshot().initial_zoom(), 1.0);
        let before = fs::read(&path).unwrap();
        for invalid in [f64::NAN, f64::INFINITY, 0.0, -1.0, 100.0] {
            assert!(store.record_zoom(invalid).is_err());
        }
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(store.set_auto_connect(true).is_err());
        assert!(!store.snapshot().auto_connect);
        fs::remove_dir(&path).unwrap();
        clean(&root);
    }
}
