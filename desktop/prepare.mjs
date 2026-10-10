import { copyFile } from "node:fs/promises";

// Preserve the dedicated multi-resolution desktop icon; the browser favicon is only 48px.
await copyFile(new URL("../src-tauri/icons/icon.ico", import.meta.url), new URL("../dist-desktop/desktop-icon.ico", import.meta.url));
for (const name of ["desktop-connection.html", "desktop-connection.js", "desktop-titlebar.html", "desktop-titlebar.js", "desktop-about.html", "desktop-about.js"]) {
  await copyFile(new URL(name, import.meta.url), new URL(`../dist-desktop/${name}`, import.meta.url));
}
