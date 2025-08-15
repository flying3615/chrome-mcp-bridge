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
          case 'dom.queryAll': {
            const selector: string = msg.selector || '*';
            const limit: number = typeof msg.limit === 'number' ? msg.limit : 50;
            const nodes = Array.from(document.querySelectorAll(selector)).slice(0, limit);
            const infos = nodes.map((el: Element) => {
              const rect = (el as HTMLElement).getBoundingClientRect?.() || { x: 0, y: 0, width: 0, height: 0 };
              const tag = el.tagName.toLowerCase();
              const id = (el as HTMLElement).id || null;
              const className = (el as HTMLElement).className || '';
              const text = (el as HTMLElement).innerText?.trim?.() || '';
              const href = (el as HTMLAnchorElement).href || null;
              const value = (el as HTMLInputElement | HTMLTextAreaElement).value ?? null;
              return { tag, id, class: className, text, href, value, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
            });
            return sendResponse({ ok: true, nodes: infos });
          }
          case 'dom.clickByText': {
            const text: string = msg.text || '';
            const selector: string = msg.selector || '*';
            const exact: boolean = !!msg.exact;
            const nth: number = typeof msg.nth === 'number' ? msg.nth : 0;
            const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
            const targetText = norm(String(text));
            const candidates = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
            const visible = (el: HTMLElement) => {
              const style = getComputedStyle(el);
              if (style.visibility === 'hidden' || style.display === 'none') return false;
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            };
            const matched: HTMLElement[] = [];
            for (const el of candidates) {
              try {
                const t = norm(el.innerText || '');
                if (!t) continue;
                if ((exact && t === targetText) || (!exact && t.includes(targetText))) {
                  if (visible(el)) matched.push(el);
                }
              } catch {}
            }
            const target = matched[nth] || null;
            (target as any)?.click?.();
            return sendResponse({ ok: !!target, matched: matched.length, clickedIndex: nth });
          }
          case 'dom.fillByLabel': {
            const labelText: string = msg.label || '';
            const value: string = msg.value ?? '';
            const exact: boolean = !!msg.exact;
            const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
            const labels = Array.from(document.querySelectorAll('label')) as HTMLLabelElement[];
            const targetLabel = labels.find(l => {
              const t = norm(l.innerText || '');
              return exact ? (t === norm(labelText)) : t.includes(norm(labelText));
            });
            let input: HTMLInputElement | HTMLTextAreaElement | null = null;
            if (targetLabel) {
              const id = targetLabel.getAttribute('for');
              if (id) {
                const el = document.getElementById(id) as any;
                if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) input = el;
              }
              if (!input) {
                const el = targetLabel.querySelector('input,textarea') as any;
                if (el) input = el;
              }
            }
            if (!input) return sendResponse({ ok: false, reason: 'not_found' });
            (input as any).focus?.();
            (input as any).value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
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


