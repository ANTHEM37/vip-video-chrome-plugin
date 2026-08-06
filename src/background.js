// Load static config (bundled JSON) to avoid exposing editing in UI
let STATIC_CONFIG = null;
async function loadStaticConfig() {
  if (STATIC_CONFIG) return STATIC_CONFIG;
  try {
    const url = chrome.runtime.getURL('src/config.json');
    const res = await fetch(url, { cache: 'no-store' });
    STATIC_CONFIG = await res.json();
  } catch (e) {
    STATIC_CONFIG = {
      parsers: [],
      sitePatterns: [],
      healthAutoSwitch: true,
      preferOverlay: true,
      autoRetryEnabled: true,
      autoRetryMax: 3,
      sponsorUrl: ""
    };
  }
  return STATIC_CONFIG;
}

const DEFAULT_SETTINGS = {
  parsers: [],
  defaultParserIndex: 0,
  sitePatterns: [],
  healthAutoSwitch: true,
  preferOverlay: true,
  remoteConfigUrl: "",
  sponsorUrl: "",
  autoRetryEnabled: true,
  autoRetryMax: 3
};

async function ensureDefaults() {
  const base = await loadStaticConfig();
  const cur = await chrome.storage.sync.get([
    "parsers", "defaultParserIndex", "sitePatterns", "healthAutoSwitch",
    "preferOverlay", "remoteConfigUrl", "sponsorUrl", "autoRetryEnabled", "autoRetryMax", "overlay"
  ]);
  const next = {};
  // 仅填充缺失项，避免每次 getSettings 覆盖用户已保存的配置
  if (!Array.isArray(cur.parsers) || cur.parsers.length === 0) {
    next.parsers = Array.isArray(base.parsers) ? base.parsers : [];
  }
  if (!Array.isArray(cur.sitePatterns) || cur.sitePatterns.length === 0) {
    next.sitePatterns = Array.isArray(base.sitePatterns) ? base.sitePatterns : [];
  }
  if (typeof cur.healthAutoSwitch !== "boolean") {
    next.healthAutoSwitch = base.healthAutoSwitch ?? DEFAULT_SETTINGS.healthAutoSwitch;
  }
  if (typeof cur.preferOverlay !== "boolean") {
    next.preferOverlay = base.preferOverlay ?? DEFAULT_SETTINGS.preferOverlay;
  }
  if (typeof cur.sponsorUrl !== "string") {
    next.sponsorUrl = base.sponsorUrl ?? DEFAULT_SETTINGS.sponsorUrl;
  }
  if (typeof cur.autoRetryEnabled !== "boolean") {
    next.autoRetryEnabled = base.autoRetryEnabled ?? DEFAULT_SETTINGS.autoRetryEnabled;
  }
  if (typeof cur.autoRetryMax !== "number") {
    next.autoRetryMax = base.autoRetryMax ?? DEFAULT_SETTINGS.autoRetryMax;
  }
  if (typeof cur.defaultParserIndex !== "number") next.defaultParserIndex = DEFAULT_SETTINGS.defaultParserIndex;
  if (typeof cur.remoteConfigUrl !== "string") next.remoteConfigUrl = DEFAULT_SETTINGS.remoteConfigUrl;
  if (!cur.overlay || typeof cur.overlay !== "object") {
    const ov = base.overlay;
    if (ov && ov.width && ov.height) next.overlay = { width: ov.width, height: ov.height };
  }
  if (Object.keys(next).length) await chrome.storage.sync.set(next);
}

function safeHostname(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function normalizeParsers(parsers) {
  if (!Array.isArray(parsers)) return DEFAULT_SETTINGS.parsers.slice();
  return parsers.map((p, i) => {
    if (typeof p === "string") {
      const host = safeHostname(p) || ("接口" + (i + 1));
      return { name: host, url: p };
    }
    const url = typeof p?.url === "string" ? p.url : "";
    if (!url) return null;
    const name = p.name || safeHostname(url) || ("接口" + (i + 1));
    return { name, url };
  }).filter(Boolean);
}

async function getSettings() {
  await ensureDefaults();
  const s = await chrome.storage.sync.get([
    "parsers", "defaultParserIndex", "sitePatterns", "lastUsedParserIndex",
    "healthAutoSwitch", "preferOverlay", "remoteConfigUrl", "sponsorUrl",
    "lastRemoteFetchTs", "autoRetryEnabled", "autoRetryMax", "overlay"
  ]);
  return {
    parsers: normalizeParsers(s.parsers ?? DEFAULT_SETTINGS.parsers),
    defaultParserIndex: typeof s.defaultParserIndex === "number" ? s.defaultParserIndex : 0,
    sitePatterns: s.sitePatterns ?? DEFAULT_SETTINGS.sitePatterns,
    lastUsedParserIndex: typeof s.lastUsedParserIndex === "number" ? s.lastUsedParserIndex : null,
    healthAutoSwitch: typeof s.healthAutoSwitch === "boolean" ? s.healthAutoSwitch : DEFAULT_SETTINGS.healthAutoSwitch,
    remoteConfigUrl: typeof s.remoteConfigUrl === "string" ? s.remoteConfigUrl : DEFAULT_SETTINGS.remoteConfigUrl,
    preferOverlay: typeof s.preferOverlay === "boolean" ? s.preferOverlay : DEFAULT_SETTINGS.preferOverlay,
    sponsorUrl: typeof s.sponsorUrl === "string" ? s.sponsorUrl : DEFAULT_SETTINGS.sponsorUrl,
    lastRemoteFetchTs: typeof s.lastRemoteFetchTs === "number" ? s.lastRemoteFetchTs : 0,
    autoRetryEnabled: typeof s.autoRetryEnabled === "boolean" ? s.autoRetryEnabled : DEFAULT_SETTINGS.autoRetryEnabled,
    autoRetryMax: typeof s.autoRetryMax === "number" ? s.autoRetryMax : DEFAULT_SETTINGS.autoRetryMax,
    overlay: s.overlay && typeof s.overlay === "object" ? s.overlay : null
  };
}

function getHost(u) {
  try { return new URL(u).host; } catch { return ""; }
}

async function readProbeCache() {
  try {
    const v = await chrome.storage.local.get(["probeCache"]);
    return v.probeCache || {};
  } catch { return {}; }
}

async function writeProbeCache(cache) {
  try { await chrome.storage.local.set({ probeCache: cache }); } catch {}
}

function buildParseUrl(parser, targetUrl) {
  const base = typeof parser === "string" ? parser : (parser?.url || "");
  return `${base}${encodeURIComponent(targetUrl)}`;
}

function isProbeHttpOk(status) {
  // 2xx/3xx 成功；403/405 常见于防盗链/禁用 HEAD，站点本身仍可用
  return (status >= 200 && status < 400) || status === 403 || status === 405;
}

/** 真实可达性探测：优先 HEAD，失败再 GET；避免 no-cors 假成功与把 404 当成功 */
async function probeFetch(href, timeoutMs) {
  const t0 = Date.now();
  const run = async (method) => {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(href, {
        signal: controller.signal,
        cache: "no-store",
        redirect: "follow",
        method
      });
      clearTimeout(to);
      return res;
    } catch (e) {
      clearTimeout(to);
      throw e;
    }
  };

  try {
    let res;
    try {
      res = await run("HEAD");
      // 部分站点对 HEAD 返回 405/501，改用 GET
      if (res.status === 405 || res.status === 501) res = await run("GET");
    } catch {
      res = await run("GET");
    }
    const time = Date.now() - t0;
    if (res.type === "opaque") return { status: "ok", time };
    if (isProbeHttpOk(res.status)) return { status: "ok", time };
    return { status: "fail", time };
  } catch {
    return { status: "fail", time: Date.now() - t0 };
  }
}

async function getActiveTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url = tab?.url || "";
  if (url && /^https?:/.test(url)) return url;
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

function registerContextMenus(_parsers) {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "vip-root", title: "VIP视频解析助手", contexts: ["page", "link"] });
    chrome.contextMenus.create({ id: "vip-auto-page", parentId: "vip-root", title: "开始解析（当前页面）", contexts: ["page"] });
    chrome.contextMenus.create({ id: "vip-auto-link", parentId: "vip-root", title: "开始解析（此链接）", contexts: ["link"] });
  });
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({ type: "basic", iconUrl: "assets/icon-48.png", title, message });
  } catch {}
}

/** 探测 content script 是否已就绪，避免重复注入叠加监听器 */
async function pingContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "vip-ping" });
    return !!(res && res.ok);
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId) {
  if (await pingContentScript(tabId)) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content.js"] });
  } catch {
    return false;
  }
  // 注入后短暂等待并再 ping
  for (let i = 0; i < 5; i++) {
    if (await pingContentScript(tabId)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

async function openOverlayOnTab(tabId, payload) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "open-overlay", ...payload });
    return !!(res && res.ok);
  } catch {
    return false;
  }
}

function pickParserIndex(s, preferIndex, excludeIndexes, opts) {
  const exclude = new Set(
    (Array.isArray(excludeIndexes) ? excludeIndexes : [])
      .filter((n) => Number.isInteger(n) && n >= 0)
  );
  const hasPrefer = Number.isInteger(preferIndex) && preferIndex >= 0 && !exclude.has(preferIndex);
  let idx = hasPrefer
    ? preferIndex
    : (Number.isInteger(s.lastUsedParserIndex) ? s.lastUsedParserIndex : s.defaultParserIndex || 0);

  if (exclude.has(idx) || idx < 0 || idx >= s.parsers.length) {
    idx = s.parsers.findIndex((_, i) => !exclude.has(i));
    if (idx < 0) idx = 0;
  }
  return { idx, hasPrefer, exclude };
}

async function doAutoParse(targetUrl, preferIndex, opts = {}) {
  const s = await getSettings();
  if (!/^https?:/.test(targetUrl)) throw new Error("invalid url");
  if (!s.parsers.length) throw new Error("no-parsers");

  const host = getHost(targetUrl);
  const excludeIndexes = opts.excludeIndexes || [];
  let { idx, hasPrefer, exclude } = pickParserIndex(s, preferIndex, excludeIndexes, opts);

  // 仅在未显式指定线路、且非强制排除换线时使用探测缓存
  if (!hasPrefer && !opts.fromOverlayRetry) {
    try {
      const cache = await readProbeCache();
      const item = cache[host];
      if (
        item && (Date.now() - item.ts) < 10 * 60 * 1000 &&
        Number.isInteger(item.bestIndex) && item.bestIndex >= 0 &&
        !exclude.has(item.bestIndex)
      ) {
        idx = item.bestIndex;
      }
    } catch {}
  }

  if (idx < 0 || idx >= s.parsers.length) idx = 0;
  let chosen = s.parsers[idx];

  // 用户显式选线时不自动改道；未指定或覆盖层换线时按健康检查轮换，并跳过 exclude
  const allowSwitch = (!hasPrefer && s.healthAutoSwitch) || opts.fromOverlayRetry;
  if (allowSwitch && s.parsers.length > 0) {
    const order = [
      idx,
      ...Array.from(s.parsers.keys()).filter((i) => i !== idx)
    ].filter((i) => !exclude.has(i));

    let found = false;
    for (const i of order) {
      const hrefProbe = buildParseUrl(s.parsers[i], targetUrl);
      const result = await probeFetch(hrefProbe, 2000);
      if (result.status === "ok") {
        chosen = s.parsers[i];
        idx = i;
        found = true;
        break;
      }
    }
    // 全部探测失败时仍用第一个未排除的线路兜底打开
    if (!found && order.length) {
      idx = order[0];
      chosen = s.parsers[idx];
    } else if (!found) {
      throw new Error("no-available-parser");
    }
  }

  const href = buildParseUrl(chosen, targetUrl);
  const overlayPayload = {
    url: href,
    targetUrl,
    parserIndex: idx,
    excludeIndexes: [...exclude, idx],
    fromOverlayRetry: !!opts.fromOverlayRetry,
    autoRetryEnabled: s.autoRetryEnabled,
    autoRetryMax: s.autoRetryMax
  };

  // preferOverlay=false：直接新标签页
  if (!s.preferOverlay) {
    await chrome.tabs.create({ url: href });
    try { await chrome.storage.sync.set({ lastUsedParserIndex: idx }); } catch {}
    return { idx, mode: "tab" };
  }

  // 优先在发起解析的标签页打开覆盖层（右键/重试时由调用方传入 tabId）
  let tabId = Number.isInteger(opts.tabId) ? opts.tabId : null;
  if (tabId == null) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tabs?.[0]?.id ?? null;
  }
  if (tabId == null) throw new Error("no-active-tab");

  let ok = false;
  if (await ensureContentScript(tabId)) {
    ok = await openOverlayOnTab(tabId, overlayPayload);
  }
  if (!ok) throw new Error("overlay-unavailable");

  try { await chrome.storage.sync.set({ lastUsedParserIndex: idx }); } catch {}
  return { idx, mode: "overlay" };
}

chrome.runtime.onInstalled.addListener(async () => {
  const { parsers } = await getSettings();
  registerContextMenus(parsers);
  try { chrome.alarms.create("remote-config", { periodInMinutes: 60 }); } catch {}
});

chrome.runtime.onStartup?.addListener(async () => {
  const { parsers } = await getSettings();
  registerContextMenus(parsers);
  try { chrome.alarms.create("remote-config", { periodInMinutes: 60 }); } catch {}
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "sync" && changes.parsers) {
    const parsers = normalizeParsers(changes.parsers.newValue || DEFAULT_SETTINGS.parsers);
    registerContextMenus(parsers);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === "vip-auto-page" || info.menuItemId === "vip-auto-link") {
      const target = info.menuItemId === "vip-auto-link"
        ? (info.linkUrl || tab?.url || "")
        : (tab?.url || "");
      try {
        await doAutoParse(target, undefined, { tabId: tab?.id });
      } catch (e) {
        await notify("解析未启动", "当前页无法内嵌解析或接口不可用，请先在弹窗内探测并选择线路。");
      }
    }
  } catch (e) { console.error(e); }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "get-settings") {
      sendResponse(await getSettings());
      return;
    }
    if (msg?.type === "fallback-open-newtab" && msg.href) {
      await chrome.tabs.create({ url: msg.href });
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "open-parse") {
      const url = msg.targetUrl || (await getActiveTabUrl());
      await doAutoParse(url, msg.parserIndex, { tabId: sender?.tab?.id });
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "set-default-parser") {
      const idx = Number(msg.index);
      const s = await getSettings();
      if (Number.isInteger(idx) && idx >= 0 && idx < s.parsers.length) {
        await chrome.storage.sync.set({ defaultParserIndex: idx });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "invalid index" });
      }
      return;
    }
    if (msg?.type === "fetch-remote-config") {
      try {
        const { remoteConfigUrl } = await getSettings();
        if (!remoteConfigUrl) { sendResponse({ ok: false, error: "no url" }); return; }
        const res = await fetch(remoteConfigUrl, { cache: "no-store" });
        if (!res.ok) { sendResponse({ ok: false, error: "http " + res.status }); return; }
        const json = await res.json();
        const next = {};
        if (Array.isArray(json.parsers)) next.parsers = json.parsers;
        if (Array.isArray(json.sitePatterns)) next.sitePatterns = json.sitePatterns;
        await chrome.storage.sync.set({ ...next, lastRemoteFetchTs: Date.now() });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e) });
      }
      return;
    }
    if (msg?.type === "health-check") {
      const { parsers } = await getSettings();
      if (!parsers.length) { sendResponse({ ok: true, statuses: [] }); return; }
      const sample = msg.sample || "https://v.qq.com/";
      const timeout = Math.min(5000, msg.timeout || 3000);
      const statuses = await Promise.all(parsers.map(async (p) => {
        const result = await probeFetch(buildParseUrl(p, sample), timeout);
        return result.status === "ok" ? "ok" : "fail";
      }));
      sendResponse({ ok: true, statuses });
      return;
    }
    if (msg?.type === "probe-current" || msg?.type === "probe-start") {
      try {
        const probeId = msg.probeId || String(Date.now());
        const s = await getSettings();
        const targetUrl = msg.targetUrl || (await getActiveTabUrl());
        if (!/^https?:/.test(targetUrl)) { sendResponse({ ok: false, error: "invalid url" }); return; }
        if (!s.parsers.length) {
          if (msg.type === "probe-start") {
            try { chrome.runtime.sendMessage({ type: "probe-done", probeId, statuses: [], times: [], bestIndex: -1 }); } catch {}
          }
          sendResponse({ ok: false, error: "no-parsers" });
          return;
        }

        const host = getHost(targetUrl);
        const timeout = Math.min(10000, Math.max(1000, msg.timeout || 10000));
        const isStreaming = msg.type === "probe-start";
        const times = new Array(s.parsers.length).fill(0);
        const statuses = new Array(s.parsers.length).fill("pending");

        const cache = await readProbeCache();
        const entry = cache[host] || {};
        const now = Date.now();

        await Promise.all(s.parsers.map((p, i) => (async () => {
          const key = `p${i}`;
          const cached = isStreaming ? entry[key] : null;
          if (cached && (now - cached.ts) <= 5 * 60 * 1000) {
            statuses[i] = cached.status;
            times[i] = cached.time;
            if (isStreaming) {
              try { chrome.runtime.sendMessage({ type: "probe-progress", probeId, idx: i, status: statuses[i], time: times[i] }); } catch {}
            }
            return;
          }
          const result = await probeFetch(buildParseUrl(p, targetUrl), timeout);
          times[i] = result.time;
          statuses[i] = result.status;
          if (isStreaming) {
            const latest = cache[host] || {};
            latest[key] = { status: statuses[i], time: times[i], ts: Date.now() };
            cache[host] = latest;
            await writeProbeCache(cache);
            try { chrome.runtime.sendMessage({ type: "probe-progress", probeId, idx: i, status: statuses[i], time: times[i] }); } catch {}
          }
        })()));

        let bestIndex = -1, bestTime = Infinity;
        statuses.forEach((st, i) => {
          if (st === "ok" && times[i] < bestTime) { bestTime = times[i]; bestIndex = i; }
        });

        try {
          const after = await readProbeCache();
          const latest = after[host] || {};
          latest.bestIndex = bestIndex;
          latest.statuses = statuses;
          latest.times = times;
          latest.ts = Date.now();
          // 同步逐线路缓存，供后续 5 分钟命中
          statuses.forEach((st, i) => {
            latest[`p${i}`] = { status: st, time: times[i], ts: Date.now() };
          });
          after[host] = latest;
          await writeProbeCache(after);
        } catch {}

        if (bestIndex >= 0) {
          try { await chrome.storage.sync.set({ lastUsedParserIndex: bestIndex }); } catch {}
        }

        if (isStreaming) {
          try { chrome.runtime.sendMessage({ type: "probe-done", probeId, statuses, times, bestIndex }); } catch {}
          sendResponse({ ok: true, probeId, bestIndex, statuses, times });
        } else {
          sendResponse({ ok: true, statuses, times, bestIndex });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
      return;
    }
    if (msg?.type === "probe-count") {
      const s = await getSettings();
      sendResponse({ ok: true, count: s.parsers.length });
      return;
    }
    if (msg?.type === "auto-parse") {
      try {
        const tabId = sender?.tab?.id;
        const out = await doAutoParse(
          msg.targetUrl || (await getActiveTabUrl()),
          msg.preferIndex,
          {
            fromOverlayRetry: !!msg.fromOverlayRetry,
            excludeIndexes: msg.excludeIndexes,
            tabId: Number.isInteger(tabId) ? tabId : undefined
          }
        );
        sendResponse({ ok: true, ...out });
      } catch (e) {
        await notify("解析未启动", "当前页无法内嵌解析或接口不可用，请先探测并选择线路。");
        sendResponse({ ok: false, error: String(e?.message || e) });
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

chrome.alarms?.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "remote-config") return;
  const { remoteConfigUrl } = await getSettings();
  if (!remoteConfigUrl) return;
  try {
    const res = await fetch(remoteConfigUrl, { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    const next = {};
    if (Array.isArray(json.parsers)) next.parsers = json.parsers;
    if (Array.isArray(json.sitePatterns)) next.sitePatterns = json.sitePatterns;
    await chrome.storage.sync.set({ ...next, lastRemoteFetchTs: Date.now() });
  } catch {}
});
