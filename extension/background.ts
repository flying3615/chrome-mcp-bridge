const WS_URL = 'ws://localhost:3001';

let websocket: WebSocket | null = null;
let retryCount = 0;
const maxRetryCount = 8;

function log(...args: unknown[]) {
  try { console.log('[mcp-ext]', ...args); } catch (_) {}
}

function sendWs(data: unknown) {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) return false;
  try { websocket.send(JSON.stringify(data)); return true; } catch (_) { return false; }
}

async function getActiveTabId(tabId?: number | null): Promise<number | null> {
  if (tabId) return tabId;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active?.id ?? null;
}

const handlers: Record<string, (payload: any) => Promise<any>> = {
  async 'tabs.create'(payload) {
    const { url, active = true } = payload || {};
    const tab = await chrome.tabs.create({ url, active });
    return { tabId: tab.id, windowId: tab.windowId };
  },

  async 'tabs.query'(payload) {
    const query = payload?.query || {};
    const tabs = await chrome.tabs.query(query);
    return tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId }));
  },

  async 'tabs.activate'(payload) {
    const tabId = await getActiveTabId(payload?.tabId);
    if (!tabId) throw new Error('no_active_tab');
    await chrome.tabs.update(tabId, { active: true });
    return { ok: true };
  },

  async 'tabs.remove'(payload) {
    const tabId = await getActiveTabId(payload?.tabId);
    if (!tabId) throw new Error('no_active_tab');
    await chrome.tabs.remove(tabId);
    return { ok: true };
  },

  async 'tabs.reload'(payload) {
    const tabId = await getActiveTabId(payload?.tabId);
    if (!tabId) throw new Error('no_active_tab');
    await chrome.tabs.reload(tabId, { bypassCache: !!payload?.bypassCache });
    return { ok: true };
  },

  async 'navigate.to'(payload) {
    const tabId = await getActiveTabId(payload?.tabId);
    if (!tabId) throw new Error('no_active_tab');
    await chrome.tabs.update(tabId, { url: payload?.url });
    return { ok: true };
  },

  async 'scripting.run'(payload) {
    let { tabId, code, args = {}, allFrames = false, world = 'ISOLATED' } = payload || {};
    tabId = await getActiveTabId(tabId);
    if (!tabId) throw new Error('no_active_tab');
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames },
      world,
      func: (src: string, fnArgs: any) => {
        const fn = new Function('args', src);
        return Promise.resolve(fn(fnArgs));
      },
      args: [code, args]
    });
    return results.map(r => ({ frameId: r.frameId, result: r.result }));
  },

  async 'dom.dispatch'(payload) {
    let { tabId, message } = payload || {};
    tabId = await getActiveTabId(tabId);
    if (!tabId) throw new Error('no_active_tab');
    try {
      const resp = await chrome.tabs.sendMessage(tabId, { from: 'bg', ...message });
      return resp;
    } catch (e) {
      // 如果内容脚本未注入，则动态注入后重试一次
      await chrome.scripting.executeScript({ target: { tabId }, files: ['dist/content.js'] });
      const resp2 = await chrome.tabs.sendMessage(tabId, { from: 'bg', ...message });
      return resp2;
    }
  },

  // Bookmarks
  async 'bookmarks.create'(payload) {
    const { parentId, title, url } = payload || {};
    if (!title || !url) throw new Error('invalid_args');
    const node = await chrome.bookmarks.create({ parentId, title, url });
    return { id: node.id, parentId: node.parentId, title: node.title, url: (node as any).url ?? null };
  },

  async 'bookmarks.search'(payload) {
    const { query } = payload || {};
    const results = await chrome.bookmarks.search(query ?? '');
    return results.map((n) => ({ id: n.id, parentId: n.parentId, title: n.title, url: (n as any).url ?? null }));
  },

  async 'bookmarks.remove'(payload) {
    const { id } = payload || {};
    if (!id) throw new Error('invalid_args');
    await chrome.bookmarks.remove(id);
    return { ok: true };
  },

  // History
  async 'history.search'(payload) {
    const { text = '', startTime, endTime, maxResults } = payload || {};
    const items = await chrome.history.search({ text, startTime, endTime, maxResults });
    return items.map((i) => ({ url: i.url, title: i.title, lastVisitTime: i.lastVisitTime, visitCount: i.visitCount, typedCount: i.typedCount }));
  },

  async 'history.deleteUrl'(payload) {
    const { url } = payload || {};
    if (!url) throw new Error('invalid_args');
    await chrome.history.deleteUrl({ url });
    return { ok: true };
  },
};

function scheduleReconnect() {
  retryCount = Math.min(retryCount + 1, maxRetryCount);
  const delay = Math.min(30000, 500 * Math.pow(2, retryCount));
  setTimeout(connect, delay);
}

function connect() {
  try {
    if (websocket && (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING)) return;
    websocket = new WebSocket(WS_URL);
    websocket.onopen = () => { retryCount = 0; log('ws open'); };
    websocket.onclose = () => { log('ws close'); scheduleReconnect(); };
    websocket.onerror = (e: Event | any) => { log('ws error', (e as any)?.message || e); try { websocket?.close(); } catch (_) {} };
    websocket.onmessage = async (ev: MessageEvent) => {
      let msg: any;
      try { msg = JSON.parse(String((ev as any).data)); } catch (_) { return; }
      const { id, type, payload } = msg || {};
      if (!type) return;
      const handler = handlers[type];
      if (!handler) return void sendWs({ id, ok: false, error: `unknown_type:${type}` });
      try {
        const result = await handler(payload);
        sendWs({ id, ok: true, result });
      } catch (err: any) {
        sendWs({ id, ok: false, error: String(err?.message || err) });
      }
    };
  } catch (e: any) {
    log('connect failed', e?.message || e);
    scheduleReconnect();
  }
}

chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);


