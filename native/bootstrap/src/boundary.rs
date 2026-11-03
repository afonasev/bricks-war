//! Entry policy shared by production dispatch and portable contract tests.
use anyhow::{Result, ensure};
pub fn elevated_operation(operation: &str, elevated: bool) -> Result<()> {
    ensure!(
        !elevated
            || matches!(
                operation,
                "broker-server"
                    | "installer-prepare"
                    | "installer-restore"
                    | "installer-register"
                    | "register-install"
                    | "audit-install"
                    | "build-info"
            ),
        "Elevated native entry only permits fixed installation/broker operations"
    );
    Ok(())
}
// Backups/restored app files use Users RX. Admit only source objects whose
// contents are already explicitly readable to Users/Everyone. Fail closed on
// effective deny ACEs instead of attempting to emulate Windows group evaluation.
pub fn public_baseline_read(allow_masks: &[u32], effective_deny: bool) -> Result<()> {
    const GENERIC_READ: u32 = 0x8000_0000;
    const FILE_GENERIC_READ: u32 = 0x0012_0089;
    ensure!(
        !effective_deny
            && allow_masks
                .iter()
                .any(|mask| mask & GENERIC_READ != 0
                    || mask & FILE_GENERIC_READ == FILE_GENERIC_READ),
        "Migration baseline would widen source read access; installation left untouched"
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn elevation_is_denied_before_generic_paths_or_payloads_are_opened() {
        for operation in [
            "stage",
            "activate",
            "run",
            "recover",
            "status",
            "installed",
            "installed-run",
            "core",
            "native-worker",
            "native-update",
            "native-status",
            "verify-tree",
            "unknown",
        ] {
            assert!(elevated_operation(operation, true).is_err(), "{operation}");
            assert!(elevated_operation(operation, false).is_ok(), "{operation}");
        }
        for operation in [
            "broker-server",
            "installer-prepare",
            "installer-restore",
            "installer-register",
            "register-install",
            "audit-install",
            "build-info",
        ] {
            assert!(elevated_operation(operation, true).is_ok(), "{operation}");
        }
    }
    #[test]
    fn baseline_does_not_publish_private_or_denied_source_bytes() {
        assert!(
            public_baseline_read(&[], false).is_err(),
            "admin-only source"
        );
        assert!(
            public_baseline_read(&[0x80], false).is_err(),
            "attributes alone do not permit content reads"
        );
        assert!(
            public_baseline_read(&[0x120089], true).is_err(),
            "deny may restrict a public grant"
        );
        assert!(public_baseline_read(&[0x120089], false).is_ok());
        assert!(public_baseline_read(&[0x80000000], false).is_ok());
    }
}
