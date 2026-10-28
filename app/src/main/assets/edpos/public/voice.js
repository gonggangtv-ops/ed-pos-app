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
  // สะกดต่างกันแต่หมายถึงคำเดียวกัน (ตัวแปลงเสียงสะกดได้หลายแบบ) → ทำให้เป็นแบบเดียวกันทั้งชื่อเมนูและคำที่ได้ยิน
  const SPELL = [[/กระเพราะ|กะเพราะ|กระเพรา|กะเพา|กระเพา/g, 'กะเพรา'], [/ซีอิ้ว|ซีอิว/g, 'ซีอิ๊ว'], [/กระหรี่/g, 'กะหรี่'], [/ไซซ์|ไซต์|ไซด์|ไซ้ส์/g, 'ไซส์']];
  const norm = s => SPELL.reduce((t, [re, to]) => t.replace(re, to),
    String(s || '').toLowerCase().replace(/[๐-๙]/g, d => TH_DIG.indexOf(d)).replace(/[\s.,!?'"“”()\-ๆ]/g, ''));
  // คำพูดที่หมายถึงตัวเลือก (ใช้เมื่อเมนูนั้นไม่มีตัวเลือกชื่อนี้ตรงๆ) เช่น "ที่เล็ก" = ขนาด S · "ไม่เผ็ด" = ไม่พริก
  const SYN = {
    s: ['เล็ก', 'ไซส์เล็ก', 'ขนาดเล็ก', 'เอส', 'ไซส์เอส', 'ไซส์s'],
    m: ['กลาง', 'ไซส์กลาง', 'ขนาดกลาง', 'เอ็ม', 'ไซส์เอ็ม', 'ไซส์m'],
    l: ['ใหญ่', 'ไซส์ใหญ่', 'ขนาดใหญ่', 'แอล', 'ไซส์แอล', 'ไซส์l'],
    xl: ['ใหญ่พิเศษ', 'เอ็กซ์แอล', 'ไซส์xl'],
    ไม่พริก: ['ไม่เผ็ด', 'ไม่ใส่พริก', 'ไม่เอาพริก'],
    เผ็ด: ['เผ็ดปกติ', 'เผ็ดธรรมดา'],
    เผ็ดมาก: ['เผ็ดจัด', 'เผ็ดสุด'],
    ราดข้าว: ['ข้าวราด', 'ราดข้าวสวย', 'โปะข้าว'],
    หมูสับ: ['หมูบด'], ทะเล: ['ซีฟู้ด', 'รวมมิตรทะเล', 'รวมทะเล'], เจ: ['มังสวิรัติ'],
    ไข่ดาว: ['ทอดไข่ดาว', 'ไข่ดาวด้วย'],
  };
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
    const names = new Set(S.menu.map(m => norm(m.name)));
    for (const m of S.menu) {
      D.push({ key: norm(m.name), m });
      // คนมักไม่พูด "ผัด" นำหน้า: "กะเพราหมู" = ผัดกะเพรา · ใช้เมื่อไม่มีเมนูชื่อนั้นอยู่แล้ว
      const short = norm(m.name).replace(/^ผัด/, '');
      if (short !== norm(m.name) && short.length >= 3 && !names.has(short)) D.push({ key: short, m, short: true });
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
  // ลำดับเมื่อยาวเท่ากัน: ชื่อตัวเลือกตรงๆ (3) > คำพ้อง (2.5) > ชื่อกลุ่มที่ข้ามได้ (2.4) > คำสั่งพิเศษ (2) > เมนู (1)
  // เช่น กลุ่ม "ราดข้าว" มีตัวเลือก "ราดข้าว" → นับเป็นตัวเลือก
  function choiceEntries(m) {
    const out = [], exact = new Set();
    for (const g of groupsOf(m)) {
      out.push({ key: norm(g.name), skip: true, pri: 2.4 });
      for (const c of g.choices) {
        const k = norm(c.name); exact.add(k);
        out.push({ key: k, choice: c.name, pri: 3 });
        const cut = k.replace(/\d.*$/, '');   // "ไข่เจียว1ฟอง" → พูดแค่ "ไข่เจียว" ก็ได้
        if (cut.length >= 2 && cut !== k) out.push({ key: cut, choice: c.name, pri: 2.5 });
        for (const w of SYN[k] || []) out.push({ key: norm(w), choice: c.name, pri: 2.5 });
      }
    }
    return out.filter(e => e.key && !(e.pri === 2.5 && exact.has(e.key)));
  }

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
      if (cur) for (const e of cur.ch) tryE(e, e.pri);
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
  // ไอคอน (วาดเอง ไม่ใช้อีโมจิ · สีตามธีม)
  const ICON_MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor"/><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5v3M8.5 21.5h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  function css() {
    const s = document.createElement('style');
    s.textContent = `
      /* ----- ปุ่มไมค์ลอย (ลากย้ายได้) ----- */
      .vfab { position: fixed; z-index: 25; width: 64px; height: 64px; border-radius: 50%; padding: 0; display: grid; place-items: center;
        background: var(--accent); color: var(--accent-ink); border: 3px solid rgba(255,255,255,.92);
        box-shadow: 0 10px 24px rgba(0,0,0,.28), 0 2px 6px rgba(0,0,0,.18); touch-action: none; user-select: none; -webkit-user-select: none;
        transition: transform .15s, box-shadow .15s, left .25s cubic-bezier(.2,.8,.2,1), top .25s cubic-bezier(.2,.8,.2,1); }
      .vfab::before { content: ""; position: absolute; inset: 0; border-radius: 50%; background: linear-gradient(160deg, rgba(255,255,255,.32), rgba(255,255,255,0) 55%); pointer-events: none; }
      .vfab svg { width: 30px; height: 30px; position: relative; }
      .vfab:active { transform: scale(.94); }
      .vfab.drag { transform: scale(1.1); box-shadow: 0 16px 34px rgba(0,0,0,.35); transition: transform .15s, box-shadow .15s; cursor: grabbing; }
      .vfab[hidden] { display: none; }
      :root[data-ot=dark] .vfab { border-color: rgba(255,255,255,.18); }
      .vtip { position: fixed; z-index: 26; background: var(--ink); color: var(--card); font-size: 14px; padding: 8px 12px; border-radius: 10px; pointer-events: none;
        box-shadow: 0 6px 16px rgba(0,0,0,.25); opacity: 0; transition: opacity .3s; white-space: nowrap; }
      .vtip.on { opacity: 1; }
      /* ----- แผ่นสั่งด้วยเสียง ----- */
      .vbg { position: fixed; inset: 0; background: rgba(10,10,12,.55); z-index: 45; display: flex; align-items: flex-end; justify-content: center; animation: vfade .18s; }
      @keyframes vfade { from { opacity: 0; } }
      @keyframes vup { from { transform: translateY(24px); opacity: .4; } }
      .vsh { background: var(--card); width: min(560px, 100%); max-height: 92vh; max-height: 92dvh; overflow: auto; border-radius: 22px 22px 0 0;
        padding: 10px 18px 0; display: flex; flex-direction: column; box-shadow: 0 -12px 40px rgba(0,0,0,.25); animation: vup .22s cubic-bezier(.2,.8,.2,1); }
      .vsh::before { content: ""; width: 42px; height: 5px; border-radius: 3px; background: var(--line); align-self: center; margin-bottom: 8px; }
      @media (min-width: 821px) { .vbg { align-items: center; } .vsh { border-radius: 20px; padding-top: 18px; } .vsh::before { display: none; } }
      .vtop { display: flex; align-items: center; gap: 10px; }
      .vtop .vbadge { width: 34px; height: 34px; border-radius: 10px; background: var(--accent); color: var(--accent-ink); display: grid; place-items: center; flex: none; }
      .vtop .vbadge svg { width: 19px; height: 19px; }
      .vtop h2 { margin: 0; font-size: 18px; font-weight: 700; flex: 1; line-height: 1.25; }
      .vtop h2 small { display: block; font-size: 13.5px; font-weight: 500; color: var(--muted); }
      .vclose { width: 38px; height: 38px; padding: 0; border-radius: 50%; display: grid; place-items: center; color: var(--muted); background: var(--bg); border-color: transparent; }
      .vclose svg { width: 18px; height: 18px; }
      /* ไมค์ใหญ่ + วงคลื่นตอนฟัง */
      .vhero { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 18px 0 8px; }
      .vhero.small { flex-direction: row; padding: 14px 0 4px; gap: 16px; }
      .vbtn { --lv: 0; position: relative; width: 84px; height: 84px; border-radius: 50%; padding: 0; display: grid; place-items: center; flex: none;
        background: var(--accent); color: var(--accent-ink); border: 0; box-shadow: 0 10px 24px rgba(0,0,0,.22); }
      .vhero.small .vbtn { width: 62px; height: 62px; }
      .vbtn svg { width: 36px; height: 36px; position: relative; z-index: 1; } .vhero.small .vbtn svg { width: 28px; height: 28px; }
      .vbtn::before, .vbtn::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: var(--accent); opacity: 0; }
      .vbtn.on::before { opacity: .22; transform: scale(calc(1.15 + var(--lv) * .45)); transition: transform .1s linear; }
      .vbtn.on::after { animation: vring 1.6s ease-out infinite; }
      @keyframes vring { 0% { opacity: .35; transform: scale(1); } 100% { opacity: 0; transform: scale(1.9); } }
      @media (prefers-reduced-motion: reduce) { .vbtn.on::after { animation: none; } }
      .vstat { text-align: center; } .vhero.small .vstat { text-align: left; flex: 1; min-width: 0; }
      .vstat b { display: block; font-size: 17px; font-weight: 700; }
      .vstat span { font-size: 14.5px; color: var(--muted); line-height: 1.5; }
      .vwave { display: inline-flex; gap: 3px; align-items: center; height: 18px; vertical-align: -3px; margin-left: 6px; }
      .vwave i { width: 3px; border-radius: 2px; background: var(--accent); height: 4px; transition: height .1s; }
      .vlive { background: var(--bg); border-radius: 14px; padding: 12px 14px; font-size: 17px; line-height: 1.5; margin: 4px 0 2px; min-height: 48px; }
      .vlive.ph { color: var(--muted); font-size: 15px; }
      .vex { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .vex span { font-size: 13.5px; padding: 4px 10px; border-radius: 999px; background: var(--card); border: 1px solid var(--line); color: var(--ink); }
      .vmsg { display: flex; gap: 8px; align-items: flex-start; color: var(--bad); font-size: 15px; margin: 8px 0 0; padding: 10px 12px; border-radius: 12px; background: rgba(192,57,43,.08); }
      .vheard { font-size: 13.5px; color: var(--muted); margin: 10px 0 2px; }
      .vsec { font-size: 13px; font-weight: 700; letter-spacing: .3px; color: var(--muted); margin: 14px 0 4px; display: flex; justify-content: space-between; }
      .vlist { list-style: none; margin: 0; padding: 0; }
      .vlist li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 11px 0; border-top: 1px solid var(--line); }
      .vlist li:first-child { border-top: 0; }
      .vlist li b { font-size: 17px; font-weight: 600; }
      .vlist li small { display: block; color: var(--muted); font-size: 14px; margin-top: 1px; }
      .vlist li.out b { text-decoration: line-through; color: var(--muted); }
      .vlist li small.bad { color: var(--bad); }
      .vlist li small.ask { color: var(--warn); font-weight: 600; }
      .vq { display: flex; align-items: center; background: var(--bg); border-radius: 999px; padding: 3px; }
      .vq button { width: 36px; height: 36px; padding: 0; border-radius: 50%; border: 0; background: var(--card); font-size: 18px; font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
      .vq span { min-width: 34px; text-align: center; font-weight: 700; font-size: 18px; color: var(--accent); }
      .vx { width: 36px; height: 36px; padding: 0; border-radius: 50%; display: grid; place-items: center; color: var(--muted); background: transparent; border-color: transparent; }
      .vx svg { width: 16px; height: 16px; }
      .vunk { margin-top: 10px; padding: 12px 14px; border-radius: 14px; background: rgba(201,138,0,.10); border: 1px solid rgba(201,138,0,.28); }
      .vunk p { margin: 0 0 8px; font-size: 15px; }
      .vunk .vc { display: flex; flex-wrap: wrap; gap: 6px; } .vunk .vc button { padding: 8px 14px; font-size: 15px; border-radius: 999px; }
      .vunk .vc button.no { color: var(--muted); background: transparent; }
      .vlearn { display: flex; gap: 8px; align-items: center; font-size: 14px; color: var(--muted); margin: 10px 0 0; }
      .vfoot { position: sticky; bottom: 0; background: var(--card); display: flex; gap: 10px; padding: 12px 0 max(14px, env(safe-area-inset-bottom)); margin-top: 12px; border-top: 1px solid var(--line); }
      .vfoot button { flex: 1; min-height: 52px; border-radius: 14px; }
      .vfoot button.primary { flex: 2; }
      .vempty { color: var(--muted); font-size: 15px; margin: 8px 0; }
      .vhold { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 8px 0 0; font-size: 13.5px; color: var(--muted); }
      .vhold span { margin-right: 2px; }
      .vhold button { padding: 4px 11px; font-size: 13.5px; border-radius: 999px; min-height: 0; }
      .vhold button[aria-pressed="true"] { background: var(--ink); color: var(--card); border-color: var(--ink); }
      .vq button:disabled, .vx:disabled { opacity: .35; }`;
    document.head.appendChild(s);
  }

  // ---------- ปุ่มลอย: ลากไปวางตรงไหนก็ได้ ปล่อยแล้วชิดขอบซ้าย/ขวาที่ใกล้กว่า · จำตำแหน่งไว้ในเครื่องนี้ ----------
  const POS_KEY = 'edposMicPos', SIZE = 64, EDGE = 14;
  let pos = null;   // {side: 'l'|'r', y: 0–1 (ตำแหน่งจากบนเทียบความสูงจอ)} · null = มุมขวาล่าง
  try { pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch {}
  const mobile = () => innerWidth <= 820;
  // ขอบที่วางได้: มือถือเว้นแถบล่าง (ยอด/ส่งออเดอร์) · จอกว้างฝั่งขวาเว้นบิล
  function bounds() {
    const bill = document.querySelector('.bill'), r = bill && !mobile() ? bill.getBoundingClientRect() : null;
    const top = (document.querySelector('header')?.getBoundingClientRect().bottom || 0) + 8;
    const bottom = innerHeight - SIZE - (mobile() ? 86 : EDGE);
    return { left: EDGE, right: (r ? r.left : innerWidth) - SIZE - EDGE, top, bottom };
  }
  function place() {
    const b = bounds(), first = !fab.dataset.placed;
    if (first) { fab.style.transition = 'none'; fab.dataset.placed = '1'; }   // วางครั้งแรกไม่ต้องเลื่อนมา
    const y = pos ? pos.y * innerHeight : b.bottom;
    fab.style.left = (pos?.side === 'l' ? b.left : b.right) + 'px';
    fab.style.top = Math.min(b.bottom, Math.max(b.top, y)) + 'px';
    if (first) { void fab.offsetWidth; fab.style.transition = ''; }
  }
  function makeFab() {
    css();
    fab = document.createElement('button');
    fab.className = 'vfab'; fab.innerHTML = ICON_MIC;
    fab.setAttribute('aria-label', 'สั่งด้วยเสียง (ลากเพื่อย้ายปุ่ม)');
    document.body.appendChild(fab);
    let drag = null, moved = false;
    fab.addEventListener('pointerdown', e => {
      const r = fab.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY }; moved = false;
      fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener('pointermove', e => {
      if (!drag) return;
      if (!moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 8) return;   // ขยับนิดเดียว = แตะ
      moved = true; fab.classList.add('drag'); hideTip();
      fab.style.left = Math.min(innerWidth - SIZE, Math.max(0, e.clientX - drag.dx)) + 'px';
      fab.style.top = Math.min(innerHeight - SIZE, Math.max(0, e.clientY - drag.dy)) + 'px';
    });
    const up = () => {
      if (!drag) return;
      drag = null; fab.classList.remove('drag');
      if (!moved) return;
      const r = fab.getBoundingClientRect(), b = bounds();
      pos = { side: r.left + SIZE / 2 < (b.left + b.right + SIZE) / 2 ? 'l' : 'r', y: Math.round(Math.min(b.bottom, Math.max(b.top, r.top)) / innerHeight * 1000) / 1000 };
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {}
      place();
    };
    fab.addEventListener('pointerup', up);
    fab.addEventListener('pointercancel', up);
    // แตะ = เปิด (ลากแล้วไม่นับเป็นแตะ)
    fab.addEventListener('click', e => { if (moved) { moved = false; e.preventDefault(); return; } hideTip(); openSheet(); listen(); });
    addEventListener('resize', () => { if (!fab.hidden) place(); });
  }
  // คำแนะนำ "ลากเพื่อย้ายได้" 2 ครั้งแรก
  let tip = null;
  function showTip() {
    let n = 0; try { n = +localStorage.getItem('edposMicTip') || 0; } catch {}
    if (n >= 2 || pos) return;
    try { localStorage.setItem('edposMicTip', n + 1); } catch {}
    const t = tip = document.createElement('div'); t.className = 'vtip'; t.textContent = 'แตะเพื่อสั่งด้วยเสียง · ลากเพื่อย้ายปุ่ม';
    document.body.appendChild(t);
    const r = fab.getBoundingClientRect();
    t.style.top = (r.top + SIZE / 2 - 18) + 'px';
    // ปุ่มชิดซ้าย → ป้ายอยู่ขวาของปุ่ม · ชิดขวา → ป้ายอยู่ซ้าย
    requestAnimationFrame(() => { t.style.left = (r.left < innerWidth / 2 ? r.right + 10 : Math.max(8, r.left - t.offsetWidth - 10)) + 'px'; t.classList.add('on'); });
    setTimeout(hideTip, 4500);
  }
  function hideTip() { if (!tip) return; const t = tip; tip = null; t.classList.remove('on'); setTimeout(() => t.remove(), 300); }
  function sync() {
    if (!ok) return;
    if (!fab) makeFab();
    const was = fab.hidden;
    fab.hidden = !(orderUi().voice && current && !hist && !document.body.classList.contains('sheet-open') && !st.open);
    if (!fab.hidden) { place(); if (was) showTip(); } else hideTip();
  }
  function openSheet() {
    Object.assign(st, { open: true, live: '', heard: '', msg: '', items: [], unk: [], allTa: false, thai: false });
    sheet = document.createElement('div'); sheet.className = 'vbg';
    sheet.onclick = e => { if (e.target === sheet) closeSheet(); };
    document.body.appendChild(sheet);
    draw(); sync();
  }
  function closeSheet() {
    ses.on = false;
    if (st.listening) try { app.voiceCancel(); } catch {}
    st.open = st.listening = false; sheet?.remove(); sheet = null; sync();
  }
  // ---------- ฟังต่อเนื่อง ----------
  // ตัวแปลงเสียงของ Android ตัดเองเมื่อเงียบแป๊บเดียว → เปิดฟังใหม่ต่อให้เองจนกว่าจะกดหยุด หรือเงียบนานเกินที่ตั้ง
  // ข้อความทุกช่วงต่อกันแล้วค่อยแยกเมนู ("ผัดกะเพราไก่" | "ที่เล็ก เผ็ดน้อย" = จานเดียวกัน)
  // กดค้างที่ไมค์ = ฟังตลอดที่กดอยู่ ปล่อยแล้วหยุด
  const HOLDS = [[2500, '2 วิ'], [4000, '4 วิ'], [7000, '7 วิ'], [0, 'กดหยุดเอง']];
  let hold = 4000; try { const h = localStorage.getItem('edposMicHold'); if (h != null && HOLDS.some(x => String(x[0]) === h)) hold = +h; } catch {}
  const MAX_SESSION = 90000;   // กันลืมปิดไมค์: ฟังได้นานสุด 1 นาทีครึ่งต่อครั้ง
  const ses = { on: false, stop: false, push: false, segs: [], base: null, last: 0, start: 0 };
  function listen(push = false) {
    Object.assign(ses, { on: true, stop: false, push, segs: [], last: Date.now(), start: Date.now(),
      base: { items: st.items.slice(), unk: st.unk.slice(), allTa: st.allTa, thai: st.thai } });
    st.msg = ''; st.live = ''; st.listening = true; draw();
    startRec();
  }
  function startRec() {
    try { app.voiceStart('th-TH'); } catch { endSession(); st.msg = 'เปิดไมค์ไม่ได้'; draw(); }
  }
  function stopListen() { ses.stop = true; try { app.voiceStop(); } catch {} }
  // ข้อความทั้งหมดของรอบนี้ → แยกเมนูใหม่ทั้งก้อน แล้วต่อท้ายรายการที่มีอยู่ก่อนเริ่มรอบ
  function reparse() {
    const b = ses.base, r = ses.segs.length ? parse(ses.segs.join(' ')) : { items: [], unk: [], allTa: false, thai: false };
    st.items = [...b.items, ...r.items]; st.unk = [...b.unk, ...r.unk];
    st.allTa = b.allTa || r.allTa; st.thai = b.thai || r.thai;
    st.heard = ses.segs.join(' ');
  }
  function endSession() { ses.on = false; st.listening = false; st.live = ''; st.level = 0; }
  // ตัวแปลงเสียงจบหนึ่งช่วง → ฟังต่อไหม
  function onRecEnd() {
    const now = Date.now(), quiet = now - ses.last;
    const more = ses.on && !ses.stop && now - ses.start < MAX_SESSION && (ses.push || hold === 0 || quiet < hold);
    if (more) { st.live = ''; setTimeout(() => { if (ses.on && !ses.stop) startRec(); else { endSession(); draw(); } }, 250); return; }
    endSession();
  }
  // กลุ่มที่ต้องเลือกแต่ยังไม่ได้บอก (จะเปิดหน้าต่างถามตอนใส่รายการ)
  const askOf = x => { const grid = gridOf(x.m);
    return groupsOf(x.m).filter(g => (g.required || grid?.groups.includes(g.name)) && g.choices.length > 1 && !g.choices.some(c => x.choices.includes(c.name))).map(g => g.name); };
  const nAdd = () => st.items.filter(x => x.m.available !== false).length;
  function draw() {
    if (!sheet) return;
    const tbl = typeof tableName === 'function' ? tableName(current) : current;
    const choiceTxt = x => [...x.choices.map(c => { const g = groupsOf(x.m).find(g => g.choices.some(y => y.name === c)); return !g ? c : /^ไม่/.test(g.name) ? `${g.name}${c}` : /^[a-z0-9]{1,3}$/i.test(c) ? `${g.name} ${c}` : c; }), ...x.notes, ...(x.ta || st.allTa ? ['กลับบ้าน'] : [])].join(' · ');
    const small = st.items.length || st.unk.length;
    const status = st.listening ? `<b>กำลังฟัง<span class="vwave">${'<i></i>'.repeat(5)}</span></b><span>${ses.push ? 'ปล่อยนิ้วเมื่อพูดจบ' : hold ? `พูดต่อได้เรื่อยๆ · เงียบ ${hold / 1000} วินาที หรือแตะ ■ = จบ` : 'พูดต่อได้เรื่อยๆ · แตะ ■ เมื่อพูดจบ'}</span>`
      : small ? '<b>แตะไมค์เพื่อพูดเพิ่ม</b><span>หรือตรวจรายการด้านล่างแล้วกดใส่รายการ</span>' : '<b>แตะไมค์แล้วพูดได้เลย</b><span>ชื่อเมนู + จำนวน + ตัวเลือก ต่อกันได้หลายเมนู · กดค้าง = พูดตลอดที่กด</span>';
    const dis = st.listening ? 'disabled' : '';
    const sofar = st.listening ? [...ses.segs, st.live].filter(Boolean).join(' ') : '';
    sheet.innerHTML = `<div class="vsh" role="dialog" aria-modal="true" aria-label="สั่งด้วยเสียง">
      <div class="vtop"><span class="vbadge">${ICON_MIC}</span><h2>สั่งด้วยเสียง<small>${esc(tbl)}</small></h2><button class="vclose" data-v="close" aria-label="ปิด">${ICON_X}</button></div>
      <div class="vhero ${small ? 'small' : ''}"><button class="vbtn ${st.listening ? 'on' : ''}" data-v="mic" aria-label="${st.listening ? 'หยุดฟัง' : 'พูด'}">${st.listening ? ICON_STOP : ICON_MIC}</button>
        <div class="vstat" aria-live="polite">${status}</div></div>
      ${st.listening || !small ? `<div class="vlive ${sofar ? '' : 'ph'}">${sofar ? esc(sofar) : st.listening ? '…' : 'ตัวอย่าง'}${!st.listening && !small ? `<div class="vex"><span>ปลาเผา 2</span><span>ช้างใหญ่ 3</span><span>กะเพราไก่ที่เล็ก เผ็ดน้อย ราดข้าว</span><span>ข้าวสวย 4 กลับบ้าน</span></div>` : ''}</div>` : ''}
      <div class="vhold"><span>หยุดฟังเองเมื่อเงียบ</span>${HOLDS.map(([ms, t]) => `<button data-v="hold" data-h="${ms}" aria-pressed="${ms === hold}">${t}</button>`).join('')}</div>
      ${st.msg ? `<p class="vmsg" role="alert"><span>⚠</span><span>${esc(st.msg)}</span></p>` : ''}
      ${st.heard && !st.listening ? `<p class="vheard">ได้ยินว่า “${esc(st.heard)}”</p>` : ''}
      ${st.items.length ? `<div class="vsec"><span>รายการที่ได้ยิน</span><span>${st.items.reduce((a, x) => a + (x.m.available === false ? 0 : x.qty), 0)} จาน</span></div><ul class="vlist">${st.items.map((x, k) => {
        const out = x.m.available === false;
        const ask = askOf(x);
        return `<li class="${out ? 'out' : ''}"><div><b>${esc(x.m.name)}</b>${out ? '<small class="bad">หมด · จะไม่ใส่รายการ</small>' : choiceTxt(x) ? `<small>${esc(choiceTxt(x))}</small>` : ''}${!out && ask.length ? `<small class="ask">จะถาม: ${esc(ask.join(' · '))}</small>` : ''}</div>
          <div class="vq">${out ? '' : `<button data-v="minus" data-k="${k}" aria-label="ลด" ${dis}>−</button><span>${x.qty}</span><button data-v="plus" data-k="${k}" aria-label="เพิ่ม" ${dis}>+</button>`}</div>
          <button class="vx" data-v="del" data-k="${k}" aria-label="เอาออก" ${dis}>${ICON_X}</button></li>`; }).join('')}</ul>`
        : !st.listening && st.heard && !st.unk.length ? '<p class="vempty">ไม่พบชื่อเมนูในที่พูด ลองพูดใหม่ช้าๆ ใกล้เครื่อง</p>' : ''}
      ${st.unk.map((u, k) => { const c = candidates(u.text);
        return `<div class="vunk"><p>ไม่แน่ใจ “<b>${esc(u.text)}</b>”${u.qty ? ` × ${u.qty}` : ''} หมายถึง</p>
          <div class="vc">${c.map(m => `<button data-v="pick" data-k="${k}" data-m="${m.id}" ${dis}>${esc(m.name)}</button>`).join('')}
          <button class="no" data-v="skip" data-k="${k}">${c.length ? 'ไม่ใช่ทั้งหมด' : 'ไม่พบเมนูที่ใกล้เคียง · ข้าม'}</button></div></div>`; }).join('')}
      ${st.unk.length ? `<label class="vlearn"><input type="checkbox" data-v="learn" ${st.learn ? 'checked' : ''}> จำคำนี้ไว้ ครั้งหน้าพูดแบบเดิมจะรู้จักเลย</label>` : ''}
      ${st.items.length ? `<p class="vheard">ตรวจรายการแล้วกด “ใส่รายการ” · เมนูที่ยังไม่ได้บอกตัวเลือก จะถามทีละจาน · ยังไม่ส่งครัวจนกว่าจะกดส่งออเดอร์</p>` : ''}
      <div class="vfoot"><button data-v="close">ยกเลิก</button>
        <button class="primary" data-v="add" ${nAdd() && !st.listening ? '' : 'disabled'}>ใส่รายการ${nAdd() ? ` (${nAdd()})` : ''}</button></div></div>`;
    paintLevel();
  }
  // ความดังเสียง → วงรอบไมค์ขยาย + แท่งคลื่น 5 แท่ง (ไม่วาดทั้งแผ่นใหม่)
  const WAVE = [0.55, 0.85, 1, 0.8, 0.6];
  function paintLevel() {
    if (!sheet) return;
    sheet.querySelector('.vbtn')?.style.setProperty('--lv', st.level);
    sheet.querySelectorAll('.vwave i').forEach((b, i) => { b.style.height = Math.round(4 + st.level * 14 * WAVE[(i + Math.round(Date.now() / 120)) % 5]) + 'px'; });
  }
  function onClick(e) {
    const b = e.target.closest('[data-v]'); if (!b || !sheet?.contains(b)) return;
    const v = b.dataset.v, k = +b.dataset.k;
    if (v === 'close') return closeSheet();
    if (v === 'mic') { if (Date.now() - pushEnd < 350) return; if (st.listening) stopListen(); else listen(); return; }
    if (v === 'hold') { hold = +b.dataset.h; try { localStorage.setItem('edposMicHold', hold); } catch {} draw(); return; }
    if (st.listening && v !== 'add') return;   // ระหว่างฟังแก้รายการไม่ได้ (รายการยังเปลี่ยนตามที่พูด)
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
  // กดค้างที่ไมค์ (เกินครึ่งวินาที) = พูดตลอดที่กด ปล่อยแล้วหยุด · แตะสั้นๆ = เปิด/ปิดตามปกติ
  let pressT = 0, pushEnd = 0;   // pushEnd = เวลาที่ปล่อยนิ้วจากการกดค้าง (คลิกที่ตามมาไม่นับเป็นแตะ)
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest('.vbtn'); if (!b || !sheet?.contains(b) || st.listening) return;
    pressT = setTimeout(() => { pressT = 0; listen(true); }, 500);
  });
  const release = () => {
    if (pressT) { clearTimeout(pressT); pressT = 0; }
    else if (ses.on && ses.push) { stopListen(); pushEnd = Date.now(); }
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
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
    if (ev.type === 'ready' || ev.type === 'start') { if (!ses.on) return; st.listening = true; }
    else if (ev.type === 'level') { st.level = ev.v || 0; if (st.level > 0.35) ses.last = Date.now(); paintLevel(); return; }
    else if (ev.type === 'partial') { st.live = ev.text || ''; if (st.live) ses.last = Date.now(); }
    else if (ev.type === 'result') {
      const alts = (ev.alts || []).filter(Boolean);
      if (alts.length && ses.base) { ses.segs.push(bestParse(alts).text); ses.last = Date.now(); reparse(); }
    } else if (ev.type === 'error') {
      // ไม่ได้ยิน/เงียบ ระหว่างฟังต่อเนื่อง = ปกติ (เดี๋ยวฟังใหม่เอง) · บอกเฉพาะตอนยังไม่ได้ยินอะไรเลย
      if (ev.code === 'nomatch' && ses.on && (ses.segs.length || ses.push || hold === 0 || Date.now() - ses.last < hold)) return;
      if (ev.code !== 'nomatch') ses.stop = true;
      st.msg = { perm: 'ยังไม่ได้อนุญาตให้ใช้ไมค์ · แตะไมค์อีกครั้งแล้วกด “อนุญาต” (หรือ ตั้งค่า › แอป › MAMA POS › สิทธิ์ › ไมโครโฟน)',
        nomatch: 'ไม่ได้ยินชัด ลองพูดอีกครั้ง ใกล้ๆ เครื่อง', net: 'แปลงเสียงไม่ได้ ต้องต่ออินเทอร์เน็ต', busy: 'ไมค์กำลังถูกใช้อยู่ ลองใหม่อีกครั้ง' }[ev.code] || 'ฟังไม่สำเร็จ ลองใหม่อีกครั้ง';
    } else if (ev.type === 'end') { if (!ses.on) return; onRecEnd(); }
    draw();
  };
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  return { sync, parse, candidates, get ok() { return ok; } };
})();
// วาดหน้าใหม่ → ซ่อน/แสดงปุ่มไมค์ตามหน้า (โต๊ะที่เปิดอยู่เท่านั้น)
{ const _render = render; render = function () { _render(); VOICE.sync(); }; }
VOICE.sync();
