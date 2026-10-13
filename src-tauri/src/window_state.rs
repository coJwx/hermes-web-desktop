use serde::{Deserialize, Serialize};
#[cfg(test)]
use std::fs;
use std::{path::PathBuf, sync::Mutex};
use tauri::Manager;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct WindowPreferences {
    pub maximized: bool,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
}

/// Application-wide window preferences; independent of remote backend and login state.
pub struct WindowState {
    path: PathBuf,
    values: Mutex<WindowPreferences>,
    write_error: Option<String>,
}

impl WindowState {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let recovered = crate::preference_recovery::load::<WindowPreferences>(
            &path,
            |prefs: &WindowPreferences| {
                if let (Some(w), Some(h)) = (prefs.width, prefs.height) {
                    if w < 400.0 || h < 300.0 {
                        return Err("窗口尺寸过小".into());
                    }
                }
                Ok(())
            },
        );
        Ok(Self {
            path,
            values: Mutex::new(recovered.value),
            write_error: recovered.write_error,
        })
    }

    pub fn snapshot(&self) -> WindowPreferences {
        self.values
            .lock()
            .expect("window state lock poisoned")
            .clone()
    }

    pub fn maximized(&self) -> bool {
        self.values
            .lock()
            .expect("window state lock poisoned")
            .maximized
    }

    pub fn update(
        &self,
        maximized: bool,
        minimized: bool,
        size: Option<(f64, f64)>,
        position: Option<(f64, f64)>,
    ) -> Result<(), String> {
        // Minimize can report non-maximized; it must not erase the last normal/maximized mode.
        if minimized {
            return Ok(());
        }
        let mut values = self.values.lock().expect("window state lock poisoned");
        let mut next = values.clone();
        next.maximized = maximized;

        // Only update bounds when not maximized so we store the normal window geometry.
        if !maximized {
            if let Some((w, h)) = size {
                if w >= 400.0 && h >= 300.0 {
                    next.width = Some(w);
                    next.height = Some(h);
                }
            }
            if let Some((x, y)) = position {
                next.x = Some(x);
                next.y = Some(y);
            }
        }

        if *values == next {
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
}

pub fn remember(window: &tauri::Window) {
    let result = (|| -> Result<(), String> {
        // Ignore the transient unmaximized layout while constructing a hidden Dashboard.
        if !window.is_visible().map_err(|e| e.to_string())? {
            return Ok(());
        }
        let minimized = window.is_minimized().map_err(|e| e.to_string())?;
        let maximized = window.is_maximized().map_err(|e| e.to_string())?;

        let mut size = None;
        let mut position = None;
        if !maximized && !minimized {
            if let Ok(factor) = window.scale_factor() {
                if let Ok(inner) = window.inner_size() {
                    let logical = inner.to_logical::<f64>(factor);
                    size = Some((logical.width, logical.height));
                }
                if let Ok(outer) = window.outer_position() {
                    let logical = outer.to_logical::<f64>(factor);
                    position = Some((logical.x, logical.y));
                }
            }
        }

        window
            .state::<WindowState>()
            .update(maximized, minimized, size, position)
    })();
    if let Err(error) = result {
        crate::diagnostics::record("preferences.window_save_failed");
        eprintln!("Could not save Dashboard window state: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("hermes-window-state-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn maximize_and_restore_survive_reopening_without_changing_connection_data() {
        let root = root();
        let path = root.join("window.json");
        let connection = root.join("connection.json");
        fs::write(&connection, "existing connection data").unwrap();
        let state = WindowState::open(path.clone()).unwrap();
        assert!(!state.maximized());
        state.update(true, false, None, None).unwrap();
        assert!(WindowState::open(path.clone()).unwrap().maximized());
        state.update(false, false, None, None).unwrap();
        assert!(!WindowState::open(path.clone()).unwrap().maximized());
        assert_eq!(
            fs::read_to_string(&connection).unwrap(),
            "existing connection data"
        );
        fs::remove_file(path).unwrap();
        fs::remove_file(connection).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn bounds_are_remembered_when_not_maximized() {
        let root = root();
        let path = root.join("window.json");
        let state = WindowState::open(path.clone()).unwrap();
        state
            .update(
                false,
                false,
                Some((1400.0, 950.0)),
                Some((120.0, 80.0)),
            )
            .unwrap();
        let reloaded = WindowState::open(path.clone()).unwrap();
        let snap = reloaded.snapshot();
        assert_eq!(snap.width, Some(1400.0));
        assert_eq!(snap.height, Some(950.0));
        assert_eq!(snap.x, Some(120.0));
        assert_eq!(snap.y, Some(80.0));

        // When maximizing, bounds shouldn't be overwritten with None or screen size
        state.update(true, false, None, None).unwrap();
        let snap2 = WindowState::open(path.clone()).unwrap().snapshot();
        assert!(snap2.maximized);
        assert_eq!(snap2.width, Some(1400.0));
        assert_eq!(snap2.height, Some(950.0));

        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn minimize_does_not_reset_mode_and_failed_write_does_not_update_memory() {
        let root = root();
        let path = root.join("window.json");
        let state = WindowState::open(path.clone()).unwrap();
        state.update(true, false, None, None).unwrap();
        state.update(false, true, None, None).unwrap();
        assert!(state.maximized());
        assert!(WindowState::open(path.clone()).unwrap().maximized());
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(state.update(false, false, None, None).is_err());
        assert!(state.maximized());
        fs::remove_dir(&path).unwrap();
        for file in fs::read_dir(&root).unwrap() {
            fs::remove_file(file.unwrap().path()).unwrap();
        }
        fs::remove_dir(root).unwrap();
    }
}
