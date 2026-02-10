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
  const cur = await chrome.storage.sync.get(["parsers","defaultParserIndex","sitePatterns","healthAutoSwitch","preferOverlay","remoteConfigUrl","sponsorUrl","autoRetryEnabled","autoRetryMax"]);
  const next = {};
  // 允许用户自定义：仅在存储为空时用打包 config.json 初始化
  if (!Array.isArray(cur.parsers) || cur.parsers.length === 0) {
    next.parsers = Array.isArray(base.parsers) ? base.parsers : [];
  }
  next.sitePatterns = Array.isArray(base.sitePatterns) ? base.sitePatterns : [];
  next.healthAutoSwitch = (base.healthAutoSwitch ?? DEFAULT_SETTINGS.healthAutoSwitch);
  next.preferOverlay = (base.preferOverlay ?? DEFAULT_SETTINGS.preferOverlay);
  next.sponsorUrl = (base.sponsorUrl ?? DEFAULT_SETTINGS.sponsorUrl);
  next.autoRetryEnabled = (base.autoRetryEnabled ?? DEFAULT_SETTINGS.autoRetryEnabled);
  next.autoRetryMax = (base.autoRetryMax ?? DEFAULT_SETTINGS.autoRetryMax);
  if (typeof cur.defaultParserIndex !== "number") next.defaultParserIndex = DEFAULT_SETTINGS.defaultParserIndex;
  if (typeof cur.remoteConfigUrl !== "string") next.remoteConfigUrl = DEFAULT_SETTINGS.remoteConfigUrl;
  await chrome.storage.sync.set(next);
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
  const s = await chrome.storage.sync.get(["parsers","defaultParserIndex","sitePatterns","lastUsedParserIndex","healthAutoSwitch","preferOverlay","remoteConfigUrl","sponsorUrl","lastRemoteFetchTs","autoRetryEnabled","autoRetryMax"]);
  return {
    parsers: normalizeParsers(s.parsers ?? DEFAULT_SETTINGS.parsers),
    defaultParserIndex: typeof s.defaultParserIndex === "number" ? s.defaultParserIndex : 0,
    sitePatterns: s.sitePatterns ?? DEFAULT_SETTINGS.sitePatterns,
    lastUsedParserIndex: typeof s.lastUsedParserIndex === 'number' ? s.lastUsedParserIndex : null,
    healthAutoSwitch: typeof s.healthAutoSwitch === 'boolean' ? s.healthAutoSwitch : DEFAULT_SETTINGS.healthAutoSwitch,
    remoteConfigUrl: typeof s.remoteConfigUrl === 'string' ? s.remoteConfigUrl : DEFAULT_SETTINGS.remoteConfigUrl,
    preferOverlay: typeof s.preferOverlay === 'boolean' ? s.preferOverlay : DEFAULT_SETTINGS.preferOverlay,
    sponsorUrl: typeof s.sponsorUrl === 'string' ? s.sponsorUrl : DEFAULT_SETTINGS.sponsorUrl,
    lastRemoteFetchTs: typeof s.lastRemoteFetchTs === 'number' ? s.lastRemoteFetchTs : 0,
    autoRetryEnabled: typeof s.autoRetryEnabled === 'boolean' ? s.autoRetryEnabled : DEFAULT_SETTINGS.autoRetryEnabled,
    autoRetryMax: typeof s.autoRetryMax === 'number' ? s.autoRetryMax : DEFAULT_SETTINGS.autoRetryMax
  };
}

function getHost(u) {
  try { return new URL(u).host; } catch { return ''; }
}

async function readProbeCache() {
  try {
    const v = await chrome.storage.local.get(['probeCache']);
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
  // 与 doAutoParse 行为保持一致：仅覆盖层解析，不默认新开标签
  return await doAutoParse(targetUrl, parserIndex);
}

function registerContextMenus(_parsers) {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'vip-root', title: 'VIP视频解析助手', contexts: ['page','link'] });
    chrome.contextMenus.create({ id: 'vip-auto-page', parentId: 'vip-root', title: '开始解析（当前页面）', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'vip-auto-link', parentId: 'vip-root', title: '开始解析（此链接）', contexts: ['link'] });
  });
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({ type: 'basic', iconUrl: 'assets/icon-48.png', title, message });
  } catch {}
}

async function doAutoParse(targetUrl, preferIndex) {
  const s = await getSettings();
  if (!/^https?:/.test(targetUrl)) throw new Error('invalid url');
  const host = getHost(targetUrl);
  let idx = Number.isInteger(preferIndex) ? preferIndex : (Number.isInteger(s.lastUsedParserIndex) ? s.lastUsedParserIndex : s.defaultParserIndex || 0);
  try {
    const cache = await readProbeCache();
    const item = cache[host];
    if (item && (Date.now() - item.ts) < 10*60*1000 && Number.isInteger(item.bestIndex) && item.bestIndex >= 0) {
      idx = item.bestIndex;
    }
  } catch {}
  if (idx < 0 || idx >= s.parsers.length) idx = 0;
  let chosen = s.parsers[idx];
  if (s.healthAutoSwitch) {
    const order = [idx, ...Array.from(s.parsers.keys()).filter(i=>i!==idx)];
    for (const i of order) {
      const hrefProbe = buildParseUrl(s.parsers[i], targetUrl);
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 2000);
      try { await fetch(hrefProbe, { signal: controller.signal, mode:'no-cors', cache:'no-store' }); clearTimeout(t); chosen = s.parsers[i]; idx = i; break; } catch {}
    }
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs && tabs[0] && tabs[0].id;
  const href = buildParseUrl(chosen, targetUrl);
  if (tabId == null) throw new Error('no-active-tab');
  // try overlay only; do not open new tab implicitly
  let ok = await new Promise((resolve)=>{
    try {
      chrome.tabs.sendMessage(tabId, { type:'open-overlay', url: href }, () => {
        if (chrome.runtime.lastError) { resolve(false); return; }
        resolve(true);
      });
      setTimeout(()=>resolve(false), 800);
    } catch { resolve(false); }
  });
  if (!ok) {
    // 尝试按需注入 content script（依赖 activeTab 权限）后再次打开覆盖层
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
    } catch {}
    ok = await new Promise((resolve)=>{
      try {
        chrome.tabs.sendMessage(tabId, { type:'open-overlay', url: href }, () => {
          if (chrome.runtime.lastError) { resolve(false); return; }
          resolve(true);
        });
        setTimeout(()=>resolve(false), 800);
      } catch { resolve(false); }
    });
  }
  if (!ok) throw new Error('overlay-unavailable');
  try { await chrome.storage.sync.set({ lastUsedParserIndex: idx }); } catch {}
  return { idx };
}

chrome.runtime.onInstalled.addListener(async () => {
  const { parsers } = await getSettings();
  registerContextMenus(parsers);
  // schedule hourly remote fetch
  try { chrome.alarms.create('remote-config', { periodInMinutes: 60 }); } catch {}
});

// Ensure context menus exist after browser restarts
chrome.runtime.onStartup?.addListener(async () => {
  const { parsers } = await getSettings();
  registerContextMenus(parsers);
  try { chrome.alarms.create('remote-config', { periodInMinutes: 60 }); } catch {}
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "sync" && changes.parsers) {
    const parsers = normalizeParsers(changes.parsers.newValue || DEFAULT_SETTINGS.parsers);
    registerContextMenus(parsers);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'vip-auto-page' || info.menuItemId === 'vip-auto-link') {
      const target = info.menuItemId === 'vip-auto-link' ? (info.linkUrl || tab?.url || '') : (tab?.url || '');
      try { await doAutoParse(target); }
      catch (e) { await notify('解析未启动', '当前页无法内嵌解析或接口不可用，请先在弹窗内探测并选择线路。'); }
    }
  } catch (e) { console.error(e); }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "get-settings") {
      sendResponse(await getSettings());
      return;
    }
    if (msg?.type === 'fallback-open-newtab' && msg.href) {
      await chrome.tabs.create({ url: msg.href });
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "open-parse") {
      const url = msg.targetUrl || (await getActiveTabUrl());
      await doAutoParse(url, msg.parserIndex); // 覆盖层解析
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
    if (msg?.type === 'fetch-remote-config') {
      try {
        const { remoteConfigUrl } = await getSettings();
        if (!remoteConfigUrl) { sendResponse({ ok:false, error:'no url' }); return; }
        const res = await fetch(remoteConfigUrl, { cache: 'no-store' });
        if (!res.ok) { sendResponse({ ok:false, error:'http '+res.status }); return; }
        const json = await res.json();
        const next = {};
        if (Array.isArray(json.parsers)) next.parsers = json.parsers;
        if (Array.isArray(json.sitePatterns)) next.sitePatterns = json.sitePatterns;
        await chrome.storage.sync.set({ ...next, lastRemoteFetchTs: Date.now() });
        sendResponse({ ok:true });
      } catch (e) {
        sendResponse({ ok:false, error: String(e.message||e) });
      }
      return;
    }
    if (msg?.type === 'health-check') {
      const { parsers } = await getSettings();
      const sample = msg.sample || 'https://v.qq.com/';
      const statuses = await Promise.all(parsers.map(async (p) => {
        const href = buildParseUrl(p, sample);
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), Math.min(5000, msg.timeout||3000));
        try {
          const res = await fetch(href, { signal: controller.signal, cache: 'no-store', mode: 'no-cors' });
          clearTimeout(t);
          return res.ok || res.type === 'opaque' ? 'ok' : ('http-'+res.status);
        } catch (e) {
          return 'fail';
        }
      }));
      sendResponse({ ok:true, statuses });
      return;
    }
    if (msg?.type === 'probe-current') {
      try {
        const s = await getSettings();
        const targetUrl = msg.targetUrl || (await getActiveTabUrl());
        if (!/^https?:/.test(targetUrl)) { sendResponse({ ok:false, error:'invalid url' }); return; }
        const host = getHost(targetUrl);
        const timeout = Math.min(10000, Math.max(1000, msg.timeout || 10000));
        const probePromises = (s.parsers || []).map((p, i) => (async () => {
          const href = buildParseUrl(p, targetUrl);
          const controller = new AbortController();
          const t0 = Date.now();
          try {
            const to = setTimeout(() => controller.abort(), timeout);
            await fetch(href, { signal: controller.signal, mode: 'no-cors', cache: 'no-store' });
            clearTimeout(to);
            return { idx: i, status: 'ok', time: Date.now() - t0 };
          } catch {
            return { idx: i, status: 'fail', time: Date.now() - t0 };
          }
        })());
        const probeResults = await Promise.all(probePromises);
        const results = probeResults.map(r => r.status);
        const times = probeResults.map(r => r.time);
        let bestIndex = -1, bestTime = Infinity;
        probeResults.forEach(r => { if (r.status === 'ok' && r.time < bestTime) { bestTime = r.time; bestIndex = r.idx; } });
        // 不再填充 skip；全部线路均有结果（ok/fail）
        try {
          const cache = await readProbeCache();
          cache[host] = { bestIndex, statuses: results, times, ts: Date.now() };
          await writeProbeCache(cache);
        } catch {}
        if (bestIndex >= 0) await chrome.storage.sync.set({ lastUsedParserIndex: bestIndex });
        sendResponse({ ok:true, statuses: results, times, bestIndex });
      } catch (e) {
        sendResponse({ ok:false, error: String(e.message||e) });
      }
      return;
    }
    if (msg?.type === 'probe-start') {
      try {
        const probeId = msg.probeId || String(Date.now());
        const s = await getSettings();
        const targetUrl = msg.targetUrl || (await getActiveTabUrl());
        if (!/^https?:/.test(targetUrl)) { sendResponse({ ok:false, error:'invalid url' }); return; }
        const host = getHost(targetUrl);
        const timeout = Math.min(10000, Math.max(1000, msg.timeout || 10000));
        const times = new Array(s.parsers.length).fill(0);
        const statuses = new Array(s.parsers.length).fill('pending');

        // 5 分钟缓存：host + parserIndex 维度
        const cache = await readProbeCache();
        const entry = cache[host] || {};
        const now = Date.now();

        await Promise.all((s.parsers || []).map((p, i) => (async () => {
          const key = `p${i}`;
          const cached = entry[key];
          // 命中缓存且 5 分钟内：直接回放结果
          if (cached && (now - cached.ts) <= 5*60*1000) {
            statuses[i] = cached.status;
            times[i] = cached.time;
            try { chrome.runtime.sendMessage({ type:'probe-progress', probeId, idx: i, status: statuses[i], time: times[i] }); } catch {}
            return;
          }
          // 未命中则发起真实探测
          const href = buildParseUrl(p, targetUrl);
          const controller = new AbortController();
          const t0 = Date.now();
          try {
            const to = setTimeout(() => controller.abort(), timeout);
            await fetch(href, { signal: controller.signal, mode: 'no-cors', cache: 'no-store' });
            clearTimeout(to);
            times[i] = Date.now() - t0; statuses[i] = 'ok';
          } catch {
            times[i] = Date.now() - t0; statuses[i] = 'fail';
          }
          // 记录缓存
          const latest = cache[host] || {};
          latest[key] = { status: statuses[i], time: times[i], ts: Date.now() };
          cache[host] = latest; await writeProbeCache(cache);
          // 推进度
          try { chrome.runtime.sendMessage({ type:'probe-progress', probeId, idx: i, status: statuses[i], time: times[i] }); } catch {}
        })()));
        // finalize
        let bestIndex = -1, bestTime = Infinity;
        statuses.forEach((st, i) => { if (st==='ok' && times[i] < bestTime) { bestTime = times[i]; bestIndex = i; } });
        try {
          const after = await readProbeCache();
          const latest = after[host] || {};
          latest.bestIndex = bestIndex; latest.statuses = statuses; latest.times = times; latest.ts = Date.now();
          after[host] = latest; await writeProbeCache(after);
        } catch {}
        if (bestIndex >= 0) { try { await chrome.storage.sync.set({ lastUsedParserIndex: bestIndex }); } catch {} }
        try { chrome.runtime.sendMessage({ type:'probe-done', probeId, statuses, times, bestIndex }); } catch {}
        sendResponse({ ok:true, probeId });
      } catch (e) {
        sendResponse({ ok:false, error:String(e?.message||e) });
      }
      return;
    }
    if (msg?.type === 'probe-count') {
      const s = await getSettings();
      sendResponse({ ok:true, count: s.parsers.length });
      return;
    }
    if (msg?.type === 'auto-parse') { try { const out = await doAutoParse(msg.targetUrl || (await getActiveTabUrl()), msg.preferIndex); sendResponse({ ok:true, ...out }); } catch (e) { await notify('解析未启动', '当前页无法内嵌解析或接口不可用，请先探测并选择线路。'); sendResponse({ ok:false, error:String(e?.message||e) }); } return; }
    if (msg?.type === "get-active-url") {
      sendResponse({ url: await getActiveTabUrl() });
      return;
    }
  })();
  return true;
});

// periodic remote fetch
chrome.alarms?.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'remote-config') return;
  const { remoteConfigUrl, lastRemoteFetchTs } = await getSettings();
  if (!remoteConfigUrl) return;
  // fetch at most every 60 min (guarded by alarm already)
  try {
    const res = await fetch(remoteConfigUrl, { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    const next = {};
    if (Array.isArray(json.parsers)) next.parsers = json.parsers;
    if (Array.isArray(json.sitePatterns)) next.sitePatterns = json.sitePatterns;
    await chrome.storage.sync.set({ ...next, lastRemoteFetchTs: Date.now() });
  } catch {}
});
