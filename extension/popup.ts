function qs<T extends HTMLElement = HTMLElement>(sel: string) {
  return document.querySelector(sel) as T | null;
}

chrome.runtime.getBackgroundPage?.(() => {}); // noop for MV3 types

function updateStatus(state: 'ok'|'warn'|'err', text: string, url: string) {
  const dot = qs<HTMLSpanElement>('#wsDot');
  const t = qs<HTMLSpanElement>('#wsText');
  const u = qs<HTMLSpanElement>('#wsUrl');
  if (dot && t && u) {
    dot.className = `dot ${state}`;
    t.textContent = text;
    u.textContent = url;
  }
}

async function queryWsStatus() {
  const url = await chrome.runtime.getURL(''); // base
  return new Promise<{ state: 'ok'|'warn'|'err'; text: string; url: string }>((resolve) => {
    chrome.runtime.sendMessage({ from: 'popup', type: 'ws.status' }, (resp) => {
      const wsUrl = resp?.url || 'unknown';
      if (resp?.state === 'OPEN') return resolve({ state: 'ok', text: 'Connected', url: wsUrl });
      if (resp?.state === 'CONNECTING') return resolve({ state: 'warn', text: 'Connecting…', url: wsUrl });
      resolve({ state: 'err', text: 'Disconnected', url: wsUrl });
    });
  });
}

async function main() {
  const btnReconnect = qs<HTMLButtonElement>('#btnReconnect');

  btnReconnect?.addEventListener('click', async () => {
    chrome.runtime.sendMessage({ from: 'popup', type: 'ws.reconnect' });
    setTimeout(async () => {
      const s = await queryWsStatus();
      updateStatus(s.state, s.text, s.url);
    }, 500);
  });

  const s = await queryWsStatus();
  updateStatus(s.state, s.text, s.url);
}

document.addEventListener('DOMContentLoaded', main);


