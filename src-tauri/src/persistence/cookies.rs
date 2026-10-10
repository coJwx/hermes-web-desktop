use super::{atomic_write, BackendFiles};
use reqwest::{cookie::CookieStore as CookieProvider, header::HeaderValue};
use std::{fs, sync::Mutex};
use url::Url;

struct CookieState {
    jar: cookie_store::CookieStore,
    error: Option<String>,
    generation: u64,
    closed: bool,
}

pub struct SessionCookies {
    files: BackendFiles,
    state: Mutex<CookieState>,
}
impl SessionCookies {
    pub fn open(files: BackendFiles) -> Result<Self, String> {
        let jar = match fs::read(files.cookie_path()) {
            Ok(encrypted) => {
                let plain = super::protect::unprotect(&encrypted, files.identity.as_bytes())
                    .map_err(|e| format!("无法恢复已保存的登录状态：{e}。请使用原 Windows 用户和电脑，或清除该服务器的 session.dpapi 后重新登录。"))?;
                cookie_store::serde::json::load(plain.as_slice())
                    .map_err(|e| format!("登录状态损坏：{e}"))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                cookie_store::CookieStore::default()
            }
            Err(e) => return Err(format!("无法读取登录状态：{e}")),
        };
        Ok(Self {
            files,
            state: Mutex::new(CookieState {
                jar,
                error: None,
                generation: 0,
                closed: false,
            }),
        })
    }
    fn persist(&self, jar: &cookie_store::CookieStore) -> Result<(), String> {
        // Preserve session cookies too, but never resurrect expired or explicitly deleted cookies.
        let active: Vec<_> = jar.iter_unexpired().collect();
        let plain = serde_json::to_vec(&active).map_err(|e| e.to_string())?;
        let encrypted = super::protect::protect(&plain, self.files.identity.as_bytes())?;
        atomic_write(&self.files.cookie_path(), &encrypted)
    }
    pub fn check_saved(&self) -> Result<(), String> {
        match &self.state.lock().expect("cookie lock poisoned").error {
            Some(error) => Err(format!("登录信息未能安全保存：{error}")),
            None => Ok(()),
        }
    }
    pub fn close(&self) {
        let mut state = self.state.lock().expect("cookie lock poisoned");
        state.closed = true;
        state.generation += 1;
    }
    pub fn clear(&self) -> Result<(), String> {
        let mut state = self.state.lock().expect("cookie lock poisoned");
        state.generation += 1;
        state.jar.clear();
        state.error = self.persist(&state.jar).err();
        match &state.error {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }
    pub async fn send(
        &self,
        builder: reqwest::RequestBuilder,
        url: &Url,
    ) -> Result<reqwest::Response, String> {
        let generation = self.state.lock().expect("cookie lock poisoned").generation;
        let builder = if let Some(cookie) = self.cookies(url) {
            builder.header(reqwest::header::COOKIE, cookie)
        } else {
            builder
        };
        let response = builder.send().await.map_err(|e| e.to_string())?;
        let mut headers = response
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .peekable();
        if headers.peek().is_some() {
            self.receive_cookies(generation, &mut headers, url);
        }
        self.check_saved()?;
        Ok(response)
    }
    fn receive_cookies(
        &self,
        generation: u64,
        headers: &mut dyn Iterator<Item = &HeaderValue>,
        url: &Url,
    ) {
        let mut state = self.state.lock().expect("cookie lock poisoned");
        if state.closed || generation != state.generation {
            return;
        }
        let parsed = headers.filter_map(|header| {
            cookie_store::RawCookie::parse(header.to_str().ok()?)
                .ok()
                .map(|cookie| cookie.into_owned())
        });
        state.jar.store_response_cookies(parsed, url);
        state.error = self.persist(&state.jar).err();
    }
}
impl CookieProvider for SessionCookies {
    fn set_cookies(&self, headers: &mut dyn Iterator<Item = &HeaderValue>, url: &Url) {
        let generation = self.state.lock().expect("cookie lock poisoned").generation;
        self.receive_cookies(generation, headers, url);
    }
    fn cookies(&self, url: &Url) -> Option<HeaderValue> {
        let state = self.state.lock().expect("cookie lock poisoned");
        if state.closed {
            return None;
        }
        let header = state
            .jar
            .get_request_values(url)
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>()
            .join("; ");
        if header.is_empty() {
            None
        } else {
            HeaderValue::from_str(&header).ok()
        }
    }
}
