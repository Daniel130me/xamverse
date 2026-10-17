//! OS-backed secret storage for production desktop installations.

use std::path::Path;
use xamverse_storage::{StorageError, StorageResult};

const SERVICE_NAME: &str = "com.xamverse.desktop";

/// Stores engine secrets in Windows Credential Manager or macOS Keychain.
/// The data-directory hash separates side-by-side installations without
/// exposing the directory path in the OS credential UI.
pub struct PlatformKeyStore {
    namespace: String,
}

impl PlatformKeyStore {
    pub fn for_data_dir(data_dir: &Path) -> StorageResult<Self> {
        let absolute = data_dir.canonicalize().or_else(|_| {
            std::fs::create_dir_all(data_dir)?;
            data_dir.canonicalize()
        })?;
        Ok(Self {
            namespace: xamverse_storage::checksum(absolute.to_string_lossy()),
        })
    }

    fn entry(&self, name: &str) -> StorageResult<keyring::Entry> {
        if name.contains('/') || name.contains('\\') || name.contains("..") {
            return Err(StorageError::InvalidValue {
                field: "key name",
                reason: "must not contain path separators".into(),
            });
        }
        keyring::Entry::new(SERVICE_NAME, &format!("{}:{name}", self.namespace))
            .map_err(keyring_error)
    }
}

impl xamverse_storage::SecureKeyStore for PlatformKeyStore {
    fn get_or_create(&self, name: &str, len: usize) -> StorageResult<Vec<u8>> {
        if let Some(secret) = self.get(name)? {
            if secret.len() != len {
                return Err(StorageError::InvalidValue {
                    field: "keychain secret",
                    reason: format!("{name} has an unexpected length"),
                });
            }
            return Ok(secret);
        }

        let secret = xamverse_storage::random_bytes(len);
        self.entry(name)?
            .set_password(&xamverse_storage::keystore::bytes_to_hex(&secret))
            .map_err(keyring_error)?;
        Ok(secret)
    }

    fn get(&self, name: &str) -> StorageResult<Option<Vec<u8>>> {
        match self.entry(name)?.get_password() {
            Ok(encoded) => xamverse_storage::keystore::hex_to_bytes(&encoded)
                .map(Some)
                .ok_or_else(|| StorageError::InvalidValue {
                    field: "keychain secret",
                    reason: format!("{name} is not valid hexadecimal data"),
                }),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(keyring_error(error)),
        }
    }
}

fn keyring_error(error: keyring::Error) -> StorageError {
    // Do not include credential contents or OS diagnostic payloads in errors.
    StorageError::InvalidValue {
        field: "operating-system keychain",
        reason: error.to_string(),
    }
}
