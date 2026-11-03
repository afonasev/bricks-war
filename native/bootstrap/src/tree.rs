use crate::platform;
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, VerifyingKey, pkcs8::DecodePublicKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[cfg(not(feature = "fixture"))]
const KEY: &str = include_str!("../../../electron/content-public-key.pem");
#[cfg(feature = "fixture")]
const KEY: &str = include_str!(env!("BRICKS_BOOTSTRAP_TEST_KEY"));
pub const MANIFEST: &str = "bootstrap-manifest.json";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    payload: String,
    signature: String,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub path: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub executable: bool,
    #[serde(default)]
    pub link: Option<String>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema: u32,
    pub game: String,
    pub component: String,
    pub channel: String,
    pub platform: String,
    pub arch: String,
    pub version: String,
    pub sequence: u64,
    pub root_abi: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_probe_abi: Option<u32>,
    pub entry: String,
    pub args: Vec<String>,
    pub files: Vec<Entry>,
}
#[derive(Clone, Debug)]
pub struct Tree {
    pub manifest: Manifest,
    pub digest: String,
    pub path: PathBuf,
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|v| format!("{v:02x}")).collect()
}
pub fn digest_ok(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
// Same lexical namespace on Windows and macOS, even when checked on a host with
// a case-sensitive filesystem. Reject ADS, device names and normalizing aliases.
pub fn relative(value: &str) -> Result<PathBuf> {
    ensure!(
        !value.is_empty()
            && value.is_ascii()
            && value.len() <= 1024
            && !value.contains(['\\', ':', '\0']),
        "Invalid relative path"
    );
    for part in value.split('/') {
        ensure!(
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with(['.', ' '])
                && !part.chars().any(|c| c.is_control()),
            "Path traversal/alias"
        );
        let stem = part.split('.').next().unwrap().to_ascii_uppercase();
        ensure!(
            !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                && !(stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && stem.as_bytes()[3].is_ascii_digit()),
            "Windows device alias"
        );
    }
    Ok(PathBuf::from(value))
}

pub fn bounded(path: &Path, limit: u64) -> Result<Vec<u8>> {
    platform::plain(path)?;
    let file = File::open(path)?;
    ensure!(
        file.metadata()?.is_file() && file.metadata()?.len() <= limit,
        "Oversized/non-file record"
    );
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() as u64 <= limit, "Oversized record");
    Ok(bytes)
}

pub(crate) fn signed(path: &Path, component: &str) -> Result<(Manifest, String)> {
    ensure!(
        matches!(component, "launcher" | "client"),
        "Unknown component"
    );
    let raw = bounded(&path.join(MANIFEST), 4 * 1024 * 1024)?;
    let envelope: Envelope = serde_json::from_slice(&raw)?;
    let key = VerifyingKey::from_public_key_pem(KEY)?;
    key.verify_strict(
        envelope.payload.as_bytes(),
        &Signature::from_slice(&STANDARD.decode(envelope.signature)?)?,
    )?;
    let m: Manifest = serde_json::from_str(&envelope.payload)?;
    ensure!(
        m.schema == 1
            && m.game == "bricks-war"
            && m.channel == "stable"
            && m.component == component
            && m.root_abi == 1
            && m.sequence > 0,
        "Wrong signed identity"
    );
    let platform = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        value => value,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        value => value,
    };
    ensure!(
        m.platform == platform
            && (m.arch == arch || (platform == "darwin" && m.arch == "universal")),
        "Wrong platform/arch"
    );
    let version: Vec<_> = m.version.split('.').collect();
    ensure!(
        version.len() == 3
            && version
                .iter()
                .all(|v| !v.is_empty() && v.len() <= 9 && v.bytes().all(|b| b.is_ascii_digit())),
        "Invalid version"
    );
    ensure!(
        !m.files.is_empty()
            && m.files.len() <= 50000
            && m.args.len() <= 32
            && m.args.iter().all(|s| s.len() <= 4096 && !s.contains('\0')),
        "Invalid inventory/arguments"
    );
    relative(&m.entry)?;
    Ok((m, hex(&Sha256::digest(envelope.payload.as_bytes()))))
}

fn inventory(
    path: &Path,
    prefix: &str,
    actual: &mut BTreeSet<String>,
    count: &mut usize,
) -> Result<()> {
    for item in fs::read_dir(path)? {
        let item = item?;
        *count += 1;
        ensure!(*count <= 60000, "Oversized payload inventory");
        let name = item
            .file_name()
            .into_string()
            .map_err(|_| anyhow::anyhow!("Non UTF-8 payload path"))?;
        let name = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        if name == MANIFEST {
            continue;
        }
        relative(&name)?;
        let metadata = fs::symlink_metadata(item.path())?;
        #[cfg(windows)]
        platform::plain(&item.path())?;
        if metadata.is_dir() {
            inventory(&item.path(), &name, actual, count)?;
        } else {
            ensure!(
                metadata.is_file() || metadata.file_type().is_symlink(),
                "Unsupported payload entry"
            );
            actual.insert(name);
        }
    }
    Ok(())
}

fn verify_link(root: &Path, entry: &Entry) -> Result<()> {
    ensure!(
        entry.size.is_none() && entry.sha256.is_none() && !entry.executable,
        "Mixed symlink entry"
    );
    ensure!(cfg!(unix), "Symlinks unsupported on Windows");
    let target = entry.link.as_ref().unwrap();
    ensure!(
        !target.is_empty() && !target.starts_with('/') && !target.contains(['\\', ':', '\0']),
        "Unsafe symlink target"
    );
    let path = root.join(relative(&entry.path)?);
    ensure!(
        fs::read_link(&path)?.to_str() == Some(target.as_str()),
        "Changed symlink"
    );
    let resolved = path.canonicalize().context("Broken/cyclic symlink")?;
    ensure!(
        resolved.starts_with(root.canonicalize()?),
        "Escaping symlink"
    );
    Ok(())
}

pub fn verify(path: &Path, component: &str) -> Result<Tree> {
    platform::ancestors(path)?;
    let (manifest, digest) = signed(path, component)?;
    let mut expected = BTreeSet::new();
    let mut aliases = BTreeSet::new();
    let mut kinds = BTreeMap::new();
    let mut total = 0u64;
    for entry in &manifest.files {
        relative(&entry.path)?;
        ensure!(
            entry.path != MANIFEST
                && expected.insert(entry.path.clone())
                && aliases.insert(entry.path.to_lowercase()),
            "Duplicate/aliased payload entry"
        );
        kinds.insert(entry.path.clone(), entry.link.is_some());
        if entry.link.is_none() {
            let size = entry.size.context("Missing size")?;
            ensure!(size <= 2 * 1024 * 1024 * 1024, "Oversized file");
            total = total.checked_add(size).context("Size overflow")?;
        }
    }
    ensure!(total <= 8 * 1024 * 1024 * 1024, "Oversized payload");
    let mut actual = BTreeSet::new();
    inventory(path, "", &mut actual, &mut 0)?;
    ensure!(actual == expected, "Unsigned/missing payload entries");
    for entry in &manifest.files {
        // No signed file may be reached through another entry's link. Framework
        // aliases are verified as links; physical files are inventoried once.
        let rel = relative(&entry.path)?;
        for parent in rel.ancestors().skip(1) {
            if !parent.as_os_str().is_empty() {
                platform::plain(&path.join(parent))?;
            }
        }
        if entry.link.is_some() {
            verify_link(path, entry)?;
            continue;
        }
        let full = path.join(&rel);
        platform::plain(&full)?;
        let file = File::open(&full)?;
        let metadata = file.metadata()?;
        let size = entry.size.unwrap();
        ensure!(
            metadata.is_file() && metadata.len() == size,
            "Changed payload size"
        );
        let hash = entry.sha256.as_deref().context("Missing digest")?;
        ensure!(digest_ok(hash), "Invalid digest");
        let mut hasher = Sha256::new();
        let mut limited = file.take(size + 1);
        let count = std::io::copy(&mut limited, &mut hasher)?;
        ensure!(
            count == size && hex(&hasher.finalize()) == hash,
            "Changed payload digest"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            ensure!(
                (metadata.permissions().mode() & 0o111 != 0) == entry.executable,
                "Changed executable mode"
            );
        }
    }
    ensure!(
        kinds.get(&manifest.entry) == Some(&false)
            && manifest
                .files
                .iter()
                .any(|e| e.path == manifest.entry && e.executable),
        "Entrypoint is not an executable file"
    );
    Ok(Tree {
        manifest,
        digest,
        path: path.to_path_buf(),
    })
}

pub fn copy(source: &Tree, to: &Path) -> Result<()> {
    fs::create_dir(to)?;
    for entry in source.manifest.files.iter().filter(|e| e.link.is_none()) {
        let relative = relative(&entry.path)?;
        let target = to.join(&relative);
        fs::create_dir_all(target.parent().unwrap())?;
        let mut file = platform::exclusive_file(&target)?;
        let size = entry.size.unwrap();
        let mut input = File::open(source.path.join(relative))?.take(size + 1);
        ensure!(
            std::io::copy(&mut input, &mut file)? == size,
            "Source changed during staging"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(if entry.executable {
                0o755
            } else {
                0o644
            }))?;
        }
        file.sync_all()?;
    }
    for entry in source.manifest.files.iter().filter(|e| e.link.is_some()) {
        let target = to.join(relative(&entry.path)?);
        fs::create_dir_all(target.parent().unwrap())?;
        #[cfg(unix)]
        std::os::unix::fs::symlink(entry.link.as_ref().unwrap(), &target)?;
        #[cfg(not(unix))]
        anyhow::bail!("Symlinks unsupported on Windows");
    }
    let mut file = platform::exclusive_file(&to.join(MANIFEST))?;
    file.write_all(&bounded(&source.path.join(MANIFEST), 4 * 1024 * 1024)?)?;
    file.sync_all()?;
    sync_tree(to)?;
    Ok(())
}
fn sync_tree(path: &Path) -> Result<()> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if fs::symlink_metadata(entry.path())?.is_dir() {
            sync_tree(&entry.path())?;
        }
    }
    platform::sync_dir(path)
}

pub fn key_fingerprint() -> Result<String> {
    let key = VerifyingKey::from_public_key_pem(KEY)?;
    Ok(hex(&Sha256::digest(key.to_bytes())))
}

#[cfg(windows)]
pub fn signed_record<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    let envelope: Envelope = serde_json::from_slice(&bounded(path, 65536)?)?;
    let key = VerifyingKey::from_public_key_pem(KEY)?;
    key.verify_strict(
        envelope.payload.as_bytes(),
        &Signature::from_slice(&STANDARD.decode(envelope.signature)?)?,
    )?;
    Ok(serde_json::from_str(&envelope.payload)?)
}

#[cfg(test)]
mod copy_boundary_tests {
    use super::*;
    #[test]
    fn copied_snapshot_excludes_late_unsigned_files_and_links() -> Result<()> {
        let base = std::env::var_os("BRICKS_QA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let root = base.join(format!("seed-inventory-{}", crate::engine::random()?));
        let source = root.join("source");
        fs::create_dir_all(&source)?;
        fs::write(source.join("approved"), b"signed bytes")?;
        fs::write(source.join(MANIFEST), b"snapshot envelope")?;
        let manifest: Manifest = serde_json::from_value(serde_json::json!({
            "schema":1,"game":"bricks-war","component":"client","channel":"stable","platform":"win32","arch":"x86_64","version":"1.0.0","sequence":1,"root_abi":1,"entry":"approved","args":[],"files":[{"path":"approved","size":12,"sha256":"0".repeat(64),"executable":true}]
        }))?;
        let snapshot = Tree {
            manifest,
            digest: "a".repeat(64),
            path: source.clone(),
        };
        // Simulate additions after a trusted snapshot was verified/frozen. The
        // elevated seed copier must use this inventory, never re-enumerate source.
        fs::write(root.join("private"), b"never publish")?;
        fs::write(source.join("unsigned-extra"), b"never copy")?;
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("private"), source.join("late-link"))?;
        let output = root.join("output");
        copy(&snapshot, &output)?;
        let mut names = fs::read_dir(&output)?
            .map(|e| e.map(|e| e.file_name()))
            .collect::<std::io::Result<Vec<_>>>()?;
        names.sort();
        assert_eq!(
            names,
            vec![
                std::ffi::OsString::from("approved"),
                std::ffi::OsString::from(MANIFEST)
            ]
        );
        assert_eq!(fs::read(root.join("private"))?, b"never publish");
        fs::remove_dir_all(root)?;
        Ok(())
    }
}
