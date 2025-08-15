const WS_URL = 'ws://localhost:3001';

let websocket: WebSocket | null = null;
let retryCount = 0;
const maxRetryCount = 8;

async function setActionIcon(color: string) {
  const sizes = [16, 32] as const;
  const imageDataMap: Record<number, ImageData> = {} as any;
  for (const s of sizes) {
    const canvas = new OffscreenCanvas(s, s);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.clearRect(0, 0, s, s);
    // background transparent
    // draw outer subtle ring for contrast
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    // draw inner colored dot
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    imageDataMap[s] = ctx.getImageData(0, 0, s, s);
  }
  try {
    await chrome.action.setIcon({ imageData: imageDataMap as any });
  } catch (_) {
    // ignore
  }
}

function setWsStateIcon(state: 'OPEN' | 'CONNECTING' | 'CLOSED') {
  const color = state === 'OPEN' ? '#16a34a' : state === 'CONNECTING' ? '#f59e0b' : '#dc2626';
  void setActionIcon(color);
}

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

  async 'bookmarks.list'(payload) {
    const { parentId, recursive = false, recent = false, maxResults = 50 } = payload || {};
    if (recent) {
      const rec = await chrome.bookmarks.getRecent(Math.max(1, Math.min(100, maxResults)));
      return rec.map((n) => ({ id: n.id, parentId: n.parentId, title: n.title, url: (n as any).url ?? null, dateAdded: n.dateAdded }));
    }
    if (recursive && parentId) {
      const sub = await chrome.bookmarks.getSubTree(parentId);
      return sub; // keep tree structure
    }
    if (parentId) {
      const children = await chrome.bookmarks.getChildren(parentId);
      return children.map((n) => ({ id: n.id, parentId: n.parentId, title: n.title, url: (n as any).url ?? null, dateAdded: n.dateAdded }));
    }
    const tree = await chrome.bookmarks.getTree();
    return tree; // full tree
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

  // Extension utils placeholder to avoid duplicate keys; runtime.reload is handled via popup/WS
  async 'page.screenshot'(payload) {
    const { tabId, format = 'png', quality = 90, bringToFront = true } = payload || {};
    let targetTabId = await getActiveTabId(tabId);
    if (!targetTabId) throw new Error('no_active_tab');
    const tab = await chrome.tabs.get(targetTabId);
    const windowId = tab.windowId;
    if (bringToFront) {
      try { await chrome.windows.update(windowId, { focused: true }); } catch {}
      try { await chrome.tabs.update(targetTabId, { active: true }); } catch {}
      await new Promise(r => setTimeout(r, 120));
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: (format as any), quality });
    return { dataUrl, format };
  },

  async 'page.fullScreenshot'(payload) {
    const { tabId, format = 'png', quality = 90, step = 0.8 } = payload || {};
    let targetTabId = await getActiveTabId(tabId);
    if (!targetTabId) throw new Error('no_active_tab');
    const metrics = await chrome.tabs.sendMessage(targetTabId, { from: 'bg', type: 'page.metrics' });
    const parts: string[] = [];
    const total = metrics?.totalHeight || 0;
    const vh = metrics?.viewportHeight || 0;
    const windowId = (await chrome.tabs.get(targetTabId)).windowId;
    let y = 0;
    const dy = Math.max(1, Math.floor(vh * (typeof step === 'number' ? step : 0.8)));
    while (y < total) {
      await chrome.tabs.sendMessage(targetTabId, { from: 'bg', type: 'dom.scrollTo', top: y, left: 0, smooth: false });
      await new Promise(r => setTimeout(r, 150));
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: (format as any), quality });
      parts.push(dataUrl);
      y += dy;
    }
    return { parts, format, viewportHeight: vh, totalHeight: total };
  },
};

function scheduleReconnect() {
  retryCount = Math.min(retryCount + 1, maxRetryCount);
  const delay = Math.min(30000, 500 * Math.pow(2, retryCount));
  setTimeout(connect, delay);
}

function connect() {
  try {
    setWsStateIcon('CONNECTING');
    if (websocket && (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING)) return;
    websocket = new WebSocket(WS_URL);
    websocket.onopen = () => { retryCount = 0; log('ws open'); setWsStateIcon('OPEN'); };
    websocket.onclose = () => { log('ws close'); setWsStateIcon('CLOSED'); scheduleReconnect(); };
    websocket.onerror = (e: Event | any) => { log('ws error', (e as any)?.message || e); setWsStateIcon('CLOSED'); try { websocket?.close(); } catch (_) {} };
    websocket.onmessage = async (ev: MessageEvent) => {
      let msg: any;
      try { msg = JSON.parse(String((ev as any).data)); } catch (_) { return; }
      const { id, type, payload } = msg || {};
      if (!type) return;
      if (type === 'heartbeat') { setWsStateIcon('OPEN'); return; }
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

// Handle popup messaging
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'ws.status') {
        const state = websocket?.readyState === WebSocket.OPEN ? 'OPEN' : (websocket?.readyState === WebSocket.CONNECTING ? 'CONNECTING' : 'CLOSED');
        return sendResponse({ state, url: WS_URL });
      }
      if (msg?.type === 'ws.reconnect') {
        try { websocket?.close(); } catch {}
        setTimeout(connect, 50);
        return sendResponse({ ok: true });
      }
      if (msg?.type === 'extension.reload') {
        chrome.runtime.reload();
        return sendResponse({ ok: true });
      }
    } catch (e: any) {
      return sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});

// Health check: wake up periodically to correct icon and reconnect if needed
chrome.alarms.create('ws-health', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'ws-health') return;
  const state = websocket?.readyState === WebSocket.OPEN ? 'OPEN' : (websocket?.readyState === WebSocket.CONNECTING ? 'CONNECTING' : 'CLOSED');
  setWsStateIcon(state as any);
  if (state !== 'OPEN') connect();
});

// Clicking the action can also trigger a reconnect + status correction
chrome.action.onClicked.addListener(() => {
  const state = websocket?.readyState === WebSocket.OPEN ? 'OPEN' : (websocket?.readyState === WebSocket.CONNECTING ? 'CONNECTING' : 'CLOSED');
  setWsStateIcon(state as any);
  if (state !== 'OPEN') connect();
});


