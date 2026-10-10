use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_BYTES: u64 = 256 * 1024;
static LOG: OnceLock<Mutex<LocalLog>> = OnceLock::new();
static WARNINGS: Mutex<Vec<String>> = Mutex::new(Vec::new());

struct LocalLog {
    path: PathBuf,
}
impl LocalLog {
    fn write(&self, event: &'static str) -> std::io::Result<()> {
        if fs::metadata(&self.path).is_ok_and(|m| m.len() >= MAX_BYTES) {
            let previous = self.path.with_extension("previous.log");
            if previous.exists() {
                fs::remove_file(&previous)?;
            }
            fs::rename(&self.path, previous)?;
        }
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        writeln!(
            fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)?,
            "{seconds} {event}"
        )
    }
}

pub fn init(root: &std::path::Path) {
    let _ = LOG.set(Mutex::new(LocalLog {
        path: root.join("desktop.log"),
    }));
    record("desktop.started");
}

/// Deliberately accepts fixed event codes, not error strings/URLs/Cookie values or payloads.
pub fn record(event: &'static str) {
    if let Some(log) = LOG.get() {
        if let Ok(log) = log.lock() {
            let _ = log.write(event);
        }
    }
}

pub fn warning(event: &'static str, message: String) {
    record(event);
    WARNINGS
        .lock()
        .expect("warning lock poisoned")
        .push(message);
}

pub fn take_warnings() -> Vec<String> {
    std::mem::take(&mut *WARNINGS.lock().expect("warning lock poisoned"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn log_rotates_and_only_writes_event_codes() {
        let root = std::env::temp_dir().join(format!("hermes-log-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let log = LocalLog {
            path: root.join("desktop.log"),
        };
        fs::write(&log.path, vec![b'x'; MAX_BYTES as usize]).unwrap();
        log.write("bridge.failed").unwrap();
        assert!(fs::read_to_string(&log.path)
            .unwrap()
            .ends_with("bridge.failed\n"));
        assert_eq!(
            fs::metadata(log.path.with_extension("previous.log"))
                .unwrap()
                .len(),
            MAX_BYTES
        );
        fs::remove_file(&log.path).unwrap();
        fs::remove_file(log.path.with_extension("previous.log")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
