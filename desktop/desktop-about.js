window.refreshAbout = () => window.__TAURI__.core.invoke("about_details").then((details) => {
  for (const [id, value] of [["version", details.client_version], ["backend", details.backend_url], ["data", details.data_directory], ["webview", details.webview_directory]]) {
    document.getElementById(id).textContent = value;
  }
}).catch((error) => { document.getElementById("error").textContent = String(error); });

window.refreshAbout();
