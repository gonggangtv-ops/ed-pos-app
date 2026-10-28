// ใช้ร่วมกันทุกหน้า: เรียก API, อัปเดตเรียลไทม์, พิมพ์ใบเสร็จ
const S = { settings: {}, menu: [], categories: [], optionSets: [], orders: [], items: [], events: [] };
// กลุ่มตัวเลือกของเมนู (แทนชุดสำเร็จรูปที่ผูกไว้ด้วยตัวจริง)
const groupsOf = m => (m.groups || []).map(g => (g.ref ? S.optionSets.find(s => s.id === g.ref) : g)).filter(Boolean);
// ตารางราคา: m.grid = {groups: ['เนื้อสัตว์', 'ขนาด'], prices: {'ทะเล|S': 150}} · ไม่มีในตาราง = ไม่มีขาย
// ราคาจาน = ราคาในตาราง + บวกราคาของกลุ่มอื่น (กลุ่มที่อยู่ในตารางไม่ใช้ช่อง "บวกราคา")
const gridOf = m => (m?.grid?.groups?.length && Object.keys(m.grid.prices || {}).length ? m.grid : null);
// choiceOf(ชื่อกลุ่ม) → ชื่อตัวเลือกที่เลือก · คืน undefined ถ้ายังเลือกไม่ครบหรือไม่มีขาย
const gridPrice = (grid, choiceOf) => { const k = grid.groups.map(choiceOf); return k.some(x => x == null) ? undefined : grid.prices[k.join('|')]; };
// เลือกได้หลายอย่าง (เนื้อสัตว์ผสม): selOf(ชื่อกลุ่ม) → [ชื่อตัวเลือก…] · ราคา = แพงสุดของทุกคู่ · มีคู่ที่ไม่มีขาย → undefined
// thai = ราคาคนไทย (grid.pricesTh · ช่องที่ไม่ได้ใส่ใช้ราคาปกติ)
// ราคาคนไทยไม่แยกตามกลุ่มหนึ่ง (grid.thaiSkip เช่น "ขนาด") → กลุ่มนั้นไม่ต้องเลือก ราคามาจาก pricesTh ของกลุ่มที่เหลือ
const thaiSkipOf = grid => (grid?.thaiSkip && Object.keys(grid.pricesTh || {}).length ? grid.thaiSkip : null);
function gridPriceAll(grid, selOf, thai = false) {
  const skip = thai ? thaiSkipOf(grid) : null;
  if (skip) {
    let cs = [[]];
    for (const n of grid.groups.filter(n => n !== skip)) cs = cs.flatMap(c => (selOf(n) || []).map(x => [...c, x]));
    let best;
    for (const c of cs) { const p = grid.pricesTh[c.join('|')]; if (p == null) return undefined; best = best == null ? p : Math.max(best, p); }
    return best;
  }
  let combos = [[]];
  for (const n of grid.groups) combos = combos.flatMap(c => (selOf(n) || []).map(x => [...c, x]));
  if (!combos.length || combos.some(c => c.length !== grid.groups.length)) return undefined;
  let best;
  for (const c of combos) {
    const k = c.join('|'); let p = grid.prices[k]; if (p == null) return undefined;
    if (thai && grid.pricesTh?.[k] != null) p = grid.pricesTh[k];
    best = best == null ? p : Math.max(best, p);
  }
  return best;
}
// ตัวเลือกนี้มีขายอย่างน้อยหนึ่งช่องในตารางไหม
const gridHas = (grid, gname, cname) => { const i = grid.groups.indexOf(gname); return i < 0 || Object.keys(grid.prices).some(k => k.split('|')[i] === cname); };
// เมนูนี้ตั้งราคาคนไทยไว้ไหม
// บวกราคาของตัวเลือก · คนไทยใช้ addTh ถ้าตั้งไว้ (เช่น ไข่ดาว ฝรั่งฟรี คนไทย +10)
const hasAddTh = c => c?.addTh != null && c.addTh !== '';
const addOf = (c, thai) => Number(thai && hasAddTh(c) ? c.addTh : c.add) || 0;
const hasThaiPrice = m => (m?.priceTh != null && m.priceTh !== '') || !!(gridOf(m) && Object.keys(m.grid.pricesTh || {}).length)
  || groupsOf(m).some(g => g.choices.some(hasAddTh));
// ราคาต่ำสุด–สูงสุดของเมนู (รวมตัวเลือกที่บวกราคา) · thai = ราคาคนไทย
function menuPriceRange(m, thai = false) {
  const grid = gridOf(m);
  const gp = !grid ? null : thai && thaiSkipOf(grid) ? Object.values(grid.pricesTh).map(Number)
    : Object.keys(grid.prices).map(k => Number(thai && grid.pricesTh?.[k] != null ? grid.pricesTh[k] : grid.prices[k]));
  const one = thai && m.priceTh != null && m.priceTh !== '' ? Number(m.priceTh) : Number(m.price) || 0;
  let lo = grid ? Math.min(...gp) : one, hi = grid ? Math.max(...gp) : lo;
  for (const g of groupsOf(m)) {
    if (grid?.groups.includes(g.name)) continue;
    const adds = g.choices.map(c => addOf(c, thai));
    if (!adds.length) continue;
    if (g.type === 'single') { if (g.required) lo += Math.min(...adds); hi += Math.max(...adds); }
    else hi += adds.filter(a => a > 0).reduce((a, b) => a + b, 0);
  }
  return [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100];
}

async function api(path, body) {
  const h = {};
  const t = PIN.token();
  if (t) h['X-Pin-Token'] = t;
  const r = await fetch(path, body === undefined ? { headers: h } : {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (r.status === 401 && j.auth) { PIN.rejected(t); throw new Error(j.error || 'ต้องใส่รหัสก่อน'); }
  if (!r.ok) throw new Error(j.error || 'ผิดพลาด');
  return j;
}

// ================= ล็อกด้วยรหัส PIN 4 หลัก =================
// หน้าที่ต้องใส่รหัสตั้ง <body data-pin="staff"> (หน้าสั่งอาหาร) หรือ "admin" (หลังร้าน)
// staff: จำไว้ในเครื่องจนกว่าจะกดล็อก · admin: ล็อกเองเมื่อไม่ได้ใช้ 10 นาที
const PIN = (() => {
  const need = document.body.dataset.pin || '';
  const KEY = 'edpos-pin-' + need, IDLE = 10 * 60000;
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } },
    set(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch {} },
  };
  let mem = store.get(), box = null;
  const valid = () => mem && mem.token && (need !== 'admin' || Date.now() - (mem.at || 0) < IDLE);
  const reloaders = [];

  function token() {
    if (!need) return '';
    if (!valid()) { lock(); return ''; }
    return mem.token;   // เวลาล็อกอัตโนมัตินับจากการแตะของคน ไม่ใช่จากข้อมูลที่อัปเดตเอง
  }
  // ใช้งานอยู่ (แตะ/พิมพ์) → นับเวลาล็อกอัตโนมัติใหม่
  if (need === 'admin') {
    let last = 0;
    const touch = () => { if (valid() && Date.now() - last > 5000) { last = Date.now(); mem.at = last; store.set(mem); } };
    addEventListener('pointerdown', touch, true); addEventListener('keydown', touch, true);
    setInterval(() => { if (mem && !valid()) lock(); }, 15000);
  }

  function css() {
    if (document.getElementById('pinCss')) return;
    const s = document.createElement('style'); s.id = 'pinCss';
    s.textContent = `
      #pinLock { position: fixed; inset: 0; z-index: 10000; background: #18201d; color: #fff; display: flex; align-items: center; justify-content: center;
        font-family: "IBM Plex Sans Thai", "Noto Sans Thai", system-ui, sans-serif; padding: 16px; overflow: auto; }
      #pinLock .pb { width: min(340px, 100%); text-align: center; }
      #pinLock .ps { font-size: 15px; color: #ffffffa0; margin: 0 0 4px; }
      #pinLock h2 { font-size: 22px; margin: 0 0 22px; font-weight: 600; }
      #pinLock .dots { display: flex; gap: 18px; justify-content: center; margin-bottom: 14px; }
      #pinLock .dots i { width: 16px; height: 16px; border-radius: 50%; border: 2px solid #ffffffb0; }
      #pinLock .dots i.on { background: #fff; border-color: #fff; }
      #pinLock .msg { min-height: 24px; font-size: 15px; color: #ffb4a6; margin-bottom: 14px; }
      #pinLock .msg.ok { color: #ffffffa0; }
      #pinLock .keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
      #pinLock .keys button { height: 70px; font: 600 28px/1 inherit; font-family: inherit; border-radius: 16px; border: 0;
        background: #ffffff17; color: #fff; cursor: pointer; touch-action: manipulation; }
      #pinLock .keys button:active { background: #ffffff38; transform: scale(.96); }
      #pinLock .keys button.fn { font-size: 17px; font-weight: 500; background: transparent; }
      #pinLock .keys button:disabled { opacity: .3; }
      #pinLock .alt { margin-top: 20px; font-size: 14px; } #pinLock .alt a { color: #ffffffa0; }
      #pinLock.shake .dots { animation: pinShake .35s; }
      @keyframes pinShake { 20%, 60% { transform: translateX(-10px); } 40%, 80% { transform: translateX(10px); } }
      @media (prefers-reduced-motion: reduce) { #pinLock.shake .dots { animation: none; } }
      @media (max-height: 560px) { #pinLock .keys button { height: 54px; } #pinLock h2 { margin-bottom: 12px; } }`;
    document.head.appendChild(s);
  }

  async function lock() {
    if (!need || box) return;
    mem = null; store.set(null);
    css();
    box = document.createElement('div'); box.id = 'pinLock';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'ใส่รหัส');
    document.body.appendChild(box);
    let info = { setup: false };
    try { info = await (await fetch('/api/auth', { cache: 'no-store' })).json(); } catch {}
    // เครื่องสำรองที่ยังไม่เคยคัดลอกข้อมูลจากเครื่องหลัก (ยังไม่มีรหัส) → ไปหน้าจับคู่ ไม่ใช่ตั้งรหัสใหม่
    if (info.setup && info.standby) { location.replace('standby.html'); return; }
    const st = { pin: '', first: '', busy: false };
    const page = need === 'admin' ? 'หลังร้าน' : 'สั่งอาหาร';
    const draw = (msg = '', ok = false) => {
      const title = info.setup ? (st.first ? 'ใส่รหัสเดิมอีกครั้ง' : 'ตั้งรหัสเจ้าของร้าน 4 หลัก')
        : need === 'admin' ? 'ใส่รหัสเจ้าของร้าน' : 'ใส่รหัสพนักงาน';
      box.innerHTML = `<div class="pb">
        <p class="ps">${esc(info.shopName || 'ED POS')} · ${page}</p>
        <h2>${title}</h2>
        <div class="dots" aria-hidden="true">${[0, 1, 2, 3].map(i => `<i class="${i < st.pin.length ? 'on' : ''}"></i>`).join('')}</div>
        <div class="msg ${ok ? 'ok' : ''}" role="status">${esc(msg)}</div>
        <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
          <button class="fn" data-k="c" ${st.pin ? '' : 'disabled'}>ล้าง</button><button data-k="0">0</button>
          <button class="fn" data-k="b" aria-label="ลบ" ${st.pin ? '' : 'disabled'}>⌫</button></div>
        ${need === 'admin' && !info.setup ? '<div class="alt"><a href="order.html">ไปหน้าสั่งอาหาร</a></div>' : ''}
      </div>`;
    };
    const fail = msg => {
      st.pin = ''; draw(msg); box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
      try { navigator.vibrate?.(150); } catch {}
    };
    const submit = async () => {
      if (info.setup && !st.first) { st.first = st.pin; st.pin = ''; return draw('จำรหัสนี้ไว้ ใช้เข้าหลังร้านและหน้าสั่งอาหาร', true); }
      if (info.setup && st.pin !== st.first) { st.first = ''; return fail('รหัสสองครั้งไม่ตรงกัน เริ่มตั้งใหม่'); }
      st.busy = true;
      try {
        const r = await fetch(info.setup ? '/api/auth/setup' : '/api/login', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: st.pin, want: need }) });
        const j = await r.json();
        if (!r.ok) return fail(j.error || 'รหัสไม่ถูกต้อง');
        mem = { token: j.token, at: Date.now() }; store.set(mem);
        box.remove(); box = null;
        // เปิดหน้ามาตอนล็อก (หลังร้านยังไม่ได้โหลดอะไร) → โหลดใหม่ทั้งหน้า
        // ล็อกระหว่างใช้งาน → แค่ดึงข้อมูลใหม่ สิ่งที่กรอกค้างไว้/รายการที่ยังไม่ส่งยังอยู่
        if (need === 'admin' && !everOk) location.reload(); else reloaders.forEach(f => f());
        everOk = true;
      } catch { fail('ติดต่อเซิร์ฟเวอร์ไม่ได้'); }
      finally { st.busy = false; }
    };
    const press = k => {
      if (st.busy || !box) return;
      if (k === 'b') st.pin = st.pin.slice(0, -1);
      else if (k === 'c') st.pin = '';
      else if (st.pin.length < 4) st.pin += k;
      draw();
      if (st.pin.length === 4) submit();
    };
    box.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b && !b.disabled) press(b.dataset.k); });
    const onKey = e => {
      if (!box) return removeEventListener('keydown', onKey, true);
      if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('b'); else if (e.key === 'Escape') press('c'); else return;
      e.preventDefault(); e.stopPropagation();
    };
    addEventListener('keydown', onKey, true);
    draw();
  }

  let everOk = !!valid();
  if (need && !everOk) lock();
  // หลังเปลี่ยนรหัสเจ้าของร้าน เซิร์ฟเวอร์ให้โทเค็นใหม่มา เครื่องนี้ใช้ต่อได้โดยไม่ต้องใส่รหัสซ้ำ
  const setToken = t => { mem = { token: t, at: Date.now() }; store.set(mem); };
  // เซิร์ฟเวอร์ไม่รับโทเค็น (เช่น เปลี่ยนรหัสแล้ว) → ล็อก · ถ้าเป็นคำขอเก่าที่ส่งไปก่อนใส่รหัสเสร็จ ไม่ต้องล็อกซ้ำ
  const rejected = sent => { if (!mem || mem.token === sent) lock(); };
  return { token, lock, rejected, setToken, onUnlock: f => reloaders.push(f), need };
})();

// ข้อมูลสดทุกเครื่อง: /events แจ้งเมื่อมีการเปลี่ยนแปลง → โหลด /api/state ใหม่
// สาย /events อาจตายเงียบๆ (มือถือพักหน้าจอ แอปอยู่เบื้องหลัง สลับ Wi-Fi) จึงมีตัวกันพลาด 3 ชั้น:
//  1) ไม่ได้ยินชีพจร (ping ทุก 20 วินาที) เกิน 45 วินาที → ต่อสายใหม่ + โหลดข้อมูล
//  2) ทุก 15 วินาทีถามเลขรุ่นข้อมูล (/api/rev ไม่กี่ไบต์) ไม่ตรง → โหลดข้อมูลใหม่
//  3) กลับมาที่แอป / เปิดหน้าจอ / เน็ตกลับมา → ต่อสายใหม่ + โหลดทันที
function live(onUpdate) {
  let es = null, heard = Date.now(), loading = null, again = false;
  const load = async () => {
    if (loading) { again = true; return loading; }   // กำลังโหลดอยู่ → โหลดซ้ำอีกรอบหลังเสร็จ (ไม่ยิงพร้อมกันหลายคำขอ)
    loading = (async () => {
      try { Object.assign(S, await api('/api/state')); onUpdate(); setOnline(true); }
      catch { setOnline(false); }
    })();
    await loading; loading = null;
    if (again) { again = false; load(); }
  };
  const connect = () => {
    try { es?.close(); } catch {}
    heard = Date.now();
    es = new EventSource('/events');
    es.onmessage = () => { heard = Date.now(); load(); };
    es.addEventListener('ping', e => { heard = Date.now(); if (S.rev != null && Number(e.data) !== S.rev) load(); });
    es.onopen = () => { heard = Date.now(); load(); };
    es.onerror = () => setOnline(false);
  };
  const wake = () => { if (document.visibilityState !== 'hidden') { connect(); load(); } };
  PIN.onUnlock(load);
  connect(); load();
  let lastPoll = 0;
  setInterval(async () => {
    if (document.visibilityState === 'hidden') return;
    if (Date.now() - heard > 45000) { connect(); load(); return; }
    if (Date.now() - lastPoll < 15000) return;
    lastPoll = Date.now();
    try { const r = await api('/api/rev'); if (S.rev != null && r.rev !== S.rev) load(); } catch {}
  }, 5000);
  document.addEventListener('visibilitychange', wake);
  addEventListener('pageshow', e => { if (e.persisted) wake(); });
  addEventListener('online', wake);
  addEventListener('focus', () => { if (Date.now() - heard > 20000) wake(); });
}

function setOnline(ok) {
  let el = document.getElementById('net');
  if (!el) { el = document.createElement('div'); el.id = 'net'; document.body.appendChild(el); }
  el.className = ok ? 'ok' : 'bad';
  el.textContent = ok ? '' : 'ขาดการเชื่อมต่อเซิร์ฟเวอร์…';
}

// มีสตางค์ → แสดง 2 ตำแหน่งเสมอ (216.30) · จำนวนเต็ม → ไม่มีทศนิยม (210)
const baht = n => { n = Math.round(Number(n) * 100) / 100 || 0;
  return n.toLocaleString('th-TH', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tableName = t => (String(t).startsWith('TA') ? 'กลับบ้าน ' + String(t).slice(2) : 'โต๊ะ ' + t);
// ชื่อจาน + ตัวเลือก (ไม่รวมคำเตือนแพ้อาหาร ซึ่งแสดงแยกเป็นสีแดง/บรรทัดของตัวเอง)
const itemLabel = i => { const o = i.opts ? i.opts.join(' ') : i.option; return i.name + (o ? ' ' + o : ''); };
const minsAgo = t => Math.max(0, Math.floor((Date.now() - t) / 60000));

function toast(msg, bad) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ---------- ใบเสร็จ: วาดบน canvas แล้วแปลงเป็นภาพขาวดำส่งเครื่องพิมพ์ ----------
// lines: [{text, right, size, bold, align:'center', hr:true}]
//        หรือรูป {image:{src, pct, mode:'dither'|'threshold'}} (กลางหน้า กว้าง pct% ของกระดาษ)
const IMGS = {};   // src → HTMLImageElement ที่โหลดแล้ว
function loadImg(src) {
  if (IMGS[src]) return Promise.resolve(IMGS[src]);
  return new Promise((ok, no) => { const im = new Image(); im.onload = () => ((IMGS[src] = im), ok(im)); im.onerror = () => no(new Error('โหลดรูปบนใบเสร็จไม่ได้')); im.src = src; });
}
const preloadImages = lines => Promise.all(lines.filter(l => l.image).map(l => loadImg(l.image.src)));
function imgSize(l, width, pad) {
  const im = IMGS[l.image.src]; if (!im || !im.naturalWidth) return { w: 0, h: 0 };
  const w = Math.max(16, Math.round((width - pad * 2) * (l.image.pct || 60) / 100));
  return { w, h: Math.round(w * im.naturalHeight / im.naturalWidth) };
}
// ตัดคำภาษาไทย/อังกฤษให้พอดีความกว้าง (ใช้ตัวตัดคำของเบราว์เซอร์ ไม่ตัดกลางสระ/วรรณยุกต์)
const WORDS = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
const splitWords = t => (WORDS ? [...WORDS.segment(t)].map(s => s.segment) : t.match(/\S+\s*|\s+/g) || [t]);
const graphemes = t => t.match(/[^ัิ-ฺ็-๎][ัิ-ฺ็-๎]*|[ัิ-ฺ็-๎]+/gu) || [];
// w0 = ความกว้างบรรทัดแรก · w1 = บรรทัดต่อไป (ย่อหน้าแบบห้อย)
function wrapText(ctx, text, w0, w1 = w0) {
  const out = []; let cur = '';
  const maxW = () => (out.length ? w1 : w0), fits = s => ctx.measureText(s).width <= maxW();
  const push = () => { if (cur.trim()) out.push(cur.trimEnd()); cur = ''; };
  for (const w of splitWords(String(text))) {
    if (fits(cur + w)) { cur += w; continue; }
    if (cur.trim()) { push(); const s = w.trimStart(); if (fits(s)) { cur = s; continue; } }
    for (const ch of graphemes(w.trimStart())) { if (cur && !fits(cur + ch)) push(); cur += ch; }
  }
  push();
  return out.length ? out : [''];
}
// lines: {text, right, size, bold, align, x (ย่อหน้า px), wrap (ตัดบรรทัด), hang (ข้อความหน้าที่บรรทัดต่อไปเยื้องตาม),
//         invert (ตัวขาวบนแถบดำ)} · {hr, dash} เส้นคั่น · {space: px} เว้นว่าง
function drawReceipt(lines, width) {
  const pad = 8, c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = (l) => `${l.bold ? 'bold ' : ''}${l.size || 26}px "Noto Sans Thai", "Sarabun", sans-serif`;
  // ขยายบรรทัดที่ยาวเกินเป็นหลายบรรทัด
  const flat = [];
  for (const l of lines) {
    if (!l.wrap || l.image || l.hr || l.space != null || !l.text) { flat.push(l); continue; }
    ctx.font = font(l);
    const x = l.x || 0, inner = l.invert ? 10 : 0, rw = l.right ? ctx.measureText(l.right).width + 16 : 0;
    const hang = l.hang ? ctx.measureText(l.hang).width : 0, full = width - pad * 2 - x - inner * 2;
    wrapText(ctx, l.text, full - rw, full - hang).forEach((t, k) =>
      flat.push({ ...l, text: t, right: k ? '' : l.right, x: x + (k ? hang : 0), wrap: false, cont: k > 0 }));
  }
  const lh = l => Math.round((l.size || 26) * (l.cont ? 1.25 : 1.45));
  // คำนวณความสูงก่อน
  let h = pad;
  for (const l of flat) h += l.image ? imgSize(l, width, pad).h + 10 : l.hr ? 18 : l.space != null ? l.space : lh(l);
  c.width = width; c.height = h + pad;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
  let y = pad;
  c._dither = [];
  for (const l of flat) {
    if (l.image) {
      const { w, h: ih } = imgSize(l, width, pad);
      if (w) {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(IMGS[l.image.src], Math.round((width - w) / 2), y, w, ih);
        if (l.image.mode === 'dither') c._dither.push([y, y + ih]);
      }
      y += ih + 10; continue;
    }
    if (l.space != null) { y += l.space; continue; }
    if (l.hr) {
      if (l.dash) for (let x = pad; x < width - pad; x += 14) ctx.fillRect(x, y + 8, Math.min(8, width - pad - x), 2);
      else ctx.fillRect(pad, y + 8, width - pad * 2, 2);
      y += 18; continue;
    }
    const size = l.size || 26, rowH = lh(l);
    ctx.font = font(l);
    const top = y + Math.round(size * (l.cont ? 0.02 : 0.12));
    const inner = l.invert ? 10 : 0, x0 = pad + (l.x || 0) + inner;
    if (l.invert) {
      // แถบดำเต็มความกว้าง (บรรทัดต่อกันของข้อความเดียวกันจะเป็นแถบเดียว)
      ctx.fillRect(pad, y, width - pad * 2, rowH); ctx.fillStyle = '#fff';
    }
    if (l.align === 'center') {
      ctx.textAlign = 'center'; ctx.fillText(l.text, width / 2, top, width - pad * 2 - inner * 2);
    } else {
      const rw = l.right ? ctx.measureText(l.right).width + 16 : 0;
      ctx.textAlign = 'left'; ctx.fillText(l.text, x0, top, width - pad - inner - x0 - rw);
      if (l.right) { ctx.textAlign = 'right'; ctx.fillText(l.right, width - pad - inner, top); }
    }
    ctx.fillStyle = '#000';
    y += rowH;
  }
  return c;
}

function canvasToRaster(c) {
  const w = c.width, h = c.height, wb = Math.ceil(w / 8);
  const px = c.getContext('2d').getImageData(0, 0, w, h).data;
  const bits = new Uint8Array(wb * h);
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  // รูปถ่าย: กระจายจุดแบบ Floyd–Steinberg ให้เห็นเป็นโทนเทา · ที่เหลือ (ตัวอักษร โลโก้ขาวดำ) ตัดขาว/ดำที่ 150
  for (const [y0, y1] of c._dither || []) {
    for (let y = y0; y < Math.min(y1, h); y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, old = lum[i], nv = old < 128 ? 0 : 255, err = old - nv;
      lum[i] = nv;
      if (x + 1 < w) lum[i + 1] += err * 7 / 16;
      if (y + 1 < y1) {
        if (x > 0) lum[i + w - 1] += err * 3 / 16;
        lum[i + w] += err * 5 / 16;
        if (x + 1 < w) lum[i + w + 1] += err * 1 / 16;
      }
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (lum[y * w + x] < 150) bits[y * wb + (x >> 3)] |= 0x80 >> (x & 7);
  }
  let bin = '';
  for (let i = 0; i < bits.length; i += 8192) bin += String.fromCharCode.apply(null, bits.subarray(i, i + 8192));
  return { widthBytes: wb, height: h, bitsBase64: btoa(bin) };
}

// ---------- เครื่องพิมพ์ / จอครัว (รายการตั้งที่หลังร้าน) ----------
const printerList = () => S.settings.printers || [];
const printerById = id => printerList().find(p => p.id === id);
const printerName = id => printerById(id)?.name || id;
const receiptPrinter = () => S.settings.receiptPrinter || printerList()[0]?.id;
const screenList = () => S.settings.kdsScreens || [{ id: 'main', name: 'ครัว' }];
// จานที่สั่งก่อนอัปเดตใช้ station/kitchen แบบเก่า
const itemPrinters = i => (Array.isArray(i.printers) ? i.printers : [i.station || 'kitchen']);
const itemScreens = i => (Array.isArray(i.screens) ? i.screens : i.kitchen ? [screenList()[0].id] : []);
const onScreen = i => itemScreens(i).length > 0;   // ครัวติดตามสถานะ (รอทำ/เสร็จ)
// จานที่ยังต้องแจ้งเครื่องพิมพ์เมื่อยกเลิก/ย้ายโต๊ะ: ครัวยังไม่ทำ หรือไม่ได้ติดตามบนจอ (ไม่รู้ว่าทำไปหรือยัง)
const needsSlip = i => i.status === 'new' || !onScreen(i);
const PAY_NAME = { cash: 'เงินสด', transfer: 'โอน/พร้อมเพย์', card: 'บัตร', split: 'แยกจ่าย' };
const PAY_NAME_EN = { cash: 'Cash', transfer: 'Bank transfer', card: 'Card', split: 'Split' };

// ---------- ภาษาบนใบแจ้งยอด/ใบเสร็จ ('th' | 'en' | 'both') ----------
// คำแปลเก็บเป็นพจนานุกรม settings.i18n.en = {คำไทย: English} ตั้งที่หลังร้าน > ชื่อภาษาอังกฤษ
// แปลตอนพิมพ์ จึงใช้กับบิลเก่าได้ · คำที่ยังไม่แปลพิมพ์เป็นภาษาไทย
const LANG_NAME = { th: 'ไทย', en: 'EN', both: '2 ภาษา' };
const billLang = o => o?.lang || S.settings.receipt?.lang || 'th';
const trEn = t => (S.settings.i18n?.en || {})[String(t || '').trim()] || '';
// ชื่อจานภาษาอังกฤษ: Holy basil stir-fry (Crispy pork, Fried egg) · ไม่มีคำแปลเลย → ''
function itemLabelEn(i) {
  const opts = (i.opts || (i.option ? [i.option] : [])).filter(Boolean);
  const n = trEn(i.name);
  if (!n && !opts.some(trEn)) return '';
  return (n || i.name) + (opts.length ? ' (' + opts.map(o => trEn(o) || o).join(', ') + ')' : '');
}
const tableNameEn = t => (String(t).startsWith('TA') ? 'Take away ' + String(t).slice(2) : 'Table ' + t);
const r2 = n => Math.round(n * 100) / 100;
// วันที่: ymd(Date) → '2026-10-26' · thDate('2026-10-26') → '26 ต.ค. 2569'
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const thDate = (s, opt = { day: 'numeric', month: 'short', year: 'numeric' }) => new Date(s + 'T00:00:00').toLocaleDateString('th-TH', opt);
// หมวดเรียงตามที่ตั้งในหน้าตั้งค่า (หมวดที่ไม่มีในรายการไปต่อท้าย)
function orderedCategories() {
  const cats = [...(S.categories || [])];
  for (const m of S.menu) if (!cats.includes(m.category || 'อื่นๆ')) cats.push(m.category || 'อื่นๆ');
  return cats.filter(c => S.menu.some(m => (m.category || 'อื่นๆ') === c));
}

// printer = id เครื่องพิมพ์ (ไม่ใส่ = เครื่องพิมพ์ใบเสร็จ) · copies = กี่ใบ
// extra = {feed: บรรทัดว่างก่อนตัด, beep: บี๊บกี่ครั้ง} (ใบสั่งครัวตั้งได้ที่หลังร้าน > ใบสั่งครัว)
async function printLines(lines, printer = receiptPrinter(), copies = 1, extra = {}) {
  if (!printer) throw new Error('ยังไม่มีเครื่องพิมพ์ เพิ่มได้ที่หลังร้าน > เครื่องพิมพ์');
  await document.fonts.ready;
  await preloadImages(lines);
  const dots = Number(printerById(printer)?.dots) || 576;
  const c = drawReceipt(lines, dots);
  await api('/api/print', { printer, copies, ...extra, ...canvasToRaster(c) });
  return c;
}
// ใบเสร็จ: พิมพ์ตามจำนวนที่ตั้งไว้ · ใบแจ้งยอด (ยังไม่จ่าย) ใบเดียว
const printReceipt = (lines, paid = true) => printLines(lines, receiptPrinter(), paid ? Number(S.settings.receiptCopies) || 1 : 1);

// พิมพ์แล้วถ้าไม่ออก ถามว่าจะลองใหม่ไหม (ออเดอร์ถูกบันทึกแล้ว ไม่หาย)
async function printWithRetry(lines, printer, copies = 1, extra) {
  for (;;) {
    try { await printLines(lines, printer, copies, extra); return true; }
    catch (e) {
      if (!confirm(`พิมพ์ไม่ออก: ${e.message}\n\nลองพิมพ์อีกครั้งไหม?`)) { toast('ไม่ได้พิมพ์ (' + printerName(printer) + ')', true); return false; }
    }
  }
}

// ---------- ใบสั่งอาหาร (ส่งเข้าครัว / หน้าร้าน) ----------
// รูปแบบตั้งที่หลังร้าน > ใบสั่งครัว (settings.ticket) · ค่าเริ่มต้น = หน้าตาแบบเดิม
const TICKET_DEF = { lang: 'th', sizeTable: 44, sizeItem: 36, sizeOpt: 30,
  showTime: true, showType: false, showRound: false, showStation: false, showCount: false, divider: false,
  qtyPos: 'front', optStyle: 'inline', noteStyle: 'normal', alertStyle: 'bold', mode: 'all', footer: '', feed: 4, beep: 0, showThai: true, price: 'all' };
const ticketCfg = over => ({ ...TICKET_DEF, ...(S.settings?.ticket || {}), ...(over || {}) });
// หน้าตาหน้าสั่งอาหาร ตั้งที่หลังร้าน > หน้าสั่งอาหาร (settings.orderUi)
const ORDER_UI_DEF = { theme: 'classic', size: 'md', font: 'md', cols: 'auto', showEn: true, showPrice: true, showSearch: true, abroad: true, voice: true };
const orderUi = () => ({ ...ORDER_UI_DEF, ...(S.settings?.orderUi || {}) });
// รอบที่สั่งของโต๊ะนี้ (กดส่งห่างกันเกิน 5 วินาที = คนละรอบ เหมือนหน้าพิมพ์ใบสั่งซ้ำ)
function ticketRound(items) {
  const i0 = items.find(i => i.orderId && i.createdAt); if (!i0) return 0;
  const its = (S.items || []).filter(i => i.orderId === i0.orderId).sort((a, b) => a.createdAt - b.createdAt);
  let n = 0, at = -Infinity;
  for (const i of its) { if (i.createdAt - at >= 5000) { n++; at = i.createdAt; } if (i.id === i0.id) return n; }
  return n;
}
// o = {cfg, station: ชื่อเครื่องพิมพ์, round, part: 'ใบ 1/3', at: เวลา}
function ticketLines(table, items, title = '', o = {}) {
  const k = o.cfg || ticketCfg();
  const en = k.lang === 'en', both = k.lang === 'both';
  const t = new Date(o.at || Date.now()).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  const ta = isTA(table), so = k.sizeOpt, ind = Math.round(k.sizeItem * 0.8);
  const nm = s => (en ? trEn(s) || s : s);                               // ชื่อตามภาษาที่เลือก (ไม่มีคำแปล = ไทย)
  const styled = (style, l) => ({ ...l, bold: style !== 'normal' || l.bold, invert: style === 'invert' });
  const L = [];
  if (k.showStation && o.station) L.push({ text: o.station + (o.part ? ' · ' + o.part : ''), size: 22, align: 'center' });
  else if (o.part) L.push({ text: o.part, size: 22, align: 'center' });
  L.push({ text: en ? tableNameEn(table) : tableName(table), right: k.showTime ? t : '', size: k.sizeTable, bold: true, wrap: true });
  if (k.showType) L.push({ text: ta ? (en ? 'TAKE AWAY' : 'กลับบ้าน') : (en ? 'DINE IN' : 'ทานที่ร้าน'), size: so, bold: true, invert: ta });
  const round = o.round ?? ticketRound(items);
  if (k.showRound && round > 1 && !title) L.push({ text: en ? `ADD-ON · round ${round}` : `สั่งเพิ่ม · รอบที่ ${round}`, size: so, bold: true });
  if (title) L.push({ text: title, size: Math.max(30, so), bold: true, invert: true, align: 'center' });
  L.push({ hr: true });
  items.forEach((i, idx) => {
    if (idx && k.divider) L.push({ hr: true, dash: true });
    const opts = (i.opts || (i.option ? [i.option] : [])).filter(Boolean);
    const inline = k.optStyle === 'inline' && opts.length;
    let name = nm(i.name);
    if (inline) name += en ? ' (' + opts.map(nm).join(', ') + ')' : ' ' + opts.join(' ');
    if (k.showThai && i.thai) name += en ? ' [THAI PRICE]' : ' [คนไทย]';
    const pre = `${i.qty} x `;
    // ราคา (เฉพาะใบที่พิมพ์): ทุกจาน หรือเฉพาะจานราคาคนไทย · จานพิมพ์แยก (เช่น ไข่ดาวของกะเพรา) ไม่มีราคา
    const showP = i.price != null && (k.price === 'all' || (k.price === 'thai' && i.thai));
    const right = showP ? baht(r2(i.price * i.qty)) : '';
    L.push(k.qtyPos === 'front' ? { text: pre + name, right, size: k.sizeItem, bold: true, wrap: true, hang: pre }
      : { text: name + `  x${i.qty}`, right, size: k.sizeItem, bold: true, wrap: true });
    // 2 ภาษา: ชื่อไทยตัวใหญ่ (ครัวอ่าน) + ชื่ออังกฤษตัวเล็กใต้
    if (both) { const e = itemLabelEn(i); if (e) L.push({ text: e, size: Math.max(20, so - 6), x: ind, wrap: true }); }
    if (!inline) for (const op of opts) L.push({ text: '- ' + nm(op), size: so, bold: true, x: ind, wrap: true, hang: '- ' });
    for (const a of i.alerts || []) L.push(styled(k.alertStyle, { text: '!! ' + nm(a) + ' !!', size: so, bold: true, x: ind, wrap: true }));
    if (i.abroad) L.push({ text: en ? '>> PACK FOR ABROAD <<' : '>> กลับต่างประเทศ <<', size: so, bold: true, invert: true, x: ind });
    else if (i.takeaway && !ta) L.push({ text: en ? '>> TAKE AWAY BOX <<' : '>> ใส่กล่องกลับบ้าน <<', size: so, bold: true, x: ind });
    if (i.note) L.push(styled(k.noteStyle, { text: '* ' + i.note, size: so, x: ind, wrap: true, hang: '* ' }));
  });
  const priced = k.price === 'all' ? items.filter(i => i.price != null) : [];
  if (k.showCount || priced.length) {
    const n = items.reduce((s, i) => s + (i.qty || 0), 0);
    L.push({ hr: true }, { text: k.showCount ? (en ? `Total ${n} item${n > 1 ? 's' : ''}` : `รวม ${n} จาน`) : (en ? 'Total' : 'รวม'),
      right: priced.length ? baht(r2(priced.reduce((s, i) => s + i.price * i.qty, 0))) + ' ฿' : '', size: so, bold: true });
  }
  for (const f of String(k.footer || '').split('\n').filter(s => s.trim())) L.push({ text: f, size: 24, align: 'center' });
  return L;
}
const isTA = t => String(t).startsWith('TA');
// วันขาย (ตัดรอบตาม หลังร้าน > ข้อมูลร้าน > ตัดรอบวันขาย) · back = ย้อนกี่วัน → 'YYYY-MM-DD'
// ตัดรอบตี 5: ตอน 00:40 ของวันที่ 25 ยังเป็นวันขายของวันที่ 24
const dayCut = () => Math.min(8, Math.max(0, Number(S.settings?.dayCutoff) || 0));
function bizDay(back = 0) {
  const d = new Date(Date.now() - dayCut() * 3600000); d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// ลำดับชั่วโมงในวันขาย (ตัดรอบตี 5: 05 = 0 … 04 = 23) ใช้เรียงกราฟรายชั่วโมงข้ามเที่ยงคืน
const relHour = h => (Number(h) - dayCut() + 24) % 24;
// โต๊ะทั้งหมดในผัง (ไม่รวมฉากกั้น/ป้าย)
const layoutTables = () => (S.settings.layout?.items || []).filter(i => i.type === 'table').map(i => i.name);

// แยกรายการตามเครื่องพิมพ์ แล้วพิมพ์ใบสั่งไปแต่ละเครื่อง (จานเดียวออกได้หลายเครื่อง)
// ใบสั่งใหม่พิมพ์ตามจำนวนสำเนาของเครื่องนั้น · ใบยกเลิก/แจ้งเตือน (มี title) พิมพ์ใบเดียว
// ตัวเลือกที่ตั้งให้พิมพ์แยก (เช่น ไข่ดาว → หน้าร้าน): ทำเป็นรายการของเครื่องนั้น พร้อมบอกว่าเป็นของจานไหน
// เครื่องที่พิมพ์จานหลักอยู่แล้วไม่ต้องได้ซ้ำ (ชื่อตัวเลือกอยู่ในบรรทัดจานแล้ว)
const splitItems = (items, pid) => items.flatMap(i => (i.splits || [])
  .filter(s => s.printers.includes(pid) && !itemPrinters(i).includes(pid))
  .map(s => ({ qty: i.qty, name: s.name, takeaway: i.takeaway, orderId: i.orderId, createdAt: i.createdAt, thai: i.thai, category: i.category, abroad: i.abroad,
    note: 'ของ ' + i.name + ((i.opts || []).filter(o => o !== s.name).length ? ' ' + i.opts.filter(o => o !== s.name).join(' ') : '') })));
const printsAt = (i, pid) => itemPrinters(i).includes(pid) || !!i.splits?.some(s => s.printers.includes(pid));
// แบ่งรายการของเครื่องหนึ่งเป็นใบ ๆ ตามรูปแบบ (settings.ticket.mode)
// all = รวมใบเดียว · each = ใบละจาน (ตัดกระดาษทีละจาน ครัวแจกให้แต่ละคนทำได้)
// cat = แยกใบตามหมวดเมนู เช่น ของทอด กับ เครื่องดื่ม ที่ออกเครื่องเดียวกันได้คนละใบ
// grp = แยกใบตามหมวดใหญ่ (หลังร้าน > หมวดหมู่) เช่น อาหาร 1 ใบ เครื่องดื่มทุกหมวดรวม 1 ใบ · หมวดที่ไม่อยู่ในหมวดใหญ่ไหน = ใบของหมวดนั้น
const itemCat = i => i.category || S.menu?.find(m => m.id === i.menuId)?.category || 'อื่นๆ';
function ticketSlips(its, mode) {
  if (its.length < 2) return [its];
  if (mode === 'each') return its.map(i => [i]);
  if (mode === 'cat' || mode === 'grp') {
    const g = new Map(), big = c => (S.settings?.catGroups || []).find(x => x.cats.includes(c))?.name || c;
    for (const i of its) { const c = mode === 'grp' ? big(itemCat(i)) : itemCat(i); g.has(c) ? g.get(c).push(i) : g.set(c, [i]); }
    return [...g.values()];
  }
  return [its];
}
async function printTickets(table, items, title) {
  if (S.settings.printTickets === false) return;
  const k = ticketCfg(), extra = { feed: k.feed, beep: k.beep }, round = ticketRound(items);
  for (const p of printerList()) {
    const its = [...items.filter(i => itemPrinters(i).includes(p.id)), ...splitItems(items, p.id)];
    if (!its.length) continue;
    const slips = ticketSlips(its, p.slip || k.mode);   // ตั้งแยกแต่ละเครื่องได้ที่หลังร้าน > เครื่องพิมพ์
    for (let n = 0; n < slips.length; n++)
      await printWithRetry(ticketLines(table, slips[n], title, { cfg: k, station: p.name, round,
        part: slips.length > 1 ? `ใบ ${n + 1}/${slips.length}` : '' }), p.id, title ? 1 : p.copies || 1, extra);
  }
}
// ใบแจ้งสั้นๆ (เช่น ย้ายโต๊ะ) ไปเฉพาะเครื่องที่มีจานของโต๊ะนี้ค้างอยู่
async function printNotice(lines, items) {
  if (S.settings.printTickets === false) return;
  const k = ticketCfg(), extra = { feed: k.feed, beep: k.beep };
  for (const p of printerList())
    if (items.some(i => needsSlip(i) && printsAt(i, p.id))) await printWithRetry(lines, p.id, 1, extra);
}

// สร้างบรรทัดใบเสร็จจากบิล (paid=false → ใบแจ้งยอด)
// รวมจานที่เหมือนกันเป็นบรรทัดเดียว · qtyOf(i) = จำนวนที่จะพิมพ์ของจานนั้น
function mergeLines(order, its, qtyOf = i => i.qty) {
  const merged = [];
  for (const i of its) {
    const q = qtyOf(i); if (!q) continue;
    const ta = i.abroad ? 'ab' : i.takeaway && !isTA(order.table);
    const k = i.menuId + '|' + i.name + '|' + i.option + '|' + i.price + '|' + ta;
    const sfx = ta === 'ab' ? ' (กลับต่างประเทศ)' : ta ? ' (กลับบ้าน)' : '', sfxEn = ta === 'ab' ? ' (pack for abroad)' : ta ? ' (take away)' : '';
    const m = merged.find(x => x.k === k);
    if (m) m.qty += q;
    else merged.push({ k, label: itemLabel(i) + sfx,
      labelEn: itemLabelEn(i) ? itemLabelEn(i) + sfxEn : '', qty: q, price: i.price });
  }
  return merged;
}
// จำนวนที่จ่ายไปแล้วของแต่ละจาน (แยกจ่ายตามรายการ)
function paidQtyOf(o) {
  const q = {};
  for (const p of o?.payments || []) for (const l of p.lines || []) q[l.id] = (q[l.id] || 0) + l.qty;
  return q;
}
const paidSum = o => r2((o.payments || []).reduce((s, p) => s + p.amount, 0));
// หัวใบเสร็จของการแยกจ่าย: หารเท่านับเฉพาะส่วนที่หาร
function partLabel(order, p, en) {
  if (p.kind === 'share') {
    const k = (order.payments || []).filter(x => x.kind === 'share' && x.no <= p.no).length;
    return en ? `Split ${p.parts || ''} ways · person ${k}` : `หารเท่า ${p.parts || ''} คน · คนที่ ${k}`;
  }
  if (en) return `${p.kind === 'items' ? 'Split by items' : 'Remaining balance'} · part ${p.no}`;
  return `${p.kind === 'items' ? 'แยกจ่ายตามรายการ' : 'จ่ายส่วนที่เหลือ'} · ใบที่ ${p.no}`;
}

// สร้างบรรทัดใบเสร็จ
//  opts.paid = false → ใบแจ้งยอด · opts.payment = ใบเสร็จของการแยกจ่ายครั้งนั้น
function receiptLines(order, opts = {}) {
  const st = { ...S.settings, ...(opts.settings || {}) }, p = opts.payment;
  const rc = opts.receipt || st.receipt || {};
  // รูป: opts.images ใช้ดูตัวอย่างตอนยังไม่บันทึก (null = ไม่มีรูป) · ปกติใช้รูปที่บันทึกไว้ในเซิร์ฟเวอร์
  const imgSrc = k => (opts.images && k in opts.images ? opts.images[k] : rc.has?.[k] ? `/receipt-img/${k}?v=${rc.imgV || 0}` : null);
  const its = opts.items || S.items.filter(i => i.orderId === order.id && i.status !== 'cancelled');
  const billSubtotal = r2(its.reduce((s, i) => s + i.price * i.qty, 0));
  // แยกจ่ายตามรายการ: พิมพ์เฉพาะจานของส่วนนั้น · หารเท่า: พิมพ์ทั้งบิลเป็นข้อมูลอ้างอิง
  const merged = p?.lines ? mergeLines(order, its, i => p.lines.find(l => l.id === i.id)?.qty || 0) : mergeLines(order, its);
  const subtotal = p ? p.amount : billSubtotal;
  const paid = opts.paid || !!p;
  const src = p || order;
  const fee = paid ? Number(src.fee) || 0 : 0;
  const total = paid && src.total != null ? src.total : subtotal;
  const d = new Date((p ? p.at : order.paidAt) || Date.now());
  const logo = imgSrc('logo'), foot = imgSrc('footer');
  const showTable = rc.showTable !== false, showTime = rc.showTime !== false;
  // ภาษา: บิลนี้ตั้งไว้ (order.lang) > ค่าเริ่มต้นของร้าน · 'both' = อังกฤษนำ ตามด้วยไทย
  const lang = ['th', 'en', 'both'].includes(opts.lang) ? opts.lang : order.lang || rc.lang || 'th';
  const en = lang !== 'th', both = lang === 'both';
  const T = (th, eng) => (lang === 'th' ? th : both ? `${eng} / ${th}` : eng);
  const lines = (th, eng) => {   // หัว/ท้ายใบเสร็จ: อังกฤษใช้ข้อความอังกฤษถ้ามี ไม่มีก็ใช้ไทย
    const a = String(th || ''), b = String(eng || '');
    const out = lang === 'th' || !b.trim() ? a : both ? b + '\n' + a : b;
    return out.split('\n').filter(t => t.trim());
  };
  const when = d.toLocaleString(en ? 'en-GB' : 'th-TH', { dateStyle: 'short', timeStyle: 'short' });
  const L = [
    ...(logo ? [{ image: { src: logo, pct: rc.logoWidth || 60, mode: rc.logoMode || 'dither' } }] : []),
    { text: st.shopName, align: 'center', size: rc.nameSize || 36, bold: true },
    ...lines(rc.header, rc.headerEn).map(t => ({ text: t, align: 'center', size: 22 })),
    ...(paid ? [] : [{ text: T('ใบแจ้งยอด (ยังไม่ชำระ)', 'BILL (not paid yet)'), align: 'center', size: 24, bold: en }]),
    ...(showTable || showTime ? [{ text: showTable ? (en ? tableNameEn(order.table) : tableName(order.table)) : '',
      right: showTime ? when : '' }] : []),
    ...(src.receiptNo && rc.showNo !== false ? [{ text: (en ? 'Receipt No. ' : 'เลขที่ ') + src.receiptNo, size: 22 }] : []),
    ...(p ? [{ text: partLabel(order, p, en), size: 26, bold: true }] : []),
    { hr: true },
  ];
  for (const m of merged) {
    if (en && m.labelEn) {
      L.push({ text: `${m.qty} x ${m.labelEn}`, right: baht(m.qty * m.price) });
      if (both) L.push({ text: '      ' + m.label, size: 22 });   // ชื่อไทยตัวเล็กใต้ชื่ออังกฤษ
    } else L.push({ text: `${m.qty} x ${m.label}`, right: baht(m.qty * m.price) });
  }
  L.push({ hr: true });
  if (p && !p.lines) L.push({ text: T('ยอดทั้งบิล', 'Bill total'), right: baht(billSubtotal) }, { text: T('ส่วนนี้', 'This part'), right: baht(p.amount) });
  // ใบแจ้งยอดของโต๊ะที่เริ่มแยกจ่ายแล้ว
  if (!paid && order.payments?.length) {
    L.push({ text: T('ยอดทั้งบิล', 'Bill total'), right: baht(billSubtotal) },
      { text: T(`จ่ายแล้ว ${order.payments.length} ครั้ง`, `Paid (${order.payments.length}x)`), right: '-' + baht(paidSum(order)) });
  }
  if (fee) {
    L.push({ text: T('ยอดอาหาร', 'Subtotal'), right: baht(subtotal) },
           { text: T(`ค่าธรรมเนียมบัตร ${baht(src.feePct)}%`, `Card fee ${baht(src.feePct)}%`), right: baht(fee) });
  }
  L.push({ text: !paid && order.payments?.length ? T('คงเหลือ', 'BALANCE DUE') : T('รวม', 'TOTAL'),
    right: baht(!paid && order.payments?.length ? r2(billSubtotal - paidSum(order)) : total) + ' ฿', size: 32, bold: true });
  if (paid) {
    const m = p ? p.method : order.payMethod;
    if (m === 'cash' && src.received) {
      L.push({ text: T('รับเงิน', 'Cash'), right: baht(src.received) }, { text: T('เงินทอน', 'Change'), right: baht(src.received - total) });
    } else if (m !== 'split') L.push({ text: T('ชำระโดย', 'Paid by'), right: en ? PAY_NAME_EN[m] || 'Cash' : PAY_NAME[m] || 'เงินสด' });
  }
  L.push({ hr: true });
  for (const t of lines(st.shopInfo, rc.footerEn)) L.push({ text: t, align: 'center', size: rc.footerSize || 22 });
  if (foot) L.push({ image: { src: foot, pct: rc.footerImgWidth || 50, mode: rc.footerImgMode || 'threshold' } });
  return L;
}
