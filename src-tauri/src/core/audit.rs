//! Audit chain — HMAC-SHA256, key held in the Rust core (never in the DB) (B18-1 / ADR-011).
//! Every mutation appends an event; tampering breaks the chain → read-only + restore (AUTH-SPEC §2.5).

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

pub const GENESIS_HASH: &str = "genesis";

pub fn hmac_hex(key: &[u8], data: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    hex_lower(&mac.finalize().into_bytes())
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Compute the next chain hash: HMAC(key, prev_hash || event_payload).
pub fn next_hash(key: &[u8], prev_hash: &str, payload: &[u8]) -> String {
    let mut buf = Vec::with_capacity(prev_hash.len() + payload.len());
    buf.extend_from_slice(prev_hash.as_bytes());
    buf.extend_from_slice(payload);
    hmac_hex(key, &buf)
}

/// Verify a stored chain of (prev_hash, hash, payload) triples; returns the first broken index.
pub fn verify_chain(key: &[u8], events: &[(String, String, Vec<u8>)]) -> Option<usize> {
    let mut prev = GENESIS_HASH.to_string();
    for (i, (stored_prev, stored_hash, payload)) in events.iter().enumerate() {
        if *stored_prev != prev {
            return Some(i);
        }
        let expected = next_hash(key, &prev, payload);
        if *stored_hash != expected {
            return Some(i);
        }
        prev = stored_hash.clone();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chain_verifies_and_detects_tamper() {
        let key = b"test-key-32-bytes-000000000000000";
        let e1 = ("genesis".to_string(), next_hash(key, GENESIS_HASH, b"event-1"), b"event-1".to_vec());
        let e2 = (e1.1.clone(), next_hash(key, &e1.1, b"event-2"), b"event-2".to_vec());
        assert_eq!(verify_chain(key, &[e1.clone(), e2.clone()]), None);

        // tamper payload (event-2 changed but hash unchanged) → broken at index 1
        let tampered = (e1.1.clone(), e2.1.clone(), b"event-2-TAMPERED".to_vec());
        assert_eq!(verify_chain(key, &[e1, tampered]), Some(1));
    }

    #[test]
    fn genesis_break_is_detected() {
        let key = b"other-key-32-bytes-00000000000000";
        let e = ("previous".to_string(), next_hash(key, GENESIS_HASH, b"x"), b"x".to_vec());
        assert_eq!(verify_chain(key, &[e]), Some(0));
    }

    #[test]
    fn deterministic_hash_vectors() {
        let key = b"0123456789abcdef0123456789abcdef";
        assert_eq!(next_hash(key, GENESIS_HASH, b"import.commit"), next_hash(key, GENESIS_HASH, b"import.commit"));
        assert_ne!(next_hash(key, GENESIS_HASH, b"import.commit"), next_hash(key, GENESIS_HASH, b"import.rollback"));
    }
}
