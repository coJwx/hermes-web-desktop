use super::*;
use axum::routing::get;
const BOOTSTRAP: &str = r#"<script>window.__HERMES_SESSION_TOKEN__="test";</script>"#;

async fn server(router: Router) -> (Url, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (url, task)
}
async fn browser(bridge: &Bridge) -> (reqwest::Client, Arc<reqwest::cookie::Jar>) {
    let jar = Arc::new(reqwest::cookie::Jar::default());
    let client = reqwest::Client::builder()
        .cookie_provider(jar.clone())
        .build()
        .unwrap();
    assert!(client
        .get(bridge.entry_url.clone())
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    (client, jar)
}
fn ws_request(bridge: &Bridge, jar: &reqwest::cookie::Jar) -> axum::http::Request<()> {
    let origin = bridge.entry_url.join("/").unwrap();
    let mut url = origin.join("api/ws").unwrap();
    url.set_scheme("ws").unwrap();
    let mut request = url.as_str().into_client_request().unwrap();
    request
        .headers_mut()
        .insert(header::COOKIE, jar.cookies(&origin).unwrap());
    request.headers_mut().insert(
        header::ORIGIN,
        HeaderValue::from_str(origin.as_str().trim_end_matches('/')).unwrap(),
    );
    request
}

#[tokio::test]
async fn close_codes_and_reasons_survive_in_both_directions() {
    let (tx, mut seen) = tokio::sync::mpsc::unbounded_channel();
    let app = Router::new().route("/", get(|| async { BOOTSTRAP })).route(
        "/api/ws",
        get(move |ws: WebSocketUpgrade| {
            let tx = tx.clone();
            async move {
                ws.on_upgrade(move |mut socket| async move {
                    while let Some(Ok(message)) = socket.recv().await {
                        match message {
                            Message::Text(_) => {
                                socket
                                    .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                                        code: 4401,
                                        reason: "refresh token".into(),
                                    })))
                                    .await
                                    .unwrap();
                                break;
                            }
                            Message::Close(Some(frame)) => {
                                let _ = tx.send((frame.code, frame.reason.to_string()));
                                break;
                            }
                            _ => {}
                        }
                    }
                })
            }
        }),
    );
    let (backend, task) = server(app).await;
    let root = std::env::temp_dir().join(format!("hermes-close-{}", uuid::Uuid::new_v4()));
    let bridge = start(backend, &root).await.unwrap();
    let (_client, jar) = browser(&bridge).await;
    let (mut socket, _) = tokio_tungstenite::connect_async(ws_request(&bridge, &jar))
        .await
        .unwrap();
    socket
        .send(UpstreamMessage::Text("close".into()))
        .await
        .unwrap();
    let frame = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let UpstreamMessage::Close(Some(frame)) = frame else {
        panic!("missing close metadata");
    };
    assert_eq!(u16::from(frame.code), 4401);
    assert_eq!(frame.reason.as_str(), "refresh token");
    let (mut socket, _) = tokio_tungstenite::connect_async(ws_request(&bridge, &jar))
        .await
        .unwrap();
    socket
        .send(UpstreamMessage::Close(Some(
            tokio_tungstenite::tungstenite::protocol::CloseFrame {
                code: 4403.into(),
                reason: "wrong origin".into(),
            },
        )))
        .await
        .unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), seen.recv())
            .await
            .unwrap()
            .unwrap(),
        (4403, "wrong origin".into())
    );
    drop(bridge);
    task.abort();
}

#[tokio::test]
async fn idle_reads_time_out_and_bridge_shutdown_cancels_headers_and_streams() {
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let app = Router::new()
        .route("/", get(|| async { BOOTSTRAP }))
        .route(
            "/api/stall",
            get({
                let entered = entered.clone();
                let release = release.clone();
                move || {
                    let entered = entered.clone();
                    let release = release.clone();
                    async move {
                        entered.notify_one();
                        release.notified().await;
                        "released"
                    }
                }
            }),
        )
        .route(
            "/api/stream",
            get(|| async {
                let body = futures_util::stream::once(async { Ok::<_, std::io::Error>("start") })
                    .chain(futures_util::stream::pending());
                Body::from_stream(body)
            }),
        )
        .route(
            "/api/active-stream",
            get(|| async {
                Body::from_stream(futures_util::stream::unfold(0, |count| async move {
                    if count == 5 {
                        return None;
                    }
                    tokio::time::sleep(Duration::from_millis(750)).await;
                    Some((Ok::<_, std::io::Error>("x"), count + 1))
                }))
            }),
        );
    let (backend, task) = server(app).await;
    let root = std::env::temp_dir().join(format!("hermes-idle-{}", uuid::Uuid::new_v4()));
    let bridge = start_with_read_timeout(backend, &root, Duration::from_secs(3))
        .await
        .unwrap();
    let (client, _jar) = browser(&bridge).await;
    let origin = bridge.entry_url.join("/").unwrap();
    let response = tokio::time::timeout(
        Duration::from_secs(5),
        client.get(origin.join("api/stall").unwrap()).send(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let active = tokio::time::timeout(Duration::from_secs(10), async {
        client
            .get(origin.join("api/active-stream").unwrap())
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap()
    })
    .await
    .unwrap();
    assert_eq!(active, "xxxxx"); // The stream outlives the idle deadline because data keeps arriving.
                                 // Drain the first request's notification before checking the second request has entered.
    entered.notified().await;
    let mut stream = client
        .get(origin.join("api/stream").unwrap())
        .send()
        .await
        .unwrap();
    assert_eq!(&stream.chunk().await.unwrap().unwrap()[..], b"start");
    let pending = tokio::spawn({
        let client = client.clone();
        let url = origin.join("api/stall").unwrap();
        async move { client.get(url).send().await }
    });
    tokio::time::timeout(Duration::from_secs(5), entered.notified())
        .await
        .unwrap();
    drop(bridge);
    let response = tokio::time::timeout(Duration::from_secs(5), pending)
        .await
        .unwrap()
        .unwrap();
    assert!(response.is_err() || response.unwrap().status() == StatusCode::SERVICE_UNAVAILABLE);
    let end = tokio::time::timeout(Duration::from_secs(5), stream.chunk())
        .await
        .unwrap();
    assert!(end.is_err() || end.unwrap().is_none());
    release.notify_waiters();
    task.abort();
}
