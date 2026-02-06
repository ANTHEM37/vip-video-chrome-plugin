async function getActiveUrl() {
  return new Promise(res => {
    chrome.runtime.sendMessage({ type: "get-active-url" }, (reply) => res(reply?.url || ""));
  });
}
async function getSettings() {
  return new Promise(res => {
    chrome.runtime.sendMessage({ type: "get-settings" }, (reply) => res(reply));
  });
}
async function openParse(targetUrl, parserIndex) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "open-parse", targetUrl, parserIndex }, () => resolve());
  });
}

(async function init() {
  const curUrl = await getActiveUrl();
  const s = await getSettings();
  const parsers = (s && s.parsers) || [];
  const select = document.getElementById('parserSelect');

  // Populate dropdown with names
  parsers.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = p.name || p.url || `接口${i+1}`;
    select.appendChild(opt);
  });

  // Default selection: last used > default
  const last = (s && s.lastUsedParserIndex);
  let idx = Number.isInteger(last) ? last : (s && s.defaultParserIndex) || 0;
  if (idx < 0 || idx >= parsers.length) idx = 0;
  if (parsers.length > 0) select.value = String(idx);

  // Parse on click
  document.getElementById('parseBtn').addEventListener('click', async () => {
    const i = Number(select.value || '0');
    if (!/^https?:/.test(curUrl)) return window.close();
    await openParse(curUrl, i);
    window.close();
  });

  // Open options
  document.getElementById('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
})();
