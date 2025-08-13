# chrome-mcp-bridge

A Chrome extension + Node.js bridge that exposes browser automation via the Model Context Protocol (MCP). The server is implemented in TypeScript using FastMCP; the extension provides tab control, script execution, DOM operations, bookmarks/history management, and page content extraction.

## Features
- Tab and navigation control
  - `tabs.create`, `tabs.query`, `tabs.activate`, `tabs.remove`, `tabs.reload`
  - `navigate.to` (open/navigate to URL)
- Scripting and DOM
  - `scripting.run` to execute JavaScript (isolated/main world)
  - `dom.dispatch` for DOM actions (click/fill/read/scroll)
  - `page.getContent` to get page text or full HTML
- Data management
  - Bookmarks: `bookmarks.create`, `bookmarks.search`, `bookmarks.remove`
  - History: `history.search`, `history.deleteUrl`
- Robustness
  - Extension auto reconnect to server (WebSocket)
  - Content script lazy injection fallback
- CI/CD
  - GitHub Actions to build both subprojects and publish a zipped extension to Releases

## Repository Structure
- `extension/` – Chrome extension (TypeScript sources; outputs to `extension/dist/`)
- `mcp/` – MCP server (TypeScript sources; outputs to `mcp/dist/`)
- `.github/workflows/build-and-release.yml` – CI workflow to build and create a Release

## Requirements
- Node.js 20+
- Chrome/Chromium

## Setup
### 1) Install deps and build
```bash
# Extension
cd extension
npm ci
npm run build

# MCP server
cd ../mcp
npm ci
npm run build
```

### 2) Run the MCP server
```bash
cd mcp
# listens for the extension at ws://localhost:3001 by default
npm start

# customize port if needed
MCP_BRIDGE_PORT=3002 npm start
```

### 3) Load the extension
- Open `chrome://extensions/` and enable Developer Mode
- Click “Load unpacked” and select the `extension` folder
- Open the Service Worker console; when connected it logs:
  ```
  [mcp-ext] ws open
  ```
- Permissions used
  - `permissions`: ["tabs","scripting","activeTab","bookmarks","history"]
  - `host_permissions`: ["<all_urls>"]

## Calling tools from a client (example)
Create `mcp/client.mjs`:
```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'node', args: ['./dist/server.js'], cwd: process.cwd() });
const client = new Client({ name: 'local-tester', version: '1.0.0' }, { capabilities: { tools: {} } });

await client.connect(transport);

console.log(await client.listTools({}));

// Open a tab
console.log(await client.callTool({ name: 'tabs.create', arguments: { url: 'https://example.com', active: true } }));

// Get page text (default format is text)
console.log(await client.callTool({ name: 'page.getContent', arguments: {} }));

// Get full HTML (with DOCTYPE)
console.log(await client.callTool({ name: 'page.getContent', arguments: { format: 'html', includeDoctype: true } }));

await client.close();
```
Run:
```bash
node client.mjs
```

## Tool Catalog
- Tabs & navigation
  - `tabs.create({ url: string, active?: boolean })`
  - `tabs.query({ query?: object })`
  - `tabs.activate({ tabId?: number })`
  - `tabs.remove({ tabId?: number })`
  - `tabs.reload({ tabId?: number, bypassCache?: boolean })`
  - `navigate.to({ tabId?: number, url: string })`
- Scripting & DOM
  - `scripting.run({ tabId?: number, code: string, args?: object, allFrames?: boolean })`
  - `dom.dispatch({ tabId?: number, message: { type: string, ... } })`
    - Supported: `dom.click`, `dom.fill`, `dom.readText`, `dom.scrollTo`, `dom.readHTML`
  - `page.getContent({ tabId?: number, format?: "text"|"html", includeDoctype?: boolean })`
- Bookmarks & history
  - `bookmarks.create({ parentId?: string, title: string, url: string })`
  - `bookmarks.search({ query?: any })`
  - `bookmarks.remove({ id: string })`
  - `history.search({ text?: string, startTime?: number, endTime?: number, maxResults?: number })`
  - `history.deleteUrl({ url: string })`

## Troubleshooting
- Connection refused in extension console
  - Ensure the MCP server is running and listening on `ws://localhost:3001`
  - Check port usage: `lsof -nP -iTCP:3001 | grep LISTEN`
- “Receiving end does not exist”
  - Means the content script was not yet injected; the background worker now injects `dist/content.js` and retries
  - Still failing usually means a restricted page (e.g., `chrome://` or Web Store) where injection is blocked
- `page.getContent` returns `no_content`
  - Make sure the target is a regular http/https page covered by `host_permissions`
  - We use a content-script based fallback (`dom.readText`/`dom.readHTML`) to avoid CSP/world issues

## CI/CD (GitHub Actions)
- On push to `main` or manual dispatch, the workflow:
  - Installs and builds `extension` and `mcp`
  - Reads `extension/manifest.json` version
  - Zips `extension/manifest.json + extension/dist/**` as `chrome-extension.zip`
  - Creates a Release `v{version}` and uploads the ZIP asset

## Development Notes
- After updating TS sources, build each subproject:
  - `cd extension && npm run build`
  - `cd mcp && npm run build`
- Only sources are tracked in Git; `dist/` and `node_modules/` are ignored
- Server port is configurable via `MCP_BRIDGE_PORT` (default 3001)

## License
MIT
