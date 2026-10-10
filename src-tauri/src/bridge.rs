use crate::persistence::{cookies::SessionCookies, Appearance, AppearanceStore, BackendFiles};
use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Request, State,
    },
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Router,
};
use futures_util::{SinkExt, StreamExt};
use include_dir::{include_dir, Dir};
use reqwest::cookie::CookieStore;
use std::path::Path;
use std::{
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message as UpstreamMessage};
use url::Url;

static ASSETS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../dist-desktop");
const COOKIE: &str = "hermes_desktop_bridge";

pub struct Bridge {
    pub entry_url: Url,
    pub backend: Url,
    pub leave: Arc<crate::leave_gate::LeaveGate>,
    entry_token: Arc<Mutex<Option<String>>>,
    task: tauri::async_runtime::JoinHandle<()>,
    shutdown: tokio::sync::watch::Sender<bool>,
    cookies: Arc<SessionCookies>,
}
impl Bridge {
    pub fn issue_entry(&self) -> Url {
        let token = uuid::Uuid::new_v4().simple().to_string();
        *self.entry_token.lock().expect("entry lock poisoned") = Some(token.clone());
        self.entry_url
            .join(&format!("/__desktop/start/{token}"))
            .expect("local entry url")
    }
}
impl Drop for Bridge {
    fn drop(&mut self) {
        self.cookies.close();
        let _ = self.shutdown.send(true);
        self.task.abort();
    }
}

#[derive(Clone)]
struct Proxy {
    backend: Url,
    origin: String,
    host: String,
    secret: String,
    entry_token: Arc<Mutex<Option<String>>>,
    client: reqwest::Client,
    cookies: Arc<SessionCookies>,
    appearance: Arc<AppearanceStore>,
    leave: Arc<crate::leave_gate::LeaveGate>,
    shutdown: tokio::sync::watch::Receiver<bool>,
}

pub async fn start(backend: Url, state_root: &Path) -> Result<Bridge, String> {
    start_with_read_timeout(backend, state_root, Duration::from_secs(120)).await
}

async fn start_with_read_timeout(
    backend: Url,
    state_root: &Path,
    read_timeout: Duration,
) -> Result<Bridge, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let host = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .to_string();
    let origin = format!("http://{host}");
    let secret = uuid::Uuid::new_v4().simple().to_string();
    let files = BackendFiles::new(state_root, &backend);
    let appearance = Arc::new(AppearanceStore::open(&files)?);
    let cookies = Arc::new(SessionCookies::open(files)?);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(read_timeout)
        .build()
        .map_err(|e| e.to_string())?;
    // Fail early on network/TLS failures without requiring credentials or mutating remote state.
    let preflight = cookies
        .send(
            client.get(backend.clone()).timeout(Duration::from_secs(15)),
            &backend,
        )
        .await
        .map_err(|e| format!("无法连接远程后端：{e}"))?
        .error_for_status()
        .map_err(|e| format!("后端拒绝连接：{e}"))?;
    validate_preflight(preflight, &backend).await?;
    cookies.check_saved()?;
    let entry = uuid::Uuid::new_v4().simple().to_string();
    let entry_token = Arc::new(Mutex::new(Some(entry.clone())));
    let entry_url =
        Url::parse(&format!("{origin}/__desktop/start/{entry}")).map_err(|e| e.to_string())?;
    let (shutdown, shutdown_rx) = tokio::sync::watch::channel(false);
    let leave = Arc::new(crate::leave_gate::LeaveGate::default());
    let state = Proxy {
        backend: backend.clone(),
        origin,
        host,
        secret,
        entry_token: entry_token.clone(),
        client,
        cookies: cookies.clone(),
        appearance,
        leave: leave.clone(),
        shutdown: shutdown_rx,
    };
    let app = Router::new()
        .route(
            "/__desktop/leave",
            axum::routing::post(reply_leave).layer(axum::extract::DefaultBodyLimit::max(1024)),
        )
        .route(
            "/__desktop/preferences",
            axum::routing::post(save_appearance).layer(axum::extract::DefaultBodyLimit::max(4096)),
        )
        .fallback(handle)
        .layer(middleware::from_fn_with_state(state.clone(), guard))
        .with_state(state);
    let task = tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            eprintln!("Desktop bridge stopped: {error}");
            crate::diagnostics::record("bridge.server_failed");
        }
    });
    Ok(Bridge {
        entry_url,
        backend,
        leave,
        entry_token,
        task,
        shutdown,
        cookies,
    })
}

async fn validate_preflight(response: reqwest::Response, backend: &Url) -> Result<(), String> {
    if response.status().is_redirection() {
        let location = response
            .headers()
            .get(header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|value| backend.join(value).ok())
            .ok_or("后端返回了无效登录跳转。")?;
        // Authentication proxies may redirect straight to an external identity provider.
        // Do not break that flow: only authenticated HTML can prove the Hermes bootstrap.
        if matches!(location.scheme(), "http" | "https") {
            return Ok(());
        }
        return Err("后端返回了不受支持的登录跳转协议。".into());
    }
    let mut bytes = Vec::new();
    let mut body = response.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("后端初始化页面过大。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    bootstrap(&String::from_utf8_lossy(&bytes)).map(|_| ())
}

fn text_header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

async fn guard(State(state): State<Proxy>, mut request: Request, next: Next) -> Response {
    if *state.shutdown.borrow() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let headers = request.headers();
    if text_header(headers, "host") != Some(state.host.as_str())
        || text_header(headers, "origin").is_some_and(|origin| origin != state.origin)
        || text_header(headers, "sec-fetch-site")
            .is_some_and(|site| !matches!(site, "same-origin" | "none"))
    {
        return (
            StatusCode::FORBIDDEN,
            "This desktop bridge only accepts same-origin requests.",
        )
            .into_response();
    }
    if let Some(token) = request
        .uri()
        .path()
        .strip_prefix("/__desktop/start/")
        .filter(|_| request.method() == "GET")
    {
        let mut entry = state.entry_token.lock().expect("entry lock poisoned");
        if entry.as_deref() != Some(token) {
            return StatusCode::FORBIDDEN.into_response();
        }
        *entry = None;
        return (
            StatusCode::SEE_OTHER,
            [
                (header::LOCATION, "/".to_string()),
                (
                    header::SET_COOKIE,
                    format!(
                        "{COOKIE}={}; Path=/; HttpOnly; SameSite=Strict",
                        state.secret
                    ),
                ),
            ],
        )
            .into_response();
    }
    let authenticated = text_header(headers, "cookie").is_some_and(|raw| {
        raw.split(';')
            .any(|value| value.trim() == format!("{COOKIE}={}", state.secret))
    });
    if !authenticated {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    // Auth/login pages can return prefix-qualified links even though our SPA uses a local root.
    let prefix = state.backend.path().trim_end_matches('/');
    if !prefix.is_empty() {
        if let Some(path) = request
            .uri()
            .path()
            .strip_prefix(prefix)
            .filter(|p| p.is_empty() || p.starts_with('/'))
        {
            let normalized = format!(
                "{}{}",
                if path.is_empty() { "/" } else { path },
                request
                    .uri()
                    .query()
                    .map(|q| format!("?{q}"))
                    .unwrap_or_default()
            );
            *request.uri_mut() = normalized.parse().expect("valid normalized uri");
        }
    }
    next.run(request).await
}

fn upstream_url(state: &Proxy, uri: &axum::http::Uri) -> Url {
    let mut url = state.backend.clone();
    // Keep even double-leading slash paths inside the chosen origin (never URL::join untrusted input).
    url.set_path(&format!(
        "{}{}",
        state.backend.path(),
        uri.path().trim_start_matches('/')
    ));
    url.set_query(uri.query());
    url
}

fn hop_header(name: &str) -> bool {
    matches!(
        name,
        "host"
            | "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn bootstrap(html: &str) -> Result<String, String> {
    static PATTERN: OnceLock<regex::Regex> = OnceLock::new();
    let pattern = PATTERN.get_or_init(|| regex::Regex::new(
        r#"window\.(__HERMES_(?:SESSION_TOKEN|DASHBOARD_EMBEDDED_CHAT|AUTH_REQUIRED|INITIAL_PROFILE|DASHBOARD_PROFILE|BASE_PATH)__)\s*=\s*("(?:\\.|[^"\\])*"|true|false)\s*;"#
    ).expect("valid bootstrap regex"));
    let mut script = String::from("window.__HERMES_BASE_PATH__=\"\";");
    let mut found = false;
    for captures in pattern.captures_iter(html) {
        if &captures[1] == "__HERMES_BASE_PATH__" {
            continue;
        }
        let value: serde_json::Value =
            serde_json::from_str(&captures[2]).map_err(|e| e.to_string())?;
        let safe = value.to_string().replace('<', "\\u003c");
        script.push_str(&format!("window.{}={safe};", &captures[1]));
        found = true;
    }
    if !found {
        return Err(
            "后端未提供 Hermes Dashboard 初始化信息。请确认地址指向 Hermes dashboard 服务。".into(),
        );
    }
    Ok(format!("<script>{script}</script>"))
}

fn redirect_location(state: &Proxy, raw: &str) -> String {
    let Ok(url) = state.backend.join(raw) else {
        return raw.into();
    };
    if url.origin() != state.backend.origin() {
        return raw.into();
    }
    let prefix = state.backend.path().trim_end_matches('/');
    let path = url
        .path()
        .strip_prefix(prefix)
        .filter(|p| p.is_empty() || p.starts_with('/'));
    let Some(path) = path else {
        return raw.into();
    };
    format!(
        "{}{}{}",
        if path.is_empty() { "/" } else { path },
        url.query().map(|q| format!("?{q}")).unwrap_or_default(),
        url.fragment().map(|f| format!("#{f}")).unwrap_or_default()
    )
}

fn offline(error: impl std::fmt::Display) -> Response {
    crate::diagnostics::record("bridge.upstream_failed");
    (StatusCode::BAD_GATEWAY, [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        format!("远程后端连接失败：{error}\n\n请从窗口菜单「连接 → 修改后端地址」重新连接，或使用「重新加载」。")).into_response()
}

async fn save_appearance(
    State(state): State<Proxy>,
    axum::Json(patch): axum::Json<Appearance>,
) -> Response {
    match state.appearance.update(patch) {
        Ok(()) => axum::Json(serde_json::json!({"ok": true})).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": error})),
        )
            .into_response(),
    }
}

async fn reply_leave(
    State(state): State<Proxy>,
    axum::Json(reply): axum::Json<crate::leave_gate::Reply>,
) -> StatusCode {
    if state.leave.reply(reply) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::CONFLICT
    }
}

async fn handle(
    State(state): State<Proxy>,
    upgrade: Result<WebSocketUpgrade, axum::extract::ws::rejection::WebSocketUpgradeRejection>,
    request: Request,
) -> Response {
    if let Ok(ws) = upgrade {
        return websocket(state, ws, request).await;
    }
    let path = request.uri().path().trim_start_matches('/');
    // Connection UI is privileged and must never be served on the proxied origin.
    if path.starts_with("desktop-connection") || path.starts_with("__desktop/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    if request.method() == "GET" || request.method() == "HEAD" {
        if let Some(file) = ASSETS.get_file(path).filter(|_| path != "index.html") {
            let mime = mime_guess::from_path(path)
                .first_or_octet_stream()
                .to_string();
            let body = if request.method() == "HEAD" {
                Body::empty()
            } else {
                Body::from(file.contents())
            };
            return Response::builder()
                .header(header::CONTENT_TYPE, mime)
                .body(body)
                .expect("valid asset response");
        }
        if path.starts_with("assets/") {
            return StatusCode::NOT_FOUND.into_response();
        }
    }
    let proxy_path = [
        "api",
        "auth",
        "login",
        "logout",
        "dashboard-plugins",
        "fonts",
        "ds-assets",
    ]
    .iter()
    .any(|prefix| path == *prefix || path.starts_with(&format!("{prefix}/")));
    if !proxy_path && (request.method() == "GET" || request.method() == "HEAD") {
        let mut shutdown = state.shutdown.clone();
        let request = state.cookies.send(
            state
                .client
                .get(state.backend.clone())
                .timeout(Duration::from_secs(15)),
            &state.backend,
        );
        let result = tokio::select! {
            result = request => result,
            _ = shutdown.changed() => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        };
        let res = match result {
            Ok(res) => res,
            Err(error) => return offline(error),
        };
        if let Err(error) = state.cookies.check_saved() {
            return offline(error);
        }
        if res.status().is_redirection() {
            if let Some(location) = res
                .headers()
                .get(header::LOCATION)
                .and_then(|v| v.to_str().ok())
            {
                return (
                    res.status(),
                    [(header::LOCATION, redirect_location(&state, location))],
                )
                    .into_response();
            }
        }
        if !res.status().is_success() {
            return offline(format!("HTTP {}", res.status()));
        }
        let body = tokio::select! {
            result = res.text() => result,
            _ = shutdown.changed() => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        };
        let html = match body {
            Ok(html) => html,
            Err(error) => return offline(error),
        };
        let script = match bootstrap(&html) {
            Ok(script) => script,
            Err(error) => return offline(error),
        };
        let local = ASSETS
            .get_file("index.html")
            .and_then(|f| f.contents_utf8())
            .expect("embedded index.html");
        return (
            [
                (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            local.replacen(
                "</head>",
                &format!("{script}{}</head>", state.appearance.bootstrap()),
                1,
            ),
        )
            .into_response();
    }
    forward(state, request).await
}

async fn forward(state: Proxy, request: Request) -> Response {
    let url = upstream_url(&state, request.uri());
    let logout = request.method() == "POST" && request.uri().path() == "/auth/logout";
    let (parts, body) = request.into_parts();
    let connection_headers = text_header(&parts.headers, "connection")
        .unwrap_or("")
        .to_lowercase();
    let mut headers = HeaderMap::new();
    for (name, value) in &parts.headers {
        if hop_header(name.as_str())
            || connection_headers
                .split(',')
                .any(|h| h.trim() == name.as_str())
            || matches!(
                name.as_str(),
                "cookie" | "origin" | "referer" | "accept-encoding"
            )
            || name.as_str().starts_with("x-forwarded-")
        {
            continue;
        }
        headers.append(name.clone(), value.clone());
    }
    headers.insert(
        header::ACCEPT_ENCODING,
        HeaderValue::from_static("identity"),
    );
    if parts.headers.contains_key(header::ORIGIN) {
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_str(&state.backend.origin().ascii_serialization())
                .expect("valid backend origin"),
        );
    }
    if parts.headers.contains_key(header::REFERER) {
        headers.insert(
            header::REFERER,
            HeaderValue::from_str(state.backend.as_str()).expect("valid backend url"),
        );
    }
    if logout {
        // Send the original cookies to revoke the server session, but forget locally even if it is offline.
        if let Some(cookie) = state.cookies.cookies(&url) {
            headers.insert(header::COOKIE, cookie);
        }
        if let Err(error) = state.cookies.clear() {
            return offline(error);
        }
    }
    let mut shutdown = state.shutdown.clone();
    let send = state.cookies.send(
        state
            .client
            .request(parts.method, url.clone())
            .headers(headers)
            .body(reqwest::Body::wrap_stream(body.into_data_stream())),
        &url,
    );
    let result = tokio::select! {
        result = send => result,
        _ = shutdown.changed() => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    if logout {
        if let Err(error) = state.cookies.clear() {
            return offline(error);
        }
    }
    if let Err(error) = state.cookies.check_saved() {
        return offline(error);
    }
    let res = match result {
        Ok(res) => res,
        Err(error) => return offline(error),
    };
    let mut builder = Response::builder().status(res.status());
    let connection_headers = text_header(res.headers(), "connection")
        .unwrap_or("")
        .to_lowercase();
    for (name, value) in res.headers() {
        // Remote cookies remain in this bridge's private jar, not the browser's localhost cookie domain.
        if hop_header(name.as_str())
            || name == header::SET_COOKIE
            || connection_headers
                .split(',')
                .any(|h| h.trim() == name.as_str())
        {
            continue;
        }
        if name == header::LOCATION {
            if let Ok(raw) = value.to_str() {
                builder = builder.header(name, redirect_location(&state, raw));
            }
        } else {
            builder = builder.header(name, value);
        }
    }
    builder
        .body(Body::from_stream(res.bytes_stream().take_until(
            async move {
                if !*shutdown.borrow() {
                    let _ = shutdown.changed().await;
                }
            },
        )))
        .expect("valid upstream response")
}

async fn websocket(state: Proxy, ws: WebSocketUpgrade, request: Request) -> Response {
    let cookie_url = upstream_url(&state, request.uri());
    let mut url = cookie_url.clone();
    let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
    url.set_scheme(scheme).expect("valid websocket scheme");
    let mut upstream = match url.as_str().into_client_request() {
        Ok(request) => request,
        Err(error) => return offline(error),
    };
    upstream.headers_mut().insert(
        header::ORIGIN,
        HeaderValue::from_str(&state.backend.origin().ascii_serialization()).expect("valid origin"),
    );
    if let Some(cookies) = state.cookies.cookies(&cookie_url) {
        upstream.headers_mut().insert(header::COOKIE, cookies);
    }
    if let Some(protocol) = request.headers().get(header::SEC_WEBSOCKET_PROTOCOL) {
        upstream
            .headers_mut()
            .insert(header::SEC_WEBSOCKET_PROTOCOL, protocol.clone());
    }
    let mut shutdown = state.shutdown.clone();
    let connect = tokio::time::timeout(
        Duration::from_secs(10),
        tokio_tungstenite::connect_async(upstream),
    );
    let connection = tokio::select! {
        result = connect => result,
        _ = shutdown.changed() => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let (upstream, response) = match connection {
        Ok(Ok(connection)) => connection,
        Ok(Err(error)) => return offline(error),
        Err(error) => return offline(error),
    };
    let protocol = response
        .headers()
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|p| p.to_str().ok())
        .map(str::to_owned);
    let ws = if let Some(protocol) = protocol {
        ws.protocols([protocol])
    } else {
        ws
    };
    ws.on_upgrade(move |socket| pump(socket, upstream, state.shutdown))
}

async fn pump(
    socket: WebSocket,
    upstream: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) {
    let (mut local_tx, mut local_rx) = socket.split();
    let (mut remote_tx, mut remote_rx) = upstream.split();
    let to_remote = async {
        while let Some(Ok(message)) = local_rx.next().await {
            let message = match message {
                Message::Text(text) => UpstreamMessage::Text(text.to_string().into()),
                Message::Binary(data) => UpstreamMessage::Binary(data),
                Message::Ping(data) => UpstreamMessage::Ping(data),
                Message::Pong(data) => UpstreamMessage::Pong(data),
                Message::Close(frame) => UpstreamMessage::Close(frame.map(|frame| {
                    tokio_tungstenite::tungstenite::protocol::CloseFrame {
                        code: frame.code.into(),
                        reason: frame.reason.to_string().into(),
                    }
                })),
            };
            if remote_tx.send(message).await.is_err() {
                break;
            }
        }
    };
    let to_local = async {
        while let Some(Ok(message)) = remote_rx.next().await {
            let message = match message {
                UpstreamMessage::Text(text) => Message::Text(text.to_string().into()),
                UpstreamMessage::Binary(data) => Message::Binary(data),
                UpstreamMessage::Ping(data) => Message::Ping(data),
                UpstreamMessage::Pong(data) => Message::Pong(data),
                UpstreamMessage::Close(frame) => {
                    Message::Close(frame.map(|frame| axum::extract::ws::CloseFrame {
                        code: frame.code.into(),
                        reason: frame.reason.to_string().into(),
                    }))
                }
                UpstreamMessage::Frame(_) => continue,
            };
            if local_tx.send(message).await.is_err() {
                break;
            }
        }
    };
    tokio::select! { _ = to_remote => {}, _ = to_local => {}, _ = shutdown.changed() => {} }
}

#[cfg(test)]
mod connection_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod transport_tests;
