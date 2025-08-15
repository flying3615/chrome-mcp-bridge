#!/usr/bin/env node
import { FastMCP } from "fastmcp";
import { z } from "zod";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { v4 as uuidv4 } from "uuid";

const PORT: number = process.env.MCP_BRIDGE_PORT ? Number(process.env.MCP_BRIDGE_PORT) : 3001;

const wss = new WebSocketServer({ port: PORT });
const wsClients: Set<WebSocket> = new Set();
const pending: Map<string, { resolve: (value: any) => void; reject: (err: any) => void; timeout: NodeJS.Timeout }> = new Map();

wss.on("connection", (ws: WebSocket) => {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
ws.on("message", (raw: RawData) => {
    let msg: any;
    try {
      const text = typeof raw === "string" ? raw : (raw as Buffer).toString();
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const { id } = msg || {};
    if (id && pending.has(id)) {
      const { resolve, timeout } = pending.get(id)!;
      clearTimeout(timeout);
      pending.delete(id);
      resolve(msg);
    }
  });
});

function sendToExtension(packet: any, timeoutMs = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (wsClients.size === 0) return reject(new Error("no_extension_connected"));
    const id = packet.id || uuidv4();
    const wrapped = { ...packet, id };
    for (const ws of wsClients) {
      try {
        ws.send(JSON.stringify(wrapped));
      } catch {}
    }
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("timeout"));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
  });
}

const server = new FastMCP({
  name: "ws-browser-bridge",
  version: "0.1.0",
});

server.addTool({
  name: "tabs.create",
  description: "在浏览器打开一个新标签页",
  parameters: z.object({
    url: z.string(),
    active: z.boolean().optional(),
  }),
  execute: async ({ url, active = true }) => {
    const resp = await sendToExtension({ type: "tabs.create", payload: { url, active } });
    if (resp.ok === false) throw new Error(resp.error || "tabs.create_failed");
    return `tabs.create ok ${JSON.stringify(resp.result || { ok: true })}`;
  },
});

server.addTool({
  name: "tabs.query",
  description: "查询标签页列表（可按条件）",
  parameters: z.object({
    query: z.record(z.any()).optional(),
  }),
  execute: async ({ query = {} }) => {
    const resp = await sendToExtension({ type: "tabs.query", payload: { query } });
    if (resp.ok === false) throw new Error(resp.error || "tabs.query_failed");
    return `tabs.query ok ${JSON.stringify(resp.result)}`;
  },
});

server.addTool({
  name: "tabs.activate",
  description: "激活指定或当前活动标签页",
  parameters: z.object({ tabId: z.number().nullable().optional() }),
  execute: async ({ tabId }) => {
    const resp = await sendToExtension({ type: "tabs.activate", payload: { tabId } });
    if (resp.ok === false) throw new Error(resp.error || "tabs.activate_failed");
    return `tabs.activate ok ${JSON.stringify(resp.result || { ok: true })}`;
  },
});

server.addTool({
  name: "tabs.remove",
  description: "关闭指定或当前活动标签页",
  parameters: z.object({ tabId: z.number().nullable().optional() }),
  execute: async ({ tabId }) => {
    const resp = await sendToExtension({ type: "tabs.remove", payload: { tabId } });
    if (resp.ok === false) throw new Error(resp.error || "tabs.remove_failed");
    return `tabs.remove ok ${JSON.stringify(resp.result || { ok: true })}`;
  },
});

server.addTool({
  name: "tabs.reload",
  description: "重新加载标签页，可选绕过缓存",
  parameters: z.object({
    tabId: z.number().nullable().optional(),
    bypassCache: z.boolean().optional(),
  }),
  execute: async ({ tabId, bypassCache }) => {
    const resp = await sendToExtension({ type: "tabs.reload", payload: { tabId, bypassCache } });
    if (resp.ok === false) throw new Error(resp.error || "tabs.reload_failed");
    return `tabs.reload ok ${JSON.stringify(resp.result || { ok: true })}`;
  },
});

server.addTool({
  name: "navigate.to",
  description: "让目标标签页跳转到指定 URL（默认当前活动标签页）",
  parameters: z.object({
    tabId: z.number().nullable().optional(),
    url: z.string(),
  }),
  execute: async ({ tabId, url }) => {
    const resp = await sendToExtension({ type: "navigate.to", payload: { tabId, url } });
    if (resp.ok === false) throw new Error(resp.error || "navigate.to_failed");
    return `navigate.to ok ${JSON.stringify(resp.result || { ok: true })}`;
  },
});

server.addTool({
  name: "scripting.run",
  description: "在扩展隔离环境执行 JS 代码，返回执行结果",
  parameters: z.object({
    tabId: z.number().nullable().optional(),
    code: z.string(),
    args: z.record(z.any()).optional(),
    allFrames: z.boolean().optional(),
  }),
  execute: async ({ tabId, code, args, allFrames = false }) => {
    const resp = await sendToExtension(
      { type: "scripting.run", payload: { tabId, code, args, allFrames } },
      20000
    );
    if (resp.ok === false) throw new Error(resp.error || "scripting.run_failed");
    return `scripting.run ok ${JSON.stringify(resp.result)}`;
  },
});

server.addTool({
  name: "dom.dispatch",
  description: "在页面内容脚本中执行 DOM 操作（点击/输入/读取文本/滚动等）",
  parameters: z.object({
    tabId: z.number().nullable().optional(),
    message: z.object({
      type: z.string(),
      selector: z.string().nullable().optional(),
      value: z.string().nullable().optional(),
      top: z.number().nullable().optional(),
      left: z.number().nullable().optional(),
      smooth: z.boolean().nullable().optional(),
    }),
  }),
  execute: async ({ tabId, message }) => {
    const resp = await sendToExtension({ type: "dom.dispatch", payload: { tabId, message } });
    if (resp.ok === false) throw new Error(resp.error || "dom.dispatch_failed");
    return `dom.dispatch ok ${JSON.stringify(resp.result || { ok: true })}`;
  },
});

// DOM enhanced helpers
server.addTool({
  name: "dom.queryAll",
  description: "查询选择器匹配的节点（返回 tag/id/class/text/href/value 与 rect）",
  parameters: z.object({
    tabId: z.number().nullable().optional(),
    selector: z.string().optional(),
    limit: z.number().optional(),
  }),
  execute: async ({ tabId, selector, limit }) => {
    const resp = await sendToExtension({ type: "dom.dispatch", payload: { tabId, message: { type: 'dom.queryAll', selector, limit } } });
    if (resp.ok === false) throw new Error(resp.error || "dom.queryAll_failed");
    return resp.result?.nodes ?? [];
  },
});

server.addTool({
  name: "dom.clickByText",
  description: "根据可见文本点击元素（可选选择器、是否精确匹配、选择第 n 个）",
  parameters: z.object({
    tabId: z.number().nullable().optional(),
    text: z.string(),
    selector: z.string().optional(),
    exact: z.boolean().optional(),
    nth: z.number().optional(),
  }),
  execute: async ({ tabId, text, selector, exact, nth }) => {
    const resp = await sendToExtension({ type: "dom.dispatch", payload: { tabId, message: { type: 'dom.clickByText', text, selector, exact, nth } } });
    if (resp.ok === false) throw new Error(resp.error || "dom.clickByText_failed");
    return resp.result ?? { ok: false };
  },
});

server.addTool({
  name: "dom.fillByLabel",
  description: "根据 label 文本填充输入框（支持精确/模糊）",
  parameters: z.object({
    tabId: z.number().nullable().optional(),
    label: z.string(),
    value: z.string(),
    exact: z.boolean().optional(),
  }),
  execute: async ({ tabId, label, value, exact }) => {
    const resp = await sendToExtension({ type: "dom.dispatch", payload: { tabId, message: { type: 'dom.fillByLabel', label, value, exact } } });
    if (resp.ok === false) throw new Error(resp.error || "dom.fillByLabel_failed");
    return resp.result ?? { ok: false };
  },
});

// Screenshot
server.addTool({
  name: "page.screenshot",
  description: "对当前/指定标签页截图，返回 dataURL（png/jpeg）",
  parameters: z.object({
    tabId: z.number().nullable().optional(),
    format: z.enum(["png", "jpeg"]).optional(),
    quality: z.number().min(0).max(100).optional(),
    bringToFront: z.boolean().optional(),
  }),
  execute: async ({ tabId, format = "png", quality = 90, bringToFront = true }) => {
    const resp = await sendToExtension({ type: "page.screenshot", payload: { tabId, format, quality, bringToFront } }, 20000);
    if (resp.ok === false) throw new Error(resp.error || "page.screenshot_failed");
    const dataUrl: string | undefined = resp.result?.dataUrl;
    if (!dataUrl || typeof dataUrl !== 'string') throw new Error('no_image');
    // data:image/png;base64,XXXX
    const match = dataUrl.match(/^data:(.+?);base64,(.*)$/);
    if (!match) {
      // Fallback: return as text
      return { content: [{ type: 'text', text: dataUrl }] } as any;
    }
    const mimeType = match[1] || (format === 'jpeg' ? 'image/jpeg' : 'image/png');
    const base64 = match[2] || '';
    return { content: [{ type: 'image', data: base64, mimeType }] } as any;
  },
});

server.addTool({
  name: "page.fullScreenshot",
  description: "整页截图：分段滚动并返回分片数组（客户端可拼接）",
  parameters: z.object({
    tabId: z.number().nullable().optional(),
    format: z.enum(["png", "jpeg"]).optional(),
    quality: z.number().min(0).max(100).optional(),
    step: z.number().min(0.2).max(1).optional(),
  }),
  execute: async ({ tabId, format = "png", quality = 90, step = 0.8 }) => {
    const resp = await sendToExtension({ type: "page.fullScreenshot", payload: { tabId, format, quality, step } }, 60000);
    if (resp.ok === false) throw new Error(resp.error || "page.fullScreenshot_failed");
    const parts: string[] = Array.isArray(resp.result?.parts) ? resp.result.parts : [];
    if (parts.length === 0) throw new Error('no_image_parts');
    // 转为 MCP 内容数组（多张）
    const contents = parts.map((dataUrl: string) => {
      const m = dataUrl.match(/^data:(.+?);base64,(.*)$/);
      if (!m) return { type: 'text', text: dataUrl } as const;
      return { type: 'image', data: m[2], mimeType: m[1] } as const;
    });
    return { content: contents as any };
  },
});

// Bookmarks tools
server.addTool({
  name: "bookmarks.create",
  description: "创建书签（可指定父目录）",
  parameters: z.object({
    parentId: z.string().optional(),
    title: z.string(),
    url: z.string(),
  }),
  execute: async ({ parentId, title, url }) => {
    const resp = await sendToExtension({ type: "bookmarks.create", payload: { parentId, title, url } });
    if (resp.ok === false) throw new Error(resp.error || "bookmarks.create_failed");
    return `bookmarks.create ok ${JSON.stringify(resp.result)}`;
  },
});

server.addTool({
  name: "bookmarks.search",
  description: "搜索书签（关键词或对象查询）",
  parameters: z.object({ query: z.any().optional() }),
  execute: async ({ query }) => {
    const resp = await sendToExtension({ type: "bookmarks.search", payload: { query } });
    if (resp.ok === false) throw new Error(resp.error || "bookmarks.search_failed");
    return `bookmarks.search ok ${JSON.stringify(resp.result)}`;
  },
});

server.addTool({
  name: "bookmarks.remove",
  description: "删除指定书签",
  parameters: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    const resp = await sendToExtension({ type: "bookmarks.remove", payload: { id } });
    if (resp.ok === false) throw new Error(resp.error || "bookmarks.remove_failed");
    return `bookmarks.remove ok ${JSON.stringify(resp.result || { ok: true })}`;
  },
});

// History tools
server.addTool({
  name: "history.search",
  description: "查询历史（支持时间范围与最大条数）",
  parameters: z.object({
    text: z.string().optional(),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    maxResults: z.number().optional(),
  }),
  execute: async ({ text, startTime, endTime, maxResults }) => {
    const resp = await sendToExtension({ type: "history.search", payload: { text, startTime, endTime, maxResults } });
    if (resp.ok === false) throw new Error(resp.error || "history.search_failed");
    return `history.search ok ${JSON.stringify(resp.result)}`;
  },
});

server.addTool({
  name: "history.deleteUrl",
  description: "删除指定 URL 的历史记录",
  parameters: z.object({ url: z.string() }),
  execute: async ({ url }) => {
    const resp = await sendToExtension({ type: "history.deleteUrl", payload: { url } });
    if (resp.ok === false) throw new Error(resp.error || "history.deleteUrl_failed");
    return `history.deleteUrl ok ${JSON.stringify(resp.result || { ok: true })}`;
  },
});

// Page content tool
server.addTool({
  name: "page.getContent",
  description: "获取当前活动标签页内容：支持返回纯文本或完整 HTML",
  parameters: z.object({
    tabId: z.number().nullable().optional(),
    // format: 'text' 仅返回可见文本；'html' 返回完整 HTML
    format: z.enum(["text", "html"]).optional().default("text"),
    includeDoctype: z.boolean().optional(),
  }),
  execute: async ({ tabId, format = "text", includeDoctype = true }) => {
    if (format === "text") {
      const resp = await sendToExtension({ type: "dom.dispatch", payload: { tabId, message: { type: 'dom.readText', selector: 'body' } } }, 20000);
      if (resp.ok === false) throw new Error(resp.error || "page.getContent_failed");
      const text = resp.result?.text ?? '';
      return typeof text === 'string' ? text : '';
    }
    // html
    const resp = await sendToExtension({ type: "dom.dispatch", payload: { tabId, message: { type: 'dom.readHTML', includeDoctype } } }, 20000);
    if (resp.ok === false) throw new Error(resp.error || "page.getContent_failed");
    const html = resp.result?.html ?? '';
    return typeof html === 'string' ? html : '';
  },
});

// Extension utils
server.addTool({
  name: "extension.reload",
  description: "重载扩展（触发 runtime.reload()）",
  parameters: z.object({}),
  execute: async () => {
    // Use runtime message path handled by background onMessage
    const resp = await sendToExtension({ type: "extension.reload", payload: {} });
    if (resp.ok === false) throw new Error(resp.error || "extension.reload_failed");
    return `extension.reload ok`;
  },
});

await server.start({ transportType: "stdio" });
console.error(`FastMCP server started. Waiting for extension on ws://localhost:${PORT}`);


