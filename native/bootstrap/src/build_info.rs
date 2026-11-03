use anyhow::{Result, ensure};
#[used]
static INFO: [u8; include_bytes!(concat!(env!("OUT_DIR"), "/native-info.bin")).len()] =
    *include_bytes!(concat!(env!("OUT_DIR"), "/native-info.bin"));
pub fn value() -> Result<serde_json::Value> {
    let info: serde_json::Value = serde_json::from_slice(&INFO[26..])?;
    ensure!(
        info["keyFingerprint"].as_str() == Some(crate::tree::key_fingerprint()?.as_str()),
        "Embedded build identity differs from the pinned runtime key"
    );
    Ok(info)
}
