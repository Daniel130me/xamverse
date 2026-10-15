//! Secure key storage.
//!
//! The engine needs a small number of symmetric secrets (most importantly the
//! SQLCipher database key). This module defines the storage contract and a
//! portable implementation. The desktop shell may supply a stronger
//! implementation (Windows DPAPI / macOS Keychain) through the same trait.

use crate::error::{StorageError, StorageResult};
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/// Contract for storing and retrieving engine secrets by name.
///
/// Implementations must guarantee:
/// * the same name always yields the same secret (create-on-first-use),
/// * secrets are generated with a cryptographically secure RNG,
/// * persistence is as strong as the platform allows.
pub trait SecureKeyStore: Send + Sync {
    /// Return the secret stored under `name`, creating a random one of
    /// `len` bytes on first use.
    fn get_or_create(&self, name: &str, len: usize) -> StorageResult<Vec<u8>>;

    /// Return the secret only if it already exists.
    fn get(&self, name: &str) -> StorageResult<Option<Vec<u8>>>;
}

/// File-backed keystore.
///
/// # NOTE(non-standard): residual risk
/// The key file lives on the same disk as the database with `0600`
/// permissions. This protects the key from other *users* on the machine but
/// not from a local administrator or full-disk access. Production desktop
/// builds should inject an OS-keychain implementation of [`SecureKeyStore`]
/// (DPAPI on Windows, Keychain on macOS). The fallback exists so headless
/// nodes (labs, CI, Linux) remain fully functional; the limitation is also
/// documented in `docs/phase2/SECURITY_MODEL.md`.
pub struct FileKeyStore {
    dir: PathBuf,
}

impl FileKeyStore {
    pub fn new(dir: impl Into<PathBuf>) -> StorageResult<Self> {
        let dir = dir.into();
        fs::create_dir_all(&dir)?;
        // Restrict the directory itself on unix; Windows ACLs are tightened
        // by the installer (documented in UPDATES_AND_INSTALLERS.md).
        #[cfg(unix)]
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
        Ok(Self { dir })
    }

    fn key_path(&self, name: &str) -> StorageResult<PathBuf> {
        // Names are engine-controlled constants; reject anything that could
        // escape the directory as defence in depth.
        if name.contains('/') || name.contains('\\') || name.contains("..") {
            return Err(StorageError::InvalidValue {
                field: "key name",
                reason: "must not contain path separators".into(),
            });
        }
        Ok(self.dir.join(format!("{name}.key")))
    }
}

impl SecureKeyStore for FileKeyStore {
    fn get_or_create(&self, name: &str, len: usize) -> StorageResult<Vec<u8>> {
        match self.get(name)? {
            Some(secret) => Ok(secret),
            None => {
                let secret = crate::random_bytes(len);
                self.store(name, &secret)?;
                Ok(secret)
            }
        }
    }

    fn get(&self, name: &str) -> StorageResult<Option<Vec<u8>>> {
        let path = self.key_path(name)?;
        if !path.exists() {
            return Ok(None);
        }
        let hex = fs::read_to_string(path)?;
        let bytes = hex_to_bytes(hex.trim())
            .ok_or_else(|| StorageError::InvalidValue { field: "key file", reason: "not valid hex".into() })?;
        Ok(Some(bytes))
    }
}

impl FileKeyStore {
    fn store(&self, name: &str, secret: &[u8]) -> StorageResult<()> {
        let path = self.key_path(name)?;
        let mut file = fs::File::create(&path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        file.write_all(bytes_to_hex(secret).as_bytes())?;
        file.sync_all()?;
        Ok(())
    }
}

/// In-memory keystore for tests and ephemeral nodes.
#[derive(Default)]
pub struct MemoryKeyStore {
    secrets: std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>>,
}

impl SecureKeyStore for MemoryKeyStore {
    fn get_or_create(&self, name: &str, len: usize) -> StorageResult<Vec<u8>> {
        let mut map = self.secrets.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        Ok(map
            .entry(name.to_string())
            .or_insert_with(|| crate::random_bytes(len))
            .clone())
    }

    fn get(&self, name: &str) -> StorageResult<Option<Vec<u8>>> {
        Ok(self
            .secrets
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(name)
            .cloned())
    }
}

pub fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn hex_to_bytes(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    (0..hex.len() / 2)
        .map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok())
        .collect()
}

/// True if the path is an existing file (helper for diagnostics).
pub fn file_exists(path: &Path) -> bool {
    path.is_file()
}
