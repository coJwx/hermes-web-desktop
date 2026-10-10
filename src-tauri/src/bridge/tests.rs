use super::*;
use crate::settings;
use axum::{
    extract::ws::WebSocketUpgrade,
    routing::{get, post},
};
use reqwest::cookie::Jar;

async fn fixture(gated: bool) -> (Url, tokio::task::JoinHandle<()>) {
    let root = move |headers: HeaderMap| async move {
        let authenticated = text_header(&headers, "cookie")
            .unwrap_or("")
            .contains("remote_session=authenticated");
        if gated && !authenticated {
            return (StatusCode::SEE_OTHER, [(header::LOCATION, "/hermes/login")]).into_response();
        }
        let html = if gated {
            "<html><head><script>window.__HERMES_AUTH_REQUIRED__=true;window.__HERMES_DASHBOARD_EMBEDDED_CHAT__=true;</script></head></html>"
        } else {
            "<html><head><script>window.__HERMES_SESSION_TOKEN__=\"fixture-token\";window.__HERMES_AUTH_REQUIRED__=false;window.__HERMES_DASHBOARD_EMBEDDED_CHAT__=true;window.__HERMES_BASE_PATH__=\"/hermes\";</script></head></html>"
        };
        axum::response::Html(html).into_response()
    };
    let app = Router::new()
        .route("/hermes/", get(root))
        .route(
            "/hermes/login",
            get(|| async {
                axum::response::Html("<html><body>Remote password login</body></html>")
            }),
        )
        .route(
            "/hermes/api/echo",
            post(|headers: HeaderMap, body: String| async move {
                let cookie = text_header(&headers, "cookie").unwrap_or("").to_string();
                let token = text_header(&headers, "x-hermes-session-token")
                    .unwrap_or("")
                    .to_string();
                format!("{body}|{cookie}|{token}")
            }),
        )
        .route(
            "/hermes/auth/password-login",
            post(|| async {
                (
                    [(
                        header::SET_COOKIE,
                        "remote_session=authenticated; Path=/hermes; HttpOnly",
                    )],
                    "ok",
                )
            }),
        )
        .route(
            "/hermes/auth/logout",
            post(|| async {
                (
                    StatusCode::SEE_OTHER,
                    [
                        (header::LOCATION, "/hermes/login"),
                        (
                            header::SET_COOKIE,
                            "remote_session=; Path=/hermes; Max-Age=0; HttpOnly",
                        ),
                    ],
                )
            }),
        )
        .route(
            "/hermes/api/ws",
            get(|ws: WebSocketUpgrade, headers: HeaderMap| async move {
                if !text_header(&headers, "cookie")
                    .unwrap_or("")
                    .contains("remote_session=authenticated")
                {
                    return StatusCode::UNAUTHORIZED.into_response();
                }
                ws.on_upgrade(|mut socket| async move {
                    while let Some(Ok(message)) = socket.recv().await {
                        if socket.send(message).await.is_err() {
                            break;
                        }
                    }
                })
            }),
        );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = Url::parse(&format!(
        "http://{}/hermes/",
        listener.local_addr().unwrap()
    ))
    .unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (url, task)
}

#[tokio::test]
async fn bundled_frontend_cookie_login_and_websocket_roundtrip() {
    let (backend, fixture) = fixture(false).await;
    let temp = std::env::temp_dir().join(format!("hermes-bridge-test-{}", uuid::Uuid::new_v4()));
    let bridge = start(backend.clone(), &temp).await.unwrap();
    let jar = Arc::new(Jar::default());
    let client = reqwest::Client::builder()
        .cookie_provider(jar.clone())
        .build()
        .unwrap();
    let html = client
        .get(bridge.entry_url.clone())
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(html.contains("id=\"root\""));
    assert!(html.contains("window.__HERMES_SESSION_TOKEN__=\"fixture-token\""));
    assert!(html.contains("window.__HERMES_BASE_PATH__=\"\""));
    let origin = bridge.entry_url.join("/").unwrap();
    assert_eq!(
        client
            .get(bridge.entry_url.clone())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let login = client
        .post(origin.join("auth/password-login").unwrap())
        .send()
        .await
        .unwrap();
    assert!(login.status().is_success());
    assert!(login
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .next()
        .is_none());
    let echo = client
        .post(origin.join("api/echo").unwrap())
        .header("x-hermes-session-token", "fixture-token")
        .body("uploaded-data")
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(
        echo,
        "uploaded-data|remote_session=authenticated|fixture-token"
    );
    assert!(!echo.contains(COOKIE));
    let prefixed = client
        .post(origin.join("hermes/api/echo").unwrap())
        .body("prefix")
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(prefixed, "prefix|remote_session=authenticated|");
    let favicon = client
        .get(origin.join("favicon.ico").unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(
        favicon.headers().get(header::CONTENT_TYPE).unwrap(),
        "image/x-icon"
    );
    assert!(!favicon.bytes().await.unwrap().is_empty());
    let mut ws_url = origin.join("api/ws?ticket=test").unwrap();
    ws_url.set_scheme("ws").unwrap();
    let mut request = ws_url.as_str().into_client_request().unwrap();
    request
        .headers_mut()
        .insert(header::COOKIE, jar.cookies(&origin).unwrap());
    request.headers_mut().insert(
        header::ORIGIN,
        HeaderValue::from_str(origin.as_str().trim_end_matches('/')).unwrap(),
    );
    let (mut socket, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    for message in [
        UpstreamMessage::Text("terminal input".into()),
        UpstreamMessage::Binary(vec![0, 1, 255].into()),
    ] {
        socket.send(message.clone()).await.unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(5), socket.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap(),
            message
        );
    }
    drop(bridge);
    let closed = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .unwrap();
    assert!(
        closed.is_none()
            || closed.is_some_and(
                |message| message.is_err() || matches!(message, Ok(UpstreamMessage::Close(_)))
            )
    );
    fixture.abort();
    cleanup_temp(&temp);
}

#[tokio::test]
async fn validation_bridge_guards_and_server_switch_isolation() {
    for raw in [
        "file:///tmp",
        "javascript:alert(1)",
        "http://user:pass@localhost",
        "http://localhost/?token=secret",
        "http://localhost/#fragment",
        "not-a-url",
    ] {
        assert!(settings::validate(raw).is_err(), "{raw}");
    }
    let (backend, fixture) = fixture(true).await;
    let temp = std::env::temp_dir().join(format!("hermes-desktop-test-{}", uuid::Uuid::new_v4()));
    let config = temp.join("connection.json");
    assert_eq!(settings::load(&config).unwrap(), settings::DEFAULT_BACKEND);
    settings::save(&config, &backend)
        .unwrap_or_else(|error| panic!("{}: {error}", config.display()));
    assert_eq!(settings::load(&config).unwrap(), backend.as_str());
    let first = start(backend.clone(), &temp).await.unwrap();
    let origin = first.entry_url.join("/").unwrap();
    let anonymous = reqwest::Client::new();
    assert_eq!(
        anonymous.get(origin.clone()).send().await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        anonymous
            .get(first.entry_url.clone())
            .header(header::ORIGIN, "https://attacker.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let jar = Arc::new(Jar::default());
    let client = reqwest::Client::builder()
        .cookie_provider(jar.clone())
        .build()
        .unwrap();
    let login_html = client
        .get(first.entry_url.clone())
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(login_html.contains("Remote password login"));
    assert_eq!(
        client
            .get(origin.clone())
            .header(header::HOST, "attacker.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        client
            .post(origin.join("api/echo").unwrap())
            .header(header::ORIGIN, "https://attacker.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    client
        .post(origin.join("auth/password-login").unwrap())
        .send()
        .await
        .unwrap();
    let gated_html = client
        .get(origin.clone())
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(gated_html.contains("window.__HERMES_AUTH_REQUIRED__=true"));
    assert!(gated_html.contains("id=\"root\""));
    assert!(!gated_html.contains("__HERMES_SESSION_TOKEN__"));
    assert_eq!(
        client
            .get(origin.clone())
            .header("sec-fetch-site", "same-site")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let (second_backend, second_fixture) = self::fixture(true).await;
    let second = start(second_backend, &temp).await.unwrap();
    let second_origin = second.entry_url.join("/").unwrap();
    // Browser cookies are not port-scoped; a fresh secret still rejects the previous session.
    assert_eq!(
        client
            .get(second_origin.join("api/echo").unwrap())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    client.get(second.entry_url.clone()).send().await.unwrap();
    let echo = client
        .post(second_origin.join("api/echo").unwrap())
        .body("new-server")
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(echo, "new-server||");
    let state = Proxy {
        backend: Url::parse("https://example.com/hermes/").unwrap(),
        origin: "http://127.0.0.1:1234".into(),
        host: "127.0.0.1:1234".into(),
        secret: "test".into(),
        entry_token: Arc::new(Mutex::new(Some("test".into()))),
        client: anonymous,
        cookies: Arc::new(
            SessionCookies::open(BackendFiles::new(
                &temp,
                &Url::parse("https://example.com/hermes/").unwrap(),
            ))
            .unwrap(),
        ),
        appearance: Arc::new(
            AppearanceStore::open(&BackendFiles::new(
                &temp,
                &Url::parse("https://example.com/hermes/").unwrap(),
            ))
            .unwrap(),
        ),
        shutdown: tokio::sync::watch::channel(false).1,
        leave: Arc::new(crate::leave_gate::LeaveGate::default()),
    };
    assert_eq!(
        upstream_url(&state, &"//attacker.invalid/api?x=1".parse().unwrap()).as_str(),
        "https://example.com/hermes/attacker.invalid/api?x=1"
    );
    assert_eq!(
        redirect_location(&state, "https://example.com/hermes/login?next=%2F"),
        "/login?next=%2F"
    );
    assert_eq!(
        redirect_location(&state, "https://oauth.example/login"),
        "https://oauth.example/login"
    );
    drop(first);
    drop(second);
    fixture.abort();
    second_fixture.abort();
    cleanup_temp(&temp);
}

// All paths originate from a unique test root; remove only its known files/directories, never user state.
fn cleanup_temp(path: &std::path::Path) {
    if !path.exists() {
        return;
    }
    for entry in std::fs::read_dir(path).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            cleanup_temp(&path);
        } else {
            std::fs::remove_file(path).unwrap();
        }
    }
    std::fs::remove_dir(path).unwrap();
}

#[cfg(windows)]
#[tokio::test]
async fn desktop_restart_restores_theme_font_and_encrypted_login_then_logout_forgets() {
    let (backend, fixture) = fixture(true).await;
    let temp = std::env::temp_dir().join(format!("hermes-restart-test-{}", uuid::Uuid::new_v4()));
    let first = start(backend.clone(), &temp).await.unwrap();
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    client.get(first.entry_url.clone()).send().await.unwrap();
    let origin = first.entry_url.join("/").unwrap();
    let login = client
        .post(origin.join("auth/password-login").unwrap())
        .send()
        .await
        .unwrap();
    assert!(login.status().is_success());
    for body in [
        r#"{"theme":"codex-dark"}"#,
        r#"{"font":"theme-default"}"#,
        r#"{"locale":"zh"}"#,
    ] {
        assert!(client
            .post(origin.join("__desktop/preferences").unwrap())
            .header(header::CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .await
            .unwrap()
            .status()
            .is_success());
    }
    let files = BackendFiles::new(&temp, &backend);
    let encrypted = std::fs::read(files.cookie_path()).unwrap();
    assert!(!encrypted
        .windows(b"authenticated".len())
        .any(|part| part == b"authenticated"));
    assert!(serde_json::from_slice::<serde_json::Value>(&encrypted).is_err());
    drop(first);
    // A completely new bridge, cookie provider and browser cookie jar simulate closing/reopening the exe.
    let restarted = start(backend.clone(), &temp).await.unwrap();
    let fresh = reqwest::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    let html = fresh
        .get(restarted.entry_url.clone())
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(html.contains("id=\"root\""));
    assert!(html.contains("localStorage.setItem(\"hermes-dashboard-theme\",\"codex-dark\")"));
    assert!(html.contains("localStorage.setItem(\"hermes-dashboard-font\",\"theme-default\")"));
    assert!(html.contains("localStorage.setItem(\"hermes-locale\",\"zh\")"));
    assert!(!html.contains("remote_session=authenticated"));
    let origin = restarted.entry_url.join("/").unwrap();
    let echo = fresh
        .post(origin.join("api/echo").unwrap())
        .body("reopened")
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(echo, "reopened|remote_session=authenticated|");
    fresh
        .post(origin.join("auth/logout").unwrap())
        .send()
        .await
        .unwrap();
    drop(restarted);
    let logged_out = start(backend, &temp).await.unwrap();
    let fresh = reqwest::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    let html = fresh
        .get(logged_out.entry_url.clone())
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(html.contains("Remote password login"));
    // An HTTP response started before logout must not re-save a cookie after local clearing.
    let started = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let ready = started.notified();
    let announced = started.clone();
    let finish = release.clone();
    let app = Router::new().route(
        "/hermes/late",
        get(move || {
            let announced = announced.clone();
            let finish = finish.clone();
            async move {
                announced.notify_one();
                finish.notified().await;
                (
                    [(
                        header::SET_COOKIE,
                        "remote_session=authenticated; Path=/hermes; HttpOnly",
                    )],
                    "late",
                )
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let late_url = Url::parse(&format!(
        "http://{}/hermes/late",
        listener.local_addr().unwrap()
    ))
    .unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let cookies = Arc::new(SessionCookies::open(files.clone()).unwrap());
    let request_cookies = cookies.clone();
    let pending = tokio::spawn(async move {
        request_cookies
            .send(reqwest::Client::new().get(late_url.clone()), &late_url)
            .await
    });
    tokio::time::timeout(Duration::from_secs(5), ready)
        .await
        .unwrap();
    cookies.clear().unwrap();
    release.notify_one();
    pending.await.unwrap().unwrap();
    assert!(SessionCookies::open(files)
        .unwrap()
        .cookies(&Url::parse("http://127.0.0.1/hermes/").unwrap())
        .is_none());
    server.abort();
    drop(logged_out);
    fixture.abort();
    cleanup_temp(&temp);
}

#[cfg(windows)]
#[tokio::test]
async fn persisted_state_is_backend_scoped_expiry_safe_and_origin_guarded() {
    let (a, fixture_a) = fixture(true).await;
    let (b, fixture_b) = fixture(true).await;
    let temp = std::env::temp_dir().join(format!("hermes-isolation-test-{}", uuid::Uuid::new_v4()));
    let first = start(a.clone(), &temp).await.unwrap();
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    client.get(first.entry_url.clone()).send().await.unwrap();
    let origin = first.entry_url.join("/").unwrap();
    client
        .post(origin.join("auth/password-login").unwrap())
        .send()
        .await
        .unwrap();
    client
        .post(origin.join("__desktop/preferences").unwrap())
        .header(header::CONTENT_TYPE, "application/json")
        .body(r#"{"theme":"codex-dark"}"#)
        .send()
        .await
        .unwrap();
    assert_eq!(
        client
            .post(origin.join("__desktop/preferences").unwrap())
            .header(header::ORIGIN, "https://attacker.invalid")
            .header(header::CONTENT_TYPE, "application/json")
            .body(r#"{"theme":"codex-light"}"#)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    drop(first);
    let second = start(b.clone(), &temp).await.unwrap();
    let html = client
        .get(second.entry_url.clone())
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(html.contains("Remote password login"));
    let files_a = BackendFiles::new(&temp, &a);
    let files_b = BackendFiles::new(&temp, &b);
    assert_ne!(files_a.directory, files_b.directory);
    let empty_b = AppearanceStore::open(&files_b).unwrap();
    assert!(!empty_b.bootstrap().contains("codex-dark"));
    empty_b
        .update(Appearance {
            theme: Some("codex-light".into()),
            font: None,
            locale: None,
        })
        .unwrap();
    drop(second);
    let again = start(a.clone(), &temp).await.unwrap();
    let html = client
        .get(again.entry_url.clone())
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(html.contains("codex-dark") && !html.contains("codex-light"));
    let restored = SessionCookies::open(files_a.clone()).unwrap();
    assert!(restored.cookies(&a).is_some());
    // Respect server deletion/expiry after reloading encrypted storage.
    let expired = HeaderValue::from_static(
        "remote_session=gone; Path=/hermes; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
    restored.set_cookies(&mut [&expired].into_iter(), &a);
    restored.check_saved().unwrap();
    assert!(SessionCookies::open(files_a.clone())
        .unwrap()
        .cookies(&a)
        .is_none());
    let a_blob = std::fs::read(files_a.cookie_path()).unwrap();
    std::fs::create_dir_all(&files_b.directory).unwrap();
    std::fs::write(files_b.cookie_path(), a_blob).unwrap();
    assert!(SessionCookies::open(files_b).is_err()); // DPAPI entropy binds the blob to the selected backend.
    drop(again);
    fixture_a.abort();
    fixture_b.abort();
    cleanup_temp(&temp);
}
