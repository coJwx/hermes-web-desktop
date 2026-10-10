pub fn matches(label: &str, expected: &str, url: &url::Url, page: &str) -> bool {
    label == expected
        && url.path() == format!("/{page}")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost")))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn connection_identity_requires_exact_label_origin_and_path() {
        let check = |label, raw| {
            matches(
                label,
                "connection",
                &url::Url::parse(raw).unwrap(),
                "desktop-connection.html",
            )
        };
        assert!(check(
            "connection",
            "http://tauri.localhost/desktop-connection.html"
        ));
        assert!(check(
            "connection",
            "tauri://localhost/desktop-connection.html"
        ));
        for raw in [
            "http://127.0.0.1/desktop-connection.html",
            "https://tauri.localhost/desktop-connection.html",
            "http://tauri.localhost:1234/desktop-connection.html",
            "http://tauri.localhost/desktop-about.html",
            "http://tauri.localhost/desktop-connection.html?remote=true",
        ] {
            assert!(!check("connection", raw));
        }
        assert!(!check(
            "dashboard-content",
            "http://tauri.localhost/desktop-connection.html"
        ));
    }
}
