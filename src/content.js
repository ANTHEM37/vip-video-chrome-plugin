(() => {
  const OVERLAY_ID = 'vip-parser-overlay';
  let retryCount = 0;
  const MAX_RETRY = 2;

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
      #${OVERLAY_ID} .toast { position:absolute; left:12px; bottom:12px; background: rgba(15,23,42,.75); color:#e5e7eb; font-size:12px; padding:6px 10px; border-radius:8px; }
    `;
    document.documentElement.appendChild(style);
  }

  function makeOverlay() {
    ensureStyles();
    let root = document.getElementById(OVERLAY_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = OVERLAY_ID;
    const box = document.createElement('div');
    box.className = 'box';
    const header = document.createElement('header');
    const title = document.createElement('div'); title.className='title'; title.textContent='正在解析…';
    const actions = document.createElement('div'); actions.className='actions';
    const btnNewtab = document.createElement('button'); btnNewtab.className='btn'; btnNewtab.textContent='新标签页打开';
    const btnClose = document.createElement('button'); btnClose.className='btn'; btnClose.textContent='关闭';
    actions.appendChild(btnNewtab); actions.appendChild(btnClose);
    header.appendChild(title); header.appendChild(actions);
    const content = document.createElement('div'); content.className='content';
    const iframe = document.createElement('iframe'); iframe.setAttribute('allowfullscreen','true');
    const loading = document.createElement('div'); loading.className='loading'; const sp = document.createElement('div'); sp.className='spinner'; loading.appendChild(sp);
    const toast = document.createElement('div'); toast.className='toast'; toast.style.display='none';
    content.appendChild(iframe); content.appendChild(loading); content.appendChild(toast);
    box.appendChild(header); box.appendChild(content);
    root.appendChild(box);
    document.documentElement.appendChild(root);

    // ESC to close
    function onKey(e){ if(e.key==='Escape'){ root.remove(); document.removeEventListener('keydown', onKey);} }
    document.addEventListener('keydown', onKey);

    // drag behavior
    let dragging=false, sx=0, sy=0, bx=0, by=0;
    header.addEventListener('mousedown', (e)=>{ dragging=true; sx=e.clientX; sy=e.clientY; const rect=box.getBoundingClientRect(); bx=rect.left; by=rect.top; e.preventDefault();});
    document.addEventListener('mousemove', (e)=>{ if(!dragging) return; const dx=e.clientX-sx, dy=e.clientY-sy; box.style.left=(bx+dx)+'px'; box.style.top=(by+dy)+'px'; box.style.transform='translate(0,0)';});
    document.addEventListener('mouseup', ()=> dragging=false);

    btnClose.addEventListener('click', ()=> root.remove());
    btnNewtab.addEventListener('click', ()=> chrome.runtime.sendMessage({ type:'fallback-open-newtab', href: iframe.src }));

    // apply initial size from config if available
    try {
      chrome.storage.sync.get(['overlay'], (cfg) => {
        const ov = cfg && cfg.overlay;
        if (ov && ov.width && ov.height) {
          box.style.width = Math.min(window.innerWidth-20, ov.width) + 'px';
          box.style.height = Math.min(window.innerHeight-20, ov.height) + 'px';
        }
      });
    } catch {}

    return { root, box, header, iframe, loading, toast, title };
  }

  function showToast(overlay, text) {
    overlay.toast.textContent = text;
    overlay.toast.style.display = 'block';
    setTimeout(()=> overlay.toast.style.display='none', 2000);
  }

  function openOverlay(url) {
    const overlay = makeOverlay();
    retryCount = 0;
    loadUrlWithRetry(overlay, url);
  }

  function loadUrlWithRetry(overlay, url) {
    overlay.title.textContent = retryCount ? `正在解析…（重试 ${retryCount}/${MAX_RETRY}）` : '正在解析…';
    overlay.loading.style.display = 'flex';
    overlay.iframe.src = url;
    let loaded = false;
    const onLoad = () => {
      loaded = true; overlay.loading.style.display='none'; showToast(overlay, '解析成功');
      try { chrome.storage.sync.set({ overlay: { lastW: overlay.box.offsetWidth, lastH: overlay.box.offsetHeight } }); } catch {}
    };
    overlay.iframe.addEventListener('load', onLoad, { once: true });
    // timeout to detect CSP/frame-block. If not loaded within 1500ms, try next best via background
    setTimeout(() => {
      if (loaded) return;
      if (retryCount < MAX_RETRY) {
        retryCount++;
        // Ask background to pick best again and push new URL back to us
        chrome.runtime.sendMessage({ type:'auto-parse', targetUrl: location.href });
        showToast(overlay, '正在尝试备用通道…');
      } else {
        overlay.loading.style.display='none';
        showToast(overlay, '内嵌受限，建议使用“新标签页打开”');
      }
    }, 1500);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'open-overlay' && typeof msg.url === 'string') {
      const overlay = makeOverlay();
      // when auto-parse asks us again, update src and retry
      loadUrlWithRetry(overlay, msg.url);
    }
  });
})();
