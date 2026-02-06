const DEFAULT_SETTINGS = {
  // parsers now support objects: { name, url }
  parsers: [
    { name: "虾米解析", url: "https://jx.xmflv.com/?url=" },
    { name: "冰豆解析", url: "https://player.bingdou.vip/?url=" }
  ],
  defaultParserIndex: 0,
  sitePatterns: [
    "*://*.v.qq.com/*",
    "*://*.youku.com/*",
    "*://*.iqiyi.com/*",
    "*://*.mgtv.com/*",
    "*://*.bilibili.com/*",
    "*://tv.sohu.com/*"
  ]
};

async function ensureDefaults() {
  const cur = await chrome.storage.sync.get(["parsers","defaultParserIndex","sitePatterns"]);
  const next = {};
  if (!Array.isArray(cur.parsers) || cur.parsers.length === 0) next.parsers = DEFAULT_SETTINGS.parsers;
  if (typeof cur.defaultParserIndex !== "number") next.defaultParserIndex = DEFAULT_SETTINGS.defaultParserIndex;
  if (!Array.isArray(cur.sitePatterns) || cur.sitePatterns.length === 0) next.sitePatterns = DEFAULT_SETTINGS.sitePatterns;
  if (Object.keys(next).length) await chrome.storage.sync.set(next);
}

function normalizeParsers(parsers) {
  // Accept legacy string array, convert to objects
  if (!Array.isArray(parsers)) return DEFAULT_SETTINGS.parsers.slice();
  return parsers.map((p, i) => {
    if (typeof p === "string") {
      // derive a readable name from hostname
      let host = "接口" + (i + 1);
      try { host = new URL(p).hostname; } catch {}
      return { name: host, url: p };
    }
    // ensure shape
    return { name: p.name || (p.url ? (new URL(p.url).hostname) : ("接口" + (i + 1))), url: p.url || String(p) };
  }).filter(x => typeof x.url === "string" && x.url);
}

async function getSettings() {
  await ensureDefaults();
  const s = await chrome.storage.sync.get(["parsers","defaultParserIndex","sitePatterns","lastUsedParserIndex"]);
  return {
    parsers: normalizeParsers(s.parsers ?? DEFAULT_SETTINGS.parsers),
    defaultParserIndex: typeof s.defaultParserIndex === "number" ? s.defaultParserIndex : 0,
    sitePatterns: s.sitePatterns ?? DEFAULT_SETTINGS.sitePatterns,
    lastUsedParserIndex: typeof s.lastUsedParserIndex === 'number' ? s.lastUsedParserIndex : null
  };
}

function buildParseUrl(parser, targetUrl) {
  const base = typeof parser === "string" ? parser : (parser?.url || "");
  return `${base}${encodeURIComponent(targetUrl)}`;
}

async function resolveTargetUrl(info, tab) {
  if (info && info.linkUrl) return info.linkUrl;
  return await getActiveTabUrl();
}

async function getActiveTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url = tab?.url || "";
  if (url && /^https?:/.test(url)) return url;
  // Fallback: try to read location.href via scripting (requires "scripting" + activeTab)
  try {
    if (tab?.id != null) {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => location.href
      });
      if (res && typeof res.result === "string" && res.result) return res.result;
    }
  } catch (e) {
    console.warn("executeScript fallback failed", e);
  }
  return url || "";
}

async function openParsedTab(targetUrl, parserIndex) {
  const settings = await getSettings();
  const idx = typeof parserIndex === "number" ? parserIndex : settings.defaultParserIndex || 0;
  const parser = settings.parsers[idx] || settings.parsers[0];
  if (!parser || !parser.url) throw new Error("No parser configured");
  if (!targetUrl || !/^https?:/.test(targetUrl)) throw new Error("Invalid target URL");
  const url = buildParseUrl(parser, targetUrl);
  await chrome.tabs.create({ url });
  try { await chrome.storage.sync.set({ lastUsedParserIndex: idx }); } catch {}
}

function registerContextMenus(parsers) {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "vip-parse",
      title: "解析播放（默认接口）",
      contexts: ["page", "link"]
    });
    chrome.contextMenus.create({
      id: "vip-parse-others",
      title: "用其他接口播放",
      contexts: ["page", "link"]
    });
    parsers.forEach((p, i) => {
      chrome.contextMenus.create({
        id: `vip-parse-idx-${i}`,
        parentId: "vip-parse-others",
        title: `${i + 1}. ${p.name || p.url}`,
        contexts: ["page", "link"]
      });
    });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const { parsers } = await getSettings();
  registerContextMenus(parsers);
});

// Ensure context menus exist after browser restarts
chrome.runtime.onStartup?.addListener(async () => {
  const { parsers } = await getSettings();
  registerContextMenus(parsers);
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "sync" && changes.parsers) {
    const parsers = normalizeParsers(changes.parsers.newValue || DEFAULT_SETTINGS.parsers);
    registerContextMenus(parsers);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const target = await resolveTargetUrl(info, tab);
    if (info.menuItemId === "vip-parse") {
      await openParsedTab(target);
      return;
    }
    if (typeof info.menuItemId === "string" && info.menuItemId.startsWith("vip-parse-idx-")) {
      const idx = Number(info.menuItemId.split("vip-parse-idx-")[1]);
      await openParsedTab(target, idx);
    }
  } catch (e) {
    console.error(e);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "get-settings") {
      sendResponse(await getSettings());
      return;
    }
    if (msg?.type === "open-parse") {
      const url = msg.targetUrl || (await getActiveTabUrl());
      await openParsedTab(url, msg.parserIndex);
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'set-default-parser') {
      const idx = Number(msg.index);
      const s = await getSettings();
      if (Number.isInteger(idx) && idx >= 0 && idx < s.parsers.length) {
        await chrome.storage.sync.set({ defaultParserIndex: idx });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'invalid index' });
      }
      return;
    }
    if (msg?.type === "get-active-url") {
      sendResponse({ url: await getActiveTabUrl() });
      return;
    }
  })();
  return true;
});
