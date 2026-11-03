//! Inventory-bound rollback copy. Windows owns path/ACL pinning at each caller.
use crate::{engine, tree};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Baseline {
    pub schema: u32,
    pub target: PathBuf,
    pub files: Vec<Entry>,
    #[serde(default)]
    pub public_read_attested: bool,
    #[serde(default)]
    pub registration: Vec<Vec<RegistryValue>>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegistryValue {
    pub name: String,
    pub kind: u32,
    pub bytes: Vec<u8>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}
fn hash(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    let mut input = std::fs::File::open(path)?;
    let mut digest = Sha256::new();
    std::io::copy(&mut input, &mut digest)?;
    Ok(tree::hex(&digest.finalize()))
}
pub fn inventory(target: &Path) -> Result<Baseline> {
    let mut files = Vec::new();
    let mut queue = vec![target.to_path_buf()];
    let mut count = 0;
    while let Some(dir) = queue.pop() {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            count += 1;
            ensure!(count <= 60000, "Oversized legacy baseline");
            let metadata = entry.path().symlink_metadata()?;
            ensure!(
                !metadata.file_type().is_symlink(),
                "Legacy baseline link rejected"
            );
            if metadata.is_dir() {
                queue.push(entry.path());
            } else {
                ensure!(metadata.is_file(), "Unsupported legacy baseline entry");
                let name = entry
                    .path()
                    .strip_prefix(target)?
                    .to_string_lossy()
                    .replace('\\', "/");
                tree::relative(&name)?;
                files.push(Entry {
                    path: name,
                    sha256: hash(&entry.path())?,
                    size: metadata.len(),
                });
            }
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    ensure!(!files.is_empty(), "Empty legacy baseline");
    Ok(Baseline {
        schema: 1,
        target: target.to_path_buf(),
        files,
        public_read_attested: false,
        registration: Vec::new(),
    })
}
pub fn require_admission(baseline: &Baseline) -> Result<()> {
    ensure!(
        baseline.public_read_attested,
        "Baseline predates source read-admission audit; protected recovery required"
    );
    Ok(())
}
pub fn verify(source: &Path, baseline: &Baseline) -> Result<()> {
    ensure!(
        baseline.schema == 1 && !baseline.files.is_empty() && baseline.files.len() <= 60000,
        "Invalid baseline"
    );
    let mut names = std::collections::HashSet::new();
    for entry in &baseline.files {
        let relative = tree::relative(&entry.path)?;
        ensure!(
            names.insert(entry.path.to_lowercase()) && tree::digest_ok(&entry.sha256),
            "Aliased/invalid baseline entry"
        );
        let path = source.join(relative);
        let metadata = path.symlink_metadata()?;
        ensure!(
            metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() == entry.size
                && hash(&path)? == entry.sha256,
            "Changed rollback baseline bytes"
        );
    }
    Ok(())
}
pub fn copy(source: &Path, destination: &Path, baseline: &Baseline) -> Result<()> {
    verify(source, baseline)?;
    // Destination is a fresh protected tree, never a caller-writable directory.
    for entry in &baseline.files {
        let relative = tree::relative(&entry.path)?;
        let path = destination.join(&relative);
        std::fs::create_dir_all(path.parent().unwrap())?;
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)?;
        let mut input = std::fs::File::open(source.join(relative))?;
        std::io::copy(&mut input, &mut output)?;
        output.sync_all()?;
    }
    verify(destination, baseline)
}
pub fn save(path: &Path, baseline: &Baseline) -> Result<()> {
    engine::write_atomic(path, baseline)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("bricks-legacy-{}", engine::random().unwrap()));
        std::fs::create_dir(&root).unwrap();
        root
    }
    #[test]
    fn exact_working_baseline_survives_partial_install_and_restore_retry() {
        let root = fixture();
        let app = root.join("app");
        std::fs::create_dir_all(app.join("resources")).unwrap();
        std::fs::write(app.join("Bricks War.exe"), b"working executable").unwrap();
        std::fs::write(app.join("resources/app.asar"), b"working code").unwrap();
        let profile = root.join("profile");
        std::fs::create_dir(&profile).unwrap();
        std::fs::write(profile.join("Local Storage"), b"original saves").unwrap();
        let baseline = inventory(&app).unwrap();
        let backup = root.join("baseline");
        std::fs::create_dir(&backup).unwrap();
        copy(&app, &backup, &baseline).unwrap();
        save(&root.join("complete.json"), &baseline).unwrap();
        std::fs::remove_dir_all(&app).unwrap();
        std::fs::create_dir(&app).unwrap();
        std::fs::write(app.join("native.exe"), b"broken candidate").unwrap();
        // A failed/partial restore must not consume or change the complete baseline.
        let partial = root.join("partial");
        std::fs::create_dir(&partial).unwrap();
        std::fs::write(partial.join("Bricks War.exe"), b"partial").unwrap();
        assert!(copy(&backup, &partial, &baseline).is_err());
        verify(&backup, &baseline).unwrap();
        let retry = root.join("retry");
        std::fs::create_dir(&retry).unwrap();
        copy(&backup, &retry, &baseline).unwrap();
        assert_eq!(
            std::fs::read(retry.join("resources/app.asar")).unwrap(),
            b"working code"
        );
        assert_eq!(
            std::fs::read(profile.join("Local Storage")).unwrap(),
            b"original saves"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn changed_backup_traversal_and_extra_unsigned_file_cannot_enter_restore() {
        let root = fixture();
        let source = root.join("source");
        std::fs::create_dir(&source).unwrap();
        std::fs::write(source.join("app.exe"), b"working").unwrap();
        let mut baseline = inventory(&source).unwrap();
        std::fs::write(source.join("injected.exe"), b"unsigned").unwrap();
        let destination = root.join("copy");
        std::fs::create_dir(&destination).unwrap();
        copy(&source, &destination, &baseline).unwrap();
        assert!(!destination.join("injected.exe").exists());
        std::fs::write(source.join("app.exe"), b"changed").unwrap();
        assert!(verify(&source, &baseline).is_err());
        baseline.files[0].path = "../outside".into();
        assert!(verify(&source, &baseline).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn old_or_unattested_baseline_is_not_admitted_for_privileged_restore() {
        let mut baseline: Baseline = serde_json::from_value(serde_json::json!({
            "schema":1,"target":"/original/game","files":[],"registration":[]
        }))
        .unwrap();
        assert!(require_admission(&baseline).is_err());
        baseline.public_read_attested = true;
        assert!(require_admission(&baseline).is_ok());
        baseline.public_read_attested = false;
        let saved = serde_json::to_vec(&baseline).unwrap();
        assert!(require_admission(&serde_json::from_slice(&saved).unwrap()).is_err());
    }
}
