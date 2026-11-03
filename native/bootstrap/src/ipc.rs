//! The same bounded, strict framing is used by the Win32 transport and tests.
use anyhow::{Result, ensure};
use serde::{Serialize, de::DeserializeOwned};
pub const MAX_FRAME: usize = 65536;
pub fn frame_len(header: [u8; 4]) -> Result<usize> {
    let size = u32::from_le_bytes(header) as usize;
    ensure!(size > 0 && size <= MAX_FRAME, "Invalid IPC frame size");
    Ok(size)
}
pub fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T> {
    ensure!(
        !bytes.is_empty() && bytes.len() <= MAX_FRAME,
        "Invalid IPC payload size"
    );
    Ok(serde_json::from_slice(bytes)?)
}
pub fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let bytes = serde_json::to_vec(value)?;
    ensure!(
        !bytes.is_empty() && bytes.len() <= MAX_FRAME,
        "Oversized broker frame"
    );
    let mut frame = (bytes.len() as u32).to_le_bytes().to_vec();
    frame.extend(bytes);
    Ok(frame)
}
fn retry(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
    ) || matches!(error.raw_os_error(), Some(232) | Some(536))
}
pub fn read_exact(
    reader: &mut impl std::io::Read,
    bytes: &mut [u8],
    deadline: std::time::Instant,
) -> Result<()> {
    let mut offset = 0;
    while offset < bytes.len() {
        ensure!(std::time::Instant::now() < deadline, "Broker IPC timeout");
        match reader.read(&mut bytes[offset..]) {
            Ok(0) => anyhow::bail!("Broker disconnected"),
            Ok(n) => offset += n,
            Err(error) if retry(&error) => std::thread::sleep(std::time::Duration::from_millis(20)),
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}
pub fn write_all(
    writer: &mut impl std::io::Write,
    bytes: &[u8],
    deadline: std::time::Instant,
) -> Result<()> {
    let mut offset = 0;
    while offset < bytes.len() {
        ensure!(std::time::Instant::now() < deadline, "Broker IPC timeout");
        match writer.write(&bytes[offset..]) {
            // A nonblocking byte pipe may successfully write zero when full.
            Ok(0) => std::thread::sleep(std::time::Duration::from_millis(20)),
            Ok(n) => offset += n,
            Err(error) if retry(&error) => std::thread::sleep(std::time::Duration::from_millis(20)),
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::installed::Request;
    #[test]
    fn frames_are_bounded_and_requests_cannot_smuggle_fields_or_operations() {
        assert!(frame_len(0u32.to_le_bytes()).is_err());
        assert!(frame_len((MAX_FRAME as u32 + 1).to_le_bytes()).is_err());
        assert_eq!(
            frame_len((MAX_FRAME as u32).to_le_bytes()).unwrap(),
            MAX_FRAME
        );
        let request = Request::Abort {
            nonce: "a".repeat(64),
        };
        let frame = encode(&request).unwrap();
        assert_eq!(
            frame_len(frame[..4].try_into().unwrap()).unwrap(),
            frame.len() - 4
        );
        assert!(matches!(
            decode::<Request>(&frame[4..]).unwrap(),
            Request::Abort { .. }
        ));
        for bytes in [
            br#"{"operation":"abort","nonce":"x","command":"powershell"}"#.as_slice(),
            br#"{"operation":"prepare","nonce":"x","sources":[{"component":"client","path":"/x","digest":"x","destination":"/admin"}]}"#,
            br#"{"operation":"launch","executable":"/admin"}"#,
            br#"{"operation":"abort","nonce":"x","nonce":"y"}"#,
        ] { assert!(decode::<Request>(bytes).is_err()); }
        assert!(decode::<Request>(&vec![b' '; MAX_FRAME + 1]).is_err());
        assert!(encode(&"x".repeat(MAX_FRAME)).is_err());
    }
    #[test]
    fn partial_nonblocking_frames_resume_and_disconnects_and_deadlines_fail() {
        use std::io::{self, Write};
        use std::time::{Duration, Instant};
        struct Backpressure {
            bytes: Vec<u8>,
            blocked: bool,
        }
        impl Write for Backpressure {
            fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
                if !self.blocked {
                    self.blocked = true;
                    return Ok(0);
                }
                let n = bytes.len().min(4096);
                self.bytes.extend_from_slice(&bytes[..n]);
                Ok(n)
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let mut writer = Backpressure {
            bytes: vec![],
            blocked: false,
        };
        let frame = encode(&"x".repeat(MAX_FRAME - 2)).unwrap();
        write_all(&mut writer, &frame, Instant::now() + Duration::from_secs(1)).unwrap();
        assert_eq!(writer.bytes, frame);
        let mut reader = std::io::Cursor::new(writer.bytes.clone());
        let mut header = [0; 4];
        read_exact(
            &mut reader,
            &mut header,
            Instant::now() + Duration::from_secs(1),
        )
        .unwrap();
        let mut data = vec![0; frame_len(header).unwrap()];
        read_exact(
            &mut reader,
            &mut data,
            Instant::now() + Duration::from_secs(1),
        )
        .unwrap();
        assert_eq!(decode::<String>(&data).unwrap().len(), MAX_FRAME - 2);
        assert!(
            read_exact(
                &mut reader,
                &mut header,
                Instant::now() + Duration::from_secs(1)
            )
            .is_err()
        );
        assert!(write_all(&mut writer, b"unwritten", Instant::now()).is_err());
    }
}
