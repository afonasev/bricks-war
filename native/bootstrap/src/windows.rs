//! Win32 trust boundary. Paths/launch programs never come from renderer IPC.
#![allow(unsafe_op_in_unsafe_fn)]
use crate::{
    engine,
    installed::{self, Broker, Proof, Request, Response, Source},
    tree,
};
use anyhow::{Context, Result, bail, ensure};
use std::{
    fs::File,
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle},
    },
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, *},
    Storage::FileSystem::*,
    System::{
        Pipes::*,
        Registry::*,
        Threading::*,
        WindowsProgramming::{DRIVE_FIXED, DRIVE_REMOVABLE},
    },
    UI::Shell::*,
};
fn registry() -> Result<String> {
    #[cfg(feature = "fixture")]
    {
        Ok(format!(
            "SOFTWARE\\BricksWar\\NativeBootstrap-QA-{}",
            &tree::key_fingerprint()?[..16]
        ))
    }
    #[cfg(not(feature = "fixture"))]
    {
        Ok("SOFTWARE\\BricksWar\\NativeBootstrap".to_owned())
    }
}
const RIGHTS: u32 = 0x40000000
    | 0x10000000
    | 0x00010000
    | 0x00040000
    | 0x00080000
    | 0x2
    | 0x4
    | 0x10
    | 0x100
    | 0x40;
const SECURITY: &str = "O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;GRGX;;;BU)";
fn wide(s: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    s.as_ref().encode_wide().chain(Some(0)).collect()
}
fn ok(value: i32) -> Result<()> {
    if value == 0 {
        Err(std::io::Error::last_os_error().into())
    } else {
        Ok(())
    }
}
struct Local(*mut core::ffi::c_void);
impl Drop for Local {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                LocalFree(self.0);
            }
        }
    }
}
#[derive(Debug)]
pub struct Handle(pub HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}
fn handle(value: HANDLE) -> Result<Handle> {
    ensure!(
        !value.is_null() && value != INVALID_HANDLE_VALUE,
        "Invalid Windows handle: {}",
        std::io::Error::last_os_error()
    );
    Ok(Handle(value))
}
// Pointer-bearing TOKEN_* structures require native alignment, unlike Vec<u8>.
struct TokenInfo {
    words: Vec<usize>,
    length: usize,
}
impl std::ops::Deref for TokenInfo {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        unsafe { std::slice::from_raw_parts(self.words.as_ptr().cast(), self.length) }
    }
}
fn token_info(token: HANDLE, kind: TOKEN_INFORMATION_CLASS) -> Result<TokenInfo> {
    unsafe {
        let mut size = 0;
        GetTokenInformation(token, kind, std::ptr::null_mut(), 0, &mut size);
        ensure!(size > 0 && size <= 65536, "Invalid token information size");
        let length = size as usize;
        let mut words = vec![0usize; length.div_ceil(std::mem::size_of::<usize>())];
        ok(GetTokenInformation(
            token,
            kind,
            words.as_mut_ptr().cast(),
            size,
            &mut size,
        ))?;
        ensure!(size as usize <= length, "Changed token information size");
        Ok(TokenInfo {
            words,
            length: size as usize,
        })
    }
}
fn sid_string(sid: PSID) -> Result<String> {
    unsafe {
        let mut text = std::ptr::null_mut();
        ok(ConvertSidToStringSidW(sid, &mut text))?;
        let memory = Local(text.cast());
        let mut len = 0;
        while *text.add(len) != 0 {
            len += 1;
        }
        let value = String::from_utf16(std::slice::from_raw_parts(text, len))?;
        drop(memory);
        Ok(value)
    }
}
#[derive(Clone, Debug)]
pub struct User {
    sid: String,
    logon: String,
    session: u32,
    elevated: bool,
}
fn token_user(token: HANDLE) -> Result<User> {
    unsafe {
        let bytes = token_info(token, TokenUser)?;
        let sid = sid_string((*(bytes.as_ptr().cast::<TOKEN_USER>())).User.Sid)?;
        let groups = token_info(token, TokenGroups)?;
        let groups = groups.as_ptr().cast::<TOKEN_GROUPS>();
        let mut logon = None;
        for group in
            std::slice::from_raw_parts((*groups).Groups.as_ptr(), (*groups).GroupCount as usize)
        {
            if group.Attributes & (SE_GROUP_LOGON_ID as u32) == SE_GROUP_LOGON_ID as u32 {
                logon = Some(sid_string(group.Sid)?);
            }
        }
        let session = u32::from_ne_bytes(token_info(token, TokenSessionId)?[..4].try_into()?);
        let elevated = u32::from_ne_bytes(token_info(token, TokenElevation)?[..4].try_into()?) != 0;
        Ok(User {
            sid,
            logon: logon.context("Missing logon SID")?,
            session,
            elevated,
        })
    }
}
fn process(pid: u32) -> Result<Handle> {
    handle(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid) })
}
fn process_user(process: &Handle) -> Result<User> {
    unsafe {
        let mut token = std::ptr::null_mut();
        ok(OpenProcessToken(process.0, TOKEN_QUERY, &mut token))?;
        let token = handle(token)?;
        token_user(token.0)
    }
}
fn image(process: &Handle) -> Result<PathBuf> {
    unsafe {
        let mut text = vec![0u16; 32768];
        let mut length = text.len() as u32;
        ok(QueryFullProcessImageNameW(
            process.0,
            0,
            text.as_mut_ptr(),
            &mut length,
        ))?;
        Ok(PathBuf::from(String::from_utf16(&text[..length as usize])?))
    }
}
fn live(process: &Handle) -> Result<()> {
    ensure!(
        unsafe { WaitForSingleObject(process.0, 0) } == WAIT_TIMEOUT,
        "Original process exited"
    );
    Ok(())
}

unsafe fn audit(handle: HANDLE, kind: SE_OBJECT_TYPE) -> Result<()> {
    let (mut owner, mut dacl, mut descriptor) = (
        std::ptr::null_mut(),
        std::ptr::null_mut(),
        std::ptr::null_mut(),
    );
    let result = GetSecurityInfo(
        handle,
        kind,
        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
        &mut owner,
        std::ptr::null_mut(),
        &mut dacl,
        std::ptr::null_mut(),
        &mut descriptor,
    );
    ensure!(result == 0, "Cannot read protected ACL: {result}");
    let _memory = Local(descriptor);
    ensure!(!owner.is_null() && !dacl.is_null(), "Null owner/DACL");
    let trusted = |sid: PSID| {
        IsWellKnownSid(sid, WinLocalSystemSid) != 0
            || IsWellKnownSid(sid, WinBuiltinAdministratorsSid) != 0
    };
    ensure!(
        trusted(owner),
        "Protected object owner is not SYSTEM/Administrators"
    );
    for index in 0..(*dacl).AceCount {
        let mut ace = std::ptr::null_mut();
        ok(GetAce(dacl, index as u32, &mut ace))?;
        let header = &*ace.cast::<ACE_HEADER>();
        if header.AceFlags & INHERIT_ONLY_ACE as u8 != 0 {
            continue;
        }
        if header.AceType == ACCESS_ALLOWED_ACE_TYPE as u8 {
            let ace = &*ace.cast::<ACCESS_ALLOWED_ACE>();
            let sid = (&ace.SidStart as *const u32).cast_mut().cast();
            let rights = if kind == SE_REGISTRY_KEY {
                0x40000000 | 0x10000000 | 0x00010000 | 0x00040000 | 0x00080000 | 0x2 | 0x4 | 0x20
            } else {
                RIGHTS
            };
            ensure!(
                ace.Mask & rights == 0 || trusted(sid),
                "Untrusted writable protected object"
            );
        } else {
            ensure!(
                header.AceType == ACCESS_DENIED_ACE_TYPE as u8
                    || header.AceType == SYSTEM_AUDIT_ACE_TYPE as u8,
                "Unsupported effective ACE type"
            );
        }
    }
    Ok(())
}

unsafe fn audit_public_baseline_read(object: HANDLE) -> Result<()> {
    let (mut dacl, mut descriptor) = (std::ptr::null_mut(), std::ptr::null_mut());
    ensure!(
        GetSecurityInfo(
            object,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut dacl,
            std::ptr::null_mut(),
            &mut descriptor
        ) == 0,
        "Cannot inspect baseline read permissions"
    );
    let _memory = Local(descriptor);
    ensure!(!dacl.is_null(), "Missing baseline DACL");
    let mut grants = Vec::new();
    let mut denied = false;
    for index in 0..(*dacl).AceCount {
        let mut raw = std::ptr::null_mut();
        ok(GetAce(dacl, index as u32, &mut raw))?;
        let header = &*raw.cast::<ACE_HEADER>();
        if header.AceFlags & INHERIT_ONLY_ACE as u8 != 0 {
            continue;
        }
        if header.AceType == ACCESS_ALLOWED_ACE_TYPE as u8 {
            let ace = &*raw.cast::<ACCESS_ALLOWED_ACE>();
            let sid = (&ace.SidStart as *const u32).cast_mut().cast();
            if IsWellKnownSid(sid, WinBuiltinUsersSid) != 0 || IsWellKnownSid(sid, WinWorldSid) != 0
            {
                grants.push(ace.Mask);
            }
        } else if header.AceType == ACCESS_DENIED_ACE_TYPE as u8 {
            denied = true;
        } else {
            bail!("Ambiguous baseline read ACE");
        }
    }
    crate::boundary::public_baseline_read(&grants, denied)
}

unsafe fn audit_ancestor(object: HANDLE) -> Result<()> {
    let (mut owner, mut dacl, mut descriptor) = (
        std::ptr::null_mut(),
        std::ptr::null_mut(),
        std::ptr::null_mut(),
    );
    ensure!(
        GetSecurityInfo(
            object,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            std::ptr::null_mut(),
            &mut dacl,
            std::ptr::null_mut(),
            &mut descriptor
        ) == 0,
        "Cannot inspect installation ancestor"
    );
    let _memory = Local(descriptor);
    ensure!(
        !owner.is_null() && !dacl.is_null(),
        "Unprotected installation ancestor"
    );
    static TRUSTED_INSTALLER: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    let installer = TRUSTED_INSTALLER.get_or_init(|| {
        let (mut sid_size, mut domain_size, mut use_type) = (0, 0, 0);
        let name = wide("NT SERVICE\\TrustedInstaller");
        LookupAccountNameW(
            std::ptr::null(),
            name.as_ptr(),
            std::ptr::null_mut(),
            &mut sid_size,
            std::ptr::null_mut(),
            &mut domain_size,
            &mut use_type,
        );
        if sid_size == 0 || sid_size > 1024 || domain_size > 32768 {
            return Vec::new();
        }
        let mut sid = vec![0u8; sid_size as usize];
        let mut domain = vec![0u16; domain_size as usize];
        if LookupAccountNameW(
            std::ptr::null(),
            name.as_ptr(),
            sid.as_mut_ptr().cast(),
            &mut sid_size,
            domain.as_mut_ptr(),
            &mut domain_size,
            &mut use_type,
        ) == 0
        {
            return Vec::new();
        }
        sid
    });
    let trusted = |sid: PSID| {
        IsWellKnownSid(sid, WinLocalSystemSid) != 0
            || IsWellKnownSid(sid, WinBuiltinAdministratorsSid) != 0
            || (!installer.is_empty() && EqualSid(sid, installer.as_ptr().cast_mut().cast()) != 0)
    };
    ensure!(
        trusted(owner),
        "Installation ancestor has an untrusted owner"
    );
    // An ancestor may permit creation of unrelated children. It must not permit
    // replacement, reparse/attribute changes, child deletion, or ACL takeover.
    let writes = 0x40000000 | 0x10000000 | 0x10000 | 0x40000 | 0x80000 | 0x10 | 0x100 | 0x40;
    for index in 0..(*dacl).AceCount {
        let mut ace = std::ptr::null_mut();
        ok(GetAce(dacl, index as u32, &mut ace))?;
        let header = &*ace.cast::<ACE_HEADER>();
        if header.AceFlags & INHERIT_ONLY_ACE as u8 != 0 {
            continue;
        }
        if header.AceType == ACCESS_ALLOWED_ACE_TYPE as u8 {
            let entry = &*ace.cast::<ACCESS_ALLOWED_ACE>();
            let sid = (&entry.SidStart as *const u32).cast_mut().cast();
            ensure!(
                entry.Mask & writes == 0 || trusted(sid),
                "Installation ancestor can be replaced by an unprivileged user"
            );
        } else {
            ensure!(
                header.AceType == ACCESS_DENIED_ACE_TYPE as u8,
                "Unsupported ancestor ACE"
            );
        }
    }
    Ok(())
}

/// Hold read handles without write/delete sharing. Each existing parent is
/// opened explicitly with OPEN_REPARSE_POINT and checked before following it.
/// This closes path-component substitution while the signed copy is prepared.
pub struct Frozen {
    files: Vec<File>,
}
impl Frozen {
    pub fn path(path: &Path, protected_root: Option<&Path>) -> Result<Self> {
        ensure!(path.is_absolute(), "Absolute local path required");
        use std::path::{Component, Prefix};
        ensure!(
            matches!(path.components().next(),Some(Component::Prefix(prefix)) if matches!(prefix.kind(),Prefix::Disk(_)|Prefix::VerbatimDisk(_))),
            "Remote/device paths are forbidden"
        );
        ensure!(
            !path
                .components()
                .any(|p| matches!(p, Component::ParentDir | Component::CurDir)),
            "Noncanonical source path"
        );
        let drive = match path.components().next() {
            Some(Component::Prefix(prefix)) => match prefix.kind() {
                Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => letter,
                _ => unreachable!(),
            },
            _ => unreachable!(),
        };
        let drive_root = format!("{}:\\", char::from(drive));
        ensure!(
            matches!(
                unsafe { GetDriveTypeW(wide(drive_root).as_ptr()) },
                DRIVE_FIXED | DRIVE_REMOVABLE
            ),
            "Mapped remote/unknown drives are forbidden at the protected boundary"
        );
        let mut files = Vec::new();
        for part in path.ancestors().collect::<Vec<_>>().into_iter().rev() {
            if part.as_os_str().is_empty() {
                continue;
            }
            let raw = unsafe {
                CreateFileW(
                    wide(part).as_ptr(),
                    GENERIC_READ | READ_CONTROL,
                    FILE_SHARE_READ,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
                    std::ptr::null_mut(),
                )
            };
            let raw = handle(raw)?;
            let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
            unsafe {
                ok(GetFileInformationByHandle(raw.0, &mut info))?;
                ensure!(
                    (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0
                        || info.nNumberOfLinks == 1,
                    "Hardlinked file rejected at protected boundary"
                );
                ensure!(
                    GetFileType(raw.0) == FILE_TYPE_DISK
                        && info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT == 0,
                    "Reparse/non-disk path rejected"
                );
                if let Some(root) = protected_root {
                    if part.starts_with(root) {
                        audit(raw.0, SE_FILE_OBJECT)?;
                    } else {
                        audit_ancestor(raw.0)?;
                    }
                }
            }
            let value = raw.0;
            std::mem::forget(raw);
            files.push(unsafe { File::from_raw_handle(value) });
        }
        Ok(Self { files })
    }
    pub fn signed_source(path: &Path, component: &str) -> Result<Self> {
        let mut frozen = Self::path(path, None)?;
        frozen
            .files
            .append(&mut Self::path(&path.join(tree::MANIFEST), None)?.files);
        let (manifest, _) = tree::signed(path, component)?;
        for entry in manifest.files {
            ensure!(
                entry.link.is_none(),
                "Windows signed payload cannot contain links"
            );
            let relative = tree::relative(&entry.path)?;
            frozen
                .files
                .append(&mut Self::path(&path.join(relative), None)?.files);
        }
        Ok(frozen)
    }
    pub fn tree(path: &Path, protected_root: Option<&Path>) -> Result<Self> {
        Self::tree_with_read_audit(path, protected_root, false)
    }
    fn public_tree(path: &Path, protected_root: &Path) -> Result<Self> {
        Self::tree_with_read_audit(path, Some(protected_root), true)
    }
    fn tree_with_read_audit(
        path: &Path,
        protected_root: Option<&Path>,
        public_read: bool,
    ) -> Result<Self> {
        let mut frozen = Self::path(path, protected_root)?;
        if public_read {
            unsafe {
                audit_public_baseline_read(frozen.files.last().unwrap().as_raw_handle())?;
            }
        }
        let mut queue = vec![path.to_path_buf()];
        let mut count = 0;
        while let Some(dir) = queue.pop() {
            for entry in std::fs::read_dir(dir)? {
                let entry = entry?;
                count += 1;
                ensure!(count <= 60000, "Oversized frozen tree");
                let mut held = Self::path(&entry.path(), protected_root)?;
                if public_read {
                    unsafe {
                        audit_public_baseline_read(held.files.last().unwrap().as_raw_handle())?;
                    }
                }
                let metadata = entry.metadata()?;
                if metadata.is_dir() {
                    queue.push(entry.path());
                } else {
                    ensure!(metadata.is_file(), "Unsupported staged entry");
                }
                frozen.files.append(&mut held.files);
            }
        }
        Ok(frozen)
    }
}
// The installer creates a new dedicated native subtree. Only fixed installed
// paths enter this function; it is not exposed as a general privileged CLI.
fn protect_payload(path: &Path) -> Result<()> {
    unsafe {
        let mut descriptor = std::ptr::null_mut();
        ok(ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide(SECURITY).as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        ))?;
        let _memory = Local(descriptor);
        let (mut owner, mut dacl, mut defaulted, mut present) =
            (std::ptr::null_mut(), std::ptr::null_mut(), 0, 0);
        ok(GetSecurityDescriptorOwner(
            descriptor,
            &mut owner,
            &mut defaulted,
        ))?;
        ok(GetSecurityDescriptorDacl(
            descriptor,
            &mut present,
            &mut dacl,
            &mut defaulted,
        ))?;
        let mut queue = vec![path.to_path_buf()];
        while let Some(path) = queue.pop() {
            crate::platform::plain(&path)?;
            if path.is_dir() {
                for entry in std::fs::read_dir(&path)? {
                    queue.push(entry?.path());
                }
            }
            let result = SetNamedSecurityInfoW(
                wide(&path).as_ptr(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION
                    | DACL_SECURITY_INFORMATION
                    | PROTECTED_DACL_SECURITY_INFORMATION,
                owner,
                std::ptr::null_mut(),
                dacl,
                std::ptr::null(),
            );
            ensure!(result == 0, "Protect payload failed: {result}");
        }
        Ok(())
    }
}
pub fn registered_root() -> Result<PathBuf> {
    unsafe {
        let mut key = std::ptr::null_mut();
        let result = RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            wide(registry()?).as_ptr(),
            0,
            KEY_READ | KEY_WOW64_64KEY,
            &mut key,
        );
        ensure!(
            result == 0,
            "Native installation registration unavailable: {result}"
        );
        let result = (|| {
            audit(key, SE_REGISTRY_KEY)?;
            let mut size = 0;
            let result = RegGetValueW(
                key,
                std::ptr::null(),
                wide("InstallRoot").as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut size,
            );
            ensure!(
                result == 0 && size > 2 && size <= 65536,
                "Invalid native install registration"
            );
            let mut text = vec![0u16; (size as usize) / 2];
            let result = RegGetValueW(
                key,
                std::ptr::null(),
                wide("InstallRoot").as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                text.as_mut_ptr().cast(),
                &mut size,
            );
            ensure!(result == 0, "Cannot read native install root");
            ensure!(text.last() == Some(&0), "Unterminated install root");
            text.pop();
            let root = PathBuf::from(String::from_utf16(&text)?);
            ensure!(root.is_absolute(), "Invalid install root");
            let _held = Frozen::path(&root, Some(&root))?;
            Ok(root.canonicalize()?)
        })();
        RegCloseKey(key);
        result
    }
}
fn trusted_executable(root: &Path) -> Result<PathBuf> {
    let expected = root.join("bricks-bootstrap.exe");
    let _held = Frozen::path(&expected, Some(root))?;
    ensure!(
        std::env::current_exe()?.canonicalize()? == expected.canonicalize()?,
        "Broker must run from registered protected native root"
    );
    Ok(expected)
}

use crate::ipc::{self, MAX_FRAME};
const PIPE_CLIENT_ACCESS: u32 = FILE_GENERIC_READ | FILE_WRITE_DATA | FILE_WRITE_ATTRIBUTES;
struct Pipe {
    file: File,
    deadline: Instant,
}
impl Pipe {
    fn new(handle: Handle) -> Self {
        let raw = handle.0;
        std::mem::forget(handle);
        Self {
            file: unsafe { File::from_raw_handle(raw) },
            deadline: Instant::now() + Duration::from_secs(120),
        }
    }
    fn receive<T: serde::de::DeserializeOwned>(&mut self) -> Result<T> {
        let mut header = [0u8; 4];
        ipc::read_exact(&mut self.file, &mut header, self.deadline)?;
        let mut bytes = vec![0; ipc::frame_len(header)?];
        ipc::read_exact(&mut self.file, &mut bytes, self.deadline)?;
        ipc::decode(&bytes)
    }
    fn send<T: Serialize>(&mut self, value: &T) -> Result<()> {
        ipc::write_all(&mut self.file, &ipc::encode(value)?, self.deadline)
    }
}
use serde::Serialize;
use windows_sys::Win32::System::SystemServices::{
    ACCESS_ALLOWED_ACE_TYPE, ACCESS_DENIED_ACE_TYPE, SE_GROUP_LOGON_ID, SYSTEM_AUDIT_ACE_TYPE,
};
fn pipe_name(nonce: &str) -> Result<String> {
    ensure!(tree::digest_ok(nonce), "Invalid broker nonce");
    Ok(format!(r"\\.\pipe\BricksWar-Update-{nonce}"))
}
fn verify_pipe_caller(pipe: &Pipe, parent: &Handle, expected: &User) -> Result<()> {
    unsafe {
        let mut pid = 0;
        ok(GetNamedPipeClientProcessId(
            pipe.file.as_raw_handle(),
            &mut pid,
        ))?;
        ensure!(pid == GetProcessId(parent.0), "Foreign pipe process");
        ok(ImpersonateNamedPipeClient(pipe.file.as_raw_handle()))?;
        let checked = (|| {
            let mut token = std::ptr::null_mut();
            ok(OpenThreadToken(
                GetCurrentThread(),
                TOKEN_QUERY,
                1,
                &mut token,
            ))?;
            let token = handle(token)?;
            let actual = token_user(token.0)?;
            ensure!(
                actual.sid == expected.sid
                    && actual.logon == expected.logon
                    && actual.session == expected.session
                    && !actual.elevated,
                "Foreign/elevated IPC identity"
            );
            Ok(())
        })();
        ok(RevertToSelf())?;
        checked
    }
}
fn verify_proof(
    broker: &Broker,
    user: &User,
    plan: &installed::Prepared,
    proof: &Proof,
) -> Result<Handle> {
    let id = if proof.component == "launcher" {
        &plan.launcher
    } else {
        &plan.client
    };
    let expected = broker.executable(&proof.component, id)?.canonicalize()?;
    let process = process(proof.pid)?;
    live(&process)?;
    let actual = process_user(&process)?;
    ensure!(
        !actual.elevated
            && actual.sid == user.sid
            && actual.logon == user.logon
            && actual.session == user.session,
        "Candidate did not run in original user/session"
    );
    ensure!(
        image(&process)?.canonicalize()? == expected,
        "Foreign candidate executable"
    );
    Ok(process)
}
pub fn serve(nonce: &str, parent_pid: u32) -> Result<i32> {
    unsafe {
        let root = registered_root()?;
        let _root_guard = Frozen::path(&root, Some(&root))?;
        let executable = trusted_executable(&root)?;
        let own = process(std::process::id())?;
        ensure!(
            process_user(&own)?.elevated,
            "Broker server must be elevated"
        );
        let parent = process(parent_pid)?;
        live(&parent)?;
        let user = process_user(&parent)?;
        ensure!(!user.elevated, "Original parent must not be elevated");
        ensure!(
            image(&parent)?.canonicalize()? == executable.canonicalize()?,
            "Original parent is not the installed native root"
        );
        let sddl = format!(
            "O:BAG:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x{PIPE_CLIENT_ACCESS:08x};;;{})",
            user.logon
        );
        let mut descriptor = std::ptr::null_mut();
        ok(ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide(sddl).as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        ))?;
        let _memory = Local(descriptor);
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let raw = handle(CreateNamedPipeW(
            wide(pipe_name(nonce)?).as_ptr(),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            MAX_FRAME as u32,
            MAX_FRAME as u32,
            0,
            &attributes,
        ))?;
        let end = Instant::now() + Duration::from_secs(30);
        loop {
            live(&parent)?;
            if ConnectNamedPipe(raw.0, std::ptr::null_mut()) != 0
                || GetLastError() == ERROR_PIPE_CONNECTED
            {
                break;
            }
            let error = GetLastError();
            ensure!(
                matches!(error, ERROR_PIPE_LISTENING | ERROR_NO_DATA) && Instant::now() < end,
                "Broker connect failure: {error}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        let mut pipe = Pipe::new(raw);
        let request: Request = pipe.receive()?;
        verify_pipe_caller(&pipe, &parent, &user)?;
        let Request::Prepare {
            nonce: request_nonce,
            sources,
        } = request
        else {
            bail!("Prepare must be first");
        };
        ensure!(request_nonce == nonce, "Foreign transaction");
        installed::validate_sources(&sources)?;
        let mut guards = Vec::new();
        for source in &sources {
            guards.push(Frozen::signed_source(&source.path, &source.component)?);
        }
        let mut broker = Broker::open(&root)?;
        let plan = broker.prepare(nonce.to_owned(), sources)?;
        for target in &plan.targets {
            let path = root
                .join(&target.component)
                .join("slots")
                .join(&target.identity.digest);
            protect_payload(&path)?;
            guards.push(Frozen::tree(&path, Some(&root))?);
        }
        // Also freeze/audit the retained component used by a single-component update.
        for (component, id) in [("launcher", &plan.launcher), ("client", &plan.client)] {
            guards.push(Frozen::tree(
                &root.join(component).join("slots").join(&id.digest),
                Some(&root),
            )?);
        }
        // Keep all source/destination handles through commit.
        pipe.send(&Response::Prepared { plan: plan.clone() })?;
        pipe.deadline = Instant::now() + engine::HEALTH_HORIZON + Duration::from_secs(10);
        let request: Request = pipe.receive()?;
        live(&parent)?;
        verify_pipe_caller(&pipe, &parent, &user)?;
        match request {
            Request::Healthy { nonce, proofs } => {
                installed::validate_proofs(&plan, &nonce, &proofs)?;
                let mut candidates = Vec::new();
                for proof in &proofs {
                    candidates.push(verify_proof(&broker, &user, &plan, proof)?);
                }
                // Retain object identities across all expensive image/hash checks,
                // and recheck both candidates and the original parent at decision.
                live(&parent)?;
                for candidate in &candidates {
                    live(candidate)?;
                }
                broker.commit(&nonce, &proofs)?;
                pipe.send(&Response::Committed { nonce })?;
            }
            Request::Abort { nonce } => {
                broker.abort(&nonce)?;
                pipe.send(&Response::Aborted { nonce })?;
            }
            _ => bail!("Repeated prepare"),
        }
        Ok(0)
    }
}

fn update_inner(sources: Vec<Source>, args: &[String]) -> Result<i32> {
    unsafe {
        crate::platform::ensure_user_launch()?;
        let root = registered_root()?;
        let executable = trusted_executable(&root)?;
        let nonce = engine::random()?;
        let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
        let verb = wide("runas");
        let file = wide(&executable);
        let parameters = wide(format!("broker-server {nonce} {}", std::process::id()));
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = parameters.as_ptr();
        info.nShow = 0;
        // Cancelled elevation follows the same original-user fallback path.
        if ShellExecuteExW(&mut info) == 0 {
            let mut lane = engine::Lane::open_installed(&root, "launcher")?;
            return lane.run(args, None);
        }
        let helper = handle(info.hProcess)?;
        let end = Instant::now() + Duration::from_secs(30);
        let mut raw;
        loop {
            live(&helper)?;
            raw = CreateFileW(
                wide(pipe_name(&nonce)?).as_ptr(),
                PIPE_CLIENT_ACCESS,
                0,
                std::ptr::null(),
                OPEN_EXISTING,
                SECURITY_SQOS_PRESENT | SECURITY_IMPERSONATION,
                std::ptr::null_mut(),
            );
            if raw != INVALID_HANDLE_VALUE {
                break;
            }
            ensure!(Instant::now() < end, "Elevated broker did not become ready");
            std::thread::sleep(Duration::from_millis(20));
        }
        let mut pipe = Pipe::new(handle(raw)?);
        let mode = PIPE_READMODE_BYTE | PIPE_NOWAIT;
        ok(SetNamedPipeHandleState(
            pipe.file.as_raw_handle(),
            &mode,
            std::ptr::null(),
            std::ptr::null(),
        ))?;
        let mut server = 0;
        ok(GetNamedPipeServerProcessId(
            pipe.file.as_raw_handle(),
            &mut server,
        ))?;
        ensure!(server == GetProcessId(helper.0), "Foreign broker server");
        pipe.send(&Request::Prepare {
            nonce: nonce.clone(),
            sources,
        })?;
        let Response::Prepared { plan } = pipe.receive::<Response>()? else {
            bail!("Broker did not prepare target");
        };
        installed::validate_plan(&plan)?;
        ensure!(plan.nonce == nonce, "Foreign prepared plan");
        let mut lane = engine::Lane::open_installed(&root, "launcher")?;
        // Scope candidate selection to this exact trusted native core child. No
        // renderer or elevated helper receives a command line to launch the game.
        let previous = std::env::var_os("BRICKS_BOOTSTRAP_CANDIDATE_CLIENT");
        std::env::set_var(
            "BRICKS_BOOTSTRAP_CANDIDATE_CLIENT",
            serde_json::to_string(&plan.client)?,
        );
        let result = lane.external_launch(&plan.launcher, &nonce, args, |pid, health| {
            let mut proofs = health.children.clone();
            proofs.push(Proof {
                component: "launcher".into(),
                nonce: nonce.clone(),
                digest: plan.launcher.digest.clone(),
                pid,
            });
            installed::validate_proofs(&plan, &nonce, &proofs)?;
            pipe.send(&Request::Healthy {
                nonce: nonce.clone(),
                proofs,
            })?;
            let reply: Response = pipe.receive()?;
            ensure!(
                matches!(reply,Response::Committed{nonce:ref value} if value==&nonce),
                "Commit was not acknowledged"
            );
            Ok(())
        });
        match previous {
            Some(value) => std::env::set_var("BRICKS_BOOTSTRAP_CANDIDATE_CLIENT", value),
            None => std::env::remove_var("BRICKS_BOOTSTRAP_CANDIDATE_CLIENT"),
        };
        match result {
            Ok(code) => Ok(code),
            Err(error) => {
                let _ = pipe.send(&Request::Abort { nonce });
                drop(lane);
                eprintln!("Native update failed; starting retained working version: {error}");
                let mut lane = engine::Lane::open_installed(&root, "launcher")?;
                lane.run(args, None)
            }
        }
    }
}
pub fn audit_install() -> Result<i32> {
    let root = registered_root()?;
    trusted_executable(&root)?;
    for component in ["launcher", "client"] {
        let lane = engine::Lane::open(&root, component)?;
        let active = lane
            .state
            .active
            .as_ref()
            .context("Missing installed baseline")?;
        let path = root.join(component).join("slots").join(&active.digest);
        let _held = Frozen::tree(&path, Some(&root))?;
        lane.tree(active)?;
    }
    Ok(0)
}

pub fn update(sources: Vec<Source>, args: &[String]) -> Result<i32> {
    crate::platform::ensure_user_launch()?;
    match update_inner(sources, args) {
        Ok(code) => Ok(code),
        Err(error) => {
            eprintln!("Native preparation failed; original-user fallback: {error}");
            let root = registered_root()?;
            let mut lane = engine::Lane::open_installed(&root, "launcher")?;
            lane.run(args, None)
        }
    }
}
pub fn spawn_controlled(
    command: &mut std::process::Command,
) -> Result<crate::platform::ManagedChild> {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::{Diagnostics::ToolHelp::*, JobObjects::*};
    unsafe {
        let job = handle(CreateJobObjectW(std::ptr::null(), std::ptr::null()))?;
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
        ok(SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of_val(&limits) as u32,
        ))?;
        // Suspend before ANY signed payload code runs. Job assignment cannot race a
        // core spawning the game; descendants inherit the kill-on-close job.
        command.creation_flags(CREATE_SUSPENDED);
        let mut child = command.spawn()?;
        let resumed = (|| {
            ok(AssignProcessToJobObject(job.0, child.as_raw_handle()))?;
            let snapshot = handle(CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0))?;
            let mut entry: THREADENTRY32 = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
            let mut found = Vec::new();
            let mut more = Thread32First(snapshot.0, &mut entry);
            while more != 0 {
                if entry.th32OwnerProcessID == child.id() {
                    found.push(entry.th32ThreadID);
                }
                more = Thread32Next(snapshot.0, &mut entry);
            }
            ensure!(
                found.len() == 1,
                "Suspended child must have exactly one initial thread"
            );
            let thread = handle(OpenThread(
                THREAD_SUSPEND_RESUME | THREAD_QUERY_LIMITED_INFORMATION,
                0,
                found[0],
            ))?;
            ensure!(
                GetProcessIdOfThread(thread.0) == child.id(),
                "Foreign initial thread"
            );
            ensure!(
                ResumeThread(thread.0) == 1,
                "Cannot safely resume initial thread"
            );
            Ok(())
        })();
        if let Err(error) = resumed {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Ok(crate::platform::ManagedChild {
            child,
            job: Some(job),
        })
    }
}

pub fn elevated() -> Result<bool> {
    let own = process(std::process::id())?;
    Ok(process_user(&own)?.elevated)
}
pub fn exclusive_protected_file(path: &Path) -> Result<File> {
    unsafe {
        let mut descriptor = std::ptr::null_mut();
        ok(ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide(SECURITY).as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        ))?;
        let _memory = Local(descriptor);
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let value = CreateFileW(
            wide(path).as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            &attributes,
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        );
        if value == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(File::from_raw_handle(value))
    }
}

pub fn escape_worker(args: &[String]) -> Result<bool> {
    use std::os::windows::process::CommandExt;
    unsafe {
        let mut in_job = 0;
        ok(windows_sys::Win32::System::JobObjects::IsProcessInJob(
            GetCurrentProcess(),
            std::ptr::null_mut(),
            &mut in_job,
        ))?;
        if in_job == 0 {
            return Ok(false);
        }
        ensure!(
            std::env::var("BRICKS_BOOTSTRAP_WORKER_ESCAPED").as_deref() != Ok("1"),
            "Worker could not leave old payload job"
        );
        let mut command = std::process::Command::new(std::env::current_exe()?);
        command
            .args(args)
            .env("BRICKS_BOOTSTRAP_WORKER_ESCAPED", "1")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(CREATE_BREAKAWAY_FROM_JOB | DETACHED_PROCESS);
        command.spawn()?;
        Ok(true)
    }
}

pub fn prepare_user_profile(root: &Path) -> Result<()> {
    let remembered = engine::health_root()?.join("profile.json");
    if remembered.exists() {
        return engine::check_profile(&engine::original_profile()?);
    }
    let profile = if let Some(profile) = std::env::var_os("BRICKS_BOOTSTRAP_PROFILE") {
        PathBuf::from(profile)
    } else {
        let id = installed::committed_identity(root, "client")?
            .or({
                let state: engine::State = serde_json::from_slice(&tree::bounded(
                    &root.join("client/state.json"),
                    1024 * 1024,
                )?)?;
                state.active
            })
            .context("Missing initial client")?;
        let payload = root.join("client/slots").join(id.digest);
        let verified = tree::verify(&payload, "client")?;
        let _held = Frozen::tree(&payload, Some(root))?;
        engine::profile_from_tree(&verified)?
    };
    engine::remember_profile(&profile)
}

pub fn register_install() -> Result<i32> {
    unsafe {
        ensure!(elevated()?, "Installation registration requires elevation");
        let executable = std::env::current_exe()?;
        ensure!(
            executable
                .file_name()
                .is_some_and(|v| v == "bricks-bootstrap.exe"),
            "Wrong native installation executable"
        );
        let root = executable
            .parent()
            .context("Missing install directory")?
            .canonicalize()?;
        let _guard = Frozen::tree(&root, Some(&root))?;
        for component in ["launcher", "client"] {
            let state: engine::State = serde_json::from_slice(&tree::bounded(
                &root.join(component).join("state.json"),
                1024 * 1024,
            )?)?;
            let id = state.active.context("Incomplete native seed")?;
            let verified = tree::verify(
                &root.join(component).join("slots").join(&id.digest),
                component,
            )?;
            ensure!(
                engine::Identity::from(&verified) == id,
                "Seed identity mismatch"
            );
            if component == "client" {
                ensure!(
                    verified.manifest.profile_probe_abi == Some(1),
                    "Migration client lacks original-profile probe"
                );
            }
        }
        let mut descriptor = std::ptr::null_mut();
        ok(ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide(SECURITY).as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        ))?;
        let _memory = Local(descriptor);
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let mut key = std::ptr::null_mut();
        let result = RegCreateKeyExW(
            HKEY_LOCAL_MACHINE,
            wide(registry()?).as_ptr(),
            0,
            std::ptr::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_READ | KEY_WRITE | KEY_WOW64_64KEY,
            &attributes,
            &mut key,
            std::ptr::null_mut(),
        );
        ensure!(
            result == 0,
            "Cannot create protected installation registration: {result}"
        );
        let result = (|| {
            audit(key, SE_REGISTRY_KEY)?;
            let text = wide(&root);
            let result = RegSetValueExW(
                key,
                wide("InstallRoot").as_ptr(),
                0,
                REG_SZ,
                text.as_ptr().cast(),
                (text.len() * 2) as u32,
            );
            ensure!(result == 0, "Cannot write native registration: {result}");
            ensure!(RegFlushKey(key) == 0, "Cannot flush native registration");
            Ok(0)
        })();
        RegCloseKey(key);
        result
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct InstallerSeed {
    schema: u32,
    game: String,
    component: String,
    platform: String,
    root_abi: u32,
    root_sha256: String,
    legacy_entry: String,
    legacy_sha256: String,
    launcher: engine::Identity,
    client: engine::Identity,
}
fn binary_hash(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(tree::hex(&hasher.finalize()))
}
pub fn installer_register(destination: &Path) -> Result<i32> {
    unsafe {
        ensure!(elevated()?, "Installer handoff requires elevation");
        ensure!(
            destination.is_absolute() && destination.file_name().is_some_and(|v| v == "native"),
            "Installer destination must be a new dedicated native subtree"
        );
        let own = std::env::current_exe()?;
        let private = own
            .parent()
            .context("Missing private installer directory")?;
        let seed: InstallerSeed = tree::signed_record(&private.join("seed-manifest.json"))?;
        ensure!(
            seed.schema == 1
                && seed.game == "bricks-war"
                && seed.component == "native-seed"
                && seed.platform == "win32"
                && seed.root_abi == 1,
            "Wrong signed installer seed"
        );
        ensure!(
            tree::digest_ok(&seed.root_sha256) && binary_hash(&own)? == seed.root_sha256,
            "Installer helper does not match signed seed"
        );
        let source = private.join("native-seed");
        let mut source_guards = vec![
            Frozen::path(&source, None)?,
            Frozen::path(&source.join("bricks-bootstrap.exe"), None)?,
        ];
        for item in std::fs::read_dir(&source)? {
            let name = item?.file_name();
            ensure!(
                ["bricks-bootstrap.exe", "launcher", "client"]
                    .iter()
                    .any(|expected| name == *expected),
                "Unexpected migration seed data"
            );
        }
        ensure!(
            binary_hash(&source.join("bricks-bootstrap.exe"))? == seed.root_sha256,
            "Embedded native root was substituted"
        );
        let mut components = Vec::new();
        for (component, id) in [("launcher", &seed.launcher), ("client", &seed.client)] {
            source_guards.push(Frozen::path(
                &source.join(component).join("state.json"),
                None,
            )?);
            let slot = source.join(component).join("slots").join(&id.digest);
            source_guards.push(Frozen::signed_source(&slot, component)?);
            let state: engine::State = serde_json::from_slice(&tree::bounded(
                &source.join(component).join("state.json"),
                1024 * 1024,
            )?)?;
            ensure!(
                state.active.as_ref() == Some(id)
                    && state.previous.is_none()
                    && state.prepared.is_none()
                    && state.pending.is_none()
                    && state.running.is_none()
                    && state.failed.is_empty()
                    && state.high_sequence == id.sequence,
                "Changed initial state"
            );
            let verified = tree::verify(
                &source.join(component).join("slots").join(&id.digest),
                component,
            )?;
            ensure!(
                engine::Identity::from(&verified) == *id,
                "Changed signed migration payload"
            );
            if component == "client" {
                ensure!(
                    verified.manifest.profile_probe_abi == Some(1),
                    "Missing original-profile probe"
                );
            }
            components.push((component, verified, state));
        }
        let parent = destination
            .parent()
            .context("Missing installation directory")?;
        let _parent = Frozen::path(parent, Some(parent))?;
        ensure!(
            legacy_root()? == parent.canonicalize()?,
            "Migration destination differs from registered legacy root"
        );
        let backup = rollback_root(parent)?;
        let _baseline = Frozen::tree(&backup, Some(&backup))?;
        let baseline: crate::legacy::Baseline = serde_json::from_slice(&tree::bounded(
            &backup.join("complete.json"),
            32 * 1024 * 1024,
        )?)?;
        ensure!(
            baseline.target == parent.canonicalize()?,
            "Missing original working-version baseline"
        );
        crate::legacy::require_admission(&baseline)?;
        crate::legacy::verify(&backup.join("app"), &baseline)?;

        ensure!(
            !seed.legacy_entry.is_empty()
                && !seed.legacy_entry.contains(['/', '\\', ':'])
                && seed.legacy_entry.to_ascii_lowercase().ends_with(".exe")
                && tree::digest_ok(&seed.legacy_sha256),
            "Invalid signed legacy entry"
        );
        let legacy = parent.join(&seed.legacy_entry);
        let legacy_guard = Frozen::path(&legacy, Some(parent))?;
        ensure!(
            binary_hash(&legacy)? == seed.legacy_sha256,
            "Legacy entry differs from migration seed"
        );
        let client = &components
            .iter()
            .find(|(component, _, _)| *component == "client")
            .unwrap()
            .1;
        ensure!(
            client.manifest.entry == seed.legacy_entry,
            "Wrong migration entrypoint"
        );
        ensure!(
            binary_hash(&client.path.join(&seed.legacy_entry))? == seed.legacy_sha256,
            "Wrong signed legacy bytes"
        );

        // Do not repurpose a pre-existing directory or modify foreign ACLs. The
        // stable root and all payloads are first created with a protected descriptor.
        ensure!(
            !destination.exists(),
            "Native destination already exists; no files were overwritten"
        );
        let mut descriptor = std::ptr::null_mut();
        ok(ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide(SECURITY).as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        ))?;
        let _memory = Local(descriptor);
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        ok(CreateDirectoryW(wide(destination).as_ptr(), &attributes))?;
        // Copy only authenticated inventories and independently validated control
        // state. Never recursively copy unsigned entries from a mutable seed root.
        let mut root_file = exclusive_protected_file(&destination.join("bricks-bootstrap.exe"))?;
        let mut root_input = File::open(source.join("bricks-bootstrap.exe"))?;
        std::io::copy(&mut root_input, &mut root_file)?;
        root_file.sync_all()?;
        drop(root_file);
        for (component, verified, state) in &components {
            let lane = destination.join(component);
            std::fs::create_dir_all(lane.join("slots"))?;
            tree::copy(verified, &lane.join("slots").join(&verified.digest))?;
            engine::write_atomic(&lane.join("state.json"), state)?;
        }
        protect_payload(destination)?;
        let root = destination.canonicalize()?;
        let _protected = Frozen::tree(&root, Some(&root))?;
        ensure!(
            binary_hash(&root.join("bricks-bootstrap.exe"))? == seed.root_sha256,
            "Copied root mismatch"
        );
        for (component, id) in [("launcher", &seed.launcher), ("client", &seed.client)] {
            let verified = tree::verify(
                &root.join(component).join("slots").join(&id.digest),
                component,
            )?;
            ensure!(
                engine::Identity::from(&verified) == *id,
                "Copied payload mismatch"
            );
        }
        let mut key = std::ptr::null_mut();
        let result = RegCreateKeyExW(
            HKEY_LOCAL_MACHINE,
            wide(registry()?).as_ptr(),
            0,
            std::ptr::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_READ | KEY_WRITE | KEY_WOW64_64KEY,
            &attributes,
            &mut key,
            std::ptr::null_mut(),
        );
        ensure!(result == 0, "Cannot register native migration: {result}");
        let result = (|| {
            audit(key, SE_REGISTRY_KEY)?;
            let value = wide(&root);
            ensure!(
                RegSetValueExW(
                    key,
                    wide("InstallRoot").as_ptr(),
                    0,
                    REG_SZ,
                    value.as_ptr().cast(),
                    (value.len() * 2) as u32
                ) == 0,
                "Cannot write install identity"
            );
            ensure!(RegFlushKey(key) == 0, "Cannot flush install identity");
            // The private elevated helper only installs bytes; no game payload is
            // launched. Keep the legacy path so old-helper rollback restores it.
            let temporary = parent.join(format!(".bricks-native-{}.exe", engine::random()?));
            let mut file = exclusive_protected_file(&temporary)?;
            let mut input = File::open(root.join("bricks-bootstrap.exe"))?;
            std::io::copy(&mut input, &mut file)?;
            file.sync_all()?;
            drop(file);
            drop(legacy_guard);
            // Parent and all ancestors remain pinned/protected across replacement.
            ensure!(
                binary_hash(&legacy)? == seed.legacy_sha256,
                "Legacy entry changed before activation"
            );
            crate::platform::replace(&temporary, &legacy)?;
            Ok(0)
        })();
        RegCloseKey(key);
        result
    }
}

// The one-time migration baseline lives beside the registered legacy app, never
// in user update storage. No destination/source argument is accepted here.
fn legacy_registry() -> Result<String> {
    let base = "Software\\e5919a2e-5a63-5e06-80d4-8586e169f51c";
    #[cfg(feature = "fixture")]
    {
        Ok(format!("{base}-QA-{}", &tree::key_fingerprint()?[..16]))
    }
    #[cfg(not(feature = "fixture"))]
    {
        Ok(base.to_owned())
    }
}
fn legacy_registration_keys() -> Result<[String; 2]> {
    let app = legacy_registry()?;
    let guid = app
        .strip_prefix("Software\\")
        .context("Wrong legacy registration")?;
    Ok([
        app.clone(),
        format!("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{guid}"),
    ])
}
fn snapshot_legacy_registration() -> Result<Vec<Vec<crate::legacy::RegistryValue>>> {
    unsafe {
        let mut snapshots = Vec::new();
        for name in legacy_registration_keys()? {
            let mut key = std::ptr::null_mut();
            ensure!(
                RegOpenKeyExW(
                    HKEY_LOCAL_MACHINE,
                    wide(name).as_ptr(),
                    0,
                    KEY_READ | KEY_WOW64_64KEY,
                    &mut key
                ) == 0,
                "Legacy registration unavailable"
            );
            let result = (|| {
                audit(key, SE_REGISTRY_KEY)?;
                let mut values = Vec::new();
                for index in 0..129 {
                    let mut name = vec![0u16; 16384];
                    let mut length = name.len() as u32;
                    let mut bytes = vec![0u8; 65536];
                    let mut size = bytes.len() as u32;
                    let mut kind = 0;
                    let result = RegEnumValueW(
                        key,
                        index,
                        name.as_mut_ptr(),
                        &mut length,
                        std::ptr::null(),
                        &mut kind,
                        bytes.as_mut_ptr(),
                        &mut size,
                    );
                    if result == ERROR_NO_MORE_ITEMS {
                        return Ok(values);
                    }
                    ensure!(
                        result == 0
                            && index < 128
                            && matches!(kind, REG_SZ | REG_EXPAND_SZ | REG_DWORD),
                        "Unsupported/oversized legacy registration"
                    );
                    name.truncate(length as usize);
                    bytes.truncate(size as usize);
                    values.push(crate::legacy::RegistryValue {
                        name: String::from_utf16(&name)?,
                        kind,
                        bytes,
                    });
                }
                bail!("Oversized legacy registration")
            })();
            RegCloseKey(key);
            snapshots.push(result?);
        }
        Ok(snapshots)
    }
}
fn restore_legacy_registration(baseline: &crate::legacy::Baseline) -> Result<()> {
    ensure!(
        baseline.registration.len() == 2,
        "Incomplete original install registration"
    );
    unsafe {
        let mut descriptor = std::ptr::null_mut();
        ok(ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide(SECURITY).as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        ))?;
        let _memory = Local(descriptor);
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        for (name, values) in legacy_registration_keys()?
            .iter()
            .zip(&baseline.registration)
        {
            let mut key = std::ptr::null_mut();
            ensure!(
                RegCreateKeyExW(
                    HKEY_LOCAL_MACHINE,
                    wide(name).as_ptr(),
                    0,
                    std::ptr::null(),
                    REG_OPTION_NON_VOLATILE,
                    KEY_READ | KEY_WRITE | KEY_WOW64_64KEY,
                    &attributes,
                    &mut key,
                    std::ptr::null_mut()
                ) == 0,
                "Cannot restore original install registration"
            );
            let result = (|| {
                audit(key, SE_REGISTRY_KEY)?;
                ensure!(values.len() <= 128, "Oversized saved registration");
                for value in values {
                    ensure!(
                        value.name.len() <= 16384
                            && !value.name.contains('\0')
                            && value.bytes.len() <= 65536
                            && matches!(value.kind, REG_SZ | REG_EXPAND_SZ | REG_DWORD),
                        "Invalid saved registration"
                    );
                    ensure!(
                        RegSetValueExW(
                            key,
                            wide(&value.name).as_ptr(),
                            0,
                            value.kind,
                            value.bytes.as_ptr(),
                            value.bytes.len() as u32
                        ) == 0,
                        "Cannot restore legacy registration value"
                    );
                }
                ensure!(RegFlushKey(key) == 0, "Cannot flush restored registration");
                Ok(())
            })();
            RegCloseKey(key);
            result?;
        }
    }
    Ok(())
}
fn legacy_root() -> Result<PathBuf> {
    unsafe {
        let mut key = std::ptr::null_mut();
        ensure!(
            RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                wide(legacy_registry()?).as_ptr(),
                0,
                KEY_READ | KEY_WOW64_64KEY,
                &mut key
            ) == 0,
            "Registered all-users legacy installation required"
        );
        let result = (|| {
            audit(key, SE_REGISTRY_KEY)?;
            let mut text = vec![0u16; 32768];
            let mut size = (text.len() * 2) as u32;
            ensure!(
                RegGetValueW(
                    key,
                    std::ptr::null(),
                    wide("InstallLocation").as_ptr(),
                    RRF_RT_REG_SZ,
                    std::ptr::null_mut(),
                    text.as_mut_ptr().cast(),
                    &mut size
                ) == 0
                    && size >= 4
                    && size % 2 == 0,
                "Invalid legacy install location"
            );
            text.truncate(size as usize / 2);
            ensure!(text.pop() == Some(0), "Unterminated legacy path");
            let root = PathBuf::from(String::from_utf16(&text)?);
            ensure!(
                root.is_absolute() && root.file_name().is_some(),
                "Invalid legacy root"
            );
            let _parent =
                Frozen::path(root.parent().context("Missing legacy parent")?, Some(&root))?;
            Ok(root.canonicalize()?)
        })();
        RegCloseKey(key);
        result
    }
}
fn rollback_root(target: &Path) -> Result<PathBuf> {
    let mut name = target
        .file_name()
        .context("Missing legacy name")?
        .to_os_string();
    name.push(".bricks-rollback");
    Ok(target.with_file_name(name))
}
fn protected_directory(path: &Path) -> Result<()> {
    unsafe {
        let mut descriptor = std::ptr::null_mut();
        ok(ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide(SECURITY).as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        ))?;
        let _memory = Local(descriptor);
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        ok(CreateDirectoryW(wide(path).as_ptr(), &attributes))
    }
}
fn rollback_registration(value: Option<&Path>) -> Result<PathBuf> {
    unsafe {
        let mut descriptor = std::ptr::null_mut();
        ok(ConvertStringSecurityDescriptorToSecurityDescriptorW(
            wide(SECURITY).as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        ))?;
        let _memory = Local(descriptor);
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let name = format!("{}-LegacyRollback", registry()?);
        let mut key = std::ptr::null_mut();
        let result = if value.is_some() {
            RegCreateKeyExW(
                HKEY_LOCAL_MACHINE,
                wide(name).as_ptr(),
                0,
                std::ptr::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_READ | KEY_WRITE | KEY_WOW64_64KEY,
                &attributes,
                &mut key,
                std::ptr::null_mut(),
            )
        } else {
            RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                wide(name).as_ptr(),
                0,
                KEY_READ | KEY_WOW64_64KEY,
                &mut key,
            )
        };
        ensure!(result == 0, "Protected rollback registration unavailable");
        let result = (|| {
            audit(key, SE_REGISTRY_KEY)?;
            if let Some(path) = value {
                let text = wide(path);
                ensure!(
                    RegSetValueExW(
                        key,
                        wide("BackupRoot").as_ptr(),
                        0,
                        REG_SZ,
                        text.as_ptr().cast(),
                        (text.len() * 2) as u32
                    ) == 0,
                    "Cannot register rollback baseline"
                );
                ensure!(
                    RegFlushKey(key) == 0,
                    "Cannot flush rollback baseline registration"
                );
                return Ok(path.to_path_buf());
            }
            let mut text = vec![0u16; 32768];
            let mut size = (text.len() * 2) as u32;
            ensure!(
                RegGetValueW(
                    key,
                    std::ptr::null(),
                    wide("BackupRoot").as_ptr(),
                    RRF_RT_REG_SZ,
                    std::ptr::null_mut(),
                    text.as_mut_ptr().cast(),
                    &mut size
                ) == 0
                    && size >= 4
                    && size % 2 == 0,
                "Invalid rollback registration"
            );
            text.truncate(size as usize / 2);
            ensure!(text.pop() == Some(0), "Unterminated rollback path");
            Ok(PathBuf::from(String::from_utf16(&text)?))
        })();
        RegCloseKey(key);
        result
    }
}
pub fn installer_prepare() -> Result<i32> {
    ensure!(elevated()?, "Migration preparation requires elevation");
    let own = std::env::current_exe()?;
    let private = own
        .parent()
        .context("Missing private installer directory")?;
    let seed: InstallerSeed = tree::signed_record(&private.join("seed-manifest.json"))?;
    ensure!(
        seed.schema == 1
            && seed.game == "bricks-war"
            && seed.component == "native-seed"
            && seed.platform == "win32"
            && seed.root_abi == 1
            && binary_hash(&own)? == seed.root_sha256,
        "Invalid private migration helper"
    );
    let target = legacy_root()?;
    let _parent = Frozen::path(target.parent().unwrap(), Some(&target))?;
    // Before creating any readable backup, verify public read access on each
    // pinned original object. Restrictive installations fail without a copy.
    let _source = Frozen::public_tree(&target, &target)?;
    ensure!(
        !target.join("native").exists(),
        "Already-native installation cannot be migrated again"
    );
    let backup = rollback_root(&target)?;
    // A cancelled installer can reuse an identical complete baseline. Never
    // overwrite a prior/incomplete baseline or accept changed installed bytes.
    if backup.exists() {
        let _existing = Frozen::tree(&backup, Some(&backup))?;
        let baseline: crate::legacy::Baseline = serde_json::from_slice(&tree::bounded(
            &backup.join("complete.json"),
            32 * 1024 * 1024,
        )?)?;
        ensure!(
            baseline.target == target
                && baseline.registration.len() == 2
                && binary_hash(&backup.join("restore.exe"))? == seed.root_sha256,
            "Existing migration baseline requires recovery"
        );
        crate::legacy::require_admission(&baseline)?;
        crate::legacy::verify(&backup.join("app"), &baseline)?;
        crate::legacy::verify(&target, &baseline)?;
        let current = crate::legacy::inventory(&target)?;
        ensure!(
            current.files.len() == baseline.files.len(),
            "Installed tree changed since baseline"
        );
        rollback_registration(Some(&backup))?;
        return Ok(0);
    }
    let mut baseline = crate::legacy::inventory(&target)?;
    baseline.public_read_attested = true;
    baseline.registration = snapshot_legacy_registration()?;
    protected_directory(&backup)?;
    protected_directory(&backup.join("app"))?;
    crate::legacy::copy(&target, &backup.join("app"), &baseline)?;
    let mut helper = exclusive_protected_file(&backup.join("restore.exe"))?;
    std::io::copy(&mut File::open(&own)?, &mut helper)?;
    helper.sync_all()?;
    drop(helper);
    ensure!(
        binary_hash(&backup.join("restore.exe"))? == seed.root_sha256,
        "Changed recovery helper"
    );
    // Complete record is last and durable; failure before it leaves the installed
    // working version untouched and a visibly incomplete baseline.
    crate::legacy::save(&backup.join("complete.json"), &baseline)?;
    protect_payload(&backup)?;
    let _protected = Frozen::tree(&backup, Some(&backup))?;
    rollback_registration(Some(&backup))?;
    Ok(0)
}
fn require_legacy_payloads_stopped(target: &Path) -> Result<()> {
    // The unelevated parent stops only its original-session candidates. Never
    // use elevation to kill another user's working game during migration.
    let system = sysinfo::System::new_all();
    for pid in system.processes().keys() {
        let Ok(process) = process(pid.as_u32()) else {
            continue;
        };
        let Ok(executable) = image(&process) else {
            continue;
        };
        let Ok(executable) = executable.canonicalize() else {
            continue;
        };
        ensure!(
            !executable.starts_with(target),
            "Installation payload still running; baseline retained"
        );
    }
    Ok(())
}
pub fn installer_restore() -> Result<i32> {
    ensure!(elevated()?, "Migration recovery requires elevation");
    let own = std::env::current_exe()?;
    let backup = own
        .parent()
        .context("Missing protected recovery directory")?
        .to_path_buf();
    let registered = rollback_registration(None)?;
    let _registered = Frozen::path(&registered, Some(&registered))?;
    ensure!(
        backup.canonicalize()? == registered.canonicalize()?,
        "Recovery helper differs from protected registration"
    );
    let _backup = Frozen::path(&backup, Some(&backup))?;
    let _saved = Frozen::tree(&backup.join("app"), Some(&backup))?;
    let _record = Frozen::path(&backup.join("complete.json"), Some(&backup))?;
    let _helper = Frozen::path(&own, Some(&backup))?;
    ensure!(
        own.file_name().is_some_and(|name| name == "restore.exe"),
        "Recovery requires the protected baseline helper"
    );
    let baseline: crate::legacy::Baseline = serde_json::from_slice(&tree::bounded(
        &backup.join("complete.json"),
        32 * 1024 * 1024,
    )?)?;
    let target = baseline.target.clone();
    ensure!(
        rollback_root(&target)?.canonicalize()? == backup.canonicalize()?,
        "Baseline belongs to another installation"
    );
    let _parent = Frozen::path(
        target.parent().context("Missing legacy parent")?,
        Some(&target),
    )?;
    crate::legacy::require_admission(&baseline)?;
    crate::legacy::verify(&backup.join("app"), &baseline)?;
    let stage = backup.join(format!("restore-{}", engine::random()?));
    protected_directory(&stage)?;
    crate::legacy::copy(&backup.join("app"), &stage, &baseline)?;
    // Freeze/audit the current tree before stopping or removing anything. Reparse,
    // untrusted writable and hardlinked installed files fail closed.
    let existing = if target.exists() {
        Some(Frozen::tree(&target, Some(&target))?)
    } else {
        None
    };
    let canonical = if target.exists() {
        target.canonicalize()?
    } else {
        target.clone()
    };
    require_legacy_payloads_stopped(&canonical)?;
    drop(existing);
    let displaced = backup.join(format!("displaced-{}", engine::random()?));
    if target.exists() {
        std::fs::rename(&target, &displaced)?;
    }
    // Baseline and displaced tree remain available if interrupted at either rename.
    std::fs::rename(&stage, &target)?;
    crate::legacy::verify(&target, &baseline)?;
    restore_legacy_registration(&baseline)?;
    unsafe {
        let mut key = std::ptr::null_mut();
        let opened = RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            wide(registry()?).as_ptr(),
            0,
            KEY_READ | KEY_WRITE | KEY_WOW64_64KEY,
            &mut key,
        );
        ensure!(
            opened == 0 || opened == ERROR_FILE_NOT_FOUND,
            "Cannot inspect migrated registration during restore"
        );
        if opened == 0 {
            let result = (|| {
                audit(key, SE_REGISTRY_KEY)?;
                let mut value = vec![0u16; 32768];
                let mut size = (value.len() * 2) as u32;
                let present = RegGetValueW(
                    key,
                    std::ptr::null(),
                    wide("InstallRoot").as_ptr(),
                    RRF_RT_REG_SZ,
                    std::ptr::null_mut(),
                    value.as_mut_ptr().cast(),
                    &mut size,
                );
                if present == 0 {
                    ensure!(
                        size >= 4 && size % 2 == 0,
                        "Invalid native registration during restore"
                    );
                    value.truncate(size as usize / 2);
                    ensure!(
                        value.pop() == Some(0),
                        "Invalid native registration terminator"
                    );
                    ensure!(
                        PathBuf::from(String::from_utf16(&value)?) == target.join("native"),
                        "Another native installation owns registration"
                    );
                    ensure!(
                        RegDeleteValueW(key, wide("InstallRoot").as_ptr()) == 0,
                        "Cannot clear migrated registration"
                    );
                } else {
                    ensure!(
                        present == ERROR_FILE_NOT_FOUND,
                        "Cannot read migrated registration"
                    );
                }
                ensure!(RegFlushKey(key) == 0, "Cannot flush migration recovery");
                Ok(())
            })();
            RegCloseKey(key);
            result?;
        }
    }
    // Retain the protected original baseline for interruption/recovery review;
    // user profile/storage was never part of these paths.
    if displaced.exists() {
        std::fs::remove_dir_all(&displaced)?;
    }
    Ok(0)
}
