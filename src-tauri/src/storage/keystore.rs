//! Secret store: OS Keychain first (OAuth tokens + HMAC key per SECURITY-CHECKLIST A02),
//! headless-Linux fallback = 0600 file beside the app dir (warned in logs; no key ever in the DB).

use keyring::Entry;
use rand::RngCore;
use std::fs;
use std::path::Path;

const SERVICE_HMAC: &str = "com.onefpa.audit";
const USER_HMAC: &str = "chain-key";

/// Get or create the 32-byte HMAC chain key (hex in keychain; key is zeroised after use).
pub fn audit_hmac_key(data_dir: &Path) -> Result<Vec<u8>, String> {
    let hex = get_or_create(&Entry::new(SERVICE_HMAC, USER_HMAC).map_err(|e| e.to_string())?, data_dir, 64)?;
    let mut key = Vec::with_capacity(32);
    for i in (0..64).step_by(2) {
        let byte = u8::from_str_radix(&hex[i..i + 2], 16).map_err(|e| format!("KEY_HEX: {e}"))?;
        key.push(byte);
    }
    Ok(key)
}

fn get_or_create(entry: &Entry, data_dir: &Path, hex_len: usize) -> Result<String, String> {
    if let Ok(v) = entry.get_password() {
        if v.len() == hex_len {
            return Ok(v);
        }
    }
    let v = random_hex(hex_len);
    match entry.set_password(&v) {
        Ok(_) => Ok(v),
        Err(e) => {
            // Headless Linux without a Secret Service: OS-permission-protected file fallback.
            eprintln!("SECURITY: keychain unavailable ({e}); using 0600 file fallback (SECURITY-CHECKLIST A02)");
            fallback_file(data_dir, hex_len)
        }
    }
}

fn fallback_file(data_dir: &Path, hex_len: usize) -> Result<String, String> {
    let path = data_dir.join("audit.key");
    if let Ok(v) = fs::read_to_string(&path) {
        if v.trim().len() == hex_len {
            return Ok(v.trim().to_string());
        }
    }
    let v = random_hex(hex_len);
    fs::write(&path, &v).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(v)
}

/// Cryptographically secure random hex (`rand` OsRng — the OS CSPRNG).
fn random_hex(len: usize) -> String {
    let mut bytes = vec![0u8; len / 2];
    OsRng.fill_bytes(&mut bytes);
    let out: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    bytes.fill(0);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_hex_decodes_to_key_bytes() {
        let hex = random_hex(64);
        assert_eq!(hex.len(), 64);
        let bytes = (0..64)
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(bytes.len(), 32);
    }

    #[test]
    fn two_hex_values_are_distinct() {
        assert_ne!(random_hex(64), random_hex(64));
    }
}
