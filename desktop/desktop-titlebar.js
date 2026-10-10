const title = document.getElementById("window-title");
title.textContent = window.__HERMES_TITLE__ ?? "Hermes Dashboard";
title.title = title.textContent;
const invoke = window.__TAURI__.core.invoke;
const menu = document.getElementById("connection-menu");
const maximize = document.getElementById("maximize");
window.showMenuError = (message) => { menu.title = String(message); window.alert(String(message)); };
function syncMaximized(value) {
  document.body.dataset.maximized = String(value);
  maximize.title = value ? "还原" : "最大化";
  maximize.setAttribute("aria-label", maximize.title);
}
syncMaximized(window.__HERMES_MAXIMIZED__ === true);

async function action(name) {
  try {
    const value = await invoke("titlebar_action", { action: name, menuX: menu.getBoundingClientRect().left });
    syncMaximized(value);
  } catch (error) {
    console.error("Window action failed:", error);
    menu.title = `窗口操作失败：${String(error)}`;
  }
}
menu.addEventListener("click", () => void action("menu"));
for (const name of ["minimize", "maximize", "close"]) {
  document.getElementById(name).addEventListener("click", () => void action(name));
}
document.addEventListener("mousedown", (event) => {
  if (event.button !== 0 || !event.target.closest("[data-drag]")) return;
  event.preventDefault();
  void action(event.detail === 2 ? "maximize" : "drag");
});
window.addEventListener("window-state", (event) => syncMaximized(event.detail));
document.addEventListener("keydown", (event) => {
  if (event.altKey && ["c", "m"].includes(event.key.toLowerCase())) {
    event.preventDefault();
    menu.focus();
    void action("menu");
  }
});
