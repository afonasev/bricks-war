use crate::platform::ManagedChild as Child;
use crate::{
    platform,
    tree::{self, Tree},
};
use anyhow::{Context, Result, bail, ensure};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use sysinfo::{Pid, ProcessStatus, ProcessesToUpdate, System};

pub const HEALTH_HORIZON: Duration = Duration::from_secs(90);
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Identity {
    pub digest: String,
    pub sequence: u64,
    pub version: String,
}
impl From<&Tree> for Identity {
    fn from(t: &Tree) -> Self {
        Self {
            digest: t.digest.clone(),
            sequence: t.manifest.sequence,
            version: t.manifest.version.clone(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Process {
    pub pid: u32,
    pub start: u64,
    pub boot: u64,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Pending {
    pub target: Identity,
    pub nonce: String,
    pub process: Option<Process>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Running {
    pub target: Identity,
    pub process: Option<Process>,
}
#[derive(Default, Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct State {
    pub schema: u32,
    pub active: Option<Identity>,
    pub previous: Option<Identity>,
    pub prepared: Option<Identity>,
    pub pending: Option<Pending>,
    pub failed: BTreeSet<String>,
    pub high_sequence: u64,
    #[serde(default)]
    pub running: Option<Running>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Health {
    pub nonce: String,
    pub digest: String,
    pub pid: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<crate::installed::Proof>,
}
#[derive(Clone)]
pub struct ParentHealth {
    pub receipt: PathBuf,
    pub nonce: String,
    pub digest: String,
}
impl ParentHealth {
    pub fn from_env() -> Result<Option<Self>> {
        let read = |name| std::env::var(name).ok();
        let (path, nonce, digest) = (
            read("BRICKS_BOOTSTRAP_RECEIPT"),
            read("BRICKS_BOOTSTRAP_NONCE"),
            read("BRICKS_BOOTSTRAP_DIGEST"),
        );
        match (path, nonce, digest) {
            (None, None, None) => Ok(None),
            (Some(path), Some(nonce), Some(digest)) => {
                ensure!(
                    tree::digest_ok(&nonce) && tree::digest_ok(&digest),
                    "Invalid parent health contract"
                );
                Ok(Some(Self {
                    receipt: PathBuf::from(path),
                    nonce,
                    digest,
                }))
            }
            _ => bail!("Incomplete parent health contract"),
        }
    }
    pub fn notify(&self) -> Result<()> {
        let health = Health {
            nonce: self.nonce.clone(),
            digest: self.digest.clone(),
            pid: std::process::id(),
            children: Vec::new(),
        };
        write_atomic(&self.receipt, &health)
    }
    pub fn notify_child(&self, child: &Health) -> Result<()> {
        let proof = crate::installed::Proof {
            component: "client".into(),
            nonce: child.nonce.clone(),
            digest: child.digest.clone(),
            pid: child.pid,
        };
        write_atomic(
            &self.receipt,
            &Health {
                nonce: self.nonce.clone(),
                digest: self.digest.clone(),
                pid: std::process::id(),
                children: vec![proof],
            },
        )
    }
}

pub(crate) fn random() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| anyhow::anyhow!("Randomness unavailable: {e}"))?;
    Ok(tree::hex(&bytes))
}
pub fn write_atomic(path: &Path, value: &impl Serialize) -> Result<()> {
    platform::ancestors(path)?;
    let temp = path.with_extension(format!("tmp-{}", random()?));
    let result = (|| {
        let mut f = platform::exclusive_file(&temp)?;
        f.write_all(&serde_json::to_vec(value)?)?;
        f.sync_all()?;
        platform::replace(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
pub(crate) fn checkpoint(name: &str) {
    #[cfg(feature = "fixture")]
    if std::env::var("BRICKS_BOOTSTRAP_FAULT").as_deref() == Ok(name) {
        std::process::exit(86);
    }
    let _ = name;
}
fn process_identity(pid: u32) -> Result<Process> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
    let process = system
        .process(Pid::from_u32(pid))
        .context("Child exited before identity capture")?;
    ensure!(
        process.status() != ProcessStatus::Zombie,
        "Child already exited"
    );
    Ok(Process {
        pid,
        start: process.start_time(),
        boot: System::boot_time(),
    })
}
fn alive(process: &Process) -> bool {
    process_identity(process.pid)
        .is_ok_and(|current| current.boot == process.boot && current.start == process.start)
}

enum Attempt {
    Healthy(i32),
    StartupFailed(anyhow::Error),
}

pub struct Lane {
    root: PathBuf,
    path: PathBuf,
    state_path: PathBuf,
    installed: bool,
    component: String,
    pub state: State,
    _lock: File,
}
impl Lane {
    pub fn open(root: &Path, component: &str) -> Result<Self> {
        ensure!(
            root.is_absolute() && matches!(component, "launcher" | "client"),
            "Invalid root/component"
        );
        platform::ancestors(root)?;
        fs::create_dir_all(root)?;
        platform::sync_dir(root.parent().context("Invalid root")?)?;
        let root = root.canonicalize()?;
        let path = root.join(component);
        platform::ancestors(&path)?;
        fs::create_dir_all(path.join("slots"))?;
        platform::sync_dir(&root)?;
        let lock_path = path.join("lock");
        platform::ancestors(&lock_path)?;
        let lock = platform::lock_file(&lock_path)?;
        lock.try_lock_exclusive()
            .context("Component is already in use")?;
        let state_path = path.join("state.json");
        let state = if state_path.exists() {
            serde_json::from_slice::<State>(&tree::bounded(&state_path, 1024 * 1024)?)?
        } else {
            State {
                schema: 1,
                ..Default::default()
            }
        };
        ensure!(state.schema == 1, "Invalid state schema");
        for identity in [&state.active, &state.previous, &state.prepared]
            .into_iter()
            .flatten()
            .chain(state.pending.iter().map(|p| &p.target))
            .chain(state.running.iter().map(|p| &p.target))
        {
            ensure!(
                tree::digest_ok(&identity.digest) && identity.sequence > 0,
                "Invalid journal identity"
            );
        }
        Ok(Self {
            root: root.to_path_buf(),
            state_path,
            installed: false,
            path,
            component: component.to_owned(),
            state,
            _lock: lock,
        })
    }
    pub fn open_installed(root: &Path, component: &str) -> Result<Self> {
        platform::ensure_user_launch()?;
        ensure!(
            root.is_absolute() && matches!(component, "launcher" | "client"),
            "Invalid installed root/component"
        );
        platform::ancestors(root)?;
        let root = root.canonicalize()?;
        let path = root.join(component);
        platform::ancestors(&path)?;
        let mut machine: State =
            serde_json::from_slice(&tree::bounded(&path.join("state.json"), 1024 * 1024)?)?;
        validate_state(&machine)?;
        if let Some(committed) = crate::installed::committed_identity(&root, component)? {
            if machine.active.as_ref() != Some(&committed) {
                machine.previous = machine.active.clone();
                machine.active = Some(committed.clone());
                machine.high_sequence = machine.high_sequence.max(committed.sequence);
            }
        }
        let user = health_root()?
            .join("running")
            .join({
                use sha2::{Digest, Sha256};
                tree::hex(&Sha256::digest(root.to_string_lossy().as_bytes()))
            })
            .join(component);
        platform::ancestors(&user)?;
        fs::create_dir_all(&user)?;
        let lock_path = user.join("lock");
        platform::ancestors(&lock_path)?;
        let lock = platform::lock_file(&lock_path)?;
        lock.try_lock_exclusive()
            .context("This user's component is already running")?;
        let state_path = user.join("state.json");
        let local = if state_path.exists() {
            let state: State = serde_json::from_slice(&tree::bounded(&state_path, 1024 * 1024)?)?;
            validate_state(&state)?;
            Some(state)
        } else {
            None
        };
        let mut state = State {
            schema: 1,
            active: machine.active.clone(),
            previous: machine.previous.clone(),
            high_sequence: machine.high_sequence,
            ..Default::default()
        };
        if let Some(local) = local {
            // A running record belongs to the previous original-user process,
            // even when another user has advanced the machine active identity.
            state.running = local.running;
            state.failed = local.failed;
        }
        if state
            .active
            .as_ref()
            .is_some_and(|id| state.failed.contains(&id.digest))
        {
            if let Some(previous) = state.previous.clone() {
                state.active = Some(previous);
                state.previous = None;
            }
        }
        Ok(Self {
            root,
            path,
            state_path,
            installed: true,
            component: component.to_owned(),
            state,
            _lock: lock,
        })
    }
    pub(crate) fn begin_external(&mut self, nonce: &str) -> Result<Identity> {
        ensure!(
            !self.installed && tree::digest_ok(nonce),
            "Invalid protected activation"
        );
        let target = self
            .state
            .prepared
            .clone()
            .context("No prepared machine target")?;
        self.tree(&target)?;
        ensure!(
            !self.state.failed.contains(&target.digest)
                && target.sequence > self.state.high_sequence,
            "Failed/non-monotonic target"
        );
        self.state.pending = Some(Pending {
            target: target.clone(),
            nonce: nonce.to_owned(),
            process: None,
        });
        self.save()?;
        Ok(target)
    }
    pub(crate) fn abort_external(&mut self, nonce: &str, target: &Identity) -> Result<()> {
        ensure!(
            !self.installed,
            "User state cannot abort machine references"
        );
        ensure!(
            self.state.active.as_ref() != Some(target),
            "Active decision cannot be aborted"
        );
        if let Some(pending) = &self.state.pending {
            ensure!(
                pending.nonce == nonce && pending.target == *target,
                "Foreign pending transaction"
            );
        }
        ensure!(
            self.state.prepared.as_ref().is_none_or(|id| id == target),
            "Foreign prepared target"
        );
        // A durable compound journal can precede every per-lane pending write.
        // Record all cancelled targets even when that lane had no pending yet.
        self.ensure_stopped(
            target,
            self.state.pending.as_ref().and_then(|p| p.process.as_ref()),
        )?;
        if let Some(active) = &self.state.active {
            self.tree(active)?;
        }
        self.state.failed.insert(target.digest.clone());
        self.state.pending = None;
        self.state.prepared = None;
        self.save()
    }
    pub(crate) fn commit_external(&mut self, nonce: &str, target: &Identity) -> Result<()> {
        ensure!(
            !self.installed,
            "User state cannot commit machine references"
        );
        let pending = self
            .state
            .pending
            .as_ref()
            .context("No machine transaction")?;
        ensure!(
            pending.nonce == nonce && pending.target == *target,
            "Machine transaction mismatch"
        );
        self.tree(target)?;
        self.state.previous = self.state.active.clone();
        self.state.active = Some(target.clone());
        self.state.high_sequence = target.sequence;
        self.state.pending = None;
        self.state.prepared = None;
        self.save()
    }
    pub(crate) fn external_launch<F>(
        &mut self,
        target: &Identity,
        nonce: &str,
        args: &[String],
        mut commit: F,
    ) -> Result<i32>
    where
        F: FnMut(u32, &Health) -> Result<()>,
    {
        platform::ensure_user_launch()?;
        ensure!(
            self.installed && tree::digest_ok(nonce),
            "External activation requires original-user installed lane"
        );
        self.recover()?;
        let tree = self.tree(target)?;
        let receipt = self.receipt(nonce)?;
        self.state.running = Some(Running {
            target: target.clone(),
            process: None,
        });
        self.save()?;
        let mut child = self.spawn(&tree, nonce, &receipt, args)?;
        self.state.running.as_mut().unwrap().process = process_identity(child.id()).ok();
        let result = (|| {
            self.save()?;
            let health = self.health(&mut child, &tree, nonce, &receipt)?;
            commit(child.id(), &health)
        })();
        if let Err(error) = result {
            Self::stop(&mut child)?;
            self.state.running = None;
            self.save()?;
            let _ = fs::remove_file(&receipt);
            return Err(error);
        }
        // Machine commit has happened. User observation cleanup cannot roll it back.
        self.state.previous = self.state.active.clone();
        self.state.active = Some(target.clone());
        if let Err(error) = self.save() {
            eprintln!("Committed candidate; local journal cleanup deferred: {error}");
        }
        let _ = fs::remove_file(&receipt);
        let code = child.wait()?.code().unwrap_or(1);
        self.state.running = None;
        if let Err(error) = self.save() {
            eprintln!("Committed candidate; local process cleanup deferred: {error}");
        }
        Ok(code)
    }
    fn save(&self) -> Result<()> {
        write_atomic(&self.state_path, &self.state)
    }
    pub(crate) fn tree(&self, identity: &Identity) -> Result<Tree> {
        ensure!(tree::digest_ok(&identity.digest), "Invalid identity digest");
        let tree = tree::verify(
            &self.path.join("slots").join(&identity.digest),
            &self.component,
        )?;
        ensure!(
            Identity::from(&tree) == *identity,
            "Journal/tree identity mismatch"
        );
        Ok(tree)
    }
    fn ensure_stopped(&self, target: &Identity, process: Option<&Process>) -> Result<()> {
        if let Some(process) = process {
            ensure!(
                !alive(process),
                "Interrupted payload still running; retain journal and working slots"
            );
        }
        // Covers the spawn → PID-journal gap and helper subprocesses within a
        // signed application tree. Never kill a PID inferred from a stale file.
        let path = self.path.join("slots").join(&target.digest);
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::All, true);
        ensure!(
            !system
                .processes()
                .values()
                .any(|p| p.status() != ProcessStatus::Zombie
                    && p.exe().is_some_and(|exe| exe.starts_with(&path))),
            "Payload tree still has live processes; recovery deferred"
        );
        Ok(())
    }
    pub fn recover(&mut self) -> Result<()> {
        if let Some(running) = &self.state.running {
            self.ensure_stopped(&running.target, running.process.as_ref())?;
            self.state.running = None;
            self.save()?;
        }
        if let Some(pending) = &self.state.pending {
            self.ensure_stopped(&pending.target, pending.process.as_ref())?;
            // No guess from a version-only/stale receipt: an uncommitted restart
            // always returns to the last known-good reference.
            if let Some(active) = &self.state.active {
                self.tree(active)?;
            }
            self.state.failed.insert(pending.target.digest.clone());
            self.state.pending = None;
            self.state.prepared = None;
            self.save()?;
        }
        Ok(())
    }
    pub fn stage(&mut self, source: &Path) -> Result<Identity> {
        ensure!(
            !self.installed,
            "Installed normal launch cannot prepare machine slots"
        );
        self.recover()?;
        let tree = tree::verify(source, &self.component)?;
        let identity = Identity::from(&tree);
        ensure!(
            !self.state.failed.contains(&identity.digest),
            "Failed digest requires a newly signed target"
        );
        ensure!(
            identity.sequence > self.state.high_sequence,
            "Non-monotonic target sequence"
        );
        let destination = self.path.join("slots").join(&identity.digest);
        if destination.exists() {
            self.tree(&identity)?;
        } else {
            let stage = self
                .path
                .join("slots")
                .join(format!("staging-{}", random()?));
            let result = (|| {
                tree::copy(&tree, &stage)?;
                let copied = tree::verify(&stage, &self.component)?;
                ensure!(copied.digest == tree.digest, "Changed staged manifest");
                platform::replace(&stage, &destination)
            })();
            if result.is_err() && stage.exists() {
                let _ = fs::remove_dir_all(&stage);
            }
            result?;
        }
        checkpoint("staged");
        self.state.prepared = Some(identity.clone());
        self.save()?;
        checkpoint("prepared");
        Ok(identity)
    }
    pub(crate) fn receipt(&self, nonce: &str) -> Result<PathBuf> {
        let base = health_root()?;
        Ok(base.join(format!("{}-{nonce}.json", self.component)))
    }
    pub(crate) fn spawn(
        &self,
        tree: &Tree,
        nonce: &str,
        receipt: &Path,
        args: &[String],
    ) -> Result<Child> {
        platform::ensure_user_launch()?;
        let mut command = Command::new(tree.path.join(tree::relative(&tree.manifest.entry)?));
        command
            .args(&tree.manifest.args)
            .args(args)
            .current_dir(&tree.path)
            .stdin(Stdio::null())
            .env_remove("ELECTRON_RUN_AS_NODE")
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .env("BRICKS_BOOTSTRAP_ROOT", &self.root)
            .env("BRICKS_BOOTSTRAP_NONCE", nonce)
            .env("BRICKS_BOOTSTRAP_DIGEST", &tree.digest)
            .env("BRICKS_BOOTSTRAP_RECEIPT", receipt);
        if self.installed {
            command.env("BRICKS_BOOTSTRAP_INSTALLED", "1");
            command.env("BRICKS_BOOTSTRAP_HEALTH_ROOT", health_root()?);
            if std::env::var_os("BRICKS_BOOTSTRAP_CANDIDATE_CLIENT").is_some()
                || args.iter().any(|arg| arg == "--updated")
            {
                command.env("BRICKS_BOOTSTRAP_SKIP_DISCOVERY", "1");
            }
            let profile = if let Some(profile) = std::env::var_os("BRICKS_BOOTSTRAP_PROFILE") {
                PathBuf::from(profile)
            } else {
                original_profile()?
            };
            ensure!(profile.is_absolute(), "Invalid original-user profile");
            command.env("BRICKS_BOOTSTRAP_PROFILE", profile);
            #[cfg(windows)]
            let stable_executable = crate::windows::registered_root()?
                .join("bricks-bootstrap.exe")
                .into_os_string();
            #[cfg(not(windows))]
            let stable_executable = std::env::var_os("BRICKS_BOOTSTRAP_EXECUTABLE")
                .unwrap_or(std::env::current_exe()?.into_os_string());
            command.env("BRICKS_BOOTSTRAP_EXECUTABLE", stable_executable);
            let key = if self.component == "launcher" {
                "BRICKS_BOOTSTRAP_LAUNCHER_ID"
            } else {
                "BRICKS_BOOTSTRAP_CLIENT_ID"
            };
            command.env(key, serde_json::to_string(&Identity::from(tree))?);
            if self.component == "launcher" {
                command.env("BRICKS_BOOTSTRAP_ROOT_PID", std::process::id().to_string());
            }
        }
        // No inherited parent contract is passed as an argument. Each immediate
        // child receives its own environment contract and must prove its PID.
        platform::spawn(&mut command)
    }
    pub(crate) fn health(
        &self,
        child: &mut Child,
        tree: &Tree,
        nonce: &str,
        receipt: &Path,
    ) -> Result<Health> {
        self.wait_health(child, tree, nonce, receipt, Some(HEALTH_HORIZON))?
            .context("Candidate closed before startup health")
    }
    fn wait_health(
        &self,
        child: &mut Child,
        tree: &Tree,
        nonce: &str,
        receipt: &Path,
        horizon: Option<Duration>,
    ) -> Result<Option<Health>> {
        let start = Instant::now();
        loop {
            if receipt.exists() {
                let bytes = tree::bounded(receipt, 4096)?;
                let health: Health = serde_json::from_slice(&bytes)?;
                ensure!(
                    health.nonce == nonce
                        && health.digest == tree.digest
                        && health.pid == child.id(),
                    "Stale/foreign startup health"
                );
                ensure!(
                    child.try_wait()?.is_none(),
                    "Payload exited before health commit"
                );
                return Ok(Some(health));
            }
            if let Some(status) = child.try_wait()? {
                if horizon.is_none() && status.success() {
                    return Ok(None);
                }
                bail!("Payload exited before health: {status}");
            }
            ensure!(
                horizon.is_none_or(|limit| start.elapsed() < limit),
                "Startup health timeout (90 seconds)"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    pub(crate) fn stop(child: &mut Child) -> Result<()> {
        if child.try_wait()?.is_none() {
            child.kill()?;
        }
        child.wait()?;
        Ok(())
    }
    fn start_working(&mut self, args: &[String], parent: Option<&ParentHealth>) -> Result<i32> {
        loop {
            let active = self
                .state
                .active
                .clone()
                .context("No verified working payload")?;
            let result = self.working_attempt(&active, args, parent)?;
            match result {
                Attempt::Healthy(code) => return Ok(code),
                Attempt::StartupFailed(error) => {
                    self.state.failed.insert(active.digest.clone());
                    self.state.running = None;
                    if let Some(previous) = self.state.previous.clone() {
                        if self.state.failed.contains(&previous.digest) {
                            self.save()?;
                            return Err(error);
                        }
                        self.tree(&previous)?;
                        self.state.active = Some(previous);
                        self.state.previous = None;
                        self.save()?;
                    } else {
                        self.save()?;
                        return Err(error);
                    }
                }
            }
        }
    }
    fn working_attempt(
        &mut self,
        active: &Identity,
        args: &[String],
        parent: Option<&ParentHealth>,
    ) -> Result<Attempt> {
        let tree = match self.tree(active) {
            Ok(t) => t,
            Err(error) => return Ok(Attempt::StartupFailed(error)),
        };
        let nonce = random()?;
        let receipt = self.receipt(&nonce)?;
        self.state.running = Some(Running {
            target: active.clone(),
            process: None,
        });
        self.save()?;
        let mut child = match self.spawn(&tree, &nonce, &receipt, args) {
            Ok(child) => child,
            Err(error) => return Ok(Attempt::StartupFailed(error)),
        };
        self.state.running.as_mut().unwrap().process = process_identity(child.id()).ok();
        if let Err(error) = self.save() {
            Self::stop(&mut child)?;
            return Err(error);
        }
        // A known-good installed client may legitimately wait for a player at
        // the pre-game consent window. Only pending activation has the fixed
        // 90s horizon; ordinary Quit before game health must remain Quit.
        let health = if self.installed {
            self.wait_health(&mut child, &tree, &nonce, &receipt, None)
        } else {
            self.health(&mut child, &tree, &nonce, &receipt).map(Some)
        };
        if let Err(error) = health {
            Self::stop(&mut child)?;
            let _ = fs::remove_file(&receipt);
            return Ok(Attempt::StartupFailed(error));
        }
        let health = match health? {
            Some(health) => health,
            None => {
                self.state.running = None;
                self.save()?;
                return Ok(Attempt::Healthy(0));
            }
        };
        let _ = fs::remove_file(&receipt);
        if let Some(parent) = parent {
            if let Err(error) = if self.component == "client" {
                parent.notify_child(&health)
            } else {
                parent.notify()
            } {
                Self::stop(&mut child)?;
                return Err(error);
            }
        }
        let code = child.wait()?.code().unwrap_or(1);
        self.state.running = None;
        self.save()?;
        Ok(Attempt::Healthy(code))
    }
    pub fn run(&mut self, args: &[String], parent: Option<&ParentHealth>) -> Result<i32> {
        platform::ensure_user_launch()?;
        self.recover()?;
        self.start_working(args, parent)
    }
    pub fn activate(&mut self, args: &[String], parent: Option<&ParentHealth>) -> Result<i32> {
        ensure!(
            !self.installed,
            "Installed activation requires the protected broker"
        );
        platform::ensure_user_launch()?;
        self.recover()?;
        let target = self.state.prepared.clone().context("No prepared target")?;
        ensure!(
            !self.state.failed.contains(&target.digest)
                && target.sequence > self.state.high_sequence,
            "Failed/non-monotonic target"
        );
        let tree = self.tree(&target)?;
        let nonce = random()?;
        let receipt = self.receipt(&nonce)?;
        self.state.pending = Some(Pending {
            target: target.clone(),
            nonce: nonce.clone(),
            process: None,
        });
        self.save()?;
        checkpoint("pending");
        let mut child = match self.spawn(&tree, &nonce, &receipt, args) {
            Ok(c) => c,
            Err(error) => {
                self.rollback()?;
                if self.state.active.is_some() {
                    self.start_working(args, parent)?;
                }
                return Err(error);
            }
        };
        let identity = process_identity(child.id());
        if let Ok(identity) = identity {
            self.state.pending.as_mut().unwrap().process = Some(identity);
        }
        // Even an early-exiting child is reaped by health below. A failed save
        // must never leave an unowned candidate running in this process.
        if let Err(error) = self.save() {
            Self::stop(&mut child)?;
            return Err(error);
        }
        checkpoint("spawned");
        let health = self.health(&mut child, &tree, &nonce, &receipt);
        if let Err(error) = health {
            Self::stop(&mut child)?;
            self.rollback()?;
            let _ = fs::remove_file(&receipt);
            if self.state.active.is_some() {
                self.start_working(args, parent)?;
            }
            return Err(error);
        }
        checkpoint("healthy");
        let old = self.state.active.clone();
        self.state.previous = old;
        self.state.active = Some(target.clone());
        self.state.high_sequence = target.sequence;
        let process = self.state.pending.as_ref().and_then(|p| p.process.clone());
        self.state.running = Some(Running { target, process });
        self.state.pending = None;
        self.state.prepared = None;
        if let Err(error) = self.save() {
            Self::stop(&mut child)?;
            return Err(error);
        }
        checkpoint("committed");
        let _ = fs::remove_file(&receipt);
        // Cleanup errors are post-commit and cannot initiate rollback.
        if let Some(parent) = parent {
            if let Err(error) = parent.notify() {
                Self::stop(&mut child)?;
                return Err(error);
            }
        }
        let code = child.wait()?.code().unwrap_or(1);
        self.state.running = None;
        self.save()?;
        Ok(code)
    }
    pub(crate) fn rollback(&mut self) -> Result<()> {
        if let Some(pending) = &self.state.pending {
            self.ensure_stopped(&pending.target, pending.process.as_ref())?;
        }
        if let Some(pending) = self.state.pending.take() {
            self.state.failed.insert(pending.target.digest);
        }
        self.state.prepared = None;
        self.save()
    }
}

pub(crate) fn health_root() -> Result<PathBuf> {
    let base = if let Some(path) = std::env::var_os("BRICKS_BOOTSTRAP_HEALTH_ROOT") {
        PathBuf::from(path)
    } else {
        #[cfg(windows)]
        let path = PathBuf::from(
            std::env::var_os("LOCALAPPDATA").context("Missing original-user LOCALAPPDATA")?,
        )
        .join("Bricks War/bootstrap-health");
        #[cfg(not(windows))]
        let path = PathBuf::from(std::env::var_os("HOME").context("Missing original-user HOME")?)
            .join("Library/Application Support/Bricks War/bootstrap-health");
        path
    };
    ensure!(base.is_absolute(), "Health root must be absolute");
    platform::ancestors(&base)?;
    fs::create_dir_all(&base)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&base, fs::Permissions::from_mode(0o700))?;
    }
    Ok(base)
}
fn validate_state(state: &State) -> Result<()> {
    ensure!(state.schema == 1, "Invalid state schema");
    for id in [&state.active, &state.previous, &state.prepared]
        .into_iter()
        .flatten()
        .chain(state.pending.iter().map(|p| &p.target))
        .chain(state.running.iter().map(|p| &p.target))
    {
        ensure!(
            tree::digest_ok(&id.digest) && id.sequence > 0,
            "Invalid journal identity"
        );
    }
    Ok(())
}

pub(crate) fn original_profile() -> Result<PathBuf> {
    if let Some(profile) = std::env::var_os("BRICKS_BOOTSTRAP_PROFILE") {
        let path = PathBuf::from(profile);
        ensure!(path.is_absolute(), "Invalid original-user profile");
        return Ok(path);
    }
    let saved = health_root()?.join("profile.json");
    if saved.exists() {
        let profile: PathBuf = serde_json::from_slice(&tree::bounded(&saved, 65536)?)?;
        ensure!(profile.is_absolute(), "Invalid remembered profile");
        return Ok(profile);
    }
    #[cfg(windows)]
    let path = PathBuf::from(std::env::var_os("APPDATA").context("Missing original-user APPDATA")?)
        .join("Bricks War");
    #[cfg(not(windows))]
    let path = PathBuf::from(std::env::var_os("HOME").context("Missing original-user HOME")?)
        .join("Library/Application Support/Bricks War");
    Ok(path)
}

pub fn check_profile(profile: &Path) -> Result<()> {
    ensure!(profile.is_absolute(), "Original profile must be absolute");
    let saved = health_root()?.join("profile.json");
    if saved.exists() {
        let original: PathBuf = serde_json::from_slice(&tree::bounded(&saved, 65536)?)?;
        ensure!(
            original == profile,
            "Refusing to switch the original-user profile"
        );
    }
    Ok(())
}
pub fn remember_profile(profile: &Path) -> Result<()> {
    let root = health_root()?;
    let lock = platform::lock_file(&root.join("profile.lock"))?;
    lock.try_lock_exclusive()
        .context("Original profile initialization is in progress")?;
    check_profile(profile)?;
    let saved = root.join("profile.json");
    if !saved.exists() {
        write_atomic(&saved, &profile)?;
    }
    Ok(())
}

pub fn installed_status(root: &Path) -> Result<serde_json::Value> {
    let root = root.canonicalize()?;
    let mut components = serde_json::Map::new();
    let mut failed = BTreeSet::new();
    for component in ["launcher", "client"] {
        let state: State = serde_json::from_slice(&tree::bounded(
            &root.join(component).join("state.json"),
            1024 * 1024,
        )?)?;
        validate_state(&state)?;
        failed.extend(state.failed.iter().cloned());
        let local = health_root()?
            .join("running")
            .join({
                use sha2::{Digest, Sha256};
                tree::hex(&Sha256::digest(root.to_string_lossy().as_bytes()))
            })
            .join(component)
            .join("state.json");
        if local.exists() {
            let state: State = serde_json::from_slice(&tree::bounded(&local, 1024 * 1024)?)?;
            validate_state(&state)?;
            failed.extend(state.failed);
        }
        let id = crate::installed::committed_identity(&root, component)?.or(state.active);
        components.insert(component.into(), serde_json::to_value(id)?);
    }
    let (phase, mut nonce, transaction_failed) = crate::installed::transaction_status(&root)?;
    failed.extend(transaction_failed);
    let current_failed = components
        .values()
        .filter_map(|v| v.get("digest").and_then(|v| v.as_str()))
        .any(|id| failed.contains(id));
    if nonce.is_none() && current_failed {
        use sha2::{Digest, Sha256};
        nonce = Some(tree::hex(&Sha256::digest(
            format!("local-recovery:{components:?}").as_bytes(),
        )));
    }
    Ok(
        serde_json::json!({"components":components,"failed":failed,"recoveryRequired":matches!(phase.as_str(),"pending"|"aborted")||current_failed,"phase":phase,"nonce":nonce}),
    )
}

pub struct ExitWaiter {
    processes: Vec<Process>,
}
impl ExitWaiter {
    pub fn capture(pids: &[u32]) -> Result<Self> {
        let mut processes = Vec::new();
        for pid in pids {
            ensure!(
                *pid > 0 && *pid != std::process::id(),
                "Invalid previous process identity"
            );
            if let Ok(identity) = process_identity(*pid) {
                processes.push(identity);
            }
        }
        Ok(Self { processes })
    }
    pub fn wait<F: Fn() -> bool>(&self, cancelled: F) -> Result<bool> {
        let start = Instant::now();
        while self.processes.iter().any(alive) {
            if cancelled() {
                return Ok(false);
            }
            ensure!(
                start.elapsed() < Duration::from_secs(120),
                "Previous application did not exit"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
        Ok(!cancelled())
    }
}

pub fn profile_from_tree(tree: &Tree) -> Result<PathBuf> {
    ensure!(
        tree.manifest.component == "client" && tree.manifest.profile_probe_abi == Some(1),
        "Client does not implement the signed profile-probe contract"
    );
    let mut command = Command::new(tree.path.join(crate::tree::relative(&tree.manifest.entry)?));
    command
        .args(&tree.manifest.args)
        .args(["--native-profile-probe", "-muted"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env_remove("ELECTRON_RUN_AS_NODE")
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH");
    let mut child = platform::spawn(&mut command)?;
    let output = child
        .child
        .stdout
        .take()
        .context("Profile probe stdout missing")?;
    let reader = std::thread::spawn(move || -> std::io::Result<Vec<u8>> {
        use std::io::Read;
        let mut bytes = Vec::new();
        output.take(65537).read_to_end(&mut bytes)?;
        Ok(bytes)
    });
    let start = Instant::now();
    let result = (|| {
        loop {
            if let Some(status) = child.try_wait()? {
                ensure!(status.success(), "Profile probe failed");
                break;
            }
            ensure!(
                start.elapsed() < Duration::from_secs(15),
                "Profile probe timed out"
            );
            std::thread::sleep(Duration::from_millis(25));
        }
        Ok(())
    })();
    if result.is_err() {
        SelfStop::stop(&mut child);
    }
    result?;
    let bytes = reader
        .join()
        .map_err(|_| anyhow::anyhow!("Profile probe reader failed"))??;
    ensure!(bytes.len() <= 65536, "Oversized profile proof");
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct ProfileProof {
        schema: u32,
        profile: PathBuf,
    }
    let proof: ProfileProof = serde_json::from_slice(&bytes)?;
    ensure!(
        proof.schema == 1 && proof.profile.is_absolute(),
        "Invalid profile proof"
    );
    Ok(proof.profile)
}
struct SelfStop;
impl SelfStop {
    fn stop(child: &mut Child) {
        let _ = child.kill();
        let _ = child.wait();
    }
}
