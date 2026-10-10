use serde::de::DeserializeOwned;
use std::{fs, path::Path};

pub struct Recovered<T> {
    pub value: T,
    /// A failed backup/read must not later overwrite the original with defaults.
    pub write_error: Option<String>,
}

pub fn load<T: Default + DeserializeOwned>(
    path: &Path,
    validate: impl Fn(&T) -> Result<(), String>,
) -> Recovered<T> {
    let data = match fs::read(path) {
        Ok(data) => data,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Recovered {
                value: T::default(),
                write_error: None,
            }
        }
        Err(e) => {
            let message = format!(
                "无法读取偏好 {}：{e}。本次使用只读默认值，原文件不会被覆盖。",
                path.display()
            );
            crate::diagnostics::warning("preferences.read_failed", message.clone());
            return Recovered {
                value: T::default(),
                write_error: Some(message),
            };
        }
    };
    let parsed = serde_json::from_slice::<T>(&data)
        .map_err(|e| e.to_string())
        .and_then(|value| {
            validate(&value)?;
            Ok(value)
        });
    match parsed {
        Ok(value) => Recovered {
            value,
            write_error: None,
        },
        Err(_) => {
            let backup = path.with_extension(format!("corrupt-{}.json", uuid::Uuid::new_v4()));
            let write_error = match fs::rename(path, &backup) {
                Ok(()) => {
                    crate::diagnostics::warning(
                        "preferences.recovered",
                        format!(
                            "偏好 {} 无效，已保留到 {}，本次使用默认值。",
                            path.display(),
                            backup.display()
                        ),
                    );
                    None
                }
                Err(_) => {
                    let message = format!(
                        "偏好 {} 无效且无法备份。本次使用只读默认值，原文件不会被覆盖。",
                        path.display()
                    );
                    crate::diagnostics::warning("preferences.backup_failed", message.clone());
                    Some(message)
                }
            };
            Recovered {
                value: T::default(),
                write_error,
            }
        }
    }
}

pub fn ensure_writable(error: &Option<String>) -> Result<(), String> {
    error
        .as_ref()
        .map_or(Ok(()), |message| Err(message.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default, serde::Deserialize)]
    struct Prefs {
        count: usize,
    }
    #[test]
    fn corrupt_and_invalid_preferences_are_preserved_before_recovery() {
        let root = std::env::temp_dir().join(format!("hermes-recovery-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("prefs.json");
        for raw in ["broken JSON", r#"{"count":999}"#] {
            fs::write(&path, raw).unwrap();
            let recovered = load::<Prefs>(&path, |p| {
                if p.count < 10 {
                    Ok(())
                } else {
                    Err("invalid".into())
                }
            });
            assert_eq!(recovered.value.count, 0);
            assert!(recovered.write_error.is_none());
            assert!(!path.exists());
            assert!(fs::read_dir(&root).unwrap().any(|entry| fs::read_to_string(
                entry.unwrap().path()
            )
            .unwrap()
                == raw));
        }
        for entry in fs::read_dir(&root).unwrap() {
            fs::remove_file(entry.unwrap().path()).unwrap();
        }
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn unreadable_preferences_leave_original_untouched_and_disable_writes() {
        let root = std::env::temp_dir().join(format!("hermes-readonly-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let recovered = load::<Prefs>(&root, |_| Ok(()));
        assert!(ensure_writable(&recovered.write_error).is_err());
        assert!(root.is_dir());
        fs::remove_dir(root).unwrap();
    }
}
