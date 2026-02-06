const DEFAULTS = {
  // default named parsers
  parsers: [
    { name: "虾米解析", url: "https://jx.xmflv.com/?url=" },
    { name: "冰豆解析", url: "https://player.bingdou.vip/?url=" }
  ],
  sitePatterns: [
    "*://*.v.qq.com/*",
    "*://*.youku.com/*",
    "*://*.iqiyi.com/*",
    "*://*.mgtv.com/*",
    "*://*.bilibili.com/*",
    "*://tv.sohu.com/*"
  ]
};

function normalizeParsers(parsers) {
  if (!Array.isArray(parsers)) return DEFAULTS.parsers.slice();
  return parsers.map((p, i) => {
    if (typeof p === 'string') {
      let name = '接口' + (i+1);
      try { name = new URL(p).hostname; } catch {}
      return { name, url: p };
    }
    return { name: p.name || (p.url ? new URL(p.url).hostname : '接口' + (i+1)), url: p.url || '' };
  }).filter(x => x.url);
}

async function load() {
  const s = await chrome.storage.sync.get(["parsers","defaultParserIndex","sitePatterns"]);
  return {
    parsers: normalizeParsers(s.parsers && s.parsers.length ? s.parsers : DEFAULTS.parsers),
    defaultParserIndex: typeof s.defaultParserIndex === "number" ? s.defaultParserIndex : 0,
    sitePatterns: Array.isArray(s.sitePatterns) && s.sitePatterns.length ? s.sitePatterns : DEFAULTS.sitePatterns.slice()
  };
}

async function save(partial) {
  await chrome.storage.sync.set(partial);
}

function renderParsers(state) {
  const ul = document.getElementById("parserList");
  ul.innerHTML = "";
  state.parsers.forEach((p, i) => {
    const li = document.createElement("li");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "defaultParser";
    radio.checked = i === state.defaultParserIndex;
    radio.addEventListener("change", async () => {
      state.defaultParserIndex = i;
      await save({ defaultParserIndex: i });
    });

    const nameInput = document.createElement("input");
    nameInput.value = p.name || "";
    nameInput.placeholder = "名称(如 虾米解析)";
    nameInput.style.flex = "0 0 30%";

    const urlInput = document.createElement("input");
    urlInput.value = p.url || "";
    urlInput.placeholder = "接口URL前缀，如 https://.../?url=";
    urlInput.style.flex = "1";

    const applyChange = async () => {
      state.parsers[i] = { name: nameInput.value.trim() || p.name || '', url: urlInput.value.trim() || p.url || '' };
      await save({ parsers: state.parsers });
      // also refresh context menus via storage change listener in background
    };
    nameInput.addEventListener("change", applyChange);
    urlInput.addEventListener("change", applyChange);

    const testBtn = document.createElement("button");
    testBtn.textContent = "测试";
    testBtn.addEventListener("click", async () => {
      const sample = "https://v.qq.com/x/cover/mzc00200pn9oay5/d4101psldo0.html";
      const base = urlInput.value.trim() || p.url;
      const url = base + encodeURIComponent(sample);
      await chrome.tabs.create({ url });
    });

    const delBtn = document.createElement("button");
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", async () => {
      state.parsers.splice(i, 1);
      if (state.defaultParserIndex >= state.parsers.length) state.defaultParserIndex = 0;
      await save({ parsers: state.parsers, defaultParserIndex: state.defaultParserIndex });
      renderParsers(state);
    });

    li.appendChild(radio);
    li.appendChild(nameInput);
    li.appendChild(urlInput);
    li.appendChild(testBtn);
    li.appendChild(delBtn);
    ul.appendChild(li);
  });
}

document.getElementById("addParser").addEventListener("click", async () => {
  const input = document.getElementById("parserInput");
  const val = input.value.trim();
  if (!/^https?:\/\//.test(val)) {
    alert("请输入以 http(s):// 开头的解析接口前缀");
    return;
  }
  const state = await load();
  let name = "自定义接口";
  try { name = new URL(val).hostname; } catch {}
  state.parsers.push({ name, url: val });
  await save({ parsers: state.parsers });
  input.value = "";
  renderParsers(state);
});

document.getElementById("savePatterns").addEventListener("click", async () => {
  const lines = document.getElementById("patternsBox").value
    .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  await save({ sitePatterns: lines });
  alert("已保存站点清单");
});

document.getElementById("restoreDefaults").addEventListener("click", async () => {
  await save({ sitePatterns: DEFAULTS.sitePatterns });
  document.getElementById("patternsBox").value = DEFAULTS.sitePatterns.join("\n");
});

document.getElementById("exportBtn").addEventListener("click", async () => {
  const state = await load();
  document.getElementById("ioBox").value = JSON.stringify({
    parsers: state.parsers,
    defaultParserIndex: state.defaultParserIndex,
    sitePatterns: state.sitePatterns
  }, null, 2);
});

document.getElementById("importBtn").addEventListener("click", async () => {
  try {
    const obj = JSON.parse(document.getElementById("ioBox").value);
    if (!Array.isArray(obj.parsers) || typeof obj.defaultParserIndex !== "number" || !Array.isArray(obj.sitePatterns)) {
      alert("导入内容格式不正确");
      return;
    }
    await save(obj);
    alert("已导入配置");
    const state = await load();
    renderParsers(state);
    document.getElementById("patternsBox").value = state.sitePatterns.join("\n");
  } catch (e) {
    alert("解析导入内容失败： " + e.message);
  }
});

(async function boot() {
  const state = await load();
  renderParsers(state);
  document.getElementById("patternsBox").value = state.sitePatterns.join("\n");
})();
