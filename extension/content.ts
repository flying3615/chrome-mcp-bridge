(function () {
  function q(selector: string, root?: Document | Element | null) { return (root || document).querySelector(selector); }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.from !== 'bg') return;
    (async () => {
      try {
        switch (msg.type) {
          case 'dom.click': {
            const el = q(msg.selector);
            (el as HTMLElement | null)?.click();
            return sendResponse({ ok: !!el });
          }
          case 'dom.fill': {
            const el = q(msg.selector) as HTMLInputElement | HTMLTextAreaElement | null;
            if (!el) return sendResponse({ ok: false, reason: 'not_found' });
            (el as any).focus?.();
            (el as any).value = msg.value ?? '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return sendResponse({ ok: true });
          }
          case 'dom.readText': {
            const el = q(msg.selector) as HTMLElement | null;
            return sendResponse({ ok: !!el, text: el?.innerText ?? null });
          }
          case 'dom.scrollTo': {
            window.scrollTo({ top: msg.top ?? 0, left: msg.left ?? 0, behavior: msg.smooth ? 'smooth' : 'auto' });
            return sendResponse({ ok: true });
          }
          case 'dom.readHTML': {
            const html = document.documentElement?.outerHTML ?? '';
            if (msg.includeDoctype) {
              const dt = document.doctype;
              if (dt) {
                const dts = '<!DOCTYPE ' + dt.name + (dt.publicId ? ' PUBLIC "' + dt.publicId + '"' : '') + (dt.systemId ? ' "' + dt.systemId + '"' : '') + '>';
                return sendResponse({ ok: true, html: dts + '\n' + html });
              }
            }
            return sendResponse({ ok: true, html });
          }
          default:
            return sendResponse({ ok: false, reason: `unknown:${msg.type}` });
        }
      } catch (e: any) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  });
})();


