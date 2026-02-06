# VIP Video Parser (Chrome Extension · MV3)

A simple, intuitive Chrome extension: pick a parser, click “Parse & Play”, and open the playable page in a new tab.

> Personal study and research only. Make sure your usage complies with target sites’ Terms and local laws.

---

## Features
- One‑click parsing: select a parser in the popup → click “Parse & Play” → opens a new tab
- Named parsers: friendly names like “Xiaomi Parser” and “Bingdou Parser”
- Context menu: right‑click page or link → “Play with other parsers”
- Configurable: add/edit parsers and site patterns in Options
- Compatible: opens in a new tab to avoid CSP/cross‑origin issues

---

## Installation (Developer Mode)
1) Open Chrome → go to `chrome://extensions`.
2) Toggle on “Developer mode”.
3) Click “Load unpacked” and select this folder:
   - `/Users/{user}/Documents/VIP视频解析Chrome插件`

> After editing code or icons, return to the Extensions page and click “Reload”.

---

## Quick Start
1) Open a video page (e.g., `https://v.qq.com/...`).
2) Click the toolbar icon to open the popup.
   - Choose a parser from the dropdown (preloaded: Xiaomi, Bingdou).
   - Click “Parse & Play”.
3) A new tab opens with the parser URL carrying the current page URL.

Examples you provided:
- Xiaomi: prefix `https://jx.xmflv.com/?url=`
  ```
  https://jx.xmflv.com/?url=https://v.qq.com/x/cover/mzc00200pn9oay5/d4101psldo0.html?ptag=11972
  ```
- Bingdou: prefix `https://player.bingdou.vip/?url=`
  (target must be URL‑encoded)
  ```
  https://player.bingdou.vip/?url=https%3A%2F%2Fv.qq.com%2Fx%2Fcover%2Fmzc00200pn9oay5%2Fd4101psldo0.html%3Fptag%3D11972
  ```

> The extension applies `encodeURIComponent` once to the target URL. No manual re‑encoding needed.

---

## Configure Parsers (Options)
- Add parser: fill “URL prefix” (ideally ending with `?url=`) and a friendly name.
- Edit/reorder: update names or URLs; the context menu refreshes automatically.
- Default / last used: the extension remembers the last used parser; you can also set a default in Options.

Preloaded parsers:
- Xiaomi: `https://jx.xmflv.com/?url=`
- Bingdou: `https://player.bingdou.vip/?url=`

---

## Context Menu
- On page: right‑click → “Parse (default parser)”.
- On link: right‑click → “Play with other parsers” → choose a parser (uses the clicked link URL).

---

## Permissions
- `activeTab`: read the active tab URL (after user interaction)
- `tabs`: open parsed URL in a new tab
- `storage`: persist your parser and site settings
- `contextMenus`: show right‑click entries
- `scripting`: fallback to read `location.href` if needed

> No broad host permissions are required for manual triggers.

---

## FAQ
- Nothing happens after clicking?
  - Make sure the page is `http(s)` (system pages like `chrome://` / `about:blank` can’t be parsed).
  - Click “Reload” on `chrome://extensions` and try again.
- Parser page fails to load or play?
  - That parser might be down or changed; add/switch to another parser in Options.
- Context menu doesn’t show names?
  - After edits, menus refresh automatically; if not, restart the browser or reload the extension.

---

## Version & Changes
- v0.1.0
  - Popup: dropdown parser selector + one primary button
  - Options: named parsers, add/edit/test
  - Context menu: default parse + “other parsers” submenu
  - Logo: gold rounded square + play triangle + VIP badge

---

## Disclaimer
This project ships no video content. It opens third‑party parser sites in a new tab with your target URL. Evaluate the risks of third‑party services and use at your own discretion.

