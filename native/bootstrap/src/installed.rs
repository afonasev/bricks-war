//! Constrained two-party transaction. No game launch occurs in this backend.
use crate::{
    engine::{self, Identity, Lane},
    platform, tree,
};
use anyhow::{Context, Result, ensure};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs::File,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub component: String,
    pub path: PathBuf,
    pub digest: String,
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub component: String,
    pub identity: Identity,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Prepared {
    pub nonce: String,
    pub targets: Vec<Target>,
    pub launcher: Identity,
    pub client: Identity,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Proof {
    pub component: String,
    pub nonce: String,
    pub digest: String,
    pub pid: u32,
}
#[cfg(any(windows, test))]
#[derive(Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields, tag = "operation", rename_all = "kebab-case")]
pub enum Request {
    Prepare { nonce: String, sources: Vec<Source> },
    Healthy { nonce: String, proofs: Vec<Proof> },
    Abort { nonce: String },
}
#[cfg(windows)]
#[derive(Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields, tag = "status", rename_all = "kebab-case")]
pub enum Response {
    Prepared { plan: Prepared },
    Committed { nonce: String },
    Aborted { nonce: String },
    Error { message: String },
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    schema: u32,
    phase: String,
    plan: Prepared,
}

pub struct Broker {
    root: PathBuf,
    lanes: Vec<(String, Lane)>,
    _lock: File,
    pub plan: Option<Prepared>,
}
impl Broker {
    pub fn open(root: &Path) -> Result<Self> {
        platform::ancestors(root)?;
        let root = root.canonicalize()?;
        let path = root.join("broker.lock");
        platform::ancestors(&path)?;
        let lock = platform::lock_file(&path)?;
        lock.try_lock_exclusive()
            .context("Another protected transaction is active")?;
        let mut value = Self {
            root,
            lanes: Vec::new(),
            _lock: lock,
            plan: None,
        };
        value.recover()?;
        Ok(value)
    }
    fn journal(&self, phase: &str, plan: &Prepared) -> Result<()> {
        engine::write_atomic(
            &self.root.join("activation.json"),
            &Journal {
                schema: 1,
                phase: phase.to_owned(),
                plan: plan.clone(),
            },
        )
    }
    fn recover(&mut self) -> Result<()> {
        let path = self.root.join("activation.json");
        if !path.exists() {
            return Ok(());
        }
        let journal: Journal = serde_json::from_slice(&tree::bounded(&path, 65536)?)?;
        ensure!(
            journal.schema == 1
                && matches!(
                    journal.phase.as_str(),
                    "pending" | "committing" | "committed" | "aborted"
                ),
            "Invalid protected journal"
        );
        validate_plan(&journal.plan)?;
        if matches!(journal.phase.as_str(), "committed" | "aborted") {
            return Ok(());
        }
        for target in &journal.plan.targets {
            let mut lane = Lane::open(&self.root, &target.component)?;
            if journal.phase == "committing" {
                if lane.state.active.as_ref() != Some(&target.identity) {
                    lane.commit_external(&journal.plan.nonce, &target.identity)?;
                }
            } else {
                lane.abort_external(&journal.plan.nonce, &target.identity)?;
            }
        }
        self.journal(
            if journal.phase == "committing" {
                "committed"
            } else {
                "aborted"
            },
            &journal.plan,
        )
    }
    pub fn prepare(&mut self, nonce: String, sources: Vec<Source>) -> Result<Prepared> {
        ensure!(
            self.plan.is_none() && tree::digest_ok(&nonce),
            "Invalid/repeated transaction"
        );
        validate_sources(&sources)?;
        let mut components = BTreeSet::new();
        for source in &sources {
            ensure!(
                matches!(source.component.as_str(), "client" | "launcher")
                    && components.insert(source.component.clone())
                    && tree::digest_ok(&source.digest)
                    && source.path.is_absolute(),
                "Invalid/duplicate signed source"
            );
        }
        // Freeze source handles before calling this method on Windows. Independent
        // verification here is authoritative; renderer success flags are never input.
        let mut targets = Vec::new();
        for source in sources {
            let verified = tree::verify(&source.path, &source.component)?;
            ensure!(verified.digest == source.digest, "Frozen target changed");
            let mut lane = Lane::open(&self.root, &source.component)?;
            let identity = lane.stage(&source.path)?;
            targets.push(Target {
                component: source.component.clone(),
                identity,
            });
            self.lanes.push((source.component, lane));
        }
        let selected = |component: &str| -> Result<Identity> {
            if let Some(target) = targets.iter().find(|t| t.component == component) {
                return Ok(target.identity.clone());
            }
            let lane = Lane::open(&self.root, component)?;
            let active = lane
                .state
                .active
                .clone()
                .context("Native baseline component is missing")?;
            lane.tree(&active)?;
            Ok(active)
        };
        let plan = Prepared {
            nonce,
            launcher: selected("launcher")?,
            client: selected("client")?,
            targets,
        };
        validate_plan(&plan)?;
        self.journal("pending", &plan)?;
        self.plan = Some(plan.clone());
        engine::checkpoint("compound-pending");
        for (_, lane) in &mut self.lanes {
            lane.begin_external(&plan.nonce)?;
            engine::checkpoint("compound-first-pending");
        }
        Ok(plan)
    }
    pub fn commit(&mut self, nonce: &str, proofs: &[Proof]) -> Result<()> {
        let plan = self.plan.as_ref().context("No prepared transaction")?;
        validate_proofs(plan, nonce, proofs)?;
        // OS peer/process/token/image verification runs before this durable decision.
        // Once recorded, restart finishes all compatible ABI-1 references rather than
        // rolling back a partly written multi-component commit.
        self.journal("committing", plan)?;
        for (component, lane) in &mut self.lanes {
            let target = plan
                .targets
                .iter()
                .find(|t| &t.component == component)
                .unwrap();
            lane.commit_external(nonce, &target.identity)?;
        }
        self.journal("committed", plan)
    }
    pub fn abort(&mut self, nonce: &str) -> Result<()> {
        let plan = self.plan.as_ref().context("No transaction")?;
        ensure!(plan.nonce == nonce, "Foreign abort");
        let path = self.root.join("activation.json");
        let journal: Journal = serde_json::from_slice(&tree::bounded(&path, 65536)?)?;
        ensure!(
            journal.phase == "pending",
            "Committed decision cannot be aborted"
        );
        for (component, lane) in &mut self.lanes {
            let target = plan
                .targets
                .iter()
                .find(|target| &target.component == component)
                .unwrap();
            lane.abort_external(nonce, &target.identity)?;
        }
        self.journal("aborted", plan)
    }
    #[cfg(windows)]
    pub fn executable(&self, component: &str, identity: &Identity) -> Result<PathBuf> {
        let path = self
            .root
            .join(component)
            .join("slots")
            .join(&identity.digest);
        let verified = tree::verify(&path, component)?;
        ensure!(
            Identity::from(&verified) == *identity,
            "Protected process identity changed"
        );
        Ok(path.join(tree::relative(&verified.manifest.entry)?))
    }
}
pub fn child_nonce(parent: &str) -> String {
    use sha2::{Digest, Sha256};
    tree::hex(&Sha256::digest(format!("{parent}:client").as_bytes()))
}
pub fn validate_plan(plan: &Prepared) -> Result<()> {
    ensure!(
        tree::digest_ok(&plan.nonce) && !plan.targets.is_empty() && plan.targets.len() <= 2,
        "Invalid protected plan"
    );
    let mut components = BTreeSet::new();
    for target in &plan.targets {
        ensure!(
            components.insert(&target.component)
                && matches!(target.component.as_str(), "client" | "launcher")
                && tree::digest_ok(&target.identity.digest)
                && target.identity.sequence > 0,
            "Invalid protected target"
        );
    }
    ensure!(
        tree::digest_ok(&plan.launcher.digest) && tree::digest_ok(&plan.client.digest),
        "Invalid launch pair"
    );
    for target in &plan.targets {
        ensure!(
            target.identity
                == if target.component == "client" {
                    plan.client.clone()
                } else {
                    plan.launcher.clone()
                },
            "Inconsistent launch pair"
        );
    }
    Ok(())
}
pub fn validate_proofs(plan: &Prepared, nonce: &str, proofs: &[Proof]) -> Result<()> {
    ensure!(
        nonce == plan.nonce && proofs.len() == 2,
        "Foreign/incomplete startup proof"
    );
    for (component, identity, expected_nonce) in [
        ("launcher", &plan.launcher, plan.nonce.clone()),
        ("client", &plan.client, child_nonce(&plan.nonce)),
    ] {
        let matching: Vec<_> = proofs.iter().filter(|p| p.component == component).collect();
        ensure!(matching.len() == 1, "Duplicate/missing component proof");
        let proof = matching[0];
        ensure!(
            proof.pid > 0 && proof.digest == identity.digest && proof.nonce == expected_nonce,
            "Stale/foreign component health"
        );
    }
    ensure!(
        proofs[0].pid != proofs[1].pid,
        "One process cannot prove both components"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn id(c: char) -> Identity {
        Identity {
            digest: c.to_string().repeat(64),
            version: "1.0.0".into(),
            sequence: 1,
        }
    }
    #[test]
    fn compound_health_cannot_mix_transactions_components_or_processes() {
        let nonce = "a".repeat(64);
        let plan = Prepared {
            nonce: nonce.clone(),
            targets: vec![Target {
                component: "client".into(),
                identity: id('c'),
            }],
            launcher: id('b'),
            client: id('c'),
        };
        let mut proofs = vec![
            Proof {
                component: "launcher".into(),
                nonce: nonce.clone(),
                digest: id('b').digest,
                pid: 10,
            },
            Proof {
                component: "client".into(),
                nonce: child_nonce(&nonce),
                digest: id('c').digest,
                pid: 11,
            },
        ];
        assert!(validate_proofs(&plan, &nonce, &proofs).is_ok());
        proofs[1].nonce = nonce.clone();
        assert!(validate_proofs(&plan, &nonce, &proofs).is_err());
        proofs[1].nonce = child_nonce(&nonce);
        proofs[1].pid = 10;
        assert!(validate_proofs(&plan, &nonce, &proofs).is_err());
        assert!(validate_proofs(&plan, &nonce, &proofs[..1]).is_err());
    }
}

pub fn committed_identity(root: &Path, component: &str) -> Result<Option<Identity>> {
    let path = root.join("activation.json");
    if !path.exists() {
        return Ok(None);
    }
    let journal: Journal = serde_json::from_slice(&tree::bounded(&path, 65536)?)?;
    ensure!(journal.schema == 1, "Invalid protected journal");
    validate_plan(&journal.plan)?;
    if !matches!(journal.phase.as_str(), "committing" | "committed") {
        return Ok(None);
    }
    Ok(Some(if component == "client" {
        journal.plan.client
    } else {
        journal.plan.launcher
    }))
}

pub fn validate_sources(sources: &[Source]) -> Result<()> {
    ensure!(
        !sources.is_empty() && sources.len() <= 2,
        "Invalid component count"
    );
    let mut names = BTreeSet::new();
    for source in sources {
        ensure!(
            matches!(source.component.as_str(), "client" | "launcher")
                && names.insert(&source.component)
                && source.path.is_absolute()
                && tree::digest_ok(&source.digest),
            "Invalid signed source"
        );
    }
    Ok(())
}

pub fn transaction_status(root: &Path) -> Result<(String, Option<String>, Vec<String>)> {
    let path = root.join("activation.json");
    if !path.exists() {
        return Ok(("initial".into(), None, Vec::new()));
    }
    let journal: Journal = serde_json::from_slice(&tree::bounded(&path, 65536)?)?;
    ensure!(
        journal.schema == 1
            && matches!(
                journal.phase.as_str(),
                "pending" | "committing" | "committed" | "aborted"
            ),
        "Invalid protected transaction phase"
    );
    validate_plan(&journal.plan)?;
    let failed = if matches!(journal.phase.as_str(), "pending" | "aborted") {
        journal
            .plan
            .targets
            .iter()
            .map(|t| t.identity.digest.clone())
            .collect()
    } else {
        Vec::new()
    };
    Ok((journal.phase, Some(journal.plan.nonce), failed))
}
