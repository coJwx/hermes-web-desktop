const form = document.getElementById("connection-form");
const nameInput = document.getElementById("server-name");
const input = document.getElementById("backend-url");
const button = document.getElementById("connect");
const status = document.getElementById("status");
const serversContainer = document.getElementById("servers-container");
const serverList = document.getElementById("server-list");
const invoke = window.__TAURI__.core.invoke;

let currentServers = [];
let activeServerId = null;

function message(text, error = false) {
  status.textContent = text;
  status.dataset.error = String(error);
}

function renderServers(servers, activeId) {
  currentServers = servers || [];
  activeServerId = activeId;
  if (!serversContainer || !serverList) return;
  if (!currentServers.length) {
    serversContainer.style.display = "none";
    return;
  }
  serversContainer.style.display = "block";
  serverList.innerHTML = "";
  for (const s of currentServers) {
    const item = document.createElement("div");
    item.className = "server-item" + (s.id === activeId || s.url === input.value.trim() ? " active" : "");
    const info = document.createElement("div");
    info.className = "server-info";
    info.innerHTML = `<div class="server-name">${s.name || s.url}</div><div class="server-url">${s.url}</div>`;
    info.onclick = () => {
      if (nameInput) nameInput.value = s.name === s.url ? "" : s.name;
      input.value = s.url;
      renderServers(currentServers, s.id);
    };

    const actions = document.createElement("div");
    actions.className = "server-actions";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-del";
    delBtn.textContent = "删除";
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await invoke("remove_server_profile", { id: s.id });
        await readSettings();
      } catch (err) {
        message(String(err), true);
      }
    };
    actions.appendChild(delBtn);

    item.appendChild(info);
    item.appendChild(actions);
    serverList.appendChild(item);
  }
}

async function readSettings(restoreAddress = false) {
  try {
    const settings = await invoke("connection_settings");
    if (restoreAddress) input.value = settings.backend_url;
    renderServers(settings.servers, settings.active_id);
    const dataDirEl = document.getElementById("data-directory");
    if (dataDirEl) dataDirEl.textContent = settings.data_directory;
    if (button) button.disabled = false;
    message(settings.error ?? "地址可随时修改。是否自动连接可在应用菜单中设置；首次连接可能需要登录。", !!settings.error);
  } catch (error) {
    if (button) button.disabled = false;
    message(`${String(error)}。请输入新地址以修复连接设置。`, true);
    input?.focus();
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
    const url = input.value.trim();
    const name = nameInput ? nameInput.value.trim() || url : url;
    if (nameInput) {
      await invoke("save_server_profile", { name, url, id: null });
    }
    await invoke("connect_backend", { backendUrl: url });
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
