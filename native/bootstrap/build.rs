use base64::{Engine, engine::general_purpose::STANDARD};
use sha2::{Digest, Sha256};
use std::{env, fs, path::PathBuf};
fn main() {
    println!("cargo:rerun-if-env-changed=BRICKS_BOOTSTRAP_TEST_KEY");
    let fixture = env::var_os("CARGO_FEATURE_FIXTURE").is_some();
    let key = if fixture {
        PathBuf::from(
            env::var("BRICKS_BOOTSTRAP_TEST_KEY")
                .expect("Fixture builds require a compile-time public key"),
        )
    } else {
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("../../electron/content-public-key.pem")
    };
    println!("cargo:rerun-if-changed={}", key.display());
    let pem = fs::read_to_string(key).expect("Native public key");
    let text: String = pem
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect();
    let der = STANDARD.decode(text).expect("Ed25519 SPKI");
    assert!(
        der.len() == 44
            && der[..12]
                == [
                    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
                ],
        "Native root requires a canonical Ed25519 public key"
    );
    let fingerprint: String = Sha256::digest(&der[12..])
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    let platform = match os.as_str() {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();
    println!("cargo:rerun-if-env-changed=BRICKS_BOOTSTRAP_ICON");
    let mut icon_fingerprint = String::new();
    if os == "windows" {
        if let Some(icon) = env::var_os("BRICKS_BOOTSTRAP_ICON") {
            let icon = PathBuf::from(icon).canonicalize().expect("Native app icon");
            println!("cargo:rerun-if-changed={}", icon.display());
            icon_fingerprint = Sha256::digest(fs::read(&icon).unwrap())
                .iter()
                .map(|v| format!("{v:02x}"))
                .collect();
            let output = PathBuf::from(env::var("OUT_DIR").unwrap());
            let rc = output.join("native-icon.rc");
            fs::write(
                &rc,
                format!(
                    "1 ICON \"{}\"\n",
                    icon.display().to_string().replace('\\', "/")
                ),
            )
            .unwrap();
            let gnu = env::var("CARGO_CFG_TARGET_ENV").unwrap() == "gnu";
            let object = output.join(if gnu {
                "native-icon.o"
            } else {
                "native-icon.res"
            });
            let status = if gnu {
                let tool = env::var("BRICKS_BOOTSTRAP_WINDRES").unwrap_or_else(|_| {
                    if arch == "x86_64" {
                        "x86_64-w64-mingw32-windres".into()
                    } else {
                        "aarch64-w64-mingw32-windres".into()
                    }
                });
                std::process::Command::new(tool)
                    .arg(&rc)
                    .arg(&object)
                    .status()
            } else {
                std::process::Command::new("rc.exe")
                    .arg("/nologo")
                    .arg(format!("/fo{}", object.display()))
                    .arg(&rc)
                    .status()
            }
            .expect("Windows icon resource compiler");
            assert!(status.success(), "Native app icon compilation failed");
            println!("cargo:rustc-link-arg={}", object.display());
        }
    }
    let json = format!(
        r#"{{"rootAbi":1,"fixture":{fixture},"keyFingerprint":"{fingerprint}","platform":"{platform}","arch":"{arch}","iconFingerprint":"{icon_fingerprint}"}}"#
    );
    let mut data = b"BRICKS_BOOTSTRAP_INFO\0".to_vec();
    data.extend_from_slice(&(json.len() as u32).to_le_bytes());
    data.extend_from_slice(json.as_bytes());
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("native-info.bin"),
        data,
    )
    .unwrap();
}
