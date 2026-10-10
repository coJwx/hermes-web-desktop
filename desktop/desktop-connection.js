const form = document.getElementById("connection-form");
const input = document.getElementById("backend-url");
const button = document.getElementById("connect");
const status = document.getElementById("status");
const invoke = window.__TAURI__.core.invoke;

function message(text, error = false) {
  status.textContent = text;
  status.dataset.error = String(error);
}

async function readSettings(restoreAddress = false) {
  try {
    const settings = await invoke("connection_settings");
    if (restoreAddress) input.value = settings.backend_url;
    document.getElementById("data-directory").textContent = settings.data_directory;
    button.disabled = false;
    message(settings.error ?? "地址可随时修改。是否自动连接可在应用菜单中设置；首次连接可能需要登录。", !!settings.error);
  } catch (error) {
    button.disabled = false;
    message(`${String(error)}。请输入新地址以修复连接设置。`, true);
    input.focus();
  }
}

window.__TAURI__.event.listen("connection-status-changed", () => void readSettings()).then(
  () => readSettings(true),
  (error) => { console.error("Connection status listener failed:", error); void readSettings(true); },
);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  input.setAttribute("aria-invalid", "false");
  form.setAttribute("aria-busy", "true");
  message("正在连接远程服务…");
  try {
    await invoke("connect_backend", { backendUrl: input.value.trim() });
    message("已连接。可以从窗口菜单重新打开此设置。");
  } catch (error) {
    message(String(error), true);
    input.setAttribute("aria-invalid", "true");
    input.focus();
  } finally {
    button.disabled = false;
    form.setAttribute("aria-busy", "false");
  }
});
