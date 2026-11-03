//! Stable outer .app with replaceable, signed, private per-user payload trees.
use crate::{
    engine::{self, Identity, Lane, State},
    installed::{self, Broker, Proof, Source},
    platform, tree,
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Seed {
    schema: u32,
    profile_name: String,
    launcher: Identity,
    client: Identity,
}
pub fn root() -> Result<PathBuf> {
    let executable = std::env::current_exe()?;
    let app = executable
        .ancestors()
        .find(|path| path.extension().is_some_and(|extension| extension == "app"))
        .context("Native entrypoint must be inside its signed root .app")?;
    let seed = app.join("Contents/Resources/native-seed");
    let metadata: Seed = serde_json::from_slice(&tree::bounded(&seed.join("seed.json"), 65536)?)?;
    ensure!(
        metadata.schema == 1
            && !metadata.profile_name.is_empty()
            && !metadata.profile_name.contains(['/', '\\', '\0'])
            && metadata.profile_name != "."
            && metadata.profile_name != "..",
        "Invalid native seed identity"
    );
    // Record the historical product profile explicitly; payload bundle identity
    // and the root's executable name must not pick a new Electron userData path.
    let remembered = engine::health_root()?.join("profile.json");
    if !remembered.exists() {
        let profile = if let Some(profile) = std::env::var_os("BRICKS_BOOTSTRAP_PROFILE") {
            PathBuf::from(profile)
        } else {
            let verified = tree::verify(&seed.join("client"), "client")?;
            ensure!(
                Identity::from(&verified) == metadata.client,
                "Changed profile-probe payload"
            );
            engine::profile_from_tree(&verified)?
        };
        engine::remember_profile(&profile)?;
    }
    let profile = engine::original_profile()?;
    engine::remember_profile(&profile)?;
    let root = profile.join("native");
    platform::ancestors(&root)?;
    std::fs::create_dir_all(&root)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))?;
    }
    for (component, id) in [
        ("launcher", &metadata.launcher),
        ("client", &metadata.client),
    ] {
        ensure!(tree::digest_ok(&id.digest), "Invalid seed digest");
        let state_path = root.join(component).join("state.json");
        if state_path.exists() {
            continue;
        }
        let source = seed.join(component);
        let verified = tree::verify(&source, component)?;
        ensure!(Identity::from(&verified) == *id, "Changed signed seed");
        let mut lane = Lane::open(&root, component)?;
        lane.stage(&source)?;
        // Initial signed installation has no previous runtime. This is seeding, not
        // update health acceptance; normal launch still requires actual child health.
        let state = State {
            schema: 1,
            active: Some(id.clone()),
            high_sequence: id.sequence,
            ..Default::default()
        };
        engine::write_atomic(&state_path, &state)?;
    }
    Ok(root)
}
pub fn update(root: &Path, sources: Vec<Source>, args: &[String]) -> Result<i32> {
    platform::ensure_user_launch()?;
    let nonce = engine::random()?;
    let mut broker = Broker::open(root)?;
    let plan = broker.prepare(nonce.clone(), sources)?;
    let mut lane = Lane::open_installed(root, "launcher")?;
    // This function runs in the independent original-user worker, not in a
    // mutable Electron app. Its candidate selection is frozen before exec.
    let old = std::env::var_os("BRICKS_BOOTSTRAP_CANDIDATE_CLIENT");
    unsafe {
        std::env::set_var(
            "BRICKS_BOOTSTRAP_CANDIDATE_CLIENT",
            serde_json::to_string(&plan.client)?,
        );
    }
    let result = lane.external_launch(&plan.launcher, &nonce, args, |pid, health| {
        let mut proofs = health.children.clone();
        proofs.push(Proof {
            component: "launcher".into(),
            nonce: nonce.clone(),
            digest: plan.launcher.digest.clone(),
            pid,
        });
        installed::validate_proofs(&plan, &nonce, &proofs)?;
        // All processes were spawned by this unelevated native worker/core. OS UAC
        // validation is Windows-only; no macOS elevation is needed for private slots.
        broker.commit(&nonce, &proofs)
    });
    unsafe {
        match old {
            Some(value) => std::env::set_var("BRICKS_BOOTSTRAP_CANDIDATE_CLIENT", value),
            None => std::env::remove_var("BRICKS_BOOTSTRAP_CANDIDATE_CLIENT"),
        };
    }
    match result {
        Ok(code) => Ok(code),
        Err(error) => {
            // A failed commit decision is not an abort: Broker refuses to undo a durable
            // committing/committed journal. Next entry finishes that decision safely.
            let _ = broker.abort(&nonce);
            drop(lane);
            drop(broker);
            eprintln!("Native activation failed; using verified working reference: {error}");
            let mut lane = Lane::open_installed(root, "launcher")?;
            lane.run(args, None)
        }
    }
}

pub fn launch(args: &[String], parent: Option<&engine::ParentHealth>) -> Result<i32> {
    let root = root()?;
    let executable = std::env::current_exe()?;
    let app = executable
        .ancestors()
        .find(|p| p.extension().is_some_and(|v| v == "app"))
        .context("Missing root app")?;
    let seed = app.join("Contents/Resources/native-seed");
    let metadata: Seed = serde_json::from_slice(&tree::bounded(&seed.join("seed.json"), 65536)?)?;
    let mut sources = Vec::new();
    for (component, id) in [("launcher", metadata.launcher), ("client", metadata.client)] {
        let state: State = serde_json::from_slice(&tree::bounded(
            &root.join(component).join("state.json"),
            1024 * 1024,
        )?)?;
        if id.sequence > state.high_sequence {
            sources.push(Source {
                component: component.into(),
                path: seed.join(component),
                digest: id.digest,
            });
        }
    }
    if !sources.is_empty() {
        return update(&root, sources, args);
    }
    let mut lane = Lane::open_installed(&root, "launcher")?;
    lane.run(args, parent)
}
