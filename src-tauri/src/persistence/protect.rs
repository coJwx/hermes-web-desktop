#[cfg(windows)]
fn transform(input: &[u8], entropy: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let input_blob = CRYPT_INTEGER_BLOB {
        cbData: input.len().try_into().map_err(|_| "登录数据过大")?,
        pbData: input.as_ptr().cast_mut(),
    };
    let entropy_blob = CRYPT_INTEGER_BLOB {
        cbData: entropy.len().try_into().map_err(|_| "后端标识过长")?,
        pbData: entropy.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // Input buffers outlive the call; DPAPI allocates output. No machine-wide flag: protection is user-scoped.
    let success = unsafe {
        if encrypt {
            CryptProtectData(
                &input_blob,
                std::ptr::null(),
                &entropy_blob,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input_blob,
                std::ptr::null_mut(),
                &entropy_blob,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if success == 0 {
        return Err(format!(
            "Windows DPAPI 失败：{}",
            std::io::Error::last_os_error()
        ));
    }
    // DPAPI's successful output belongs to LocalFree, not Rust's allocator.
    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(bytes)
}

pub fn protect(input: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        transform(input, entropy, true)
    }
    #[cfg(not(windows))]
    {
        let _ = (input, entropy);
        Err("此构建仅支持 Windows 安全会话存储；不会降级为明文。".into())
    }
}
pub fn unprotect(input: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        transform(input, entropy, false)
    }
    #[cfg(not(windows))]
    {
        let _ = (input, entropy);
        Err("此构建仅支持 Windows 安全会话存储。".into())
    }
}
