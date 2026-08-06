(() => {
  // 防止 executeScript 重复注入导致多个 onMessage 监听器
  if (globalThis.__VIP_PARSER_CONTENT__) return;
  globalThis.__VIP_PARSER_CONTENT__ = true;

  const OVERLAY_ID = 'vip-parser-overlay';
  let retryCount = 0;
  let pendingRetry = false;
  let loadGen = 0;
  let currentTargetUrl = '';
  let currentParserIndex = -1;
  let excludedIndexes = [];
  let maxRetry = 2;
  let autoRetryEnabled = true;

  function ensureStyles() {
    if (document.getElementById(OVERLAY_ID + '-style')) return;
    const style = document.createElement('style');
    style.id = OVERLAY_ID + '-style';
    style.textContent = `
      #${OVERLAY_ID} { position: fixed; inset: 0; background: rgba(15,23,42,0.76); z-index: 2147483647; display: flex; align-items: center; justify-content: center; }
      #${OVERLAY_ID} .box { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(96vw, 1100px); height: min(80vh, 640px); background: #0b1220; border-radius: 12px; overflow: hidden; box-shadow: 0 12px 30px rgba(0,0,0,.35); }
      #${OVERLAY_ID} header { position: absolute; left:0; right:0; top:0; height: 42px; display:flex; align-items:center; justify-content:space-between; padding: 0 10px; background: linear-gradient(180deg, rgba(15,23,42,.9), rgba(15,23,42,.4)); color:#e5e7eb; cursor: move; user-select:none; }
      #${OVERLAY_ID} header .title{ font-size:13px; opacity:.9 }
      #${OVERLAY_ID} header .actions{ display:flex; gap:8px }
      #${OVERLAY_ID} .btn { appearance: none; border: 1px solid rgba(148,163,184,.25); border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; background: rgba(30,41,59,.7); color: #e5e7eb; }
      #${OVERLAY_ID} .btn:hover { background: rgba(30,41,59,.9); }
      #${OVERLAY_ID} .content { position:absolute; left:0; right:0; top:42px; bottom:0; background:#000; }
      #${OVERLAY_ID} iframe { width: 100%; height: 100%; border: 0; background: #000; }
      #${OVERLAY_ID} .loading { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background: rgba(0,0,0,.35); }
      #${OVERLAY_ID} .spinner { width: 40px; height: 40px; border: 4px solid rgba(255,255,255,.25); border-top-color: #fff; border-radius: 50%; animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      #${OVERLAY_ID} .toast { position:absolute; left:12px; bottom:12px; background: rgba(15,23,42,.75); color:#e5e7eb; font-size:12px; padding:6px 10px; border-radius:8px; max-width: calc(100% - 24px); }
    `;
    document.documentElement.appendChild(style);
  }

  function bindOverlay(root) {
    const box = root.querySelector('.box');
    const header = box.querySelector('header');
    const iframe = box.querySelector('iframe');
    const loading = box.querySelector('.loading');
    const toast = box.querySelector('.toast');
    const title = header.querySelector('.title');
    const btnSwitch = header.querySelector('.btn-switch');
    const btnNewtab = header.querySelector('.btn-newtab');
    const btnClose = header.querySelector('.btn-close');
    return { root, box, header, iframe, loading, toast, title, btnSwitch, btnNewtab, btnClose };
  }

  function requestSwitchLine() {
    const target = currentTargetUrl || location.href;
    const exclude = Array.from(new Set([
      ...excludedIndexes,
      ...(Number.isInteger(currentParserIndex) && currentParserIndex >= 0 ? [currentParserIndex] : [])
    ]));
    pendingRetry = true;
    chrome.runtime.sendMessage({
      type: 'auto-parse',
      targetUrl: target,
      fromOverlayRetry: true,
      excludeIndexes: exclude
    });
  }

  function makeOverlay() {
    ensureStyles();
    let root = document.getElementById(OVERLAY_ID);
    if (root) return bindOverlay(root);

    root = document.createElement('div');
    root.id = OVERLAY_ID;
    const box = document.createElement('div');
    box.className = 'box';
    const header = document.createElement('header');
    const title = document.createElement('div'); title.className = 'title'; title.textContent = '正在解析…';
    const actions = document.createElement('div'); actions.className = 'actions';
    const btnSwitch = document.createElement('button'); btnSwitch.className = 'btn btn-switch'; btnSwitch.textContent = '换线路';
    const btnNewtab = document.createElement('button'); btnNewtab.className = 'btn btn-newtab'; btnNewtab.textContent = '新标签页打开';
    const btnClose = document.createElement('button'); btnClose.className = 'btn btn-close'; btnClose.textContent = '关闭';
    actions.appendChild(btnSwitch); actions.appendChild(btnNewtab); actions.appendChild(btnClose);
    header.appendChild(title); header.appendChild(actions);
    const content = document.createElement('div'); content.className = 'content';
    const iframe = document.createElement('iframe'); iframe.setAttribute('allowfullscreen', 'true');
    const loading = document.createElement('div'); loading.className = 'loading';
    const sp = document.createElement('div'); sp.className = 'spinner'; loading.appendChild(sp);
    const toast = document.createElement('div'); toast.className = 'toast'; toast.style.display = 'none';
    content.appendChild(iframe); content.appendChild(loading); content.appendChild(toast);
    box.appendChild(header); box.appendChild(content);
    root.appendChild(box);
    document.documentElement.appendChild(root);

    function onKey(e) {
      if (e.key === 'Escape') {
        root.remove();
        document.removeEventListener('keydown', onKey);
      }
    }
    document.addEventListener('keydown', onKey);

    let dragging = false, sx = 0, sy = 0, bx = 0, by = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      const rect = box.getBoundingClientRect(); bx = rect.left; by = rect.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      box.style.left = (bx + e.clientX - sx) + 'px';
      box.style.top = (by + e.clientY - sy) + 'px';
      box.style.transform = 'translate(0,0)';
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    btnClose.addEventListener('click', () => root.remove());
    btnNewtab.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'fallback-open-newtab', href: iframe.src }));
    btnSwitch.addEventListener('click', () => {
      showToast(bindOverlay(root), '正在切换线路…');
      requestSwitchLine();
    });

    try {
      chrome.storage.sync.get(['overlay'], (cfg) => {
        const ov = cfg && cfg.overlay;
        if (ov && ov.width && ov.height) {
          box.style.width = Math.min(window.innerWidth - 20, ov.width) + 'px';
          box.style.height = Math.min(window.innerHeight - 20, ov.height) + 'px';
        }
      });
    } catch {}

    return { root, box, header, iframe, loading, toast, title, btnSwitch, btnNewtab, btnClose };
  }

  function showToast(overlay, text) {
    overlay.toast.textContent = text;
    overlay.toast.style.display = 'block';
    setTimeout(() => {
      if (overlay.toast.textContent === text) overlay.toast.style.display = 'none';
    }, 2800);
  }

  function loadUrlWithRetry(overlay, url) {
    const gen = ++loadGen;
    overlay.title.textContent = retryCount
      ? `正在解析…（备用 ${retryCount}/${maxRetry}）`
      : '正在解析…';
    overlay.loading.style.display = 'flex';
    overlay.iframe.src = url;

    let loadFired = false;
    const onLoad = () => {
      if (gen !== loadGen) return;
      loadFired = true;
      overlay.loading.style.display = 'none';
      // 跨域 iframe 被 XFO/CSP 拦截时仍会触发 load，不能当作播放成功
      showToast(overlay, '解析页已打开；若黑屏请点“换线路”或“新标签页打开”');
      try {
        chrome.storage.sync.set({
          overlay: { width: overlay.box.offsetWidth, height: overlay.box.offsetHeight }
        });
      } catch {}
    };
    overlay.iframe.addEventListener('load', onLoad, { once: true });

    // 仅在完全未触发 load（网络挂起）时自动换线；XFO 黑屏靠手动「换线路」
    setTimeout(() => {
      if (gen !== loadGen || loadFired) return;
      if (!autoRetryEnabled || retryCount >= maxRetry) {
        overlay.loading.style.display = 'none';
        showToast(overlay, '加载超时，请尝试“换线路”或“新标签页打开”');
        return;
      }
      retryCount++;
      showToast(overlay, '加载超时，正在尝试备用通道…');
      requestSwitchLine();
    }, 2500);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'vip-ping') {
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'open-overlay' && typeof msg.url === 'string') {
      if (typeof msg.targetUrl === 'string' && msg.targetUrl) currentTargetUrl = msg.targetUrl;
      if (Number.isInteger(msg.parserIndex)) currentParserIndex = msg.parserIndex;
      if (Array.isArray(msg.excludeIndexes)) {
        excludedIndexes = msg.excludeIndexes.filter((n) => Number.isInteger(n) && n >= 0);
      }
      if (typeof msg.autoRetryEnabled === 'boolean') autoRetryEnabled = msg.autoRetryEnabled;
      if (typeof msg.autoRetryMax === 'number' && msg.autoRetryMax >= 0) maxRetry = msg.autoRetryMax;

      if (!pendingRetry) {
        retryCount = 0;
        if (!msg.fromOverlayRetry) excludedIndexes = [];
      }
      pendingRetry = false;
      loadUrlWithRetry(makeOverlay(), msg.url);
      sendResponse({ ok: true });
      return false;
    }
  });
})();
