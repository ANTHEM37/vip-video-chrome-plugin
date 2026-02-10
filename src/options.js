function normalizeParsers(parsers){
  if(!Array.isArray(parsers)) return [];
  return parsers.map((p,i)=>{
    if(typeof p==='string') return { name: '接口'+(i+1), url: p };
    return { name: p.name||('接口'+(i+1)), url: p.url||'' };
  }).filter(x=>x.url);
}

async function loadStaticDefaults(){
  try{
    const res = await fetch(chrome.runtime.getURL('src/config.json'), { cache:'no-store' });
    const json = await res.json();
    return Array.isArray(json.parsers) ? json.parsers : [];
  }catch{return []}
}

async function readParsers(){
  const cur = await chrome.storage.sync.get(['parsers']);
  return normalizeParsers(cur.parsers||[]);
}

async function writeParsers(parsers){
  await chrome.storage.sync.set({ parsers: normalizeParsers(parsers) });
}

function rowTpl(i, p){
  return `<tr data-i="${i}"><td>${i+1}</td><td><input class="nm" type="text" value="${p.name||''}"/></td><td><input class="ux" type="text" value="${p.url||''}"/></td><td><button class="up ghost">上移</button> <button class="down ghost">下移</button> <button class="del danger">删除</button></td></tr>`;
}

async function render(){
  const list = document.getElementById('list');
  const parsers = await readParsers();
  list.innerHTML = parsers.map((p,i)=>rowTpl(i,p)).join('');
}

async function saveFromTable(){
  const rows = Array.from(document.querySelectorAll('#list tr'));
  const parsers = rows.map(tr=>({
    name: tr.querySelector('.nm').value.trim()||'',
    url: tr.querySelector('.ux').value.trim()
  })).filter(x=>x.url);
  await writeParsers(parsers);
  const msg = document.getElementById('msg');
  msg.textContent = '已保存。'; setTimeout(()=> msg.textContent='', 1500);
}

document.getElementById('add').addEventListener('click', async ()=>{
  const nm = document.getElementById('name');
  const ux = document.getElementById('url');
  const name = nm.value.trim(); const url = ux.value.trim();
  if(!url){ return; }
  const cur = await readParsers();
  cur.push({ name: name||('接口'+(cur.length+1)), url });
  await writeParsers(cur);
  nm.value=''; ux.value='';
  await render();
});

document.getElementById('save').addEventListener('click', saveFromTable);

document.getElementById('restore').addEventListener('click', async ()=>{
  const def = await loadStaticDefaults();
  await writeParsers(def);
  await render();
});

document.getElementById('list').addEventListener('click', async (e)=>{
  const btn = e.target.closest('button'); if(!btn) return;
  const tr = btn.closest('tr'); const i = Number(tr.dataset.i);
  const cur = await readParsers();
  if(btn.classList.contains('del')) cur.splice(i,1);
  if(btn.classList.contains('up') && i>0) cur.splice(i-1,2,cur[i],cur[i-1]);
  if(btn.classList.contains('down') && i<cur.length-1) cur.splice(i,2,cur[i+1],cur[i]);
  await writeParsers(cur);
  await render();
});

render();

