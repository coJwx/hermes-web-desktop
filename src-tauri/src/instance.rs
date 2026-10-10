use std::{
    fs::{File, OpenOptions},
    path::Path,
};

/// The OS releases this lock on normal exit and crashes; the file itself is not a PID sentinel.
pub struct InstanceLock {
    _file: File,
}
impl InstanceLock {
    pub fn acquire(root: &Path) -> Result<Self, String> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join("desktop.lock"))
            .map_err(|e| format!("无法打开客户端锁：{e}"))?;
        file.try_lock().map_err(|_| {
            "此数据目录已由另一个 Hermes Dashboard 使用，或无法获取独占锁。请先退出已有客户端。"
                .to_string()
        })?;
        Ok(Self { _file: file })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_one_owner_and_release_allows_reopening() {
        let root = std::env::temp_dir().join(format!("hermes-lock-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let first = InstanceLock::acquire(&root).unwrap();
        assert!(InstanceLock::acquire(&root).is_err());
        drop(first);
        drop(InstanceLock::acquire(&root).unwrap());
        std::fs::remove_file(root.join("desktop.lock")).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
