use crate::{engine, installed::Source, platform, tree};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub request_nonce: String,
    pub schema: u32,
    pub sources: Vec<Source>,
    pub profile: PathBuf,
    pub parent_pid: u32,
    pub root_pid: Option<u32>,
    pub args: Vec<String>,
    pub relaunch: bool,
}
pub fn run(path: &Path) -> Result<i32> {
    platform::ensure_user_launch()?;
    ensure!(path.is_absolute(), "Absolute frozen plan path required");
    let update_root = engine::health_root()?.join("updates");
    ensure!(
        path == update_root.join("apply.json"),
        "Worker plan must be the original-user update plan"
    );
    let plan: Plan = serde_json::from_slice(&tree::bounded(path, 65536)?)?;
    ensure!(
        plan.schema == 1
            && tree::digest_ok(&plan.request_nonce)
            && plan.profile.is_absolute()
            && plan.parent_pid > 0
            && plan.args.len() <= 64
            && plan
                .args
                .iter()
                .all(|arg| arg.len() <= 4096 && !arg.contains('\0')),
        "Invalid original-user launch plan"
    );
    ensure!(
        (plan.relaunch && plan.sources.is_empty())
            || (!plan.relaunch && !plan.sources.is_empty() && plan.sources.len() <= 2),
        "Invalid native operation"
    );
    ensure!(
        engine::original_profile()? == plan.profile,
        "Worker cannot switch the original-user profile"
    );
    engine::check_profile(&plan.profile)?;
    let directory = path.parent().unwrap();
    let cancelled = directory.join(format!("cancelled-{}", plan.request_nonce));
    if cancelled.exists() {
        return Ok(0);
    }
    let mut old = vec![plan.parent_pid];
    if let Some(pid) = plan.root_pid {
        old.push(pid);
    }
    let exits = engine::ExitWaiter::capture(&old)?;
    engine::write_atomic(
        &directory.join("worker.json"),
        &serde_json::json!({"schema":1,"parent_pid":plan.parent_pid,"worker_pid":std::process::id(),"request_nonce":plan.request_nonce}),
    )?;
    // Acknowledge the independent original-user worker before old Electron exits;
    // UAC may take arbitrarily longer than the legacy 3-second helper handshake.
    let mut file = platform::exclusive_file(
        &directory.join(format!("helper-started-{}", std::process::id())),
    )?;
    use std::io::Write;
    write!(file, "{}", plan.parent_pid)?;
    file.sync_all()?;
    drop(file);
    platform::replace(
        &directory.join(format!("helper-started-{}", std::process::id())),
        &directory.join("helper-started"),
    )?;
    if !exits.wait(|| cancelled.exists())? {
        return Ok(0);
    }
    // Cancellation and old-process drain happen before any profile mutation.
    engine::remember_profile(&plan.profile)?;
    unsafe {
        std::env::remove_var("BRICKS_BOOTSTRAP_MANAGED");
        std::env::remove_var("BRICKS_BOOTSTRAP_SKIP_DISCOVERY");
        std::env::remove_var("BRICKS_BOOTSTRAP_WORKER_ESCAPED");
        std::env::remove_var("BRICKS_BOOTSTRAP_CANDIDATE_CLIENT");
        std::env::remove_var("BRICKS_BOOTSTRAP_NONCE");
        std::env::remove_var("BRICKS_BOOTSTRAP_DIGEST");
        std::env::remove_var("BRICKS_BOOTSTRAP_RECEIPT");
    }
    if !plan.relaunch {
        // Consume only the exact previously consented plan. A later ready plan must
        // survive, and the new client must not replay this plan before first health.
        let ready = directory.join("ready.json");
        if ready.exists() {
            let bytes = tree::bounded(&ready, 65536)?;
            let current: serde_json::Value = serde_json::from_slice(&bytes)?;
            let mut expected = serde_json::to_value(&plan)?;
            expected.as_object_mut().unwrap().remove("request_nonce");
            if current == expected {
                std::fs::remove_file(&ready)?;
                platform::sync_dir(directory)?;
            }
        }
    }
    let cleanup_sources = plan.sources.clone();
    #[cfg(windows)]
    let result = {
        let root = crate::windows::registered_root()?;
        if plan.relaunch {
            let mut lane = engine::Lane::open_installed(&root, "launcher")?;
            return lane.run(&plan.args, None);
        }
        crate::windows::update(plan.sources, &plan.args)
    };
    #[cfg(not(windows))]
    let result = {
        let root = crate::macos::root()?;
        if plan.relaunch {
            let mut lane = engine::Lane::open_installed(&root, "launcher")?;
            return lane.run(&plan.args, None);
        }
        crate::macos::update(&root, plan.sources, &plan.args)
    };
    // Only after the child lifetime ends: no running worker/helper still reads
    // these bytes. Failed operations retain their consented package for diagnosis.
    if result.as_ref().is_ok_and(|code| *code == 0) {
        if let Err(error) = cleanup_completed(directory, &cleanup_sources) {
            eprintln!("Native prepared-cache cleanup deferred: {error}");
        }
    }
    result
}
fn cleanup_completed(directory: &Path, sources: &[Source]) -> Result<()> {
    let Some(first) = sources.first() else {
        return Ok(());
    };
    let owned = engine::health_root()?.join("updates");
    ensure!(directory == owned, "Unexpected native cache directory");
    let stage = first
        .path
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| anyhow::anyhow!("Missing preparation"))?;
    let name = stage
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    ensure!(
        stage.parent() == Some(directory)
            && name.starts_with("prepared-")
            && name.len() == 41
            && name[9..].bytes().all(|v| v.is_ascii_hexdigit()),
        "Foreign native preparation"
    );
    ensure!(
        sources.iter().all(
            |source| ["client", "launcher"].contains(&source.component.as_str())
                && source.path == stage.join("payload").join(&source.component)
        ),
        "Mixed native preparation"
    );
    platform::ancestors(stage)?;
    #[cfg(windows)]
    let root = crate::windows::registered_root()?;
    #[cfg(not(windows))]
    let root = crate::macos::root()?;
    let status = engine::installed_status(&root)?;
    if status["phase"] == "committed"
        && sources.iter().all(|source| {
            status["components"][&source.component]["digest"].as_str() == Some(&source.digest)
        })
    {
        std::fs::remove_dir_all(stage)?;
    }
    Ok(())
}
