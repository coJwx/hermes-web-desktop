use super::*;
use axum::routing::get;
use std::sync::atomic::{AtomicBool, Ordering};

async fn server(valid: Arc<AtomicBool>) -> (Url, tokio::task::JoinHandle<()>) {
    let app = Router::new().route(
        "/",
        get(move || {
            let valid = valid.clone();
            async move {
                if valid.load(Ordering::SeqCst) {
                    r#"<script>window.__HERMES_SESSION_TOKEN__="fixture";</script>"#
                } else {
                    "<html>Unrelated site</html>"
                }
            }
        }),
    );
    let app = app.route(
        "/auth-gateway/",
        get(|| async {
            (
                StatusCode::SEE_OTHER,
                [(header::LOCATION, "https://identity.example/authorize")],
            )
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (url, task)
}

#[tokio::test]
async fn invalid_backend_preflight_does_not_replace_saved_address_or_old_bridge() {
    let (old_url, old_task) = server(Arc::new(AtomicBool::new(true))).await;
    let (bad_url, bad_task) = server(Arc::new(AtomicBool::new(false))).await;
    let root = std::env::temp_dir().join(format!("hermes-preflight-{}", uuid::Uuid::new_v4()));
    let path = root.join("connection.json");
    crate::settings::save(&path, &old_url).unwrap();
    let bridge = start(old_url.clone(), &root).await.unwrap();
    // A root auth gateway can legitimately redirect off-origin; preflight never follows it.
    drop(
        start(old_url.join("auth-gateway/").unwrap(), &root)
            .await
            .unwrap(),
    );
    assert!(start(bad_url, &root).await.is_err());
    assert_eq!(crate::settings::load(&path).unwrap(), old_url.as_str());
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    assert!(client
        .get(bridge.entry_url.clone())
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    drop(bridge);
    old_task.abort();
    bad_task.abort();
    std::fs::remove_file(path).unwrap();
    std::fs::remove_dir(root).unwrap();
}

#[tokio::test]
async fn rollback_reentry_and_native_replies_remain_one_use_same_origin_and_correlated() {
    let (url, task) = server(Arc::new(AtomicBool::new(true))).await;
    let root = std::env::temp_dir().join(format!("hermes-reentry-{}", uuid::Uuid::new_v4()));
    let first = start(url.clone(), &root).await.unwrap();
    let second = start(url, &root).await.unwrap();
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .build()
        .unwrap();
    assert!(client
        .get(first.entry_url.clone())
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    assert!(client
        .get(second.entry_url.clone())
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    let origin = first.entry_url.join("/").unwrap();
    assert_eq!(
        client.get(origin.clone()).send().await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    let restored_entry = first.issue_entry();
    assert_ne!(restored_entry, first.entry_url);
    assert!(client
        .get(restored_entry.clone())
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    assert_eq!(
        client.get(restored_entry).send().await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let endpoint = origin.join("__desktop/leave").unwrap();
    let (id, response) = first.leave.begin().unwrap();
    let payload = serde_json::json!({"request_id":id,"decision":"allow"});
    let post = |client: &reqwest::Client| {
        client
            .post(endpoint.clone())
            .header(header::CONTENT_TYPE, "application/json")
            .body(payload.to_string())
    };
    assert_eq!(
        post(&reqwest::Client::new()).send().await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        post(&client)
            .header(header::ORIGIN, "https://evil.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        client
            .post(endpoint.clone())
            .header(header::CONTENT_TYPE, "application/json")
            .body(r#"{"request_id":"stale","decision":"allow"}"#)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        post(&client).send().await.unwrap().status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        crate::leave_gate::wait(response).await,
        crate::leave_gate::Decision::Allow
    );
    assert_eq!(
        post(&client).send().await.unwrap().status(),
        StatusCode::CONFLICT
    );
    first.leave.cancel(&id);
    drop(first);
    drop(second);
    task.abort();
}
