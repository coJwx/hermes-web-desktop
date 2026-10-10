// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';

function form() {
  document.body.innerHTML = '<form id="connection-form"><input id="backend-url"><button id="connect" disabled>保存并连接</button><p id="status"></p></form><span id="data-directory"></span>';
}
afterEach(() => { delete window.__TAURI__; document.body.innerHTML = ''; vi.resetModules(); });

test('saved settings and asynchronous startup failure appear without overwriting an edited address', async () => {
  form();
  let listener;
  const settings = {backend_url:'https://example.com/hermes/', data_directory:'C:\\test-profile', error:null};
  window.__TAURI__ = {core:{invoke:vi.fn(async () => ({...settings}))}, event:{listen:vi.fn(async (_event, callback) => {listener=callback;})}};
  await import('../../desktop/desktop-connection.js');
  await vi.waitFor(() => expect(document.getElementById('backend-url').value).toBe(settings.backend_url));
  expect(document.getElementById('data-directory').textContent).toBe(settings.data_directory);
  document.getElementById('backend-url').value = 'https://another.example/';
  settings.error = '自动连接失败：服务器不可达';
  listener();
  await vi.waitFor(() => expect(document.getElementById('status').textContent).toBe(settings.error));
  expect(document.getElementById('status').dataset.error).toBe('true');
  expect(document.getElementById('backend-url').value).toBe('https://another.example/');
});

test('failed manual retry restores controls and keeps the entered address for correction', async () => {
  form();
  const invoke=vi.fn(async (command) => {
    if(command==='connect_backend') throw new Error('后端不可达');
    return {backend_url:'https://example.com/',data_directory:'C:\\test-profile',error:null};
  });
  window.__TAURI__={core:{invoke},event:{listen:async () => {}}};
  await import('../../desktop/desktop-connection.js');
  await vi.waitFor(() => expect(document.getElementById('connect').disabled).toBe(false));
  document.getElementById('backend-url').value=' https://retry.example/ ';
  document.getElementById('connection-form').dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.waitFor(() => expect(document.getElementById('status').textContent).toContain('后端不可达'));
  expect(invoke).toHaveBeenCalledWith('connect_backend',{backendUrl:'https://retry.example/'});
  expect(document.getElementById('connect').disabled).toBe(false);
  expect(document.getElementById('connection-form').getAttribute('aria-busy')).toBe('false');
  expect(document.getElementById('backend-url').getAttribute('aria-invalid')).toBe('true');
});
