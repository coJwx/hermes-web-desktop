/// These dialogs run on a blocking worker, leaving the WebView UI thread responsive.
pub fn confirm_force(message: &str) -> bool {
    message_box(
        message,
        "Hermes — 确认操作",
        0x4 | 0x100 | 0x30 | 0x10000 | 0x40000,
    ) == 6
}
pub fn warning(message: &str) {
    message_box(message, "Hermes — 提示", 0x30);
}

#[cfg(windows)]
fn message_box(message: &str, title: &str, flags: u32) -> i32 {
    #[link(name = "user32")]
    unsafe extern "system" {
        fn MessageBoxW(
            hwnd: *mut std::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            flags: u32,
        ) -> i32;
    }
    let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
    let caption: Vec<u16> = title.encode_utf16().chain(Some(0)).collect();
    // Buffers are NUL-terminated and live through the synchronous Win32 call.
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), flags) }
}
#[cfg(not(windows))]
fn message_box(message: &str, _title: &str, _flags: u32) -> i32 {
    eprintln!("{message}");
    0 // No native confirmation implementation: never implicitly authorize force.
}
