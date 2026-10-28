// ================= สั่งอาหารด้วยเสียง (หน้าสั่งอาหาร) =================
// ปุ่มไมค์ลอยมุมขวาล่าง · ใช้ได้เฉพาะในแอป MAMA POS (ไมค์ของ Android ผ่าน EdPosApp.voiceStart · ส่วนใหญ่ต้องต่อเน็ต)
// ปิด/เปิดปุ่มได้ที่ หลังร้าน > หน้าสั่งอาหาร
// พูด "ปลาเผา 2 กุ้งแม่น้ำเผา 1 ช้างใหญ่ 2 ข้าวสวย 3" → แยกเป็นเมนู + ตัวเลือก + จำนวน → ให้ตรวจ → ใส่รายการที่ยังไม่ส่ง
// ไม่ส่งครัวเอง · เมนูที่ยังไม่ได้บอกตัวเลือกที่ต้องเลือก → เปิดหน้าต่างเลือกตามปกติทีละจาน
// คำที่ระบบไม่แน่ใจ → แตะเมนูที่ใกล้เคียง แล้วระบบจำคำนั้นไว้ (settings.voiceAliases ใช้ร่วมทุกเครื่อง)
const VOICE = (() => {
  const app = window.EdPosApp;
  let ok = false;
  try { ok = !!app?.voiceAvailable?.(); } catch {}

  // ---------- แยกคำ ----------
  const TH_DIG = '๐๑๒๓๔๕๖๗๘๙';
  const norm = s => String(s || '').toLowerCase().replace(/[๐-๙]/g, d => TH_DIG.indexOf(d)).replace(/[\s.,!?'"“”()\-]/g, '');
  const NUM = { หนึ่ง: 1, นึง: 1, เอ็ด: 1, สอง: 2, ยี่: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9 };
  const W = 'หนึ่ง|นึง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า';
  const NUM_RE = new RegExp(`^(?:(\\d{1,3})|((?:${W}|ยี่)?สิบ(?:เอ็ด|${W})?)|(${W}))`);
  const numOf = m => {
    if (m[1]) return +m[1];
    if (m[3]) return NUM[m[3]];
    const [a, b] = m[2].split('สิบ');
    return (a ? NUM[a] : 1) * 10 + (b ? NUM[b] : 0);
  };
  // ลักษณนาม (ตามหลังจำนวน) และคำเชื่อม/คำสุภาพที่ข้ามได้
  const UNIT = ['ที่', 'จาน', 'แก้ว', 'ขวด', 'ชุด', 'ถ้วย', 'ชาม', 'ตัว', 'อัน', 'กล่อง', 'ห่อ', 'ถุง', 'ลูก', 'ไม้', 'เหยือก', 'ชิ้น', 'โถ', 'หม้อ', 'ถาด', 'กระป๋อง', 'ทาวเวอร์'];
  const FILL = ['แล้วก็', 'เอา', 'ขอ', 'ครับ', 'คับ', 'ค่ะ', 'คะ', 'จ้า', 'จ้ะ', 'นะ', 'ด้วย', 'แล้ว', 'และ', 'กับ', 'อีก', 'หน่อย', 'ให้', 'สั่ง', 'ก็'];
  const SKIP = [...UNIT, ...FILL].sort((a, b) => b.length - a.length);
  const NOTE_WORDS = ['ไม่เผ็ด', 'เผ็ดน้อย', 'เผ็ดมาก', 'ไม่ใส่ผัก', 'ไม่ผัก', 'ไม่หวาน', 'หวานน้อย', 'ไม่ใส่น้ำแข็ง', 'แยกน้ำแข็ง', 'ไม่ใส่ผงชูรส', 'พิเศษ'];

  // พจนานุกรม: ชื่อเมนู · ชื่ออังกฤษ · คำที่ร้านสอนไว้ (สร้างใหม่เมื่อเมนูเปลี่ยน)
  let dictRev = -1, dictCache = null;
  function dict() {
    if (dictCache && dictRev === S.rev) return dictCache;
    const D = [];
    for (const m of S.menu) {
      D.push({ key: norm(m.name), m });
      const en = typeof trEn === 'function' ? norm(trEn(m.name)) : '';
      if (en.length >= 3 && en !== norm(m.name)) D.push({ key: en, m });
    }
    for (const a of S.settings.voiceAliases || []) {
      const m = S.menu.find(x => x.id === a.m);
      if (m && a.p) D.push({ key: a.p, m, c: a.c || [], alias: true });
    }
    const KW = [
      ...['กลับบ้าน', 'ใส่กล่อง', 'ห่อกลับ', 'เทคอะเวย์', 'takeaway', 'takehome'].map(key => ({ key, kw: 'ta' })),
      ...['กลับบ้านทั้งหมด', 'ทั้งหมดกลับบ้าน', 'ใส่กล่องทั้งหมด', 'ทั้งหมดใส่กล่อง'].map(key => ({ key, kw: 'allta' })),
      ...['ราคาคนไทย', 'คนไทย'].map(key => ({ key, kw: 'thai' })),
      ...[...new Set([...quickNotes(), ...NOTE_WORDS])].map(n => ({ key: norm(n), kw: 'note', note: n })),
    ].filter(e => e.key);
    dictRev = S.rev; dictCache = { D: D.filter(e => e.key), KW };
    return dictCache;
  }
  // ตัวเลือกของเมนู + ชื่อกลุ่ม (ข้ามได้ เช่น "ช้างขวดใหญ่" · "ข้าวผัดไม่ใส่ไข่")
  const choiceEntries = m => groupsOf(m).flatMap(g => [{ key: norm(g.name), skip: true }, ...g.choices.map(c => ({ key: norm(c.name), choice: c.name }))]).filter(e => e.key);

  // เศษคำที่ยาวพอจะเป็นคำ (ไม่นับสระบน/ล่าง วรรณยุกต์) → ถามว่าหมายถึงเมนูไหน
  const meaningful = s => s.length >= 2 && s.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '').length >= 1;   // "ปู" ได้ · "ก" ไม่ได้
  // แยกข้อความหนึ่งประโยค → {items: [{m, qty, choices, notes, ta}], unk: [{text, qty}], allTa, thai, score}
  function parse(text) {
    const t = norm(text), { D, KW } = dict();
    const items = [], unk = [];
    let cur = null, buf = '', pendQ = null, allTa = false, thai = false, score = 0;
    const flush = q => {
      if (meaningful(buf)) { unk.push({ text: buf, qty: q }); score -= buf.length * 0.5; }
      else if (q != null && cur && cur.qty == null) cur.qty = q;
      buf = '';
    };
    let i = 0;
    while (i < t.length) {
      const rest = t.slice(i);
      // โต๊ะ 5 → ไม่ใช่จำนวน
      const tb = rest.match(/^โต๊ะ(?:\d+|[a-z]+\d*|(?:หนึ่ง|นึง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ยี่|เอ็ด)+)?/);
      if (tb) { i += tb[0].length; continue; }
      // คำที่ยาวที่สุดชนะ · ยาวเท่ากัน: ตัวเลือกของเมนูล่าสุด > คำสั่งพิเศษ > เมนู (เช่น "ไข่ดาว" หลังกะเพรา = ตัวเลือก ไม่ใช่เมนูไข่ดาว)
      let best = null;
      const tryE = (e, pri) => {
        if (e.key.length > rest.length || !rest.startsWith(e.key)) return;
        if (!best || e.key.length > best.e.key.length || (e.key.length === best.e.key.length && pri > best.pri)) best = { e, pri };
      };
      if (cur) for (const e of cur.ch) tryE(e, 3);
      for (const e of KW) tryE(e, 2);
      for (const e of D) tryE(e, 1);
      if (best) {
        const e = best.e;
        i += e.key.length; score += e.key.length;
        if (e.skip) { buf = ''; score -= e.key.length; }
        else if (e.choice) { if (!cur.choices.includes(e.choice)) cur.choices.push(e.choice); }
        else if (e.kw === 'ta') { if (cur) cur.ta = true; else allTa = true; }
        else if (e.kw === 'allta') allTa = true;
        else if (e.kw === 'thai') thai = true;
        else if (e.kw === 'note') { if (cur && !cur.notes.includes(e.note)) cur.notes.push(e.note); }
        else {
          // คำที่ไม่รู้จักติดหน้าชื่อเมนู เช่น "น้ำ|มะม่วงปั่น" "ปู|ผัดผงกะหรี่"
          // มีเมนูอื่นที่มีทั้งสองคำ (ปูตัวผัดผงกะหรี่ / เนื้อปูผัดผงกะหรี่) → ถามว่าหมายถึงเมนูไหน · ไม่มี → ทิ้งคำหน้า (น้ำ+มะม่วงปั่น = มะม่วงปั่น)
          if (meaningful(buf)) {
            const b = buf;
            if (D.some(d => d.m !== e.m && d.m.available !== false && d.key.includes(b) && d.key.includes(e.key))) { buf += e.key; continue; }
            score += buf.length; buf = '';
          }
          flush(null);
          cur = { m: e.m, qty: pendQ, choices: [...(e.c || [])], notes: [], ta: false, ch: choiceEntries(e.m) };
          items.push(cur); pendQ = null;
        }
        continue;
      }
      const nm = rest.match(NUM_RE);
      if (nm) {
        const n = Math.max(1, Math.min(99, numOf(nm)));
        i += nm[0].length; score += nm[0].length;
        const u = UNIT.find(w => t.startsWith(w, i)); if (u) i += u.length;
        // จำนวนตามหลังคำที่ไม่รู้จัก → เป็นของคำนั้น · ตามหลังเมนูที่ยังไม่มีจำนวน → ของเมนูนั้น · นอกนั้น → ของเมนูถัดไป
        if (meaningful(buf)) flush(n);
        else { buf = ''; if (cur && cur.qty == null) cur.qty = n; else pendQ = n; }
        continue;
      }
      const sk = SKIP.find(w => rest.startsWith(w));
      if (sk) { i += sk.length; if (meaningful(buf)) flush(null); else buf = ''; continue; }
      buf += t[i]; i++;
    }
    flush(pendQ);
    items.forEach(x => { if (x.qty == null) x.qty = 1; delete x.ch; });
    return { text, items, unk, allTa, thai, score };
  }
  // ตัวแปลงเสียงให้คำที่เป็นไปได้หลายแบบ → เลือกแบบที่จับเมนู/จำนวนได้มากสุด (คำที่ไม่รู้จักหักคะแนนเล็กน้อย)
  const bestParse = alts => alts.map(parse).sort((a, b) => b.score - a.score)[0];

  // เมนูที่ใกล้เคียงกับคำที่ไม่รู้จัก (ชื่อมีคำนั้น/คำนั้นมีชื่อเมนู หรือตัวอักษรคล้ายกัน)
  const pairs = s => { const p = new Set(); for (let i = 0; i < s.length - 1; i++) p.add(s.slice(i, i + 2)); return p; };
  function similar(a, b) {
    if (!a || !b) return 0;
    // ชื่อเมนูมีคำที่พูดทั้งคำ = ใกล้มาก · คำที่พูดยาวกว่าชื่อเมนู (พูดเกิน) = ใกล้น้อยกว่า
    if (b.includes(a)) return 0.6 + 0.4 * a.length / b.length;
    if (a.includes(b)) return 0.45 + 0.3 * b.length / a.length;
    const A = pairs(a), B = pairs(b); let n = 0; for (const x of A) if (B.has(x)) n++;
    return A.size + B.size ? 2 * n / (A.size + B.size) : 0;
  }
  const candidates = text => scored(text).slice(0, 6).map(x => x.m);
  function scored(text) {
    const best = new Map();
    for (const e of dict().D) {
      if (e.m.available === false) continue;
      const sc = similar(text, e.key);
      if (sc >= 0.35 && sc > (best.get(e.m.id)?.sc || 0)) best.set(e.m.id, { m: e.m, sc });
    }
    return [...best.values()].sort((a, b) => b.sc - a.sc);
  }

  // ---------- หน้าตา ----------
  const st = { open: false, listening: false, level: 0, live: '', heard: '', msg: '', items: [], unk: [], allTa: false, thai: false, learn: true };
  let fab = null, sheet = null;
  function css() {
    const s = document.createElement('style');
    s.textContent = `
      .vfab { position: fixed; right: 18px; bottom: 18px; z-index: 25; width: 62px; height: 62px; border-radius: 50%; padding: 0; font-size: 27px;
        background: var(--accent); color: var(--accent-ink); border-color: var(--accent); box-shadow: 0 6px 18px #0004; }
      .vfab[hidden] { display: none; }
      @media (max-width: 820px) { .vfab { bottom: calc(86px + env(safe-area-inset-bottom)); right: 14px; } }
      .vbg { position: fixed; inset: 0; background: #0007; z-index: 45; display: flex; align-items: flex-end; justify-content: center; }
      .vsh { background: var(--card); width: min(560px, 100%); max-height: 92vh; max-height: 92dvh; overflow: auto; border-radius: 18px 18px 0 0;
        padding: 16px 16px 0; display: flex; flex-direction: column; }
      @media (min-width: 821px) { .vbg { align-items: center; } .vsh { border-radius: 16px; } }
      .vsh h2 { margin: 0; font-size: 19px; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
      .vsh h2 button { padding: 6px 12px; }
      .vmic { display: flex; align-items: center; gap: 14px; margin: 14px 0 6px; }
      .vmic button { width: 66px; height: 66px; border-radius: 50%; padding: 0; font-size: 28px; flex: none; position: relative;
        background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
      .vmic button.on::after { content: ""; position: absolute; inset: -8px; border-radius: 50%; border: 3px solid var(--accent);
        opacity: .5; transform: scale(var(--lv, 1)); transition: transform .1s; }
      .vmic p { margin: 0; font-size: 15.5px; line-height: 1.5; color: var(--muted); }
      .vmic p b { color: var(--ink); font-weight: 600; }
      .vmsg { color: var(--bad); font-size: 15px; margin: 4px 0; }
      .vheard { font-size: 14px; color: var(--muted); margin: 6px 0 4px; }
      .vlist { list-style: none; margin: 6px 0 0; padding: 0; }
      .vlist li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); }
      .vlist li b { font-size: 17px; font-weight: 600; }
      .vlist li small { display: block; color: var(--muted); font-size: 14px; }
      .vlist li.out b { text-decoration: line-through; color: var(--muted); }
      .vlist li small.bad { color: var(--bad); } .vlist li small.ask { color: var(--warn); font-weight: 600; }
      .vq { display: flex; align-items: center; gap: 6px; } .vq button { padding: 6px 12px; min-width: 40px; } .vq span { min-width: 26px; text-align: center; font-weight: 700; font-size: 18px; }
      .vx { padding: 6px 11px; color: var(--bad); }
      .vunk { margin-top: 10px; padding: 12px; border-radius: 12px; background: var(--bg); }
      .vunk p { margin: 0 0 8px; font-size: 15px; }
      .vunk .vc { display: flex; flex-wrap: wrap; gap: 6px; } .vunk .vc button { padding: 8px 12px; font-size: 15px; }
      .vunk .vc button.no { color: var(--muted); }
      .vlearn { display: flex; gap: 8px; align-items: center; font-size: 14px; color: var(--muted); margin: 10px 0 0; }
      .vfoot { position: sticky; bottom: 0; background: var(--card); display: flex; gap: 10px; padding: 12px 0 max(14px, env(safe-area-inset-bottom)); margin-top: 12px; }
      .vfoot button { flex: 1; min-height: 50px; }
      .vempty { color: var(--muted); font-size: 15px; margin: 8px 0; }`;
    document.head.appendChild(s);
  }
  function sync() {
    if (!ok) return;
    if (!fab) {
      css();
      fab = document.createElement('button');
      fab.className = 'vfab'; fab.textContent = '🎤'; fab.setAttribute('aria-label', 'สั่งด้วยเสียง');
      fab.onclick = () => { openSheet(); listen(); };
      document.body.appendChild(fab);
    }
    fab.hidden = !(orderUi().voice && current && !hist && !document.body.classList.contains('sheet-open') && !st.open);
    // จอกว้าง: วางไว้ขวาล่างของรายการเมนู (ไม่ทับบิลด้านขวา)
    const bill = document.querySelector('.bill');
    fab.style.right = !fab.hidden && innerWidth > 820 && bill ? Math.max(18, innerWidth - bill.getBoundingClientRect().left + 18) + 'px' : '';
  }
  function openSheet() {
    Object.assign(st, { open: true, live: '', heard: '', msg: '', items: [], unk: [], allTa: false, thai: false });
    sheet = document.createElement('div'); sheet.className = 'vbg';
    sheet.onclick = e => { if (e.target === sheet) closeSheet(); };
    document.body.appendChild(sheet);
    draw(); sync();
  }
  function closeSheet() {
    if (st.listening) try { app.voiceCancel(); } catch {}
    st.open = st.listening = false; sheet?.remove(); sheet = null; sync();
  }
  function listen() {
    st.msg = ''; st.live = ''; st.listening = true; draw();
    try { app.voiceStart('th-TH'); } catch { st.listening = false; st.msg = 'เปิดไมค์ไม่ได้'; draw(); }
  }
  // กลุ่มที่ต้องเลือกแต่ยังไม่ได้บอก (จะเปิดหน้าต่างถามตอนใส่รายการ)
  const askOf = x => { const grid = gridOf(x.m);
    return groupsOf(x.m).filter(g => (g.required || grid?.groups.includes(g.name)) && g.choices.length > 1 && !g.choices.some(c => x.choices.includes(c.name))).map(g => g.name); };
  const nAdd = () => st.items.filter(x => x.m.available !== false).length;
  function draw() {
    if (!sheet) return;
    const tbl = typeof tableName === 'function' ? tableName(current) : current;
    const choiceTxt = x => [...x.choices.map(c => { const g = groupsOf(x.m).find(g => g.choices.some(y => y.name === c)); return g && /^ไม่/.test(g.name) ? `${g.name}${c}` : c; }), ...x.notes, ...(x.ta || st.allTa ? ['กลับบ้าน'] : [])].join(' · ');
    sheet.innerHTML = `<div class="vsh" role="dialog" aria-modal="true" aria-label="สั่งด้วยเสียง">
      <h2><span>🎤 สั่งด้วยเสียง · ${esc(tbl)}</span><button data-v="close">ปิด</button></h2>
      <div class="vmic"><button data-v="mic" class="${st.listening ? 'on' : ''}" aria-label="${st.listening ? 'หยุดฟัง' : 'พูดเพิ่ม'}">${st.listening ? '■' : '🎤'}</button>
        <p>${st.listening ? (st.live ? `<b>${esc(st.live)}</b>` : 'กำลังฟัง… พูดชื่อเมนูตามด้วยจำนวน<br>เช่น “ปลาเผา 2 ช้างใหญ่ 3 ข้าวสวย 4”')
          : st.items.length || st.unk.length ? 'แตะไมค์เพื่อพูดเพิ่ม' : 'แตะไมค์แล้วพูดชื่อเมนูตามด้วยจำนวน'}</p></div>
      ${st.msg ? `<p class="vmsg" role="alert">${esc(st.msg)}</p>` : ''}
      ${st.heard ? `<p class="vheard">ได้ยินว่า “${esc(st.heard)}”</p>` : ''}
      ${st.items.length ? `<ul class="vlist">${st.items.map((x, k) => {
        const out = x.m.available === false;
        const ask = askOf(x);
        return `<li class="${out ? 'out' : ''}"><div><b>${esc(x.m.name)}</b>${out ? '<small class="bad">หมด · จะไม่ใส่รายการ</small>' : choiceTxt(x) ? `<small>${esc(choiceTxt(x))}</small>` : ''}${!out && ask.length ? `<small class="ask">จะถาม: ${esc(ask.join(' · '))}</small>` : ''}</div>
          <div class="vq">${out ? '' : `<button data-v="minus" data-k="${k}" aria-label="ลด">−</button><span>${x.qty}</span><button data-v="plus" data-k="${k}" aria-label="เพิ่ม">+</button>`}</div>
          <button class="vx" data-v="del" data-k="${k}" aria-label="เอาออก">✕</button></li>`; }).join('')}</ul>`
        : !st.listening && st.heard && !st.unk.length ? '<p class="vempty">ไม่พบชื่อเมนูในที่พูด ลองพูดใหม่ช้าๆ ใกล้เครื่อง</p>' : ''}
      ${st.unk.map((u, k) => { const c = candidates(u.text);
        return `<div class="vunk"><p>ไม่แน่ใจ “<b>${esc(u.text)}</b>”${u.qty ? ` × ${u.qty}` : ''} หมายถึง</p>
          <div class="vc">${c.map(m => `<button data-v="pick" data-k="${k}" data-m="${m.id}">${esc(m.name)}</button>`).join('')}
          <button class="no" data-v="skip" data-k="${k}">${c.length ? 'ไม่ใช่ทั้งหมด' : 'ไม่พบเมนูที่ใกล้เคียง · ข้าม'}</button></div></div>`; }).join('')}
      ${st.unk.length ? `<label class="vlearn"><input type="checkbox" data-v="learn" ${st.learn ? 'checked' : ''}> จำคำนี้ไว้ ครั้งหน้าพูดแบบเดิมจะรู้จักเลย</label>` : ''}
      ${st.items.length ? `<p class="vheard">ตรวจรายการแล้วกด “ใส่รายการ” · เมนูที่ยังไม่ได้บอกตัวเลือก จะถามทีละจาน · ยังไม่ส่งครัวจนกว่าจะกดส่งออเดอร์</p>` : ''}
      <div class="vfoot"><button data-v="close">ยกเลิก</button>
        <button class="primary" data-v="add" ${nAdd() && !st.listening ? '' : 'disabled'}>ใส่รายการ${nAdd() ? ` (${nAdd()})` : ''}</button></div></div>`;
    const lv = sheet.querySelector('.vmic button'); if (lv) lv.style.setProperty('--lv', 1 + st.level * 0.35);
  }
  function onClick(e) {
    const b = e.target.closest('[data-v]'); if (!b || !sheet?.contains(b)) return;
    const v = b.dataset.v, k = +b.dataset.k;
    if (v === 'close') return closeSheet();
    if (v === 'mic') { if (st.listening) { try { app.voiceStop(); } catch {} } else listen(); return; }
    if (v === 'minus') st.items[k].qty = Math.max(1, st.items[k].qty - 1);
    if (v === 'plus') st.items[k].qty = Math.min(99, st.items[k].qty + 1);
    if (v === 'del') st.items.splice(k, 1);
    if (v === 'skip') st.unk.splice(k, 1);
    if (v === 'pick') {
      const u = st.unk[k], m = S.menu.find(x => x.id === b.dataset.m);
      st.items.push({ m, qty: u.qty || 1, choices: [], notes: [], ta: false });
      st.unk.splice(k, 1);
      if (st.learn) api('/api/voice/alias', { p: u.text, m: m.id }).then(() => { dictRev = -1; }).catch(() => {});
    }
    if (v === 'add') return addAll();
    draw();
  }
  function onChange(e) { if (e.target.dataset?.v === 'learn') st.learn = e.target.checked; }
  // ใส่รายการทีละจาน: ตัวเลือกครบ → เพิ่มเลย · ขาด → เปิดหน้าต่างเลือก แล้วค่อยจานถัดไป
  function addAll() {
    const queue = st.items.filter(x => x.m.available !== false), before = cart.reduce((s, c) => s + c.qty, 0);
    const { allTa, thai } = st;
    closeSheet();
    const next = () => {
      const x = queue.shift();
      if (!x) {
        const n = cart.reduce((s, c) => s + c.qty, 0) - before;
        if (n > 0) {
          toast(`เพิ่มจากเสียง ${n} จานแล้ว ตรวจแล้วกด “ส่งออเดอร์”`);
          if (matchMedia('(max-width: 820px)').matches) toggleBill(true);   // มือถือ: เปิดบิลให้เห็นรายการ
        }
        return;
      }
      if (!S.menu.some(m => m.id === x.m.id)) return next();
      addItem(x.m.id, undefined, { qty: x.qty, choices: x.choices, notes: x.notes, takeaway: x.ta || allTa, thai, auto: true, quiet: true, done: next });
    };
    next();
  }
  // เหตุการณ์จากแอป (Voice.java)
  window.edposVoice = ev => {
    if (!st.open) return;
    if (ev.type === 'ready' || ev.type === 'start') st.listening = true;
    else if (ev.type === 'level') { st.level = ev.v || 0; sheet?.querySelector('.vmic button')?.style.setProperty('--lv', 1 + st.level * 0.35); return; }
    else if (ev.type === 'partial') st.live = ev.text || '';
    else if (ev.type === 'result') {
      const alts = (ev.alts || []).filter(Boolean);
      if (alts.length) {
        const r = bestParse(alts);
        st.heard = r.text; st.items.push(...r.items); st.unk.push(...r.unk);
        st.allTa = st.allTa || r.allTa; st.thai = st.thai || r.thai;
      }
    } else if (ev.type === 'error') {
      st.msg = { perm: 'ยังไม่ได้อนุญาตให้ใช้ไมค์ · แตะไมค์อีกครั้งแล้วกด “อนุญาต” (หรือ ตั้งค่า › แอป › MAMA POS › สิทธิ์ › ไมโครโฟน)',
        nomatch: 'ไม่ได้ยินชัด ลองพูดอีกครั้ง ใกล้ๆ เครื่อง', net: 'แปลงเสียงไม่ได้ ต้องต่ออินเทอร์เน็ต', busy: 'ไมค์กำลังถูกใช้อยู่ ลองใหม่อีกครั้ง' }[ev.code] || 'ฟังไม่สำเร็จ ลองใหม่อีกครั้ง';
    } else if (ev.type === 'end') { st.listening = false; st.live = ''; st.level = 0; }
    draw();
  };
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  return { sync, parse, candidates, get ok() { return ok; } };
})();
// วาดหน้าใหม่ → ซ่อน/แสดงปุ่มไมค์ตามหน้า (โต๊ะที่เปิดอยู่เท่านั้น)
{ const _render = render; render = function () { _render(); VOICE.sync(); }; }
VOICE.sync();
