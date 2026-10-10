// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
afterEach(() => { delete window.__TAURI__; delete window.refreshAbout; document.body.innerHTML=''; vi.resetModules(); });
function fields() { document.body.innerHTML='<span id="version"></span><span id="backend"></span><span id="data"></span><span id="webview"></span><p id="error"></p>'; }
test('about renders native metadata as text and refreshes after backend changes',async () => {
    fields();
    const details={client_version:'test-client',backend_url:'https://example.com/',data_directory:'C:\\profile',webview_directory:'C:\\cache'};
    window.__TAURI__={core:{invoke:vi.fn(async () => ({...details}))}};
    await import('../../desktop/desktop-about.js');
    await vi.waitFor(() => expect(document.getElementById('backend').textContent).toBe(details.backend_url));
    expect(document.getElementById('data').textContent).toBe(details.data_directory);
    details.backend_url='<img src=x onerror=alert(1)>';
    await window.refreshAbout();
    expect(document.getElementById('backend').textContent).toBe(details.backend_url);
    expect(document.querySelector('img')).toBeNull();
});
test('about reports read failure rather than displaying a success placeholder',async () => {
    fields();
    window.__TAURI__={core:{invoke:async () => {throw new Error('metadata denied');}}};
    await import('../../desktop/desktop-about.js');
    await vi.waitFor(() => expect(document.getElementById('error').textContent).toContain('metadata denied'));
});
