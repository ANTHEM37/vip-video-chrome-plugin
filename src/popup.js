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

(async function init() {
  const curUrl = await getActiveUrl();
  await getSettings(); // warm settings

  const parseBtn = document.getElementById('parseBtn');
  const probeBtn = document.getElementById('probeBtn');
  const probeArea = document.getElementById('probeArea');
  const openOptions = document.getElementById('openOptions');

  if (openOptions) {
    openOptions.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  // 探测流程：并行探测，返回即更新；默认选最短耗时成功路线
  probeBtn.addEventListener('click', async () => {
    if (!/^https?:/.test(curUrl)) return;
    // 重置按钮与提示
    parseBtn.disabled = true;
    parseBtn.textContent = '开始解析';
    parseBtn.onclick = null;
    const chooseHintEl = document.getElementById('chooseHint');
    if (chooseHintEl) chooseHintEl.style.display = 'none';
    probeBtn.disabled = true;
    probeBtn.textContent = '正在探测…';
    probeArea.style.display = 'block';

    // 根据解析器数量预创建占位胶囊（pending）
    const s = await getSettings();
    const N = (s && Array.isArray(s.parsers)) ? s.parsers.length : 0;
    probeArea.innerHTML = '';
    const frag = document.createElement('div');
    frag.className = 'grid';
    probeArea.appendChild(frag);
    const pillEls = Array.from({ length: Math.max(1, N) }, (_, i) => {
      const pill = document.createElement('div');
      pill.className = 'pill';
      const dot = document.createElement('span'); dot.className = 'dotk';
      const label = document.createElement('span'); label.textContent = `线路 ${i+1}`;
      pill.appendChild(dot); pill.appendChild(label);
      frag.appendChild(pill);
      return pill;
    });

    const probeId = String(Date.now());
    const chosen = { idx: -1 };

    function select(i) {
      chosen.idx = i;
      pillEls.forEach((el, k) => el.classList.toggle('active', k === i));
      parseBtn.disabled = false;
      parseBtn.onclick = () => chrome.runtime.sendMessage({ type: 'auto-parse', preferIndex: i, targetUrl: curUrl });
      const h = document.getElementById('chooseHint'); if (h) h.style.display = 'none';
    }

    function renderStatus(i, status, time) {
      const pill = pillEls[i] || null;
      if (!pill) return;
      const [dotEl, labelEl] = pill.children;
      dotEl.className = (status === 'ok') ? 'dotg' : (status === 'fail' ? 'dotr' : 'dotk');
      labelEl.textContent = `线路 ${i+1}${(time && status==='ok') ? ` · ${time}ms` : ''}`;
      if (status === 'ok') {
        pill.style.cursor = 'pointer';
        pill.onclick = () => select(i);
      } else {
        pill.style.cursor = 'default';
        pill.onclick = null;
      }
    }

    // 逐条进度 + 完成汇总
    const onMsg = (m) => {
      if (!m || m.probeId !== probeId) return;
      if (m.type === 'probe-progress') { renderStatus(m.idx, m.status, m.time); }
      if (m.type === 'probe-done') {
        probeBtn.disabled = false; probeBtn.textContent = '重新探测';
        if (typeof m.bestIndex === 'number' && m.bestIndex >= 0) {
          renderStatus(m.bestIndex, 'ok', m.times && m.times[m.bestIndex]);
          select(m.bestIndex);
        }
        chrome.runtime.onMessage.removeListener(onMsg);
      }
    };
    chrome.runtime.onMessage.addListener(onMsg);

    chrome.runtime.sendMessage({ type: 'probe-start', probeId, targetUrl: curUrl }, (resp) => {
      if (!resp || resp.ok !== true) {
        probeArea.textContent = '探测失败，请稍后重试。';
        probeBtn.disabled = false; probeBtn.textContent = '探测路线';
        chrome.runtime.onMessage.removeListener(onMsg);
      } else {
        const h = document.getElementById('chooseHint');
        if (h) h.style.display = 'block';
      }
    });
  });
})();
