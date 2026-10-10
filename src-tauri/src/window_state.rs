use serde::{Deserialize, Serialize};
#[cfg(test)]
use std::fs;
use std::{path::PathBuf, sync::Mutex};
use tauri::Manager;

#[derive(Default, Deserialize, Serialize)]
struct Preferences {
    maximized: bool,
}

/// Application-wide window preferences; independent of remote backend and login state.
pub struct WindowState {
    path: PathBuf,
    values: Mutex<Preferences>,
    write_error: Option<String>,
}

impl WindowState {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let recovered =
            crate::preference_recovery::load::<Preferences>(&path, |_: &Preferences| Ok(()));
        Ok(Self {
            path,
            values: Mutex::new(recovered.value),
            write_error: recovered.write_error,
        })
    }

    pub fn maximized(&self) -> bool {
        self.values
            .lock()
            .expect("window state lock poisoned")
            .maximized
    }

    pub fn update(&self, maximized: bool, minimized: bool) -> Result<(), String> {
        // Minimize can report non-maximized; it must not erase the last normal/maximized mode.
        if minimized {
            return Ok(());
        }
        let mut values = self.values.lock().expect("window state lock poisoned");
        if values.maximized == maximized {
            return Ok(());
        }
        let next = Preferences { maximized };
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
        window.state::<WindowState>().update(maximized, minimized)
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
        state.update(true, false).unwrap();
        assert!(WindowState::open(path.clone()).unwrap().maximized());
        state.update(false, false).unwrap();
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
    fn minimize_does_not_reset_mode_and_failed_write_does_not_update_memory() {
        let root = root();
        let path = root.join("window.json");
        let state = WindowState::open(path.clone()).unwrap();
        state.update(true, false).unwrap();
        state.update(false, true).unwrap();
        assert!(state.maximized());
        assert!(WindowState::open(path.clone()).unwrap().maximized());
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(state.update(false, false).is_err());
        assert!(state.maximized());
        fs::remove_dir(&path).unwrap();
        for file in fs::read_dir(&root).unwrap() {
            fs::remove_file(file.unwrap().path()).unwrap();
        }
        fs::remove_dir(root).unwrap();
    }
}
