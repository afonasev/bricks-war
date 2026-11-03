use anyhow::{Result, bail};
use std::{
    fs::{self, File, OpenOptions},
    path::Path,
};

pub fn plain(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        bail!("Symbolic path boundary: {}", path.display());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            bail!("Reparse point: {}", path.display());
        }
    }
    Ok(())
}

// Check every existing ancestor, not just the final pathname. Callers use a
// private installation/health directory; privileged ACL provisioning is separate.
pub fn ancestors(path: &Path) -> Result<()> {
    for parent in path.ancestors() {
        if parent.exists() {
            plain(parent)?;
        }
    }
    Ok(())
}

pub fn sync_dir(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(path)?.sync_all()?;
    #[cfg(windows)]
    {
        // Windows rename uses MoveFileExW WRITE_THROUGH below. Directory handles
        // do not support FlushFileBuffers on all supported filesystems.
        plain(path)?;
    }
    Ok(())
}

pub fn replace(from: &Path, to: &Path) -> Result<()> {
    #[cfg(unix)]
    fs::rename(from, to)?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
        };
        let source: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let target: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            MoveFileExW(
                source.as_ptr(),
                target.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
    }
    sync_dir(
        to.parent()
            .ok_or_else(|| anyhow::anyhow!("Missing parent"))?,
    )
}

pub fn exclusive_file(path: &Path) -> Result<File> {
    ancestors(path)?;
    #[cfg(windows)]
    if crate::windows::elevated()? {
        return crate::windows::exclusive_protected_file(path);
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    Ok(options.open(path)?)
}

pub fn ensure_user_launch() -> Result<()> {
    #[cfg(unix)]
    if unsafe { libc::geteuid() } == 0 {
        bail!("Elevated processes cannot launch payloads");
    }
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            Security::{GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation},
            System::Threading::{GetCurrentProcess, OpenProcessToken},
        };
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let mut elevation: TOKEN_ELEVATION = std::mem::zeroed();
        let mut length = 0;
        let result = GetTokenInformation(
            token,
            TokenElevation,
            (&mut elevation as *mut TOKEN_ELEVATION).cast(),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut length,
        );
        CloseHandle(token);
        if result == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        if elevation.TokenIsElevated != 0 {
            bail!("Elevated processes cannot launch payloads");
        }
    }
    Ok(())
}

pub struct ManagedChild {
    pub(crate) child: std::process::Child,
    #[cfg(unix)]
    group: Option<i32>,
    #[cfg(windows)]
    pub(crate) job: Option<crate::windows::Handle>,
}
impl ManagedChild {
    pub fn id(&self) -> u32 {
        self.child.id()
    }
    pub fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        self.child.try_wait()
    }
    pub fn wait(&mut self) -> std::io::Result<std::process::ExitStatus> {
        self.child.wait()
    }
    pub fn kill(&mut self) -> std::io::Result<()> {
        #[cfg(windows)]
        if let Some(job) = &self.job {
            if unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(job.0, 1) } == 0
            {
                return Err(std::io::Error::last_os_error());
            }
            return Ok(());
        }
        #[cfg(unix)]
        if let Some(group) = self.group {
            if unsafe { libc::killpg(group, libc::SIGKILL) } != 0 {
                return Err(std::io::Error::last_os_error());
            }
            return Ok(());
        }
        self.child.kill()
    }
}
pub fn spawn(command: &mut std::process::Command) -> Result<ManagedChild> {
    #[cfg(windows)]
    {
        crate::windows::spawn_controlled(command)
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::process::CommandExt;
        let own_group = std::env::var("BRICKS_BOOTSTRAP_MANAGED").as_deref() != Ok("1");
        command.env("BRICKS_BOOTSTRAP_MANAGED", "1");
        if own_group {
            unsafe {
                command.pre_exec(|| {
                    if libc::setpgid(0, 0) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
        }
        let child = command.spawn()?;
        let group = if own_group {
            Some(child.id() as i32)
        } else {
            None
        };
        Ok(ManagedChild { child, group })
    }
}

pub fn lock_file(path: &Path) -> Result<File> {
    ancestors(path)?;
    match exclusive_file(path) {
        Ok(file) => Ok(file),
        Err(error)
            if error
                .downcast_ref::<std::io::Error>()
                .is_some_and(|e| e.kind() == std::io::ErrorKind::AlreadyExists) =>
        {
            plain(path)?;
            Ok(OpenOptions::new().read(true).write(true).open(path)?)
        }
        Err(error) => Err(error),
    }
}

impl Drop for ManagedChild {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(group) = self.group {
            if matches!(self.child.try_wait(), Ok(None)) {
                unsafe {
                    libc::killpg(group, libc::SIGKILL);
                }
            }
        }
    }
}
