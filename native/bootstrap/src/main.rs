#![cfg_attr(all(windows, not(feature = "fixture")), windows_subsystem = "windows")]
#[cfg(any(windows, test))]
mod boundary;
mod build_info;
mod engine;
mod installed;
#[cfg(any(windows, test))]
mod ipc;
#[cfg(any(windows, test))]
mod legacy;
#[cfg(not(windows))]
mod macos;
mod platform;
mod tree;
#[cfg(windows)]
mod windows;
mod worker;
use anyhow::{Context, Result, bail, ensure};
use engine::{Lane, ParentHealth};
use std::path::Path;

fn main() {
    match execute() {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            eprintln!("Bricks bootstrap: {error:#}");
            std::process::exit(1);
        }
    }
}
fn execute() -> Result<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let explicit = args.first().is_some_and(|value| !value.starts_with('-'));
    let operation = if explicit {
        args[0].as_str()
    } else if std::env::var_os("BRICKS_BOOTSTRAP_ROOT").is_some() {
        "core"
    } else {
        "installed"
    };
    let entry_flags = if explicit {
        args.get(1..).unwrap_or(&[])
    } else {
        &args[..]
    };
    // Reject elevated generic operations before even opening their caller paths.
    #[cfg(windows)]
    boundary::elevated_operation(operation, windows::elevated()?)?;
    if operation == "native-worker" {
        ensure!(args.len() == 2, "Invalid native worker invocation");
        #[cfg(windows)]
        if windows::escape_worker(&args)? {
            return Ok(0);
        }
        return worker::run(Path::new(&args[1]));
    }
    if operation == "build-info" {
        println!("{}", build_info::value()?);
        return Ok(0);
    }
    if operation == "verify-tree" {
        ensure!(args.len() == 3, "verify-tree COMPONENT SOURCE");
        let verified = tree::verify(Path::new(&args[2]), &args[1])?;
        let bytes: u64 = verified.manifest.files.iter().filter_map(|f| f.size).sum();
        println!(
            "{}",
            serde_json::json!({"identity":engine::Identity::from(&verified),"unpackedSize":bytes})
        );
        return Ok(0);
    }
    if operation == "native-status" {
        #[cfg(windows)]
        let root = windows::registered_root()?;
        #[cfg(not(windows))]
        let root = macos::root()?;
        println!("{}", engine::installed_status(&root)?);
        return Ok(0);
    }
    let parent = ParentHealth::from_env()?;
    if operation == "core" {
        platform::ensure_user_launch()?;
        let root = std::env::var("BRICKS_BOOTSTRAP_ROOT").context("Core requires native root")?;
        let mut lane = if std::env::var("BRICKS_BOOTSTRAP_INSTALLED").as_deref() == Ok("1") {
            Lane::open_installed(Path::new(&root), "client")?
        } else {
            Lane::open(Path::new(&root), "client")?
        };
        if std::env::var("BRICKS_BOOTSTRAP_INSTALLED").as_deref() == Ok("1") {
            if let Ok(target) = std::env::var("BRICKS_BOOTSTRAP_CANDIDATE_CLIENT") {
                let target: engine::Identity = serde_json::from_str(&target)?;
                let parent = parent
                    .as_ref()
                    .context("Candidate core requires a parent health contract")?;
                let nonce = installed::child_nonce(&parent.nonce);
                return lane.external_launch(
                    &target,
                    &nonce,
                    &args.iter().skip(1).cloned().collect::<Vec<_>>(),
                    |_, health| parent.notify_child(health),
                );
            }
        }
        // Propagate root launch flags (including -muted) but never a parent
        // health contract. A new exact child contract is supplied by Lane.
        return lane.run(
            &args.iter().skip(1).cloned().collect::<Vec<_>>(),
            parent.as_ref(),
        );
    }
    #[cfg(windows)]
    {
        if operation == "broker-server" {
            ensure!(args.len() == 3, "Invalid broker invocation");
            return windows::serve(&args[1], args[2].parse()?);
        }
        if operation == "installer-prepare" || operation == "installer-restore" {
            ensure!(args.len() == 1, "Unexpected migration recovery arguments");
            return if operation == "installer-prepare" {
                windows::installer_prepare()
            } else {
                windows::installer_restore()
            };
        }
        if operation == "installer-register" {
            ensure!(args.len() == 2, "installer-register NATIVE_ROOT");
            return windows::installer_register(Path::new(&args[1]));
        }
        if operation == "register-install" {
            ensure!(args.len() == 1, "Unexpected registration arguments");
            return windows::register_install();
        }
        if operation == "audit-install" {
            ensure!(args.len() == 1, "Unexpected installation audit arguments");
            return windows::audit_install();
        }
        if operation == "installed" {
            platform::ensure_user_launch()?;
            let root = windows::registered_root()?;
            windows::prepare_user_profile(&root)?;
            let mut lane = Lane::open_installed(&root, "launcher")?;
            return lane.run(entry_flags, parent.as_ref());
        }
        if operation == "native-update" {
            ensure!(args.len() >= 2, "Missing frozen update plan");
            let sources: Vec<installed::Source> =
                serde_json::from_slice(&tree::bounded(Path::new(&args[1]), 65536)?)?;
            return windows::update(sources, &args[2..]);
        }
    }
    #[cfg(not(windows))]
    if operation == "installed" {
        return macos::launch(entry_flags, parent.as_ref());
    }
    #[cfg(feature = "fixture")]
    if operation == "fixture-profile" {
        ensure!(args.len() == 2, "fixture-profile PROFILE");
        engine::remember_profile(Path::new(&args[1]))?;
        return Ok(0);
    }
    #[cfg(feature = "fixture")]
    if operation == "fixture-recover" {
        ensure!(args.len() == 2, "fixture-recover ROOT");
        drop(installed::Broker::open(Path::new(&args[1]))?);
        return Ok(0);
    }
    #[cfg(feature = "fixture")]
    if operation == "fixture-update" {
        ensure!(args.len() >= 3, "fixture-update ROOT SOURCES");
        let sources: Vec<installed::Source> =
            serde_json::from_slice(&tree::bounded(Path::new(&args[2]), 65536)?)?;
        #[cfg(not(windows))]
        return macos::update(Path::new(&args[1]), sources, &args[3..]);
        #[cfg(windows)]
        anyhow::bail!("Use the real Windows protected broker fixture");
    }
    ensure!(
        args.len() >= 3,
        "Usage: bricks-bootstrap <stage|activate|run|recover|status> ABS_ROOT <launcher|client> [SOURCE | -- launch-args]"
    );
    let mut lane = if operation == "installed-run" {
        Lane::open_installed(Path::new(&args[1]), &args[2])?
    } else {
        Lane::open(Path::new(&args[1]), &args[2])?
    };
    let tail = if args.get(3).map(String::as_str) == Some("--") {
        &args[4..]
    } else {
        &args[3..]
    };
    match operation {
        "stage" => {
            ensure!(tail.len() == 1, "stage requires one source tree");
            let id = lane.stage(Path::new(&tail[0]))?;
            println!("{}", serde_json::to_string(&id)?);
            Ok(0)
        }
        "activate" => lane.activate(tail, parent.as_ref()),
        "run" | "installed-run" => lane.run(tail, parent.as_ref()),
        "recover" => {
            ensure!(tail.is_empty(), "Unexpected recovery arguments");
            lane.recover()?;
            println!("{}", serde_json::to_string(&lane.state)?);
            Ok(0)
        }
        "status" => {
            ensure!(tail.is_empty(), "Unexpected status arguments");
            println!("{}", serde_json::to_string(&lane.state)?);
            Ok(0)
        }
        _ => bail!("Unknown operation"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_portable_path_aliases() {
        for name in [
            "../x", "/x", "a//b", "a/./b", "x\\y", "x:y", "NUL.exe", "com1", "x.", "a/ ", "a/../b",
        ] {
            assert!(tree::relative(name).is_err(), "{name}");
        }
        assert!(tree::relative("Bricks War.app/Contents/MacOS/Bricks War").is_ok());
    }
    #[test]
    fn digest_namespace_is_fixed() {
        assert!(tree::digest_ok(&"a".repeat(64)));
        assert!(!tree::digest_ok(&"A".repeat(64)));
        assert!(!tree::digest_ok("../../state"));
    }
    #[test]
    fn health_horizon_is_preserved() {
        assert_eq!(engine::HEALTH_HORIZON.as_secs(), 90);
    }
}
