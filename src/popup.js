async function getActiveUrl() {
  return new Promise((res) => {
    chrome.runtime.sendMessage({ type: "get-active-url" }, (reply) => {
      if (chrome.runtime.lastError) return res("");
      res(reply?.url || "");
    });
  });
}

async function getSettings() {
  return new Promise((res) => {
    chrome.runtime.sendMessage({ type: "get-settings" }, (reply) => {
      if (chrome.runtime.lastError) return res(null);
      res(reply);
    });
  });
}

(async function init() {
  const parseBtn = document.getElementById("parseBtn");
  const probeBtn = document.getElementById("probeBtn");
  const probeArea = document.getElementById("probeArea");
  const openOptions = document.getElementById("openOptions");
  const chooseHint = document.getElementById("chooseHint");

  if (openOptions) {
    openOptions.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
  }

  function setHint(text, show = true) {
    if (!chooseHint) return;
    chooseHint.textContent = text;
    chooseHint.style.display = show ? "block" : "none";
  }

  // 探测流程：并行探测，返回即更新；默认选最短耗时成功路线
  probeBtn.addEventListener("click", async () => {
    const curUrl = await getActiveUrl();
    if (!/^https?:/.test(curUrl)) {
      setHint("请先打开一个 http(s) 视频页面再探测。");
      return;
    }

    parseBtn.disabled = true;
    parseBtn.textContent = "开始解析";
    parseBtn.onclick = null;
    setHint("", false);

    probeBtn.disabled = true;
    probeBtn.textContent = "正在探测…";
    probeArea.style.display = "block";

    const s = await getSettings();
    const N = (s && Array.isArray(s.parsers)) ? s.parsers.length : 0;
    if (!N) {
      probeArea.textContent = "暂无解析线路，请先在设置中添加或恢复内置接口。";
      probeBtn.disabled = false;
      probeBtn.textContent = "探测路线";
      setHint("没有可用线路。", true);
      return;
    }

    probeArea.innerHTML = "";
    const frag = document.createElement("div");
    frag.className = "grid";
    probeArea.appendChild(frag);
    const pillEls = Array.from({ length: N }, (_, i) => {
      const pill = document.createElement("div");
      pill.className = "pill";
      const dot = document.createElement("span"); dot.className = "dotk";
      const label = document.createElement("span"); label.textContent = `线路 ${i + 1}`;
      pill.appendChild(dot); pill.appendChild(label);
      frag.appendChild(pill);
      return pill;
    });

    const probeId = String(Date.now());

    function select(i) {
      pillEls.forEach((el, k) => el.classList.toggle("active", k === i));
      parseBtn.disabled = false;
      parseBtn.onclick = async () => {
        const url = await getActiveUrl();
        const targetUrl = /^https?:/.test(url) ? url : curUrl;
        chrome.runtime.sendMessage({ type: "auto-parse", preferIndex: i, targetUrl });
      };
      setHint("", false);
    }

    function renderStatus(i, status, time) {
      const pill = pillEls[i] || null;
      if (!pill) return;
      const [dotEl, labelEl] = pill.children;
      dotEl.className = (status === "ok") ? "dotg" : (status === "fail" ? "dotr" : "dotk");
      labelEl.textContent = `线路 ${i + 1}${(time && status === "ok") ? ` · ${time}ms` : ""}`;
      if (status === "ok") {
        pill.style.cursor = "pointer";
        pill.onclick = () => select(i);
      } else {
        pill.style.cursor = "default";
        pill.onclick = null;
      }
    }

    const onMsg = (m) => {
      if (!m || m.probeId !== probeId) return;
      if (m.type === "probe-progress") renderStatus(m.idx, m.status, m.time);
      if (m.type === "probe-done") {
        probeBtn.disabled = false;
        probeBtn.textContent = "重新探测";
        if (typeof m.bestIndex === "number" && m.bestIndex >= 0) {
          renderStatus(m.bestIndex, "ok", m.times && m.times[m.bestIndex]);
          select(m.bestIndex);
          setHint("已选最短成功线路，也可手动改选后点击“开始解析”。", true);
        } else {
          setHint("全部线路探测失败，请稍后重试或到设置中更换接口。", true);
        }
        chrome.runtime.onMessage.removeListener(onMsg);
      }
    };
    chrome.runtime.onMessage.addListener(onMsg);

    chrome.runtime.sendMessage({ type: "probe-start", probeId, targetUrl: curUrl }, (resp) => {
      if (chrome.runtime.lastError || !resp || resp.ok !== true) {
        probeArea.textContent = resp?.error === "no-parsers"
          ? "暂无解析线路，请先在设置中添加接口。"
          : "探测失败，请稍后重试。";
        probeBtn.disabled = false;
        probeBtn.textContent = "探测路线";
        setHint("", false);
        chrome.runtime.onMessage.removeListener(onMsg);
      }
    });
  });
})();
