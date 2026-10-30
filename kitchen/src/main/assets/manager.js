/*
 * ผู้ช่วยครัว — โหมดผู้จัดการร้าน (ใช้รหัสเจ้าของร้าน)
 * ข้อมูลจากเซิร์ฟเวอร์ ED POS เดิม ไม่ต้องแก้เซิร์ฟเวอร์:
 *   GET /api/pace (ยอดสดวันนี้เทียบที่คาด) · GET /api/breakeven (เดือนนี้/คุ้มทุน) · GET /api/forecast (7 วันข้างหน้า + เตรียมของ)
 *   GET /api/report?from&to (ขายดี เวลาครัว ยกเลิก) · GET /api/state (เมนู + ปิด/เปิด) · GET /api/line/preview?kind=day|week|month (สรุปแบบ LINE)
 *   POST /api/menu/available {id, available}
 * ไฟล์นี้ไม่แตะหน้าจอ/เครือข่าย ทดสอบด้วย node ได้ (kitchen/test/test-manager.js)
 */
(function (root) {
  'use strict';
  const L = typeof module !== 'undefined' && module.exports ? require('./logic.js') : root.KitchenLogic;
  const norm = L.norm;

  const fmt = n => Math.round(+n || 0).toLocaleString('en-US');
  const baht = n => `${fmt(n)} บาท`;
  const TH_DAY = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
  const dayKey = (t, plus) => { const d = new Date(t); d.setDate(d.getDate() + (plus || 0)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // ---------- ปิด/เปิดเมนู ----------
  /** เมนูที่ตรงกับคำ: ชื่อเมนูมีคำนี้ (กุ้ง → ต้มยำกุ้ง, กุ้งผัดพริก) หรือใช้วัตถุดิบชื่อนี้ (ตั้งไว้ที่หลังร้าน > วัตถุดิบ) */
  function menusFor(word, menu, ingredients) {
    const w = norm(word);
    if (w.length < 2) return [];
    const exact = menu.filter(m => norm(m.name) === w);
    if (exact.length) return exact;
    const ids = new Set(menu.filter(m => norm(m.name).includes(w)).map(m => m.id));
    for (const g of ingredients || []) if (norm(g.name) === w || norm(g.name).includes(w)) for (const u of g.uses || []) if (u.t === 'm') ids.add(u.r);
    if (!ids.size) {   // ระบบฟังเพี้ยน (กระเพรา) → ใช้วิธีเทียบของจอครัว
      const fake = menu.map(m => ({ id: m.id, name: m.name, extra_option: [] }));
      for (const d of L.matchDishes(fake, w, '')) ids.add(d.id);
    }
    return menu.filter(m => ids.has(m.id));
  }
  const listNames = ms => ms.length <= 4 ? ms.map(m => m.name).join(', ') : ms.slice(0, 3).map(m => m.name).join(', ') + ` และอีก ${ms.length - 3} เมนู`;
  function menuCalls(ms, on) {
    return { calls: ms.map(m => ({ path: '/api/menu/available', body: { id: m.id, available: on } })),
      undo: ms.map(m => ({ path: '/api/menu/available', body: { id: m.id, available: !on } })) };
  }
  /** "X หมด" / "ปิดเมนู X" → ปิด · "เปิดเมนู X" / "X มาแล้ว" → เปิด */
  function menuIntent(c, menu, ingredients, optionNames) {
    let m, off;
    if ((m = /^(ปิดเมนู|ปิด|งดขาย|งด)(.+)$/.exec(c)) || (m = /^(.+?)(หมดแล้ว|หมด|ไม่มีแล้ว|ขาดแล้ว|ขาด)$/.exec(c))) off = true;
    else if ((m = /^(เปิดเมนู|เปิดขาย|เปิด)(.+)$/.exec(c)) || (m = /^(.+?)(มาแล้ว|มีแล้ว|เข้าแล้ว|ขายได้แล้ว|กลับมาแล้ว)$/.exec(c))) off = false;
    if (!m) return null;
    const word = (off !== undefined && /^(ปิด|เปิด|งด)/.test(m[1]) ? m[2] : m[1]).replace(/(ค่ะ|ครับ|นะ|หน่อย|ด้วย|เลย|ทั้งหมด)+$/, '').replace(/^(เมนู|ของ)/, '');
    if (!word || /^(จอ|แอป|ไมค์|เสียง|ร้าน)/.test(word)) return null;   // ปิดเสียง/ปิดร้าน ไม่ใช่เรื่องเมนู
    const all = menusFor(word, menu, ingredients);
    const hit = all.filter(x => off ? x.available !== false : x.available === false);
    if (!all.length) {
      if ((optionNames || []).some(o => norm(o).includes(norm(word))))
        return { kind: 'say', say: `${word} เป็นตัวเลือกในเมนู ปิดทีละตัวเลือกด้วยเสียงไม่ได้ค่ะ ปิดได้ที่หลังร้าน` };
      return { kind: 'notfound', say: `ไม่เจอเมนู ${word} ค่ะ` };
    }
    if (!hit.length) return { kind: 'say', say: off ? `${listNames(all)} ปิดอยู่แล้วค่ะ` : `${listNames(all)} เปิดขายอยู่แล้วค่ะ` };
    return { kind: off ? 'menu-off' : 'menu-on', confirm: true, menus: hit,
      ask: `${off ? 'ปิด' : 'เปิด'} ${hit.length} เมนู ${listNames(hit)} ใช่ไหมคะ`,
      say: `${off ? 'ปิด' : 'เปิดขาย'} ${hit.length} เมนูแล้วค่ะ${off ? ' หน้าร้านจะสั่งไม่ได้' : ''}`, ...menuCalls(hit, !off) };
  }


  // ---------- สต๊อกวัตถุดิบ (GET /api/stock) ----------
  // หน่วยที่พูด → [หน่วยฐาน, ตัวคูณ] · น้ำหนัก = กรัม · ปริมาตร = มล. · อื่นๆ = นับชิ้น
  const UNITS = [
    [/^(กิโลกรัม|กิโล|กก|kg)/, 'g', 1000], [/^(ขีด)/, 'g', 100], [/^(กรัม|g)/, 'g', 1],
    [/^(ลิตร|l)/, 'ml', 1000], [/^(มิลลิลิตร|มล|ml|ซีซี|cc)/, 'ml', 1],
    [/^(แผง)/, 'pc', 30], [/^(โหล)/, 'pc', 12],
    [/^(ฟอง|ตัว|ชิ้น|ขวด|ถุง|กล่อง|แพ็ค|แพค|แพ็ก|ห่อ|ลูก|หัว|มัด|กำ|ต้น|ถัง|แกลลอน|กระป๋อง|ซอง|ลัง|อัน|กระสอบ)/, 'pc', 1],
  ];
  const baseOf = unit => /กรัม|กก/.test(unit) ? 'g' : /มล|ลิตร/.test(unit) ? 'ml' : 'pc';
  const toIngUnit = (n, b, unit) => b === 'g' && unit === 'กก.' ? n / 1000 : b === 'ml' && unit === 'ลิตร' ? n / 1000 : n;
  /** ตัวเลข (ทศนิยม/คำไทย/ครึ่ง) + หน่วย ที่ตำแหน่ง i → {n (หน่วยของวัตถุดิบ), len, unitWord} */
  function readQty(c, i, ingUnit) {
    let n = null, len = 0;
    const d = /^\d+(\.\d+)?/.exec(c.slice(i));
    if (d) { n = parseFloat(d[0]); len = d[0].length; }
    else if (c.startsWith('ครึ่ง', i)) { n = 0.5; len = 5; }
    else { const r = L.readNumber(c, i); if (r) { n = r.n; len = r.len; } }
    if (n == null) return null;
    let j = i + len, mult = null, base = null, unitWord = '';
    for (const [re, b, m] of UNITS) { const u = re.exec(c.slice(j)); if (u) { base = b; mult = m; unitWord = u[0]; j += u[0].length; break; } }
    if (c.startsWith('ครึ่ง', j)) { n += 0.5; j += 5; }   // กิโลครึ่ง
    let q = n;
    if (base && base === baseOf(ingUnit)) q = toIngUnit(n * mult, base, ingUnit);
    else if (base && base !== 'pc') return { n: null, len: j - i, unitWord, bad: true, kg: base === 'g' ? n * mult / 1000 : null };   // พูดกิโลแต่วัตถุดิบนับเป็นชิ้น (kg = ไว้แปลงด้วย โลละกี่ตัว)
    else if (base === 'pc') q = n * mult;
    return { n: Math.round(q * 100) / 100, len: j - i, unitWord };
  }
  /** วัตถุดิบที่พูดถึง (ชื่อยาวสุดที่อยู่ในประโยค → แบบเพี้ยน) */
  function findIng(c, list) {
    let best = null;
    for (const g of list) { const n = norm(g.name); const i = c.indexOf(n); if (n && i >= 0 && (!best || n.length > best.n.length)) best = { g, n, i }; }
    if (best) return { g: best.g, start: best.i, end: best.i + best.n.length };
    return null;
  }
  const qtyTxt = (q, unit) => {
    if (q == null) return '–';
    if (unit === 'กรัม' && Math.abs(q) >= 1000) return `${Math.round(q / 100) / 10} กิโล`;
    if (unit === 'มล.' && Math.abs(q) >= 1000) return `${Math.round(q / 100) / 10} ลิตร`;
    return `${Math.round(q * 10) / 10} ${unit === 'กก.' ? 'กิโล' : unit === 'มล.' ? 'มิลลิลิตร' : unit}`;
  };
  function shopListText(st, shopName) {
    const buy = (st.list || []).filter(x => x.tracked && x.toBuy > 0);
    if (!buy.length) return '';
    const day = st.tomorrow && st.tomorrow.date ? ` สำหรับวันที่ ${+st.tomorrow.date.slice(8)}` : '';
    return `🛒 รายการซื้อของ${shopName ? ' ' + shopName : ''}${day}\n` + buy.map(x => `• ${x.name} ${qtyTxt(roundBuy(x.toBuy, x.unit), x.unit)} (เหลือ ${qtyTxt(x.stock, x.unit)})`).join('\n');
  }
  // ปัดจำนวนซื้อให้ซื้อจริงได้: กรัม → ขึ้นทีละ 100 · มล. ทีละ 100 · ชิ้น → ขึ้นเป็นจำนวนเต็ม
  const roundBuy = (q, unit) => unit === 'กรัม' || unit === 'มล.' ? Math.ceil(q / 100) * 100 : unit === 'กก.' || unit === 'ลิตร' ? Math.ceil(q * 10) / 10 : Math.ceil(q - 0.01);

  // "โลละ 40 ตัว" / "กิโลละสี่สิบ" / "40 ตัวต่อโล" / "ไซส์ 40" (กุ้งขายตามไซส์ = กี่ตัวต่อกิโล) · ไม่นับ "กิโลละ 350 บาท" (ราคา)
  // → {n, start, end} ตำแหน่งในข้อความ (ไว้ตัดออกก่อนหาราคา)
  function perKgAt(t) {
    const kw = /(กิโลกรัมละ|กิโลละ|โลละ|กิโลนึง|โลนึง|กิโลหนึ่ง|โลหนึ่ง|ไซส์|ไซซ์|size|ขนาด)/g;
    let m;
    while ((m = kw.exec(t))) {
      const i = m.index + m[0].length, r = L.readNumber(t, i);
      if (!r) continue;
      let j = i + r.len;
      const u = /^(ตัว|ชิ้น|ลูก|ฟอง|อัน)/.exec(t.slice(j)); if (u) j += u[0].length;
      if (!u && /^(\.\d|บาท)/.test(t.slice(j))) continue;   // ราคาต่อกิโล
      if (r.n > 0 && r.n < 10000) return { n: r.n, start: m.index, end: j };
    }
    const m2 = /(\d+)(ตัว|ชิ้น|ลูก|ฟอง)ต่อ(กิโล|โล)(กรัม)?/.exec(t);
    return m2 && +m2[1] > 0 ? { n: +m2[1], start: m2.index, end: m2.index + m2[0].length } : null;
  }
  const perKgIn = t => (perKgAt(t) || {}).n || null;
  function stockIntent(c, st) {
    const list = (st && st.list) || [];
    if (!list.length) return null;
    const T = (topic, extra) => ({ kind: 'mgr', topic, need: ['stock'], ...extra });
    if (/(ใกล้หมด|สต[็๊]?อกต่ำ|ต้องเติมอะไร|อะไรจะหมด|ของจะหมด)/.test(c)) return T('low');
    if (/(ส่ง.*(ไลน์|line)|(ไลน์|line).*ร้านส่งของ)/.test(c) && /(ซื้อ|สั่ง|รายการ|ของ)/.test(c)) return { kind: 'stock-line' };
    if (/(ต้องซื้อ|รายการซื้อ|ซื้อของอะไร|ซื้ออะไร|สั่งของอะไร|ต้องสั่งอะไร|ไปตลาด|ไปแม็คโคร|ไปแมคโคร|จ่ายตลาด)/.test(c)) return T('buy');
    if (/(ของหาย|ส่วนต่าง|ของเสียเท่า|เสียไปเท่า|หายไปเท่า)/.test(c)) return T('loss');
    if (/(ต้นทุน|กำไรจานละ|กำไรต่อจาน|จานละกี่บาท|ได้กำไรเท่า)/.test(c)) return T('cost', { word: c.replace(/(ต้นทุน|กำไรจานละ|กำไรต่อจาน|จานละกี่บาท|ได้กำไรเท่าไร|ได้กำไรเท่าไหร่|เท่าไร|เท่าไหร่|ของ|ค่ะ|ครับ)/g, '') });
    const f = findIng(c, list);
    if (!f) return null;
    const g = f.g, rest = c.slice(f.end), before = c.slice(0, f.start);
    // "กุ้งวันนี้โลละ 35 ตัว" (ไม่มีรับ/นับ) = จำไว้ใช้แปลงกิโลเป็นตัว
    if (!/(รับ|เติม|ซื้อ|เหลือ|นับ|เสีย|ทิ้ง|ได้มา)/.test(c) && g.unit !== 'กรัม' && g.unit !== 'กก.') {
      const per = perKgIn(rest);
      if (per) return { kind: 'stock-move', confirm: true, ing: g, ask: `จำว่า${g.name}โลละ ${per} ${g.unit} ใช่ไหมคะ`, say: `จำไว้แล้วค่ะ ${g.name}โลละ ${per} ${g.unit}`,
        calls: [{ path: '/api/stock/setup', body: { id: g.id, perKg: per } }],
        undo: g.perKg ? [{ path: '/api/stock/setup', body: { id: g.id, perKg: g.perKg } }] : [] };
    }
    // ถามคงเหลือ
    if (/^(เหลือ|มี|สต[็๊]?อก)?(เท่าไร|เท่าไหร่|กี่|อีกกี่|อยู่เท่าไร|อยู่กี่|พอไหม|พอมั้ย|พอถึง)/.test(rest) || /^(สต[็๊]?อก|เช็ค|เช็ก)$/.test(before)) return T('ing', { id: g.id });
    // หาตัวเลข (หลังชื่อ ข้ามคำเชื่อม)
    const m = /^(มาแล้ว|เข้ามา|มา|เข้า|เพิ่ม|อีก|เหลือ|ได้|ไป|ทิ้ง|เสีย|บูด|เน่า|หมดอายุ)*/.exec(rest);
    const qi = f.end + m[0].length;
    const q = readQty(c, qi, g.unit);
    if (!q) return null;
    // ซื้อเป็นกิโลแต่นับเป็นตัว (กุ้ง): แปลงด้วย "โลละ 40 ตัว" ในประโยค หรือค่าล่าสุดที่เคยบอก (g.perKg)
    let kgInfo = null;
    if (q.bad && q.kg > 0) {
      const said = perKgIn(c.slice(qi + q.len)), per = said || g.perKg;
      if (!per) return { kind: 'say', say: `${g.name}นับเป็น${g.unit}ค่ะ ${g.name}วันนี้โลละกี่${g.unit} พูดแบบนี้ได้ค่ะ รับ${g.name} ${Math.round(q.kg * 10) / 10} กิโล โลละ 40 ${g.unit}` };
      kgInfo = { kg: Math.round(q.kg * 100) / 100, per, said: !!said };
      q.n = Math.round(q.kg * per); q.bad = false;
    }
    if (q.bad) return { kind: 'say', say: `${g.name} นับเป็น${g.unit} บอกเป็น${g.unit}ด้วยค่ะ` };
    if (!(q.n > 0) && !/เหลือ/.test(rest)) return null;
    const after = c.slice(qi + q.len);
    const pk = perKgAt(after), after2 = pk ? after.slice(0, pk.start) + ' ' + after.slice(pk.end) : after;   // ตัด "โลละ 40 ตัว" ออกก่อนหาราคา
    const perKgPrice = /(กิโล|โล)ละ(\d+(\.\d+)?)บาท/.exec(after);
    const price = /(ราคา|ค่า)?(\d+(\.\d+)?)บาท|ราคา(\d+(\.\d+)?)/.exec(after2);
    const kgBought = kgInfo ? kgInfo.kg : g.unit === 'กรัม' ? q.n / 1000 : g.unit === 'กก.' ? q.n : 0;
    const cost = perKgPrice && kgBought ? Math.round(parseFloat(perKgPrice[2]) * kgBought) : price ? parseFloat(price[2] || price[4]) : 0;
    const kgTxt = kgInfo ? ` (${Math.round(kgInfo.kg * 10) / 10} กิโล โลละ ${kgInfo.per})` : '';
    const extra = kgInfo ? { kg: kgInfo.kg, ...(kgInfo.said ? { perKg: kgInfo.per } : {}) } : {};
    const word = before + rest.slice(0, m[0].length);
    let kind = null;
    if (/(รับ|เติม|ซื้อ|เข้า|ได้|มา|เพิ่ม)/.test(word) && !/(เหลือ|เสีย|ทิ้ง|นับ)/.test(word)) kind = 'in';
    else if (/(เสีย|ทิ้ง|บูด|เน่า|หมดอายุ|ตก|หก)/.test(word)) kind = 'waste';
    else if (/(เหลือ|นับ|นับได้|มีอยู่|คงเหลือ)/.test(word)) kind = 'count';
    if (!kind) return null;
    const amt = qtyTxt(q.n, g.unit);
    const now = g.stock;
    if (kind === 'in') {
      return { kind: 'stock-move', confirm: true, ing: g,
        ask: `รับ${g.name} ${amt}${kgTxt}${cost ? ` ${Math.round(cost)} บาท` : ''} ใช่ไหมคะ`,
        say: `รับ${g.name}แล้วค่ะ เหลือ ${qtyTxt((now || 0) + q.n, g.unit)}`,
        calls: [{ path: '/api/stock/move', body: { id: g.id, kind: 'in', qty: q.n, cost, ...extra } }],
        undo: [{ path: '/api/stock/move', body: { id: g.id, kind: 'adjust', delta: -q.n, note: 'ย้อนกลับรับของ' } }] };
    }
    if (kind === 'waste') {
      return { kind: 'stock-move', confirm: true, ing: g, ask: `${g.name}เสีย ${amt}${kgTxt} ตัดออกจากสต๊อก ใช่ไหมคะ`, say: `ตัด${g.name} ${amt}แล้วค่ะ`,
        calls: [{ path: '/api/stock/move', body: { id: g.id, kind: 'waste', qty: q.n, ...extra } }],
        undo: [{ path: '/api/stock/move', body: { id: g.id, kind: 'adjust', delta: q.n, note: 'ย้อนกลับของเสีย' } }] };
    }
    const diff = now != null ? q.n - now : null;
    const gap = diff != null && Math.abs(diff) >= Math.max(1, Math.abs(now) * 0.05) ? ` ${diff < 0 ? 'น้อยกว่า' : 'มากกว่า'}ในระบบ ${qtyTxt(Math.abs(diff), g.unit)}` : '';
    return { kind: 'stock-move', confirm: true, ing: g, ask: `นับ${g.name}ได้ ${amt}${kgTxt}${gap} ตั้งตามนี้ใช่ไหมคะ`, say: `ตั้ง${g.name}เป็น ${amt}แล้วค่ะ`,
      calls: [{ path: g.tracked ? '/api/stock/move' : '/api/stock/setup', body: g.tracked ? { id: g.id, kind: 'count', qty: q.n, ...extra } : { id: g.id, stock: q.n, ...(extra.perKg ? { perKg: extra.perKg } : {}) } }],
      undo: g.tracked ? [{ path: '/api/stock/move', body: { id: g.id, kind: 'count', qty: now, note: 'ย้อนกลับการนับ' } }] : [{ path: '/api/stock/setup', body: { id: g.id, track: false } }] };
  }
  function sayLow(st) {
    const low = (st.list || []).filter(x => x.low).sort((a, b) => a.stock - b.stock);
    const soon = (st.list || []).filter(x => x.tracked && !x.low && x.daysLeft != null && x.daysLeft < 1.5);
    if (!low.length && !soon.length) return (st.list || []).some(x => x.tracked) ? 'ยังไม่มีอะไรใกล้หมดค่ะ' : 'ยังไม่ได้นับสต๊อกวัตถุดิบเลยค่ะ ลองพูดว่า กุ้งเหลือ 2 กิโล';
    const parts = [];
    if (low.length) parts.push((low.some(x => x.out) ? 'หมดหรือใกล้หมด ' : 'ใกล้หมด ') + low.map(x => `${x.name} ${x.out ? 'หมดแล้ว' : 'เหลือ ' + qtyTxt(x.stock, x.unit)}`).join(', '));
    if (soon.length) parts.push('พอใช้ไม่ถึงพรุ่งนี้ ' + soon.map(x => x.name).join(', '));
    return parts.join(' · ') + ' ค่ะ';
  }
  function sayIng(st, id) {
    const g = (st.list || []).find(x => x.id === id);
    if (!g) return 'ไม่เจอวัตถุดิบนี้ค่ะ';
    if (!g.tracked) return `${g.name}ยังไม่ได้นับสต๊อกค่ะ บอกได้เลยว่าเหลือเท่าไร เช่น ${g.name}เหลือ 2 ${g.unit === 'กรัม' ? 'กิโล' : g.unit}`;
    let t = `${g.name}เหลือ ${qtyTxt(g.stock, g.unit)}`;
    if (g.daysLeft != null) t += ` ใช้ได้อีกประมาณ ${g.daysLeft} วัน`;
    if (g.tomorrow) t += g.stock >= g.tomorrow ? ' พอสำหรับพรุ่งนี้' : ` พรุ่งนี้น่าจะใช้ ${qtyTxt(g.tomorrow, g.unit)} ไม่พอ`;
    return t + ' ค่ะ';
  }
  function sayBuy(st) {
    if (!(st.list || []).some(x => x.tracked)) return 'ยังไม่ได้นับสต๊อกวัตถุดิบเลยค่ะ นับก่อนแล้วน้องจะคิดรายการซื้อให้';
    const buy = (st.list || []).filter(x => x.tracked && x.toBuy > 0);
    if (!buy.length) return 'ของที่นับสต๊อกไว้พอสำหรับพรุ่งนี้แล้วค่ะ ไม่ต้องซื้อเพิ่ม';
    return 'ต้องซื้อ ' + buy.map(x => `${x.name} ${qtyTxt(roundBuy(x.toBuy, x.unit), x.unit)}`).join(', ') + (st.hasLine ? ' จะให้ส่งเข้าไลน์ร้าน พูดว่า ส่งรายการซื้อของเข้าไลน์' : '') + ' ค่ะ';
  }
  function sayLoss(st) {
    const g = (st.gap7 || []).filter(x => x.d < 0);
    if (!g.length) return 'เจ็ดวันที่ผ่านมายังไม่มีของหายหรือของเสียที่บันทึกไว้ค่ะ';
    const list = st.list || [];
    return 'เจ็ดวันที่ผ่านมา ของเสียหรือหาย ' + g.map(x => { const i = list.find(y => y.id === x.id) || {}; const v = i.cost ? ` ประมาณ ${Math.round(-x.d * i.cost)} บาท` : '';
      return `${x.name} ${qtyTxt(-x.d, i.unit)}${v}`; }).join(', ') + ' ค่ะ';
  }
  function sayCost(st, word) {
    const ds = st.dishes || [];
    if (!ds.length) return 'ยังคิดต้นทุนต่อจานไม่ได้ค่ะ ต้องมีราคาวัตถุดิบก่อน รับของพร้อมบอกราคา หรือถ่ายรูปบิลซื้อของ';
    const w = norm(word || '');
    const hit = w.length >= 2 ? ds.filter(d => norm(d.name).includes(w) || w.includes(norm(d.name))) : [];
    if (hit.length) return hit.slice(0, 3).map(d => `${d.name} ต้นทุนวัตถุดิบ ${Math.round(d.cost)} บาท ขาย ${d.price} กำไรขั้นต้น ${Math.round(d.margin)} บาท (ต้นทุน ${d.pct}%)`).join(' · ') + ' ค่ะ';
    const hi = ds.filter(d => d.pct >= 40).slice(0, 3);
    return `คิดต้นทุนได้ ${ds.length} เมนู` + (hi.length ? ` · ต้นทุนสูงเกิน 40% ${hi.map(d => `${d.name} ${d.pct}%`).join(', ')} ควรพิจารณาขึ้นราคาหรือลดปริมาณ` : ' · ทุกเมนูต้นทุนไม่เกิน 40%') + ' ค่ะ';
  }

  // ---------- เข้าใจคำถามผู้จัดการ ----------
  /** → {kind:'mgr', topic, need:[...endpoints]} · {kind:'menu-off'|'menu-on', ...} · null = ไม่ใช่เรื่องผู้จัดการ */
  function parse(text, ctx) {
    ctx = ctx || {};
    const c = L.norm(text);
    if (!c) return null;
    const si = stockIntent(c, ctx.stock);
    if (si) return si;
    const mi = menuIntent(c, ctx.menu || [], ctx.ingredients, ctx.optionNames);
    if (mi) {
      // "กุ้งหมด" + กุ้งนับสต๊อกอยู่ → ตั้งสต๊อกเป็น 0 ไปพร้อมกัน
      const w = /^(.+?)(หมดแล้ว|หมด|ไม่มีแล้ว)$/.exec(c);
      const g = w && ((ctx.stock && ctx.stock.list) || []).find(x => x.tracked && x.stock > 0 && norm(x.name) === w[1]);
      if (g && mi.kind === 'menu-off') {
        mi.calls.push({ path: '/api/stock/move', body: { id: g.id, kind: 'count', qty: 0, note: 'บอกว่าหมด' } });
        mi.undo.push({ path: '/api/stock/move', body: { id: g.id, kind: 'count', qty: g.stock, note: 'ย้อนกลับ' } });
        mi.ask = mi.ask.replace(/ ใช่ไหมคะ$/, ` และตั้งสต๊อก${g.name}เป็นศูนย์ ใช่ไหมคะ`);
      }
      return mi;
    }
    const T = (topic, need, extra) => ({ kind: 'mgr', topic, need, ...extra });
    if (/(เมนูไหนปิด|ปิดอยู่|เมนูที่ปิด|อะไรหมดบ้าง|ของหมดอะไร|หมดอะไรบ้าง)/.test(c)) return T('closed', ['state']);
    if (/(สรุป(ยอด)?สัปดาห์|อาทิตย์นี้|สัปดาห์นี้)/.test(c)) return T('week', ['line-week']);
    if (/(สรุป(ยอด)?เดือน|เดือนที่แล้ว)/.test(c)) return T('month-text', ['line-month']);
    if (/(สรุปวันนี้|สรุปยอดวันนี้|สรุปยอด$|ปิดร้าน|ปิดยอด|รายงานวันนี้|สรุปทั้งวัน)/.test(c)) return T('day', ['line-day']);
    if (/(คุ้มทุน|เดือนนี้|กำไร|ขาดทุน|ต้องขายวันละ)/.test(c)) return T('month', ['breakeven']);
    if (/(พรุ่งนี้|เตรียมของ|ต้องเตรียม|เตรียมอะไร|ซื้อของ|วัตถุดิบ|สั่งของ|ตลาด)/.test(c)) return T('tomorrow', ['forecast']);
    if (/(อาทิตย์หน้า|สัปดาห์หน้า|วันไหนยุ่ง|วันไหนเงียบ)/.test(c)) return T('week-ahead', ['forecast']);
    if (/(ขายดี|ขายได้เยอะ|ยอดนิยม|ขายไม่ดี|ขายไม่ออก|เมนูไหนขาย)/.test(c)) return T('top', ['report'], { worst: /(ไม่ดี|ไม่ออก)/.test(c) });
    if (/(ครัวช้า|ครัวเร็ว|ทำเร็วไหม|ทำช้า|เวลาครัว|ใช้เวลาทำ)/.test(c)) return T('speed', ['report']);
    if (/(ยกเลิกวันนี้|ยกเลิกกี่|ยกเลิกเยอะ)/.test(c)) return T('cancel', ['report']);
    if (/(ยอด|ขายได้|รายได้|ได้เงิน|เงินเข้า|กี่บิล|ลูกค้ากี่|เป้า|คาดว่าจะขาย|โต๊ะเปิด|ค้างจ่าย|ยังไม่จ่าย)/.test(c)) return T('today', ['pace']);
    return null;
  }

  // ---------- ข้อความตอบ ----------
  function sayToday(p, money) {
    if (!p) return 'ดูยอดไม่ได้ค่ะ';
    const parts = [];
    parts.push(money ? `วันนี้ขายได้ ${baht(p.actual)} ${p.bills} บิล` : `วันนี้ ${p.bills} บิล`);
    if (p.pace != null) parts.push(p.pace >= 0 ? `ดีกว่าที่คาด ${p.pace}%` : `ต่ำกว่าที่คาด ${-p.pace}%`);
    if (money && p.projected) parts.push(`คาดปิดวันประมาณ ${baht(p.projected)}`);
    if (p.lastWeekNow && money) {
      const d = p.lastWeekNow ? Math.round((p.actual / p.lastWeekNow - 1) * 100) : null;
      if (d != null && Math.abs(d) >= 5) parts.push(`${d > 0 ? 'มากกว่า' : 'น้อยกว่า'}${'วัน' + TH_DAY[new Date(p.date + 'T00:00:00').getDay()]}ที่แล้วช่วงเดียวกัน ${Math.abs(d)}%`);
    }
    if (p.openTables) parts.push(`เปิดอยู่ ${p.openTables} โต๊ะ${money ? ` รอเก็บ ${baht(p.openDue)}` : ''}`);
    return parts.join(' · ') + ' ค่ะ';
  }
  function sayMonth(b, money) {
    if (!b) return 'ดูยอดเดือนไม่ได้ค่ะ';
    if (!b.be) return money ? `เดือนนี้ขายแล้ว ${baht(b.soldNow)} คาดทั้งเดือน ${baht(b.projected)} ยังไม่ได้ตั้งค่าใช้จ่ายคงที่ที่หลังร้าน เลยคิดจุดคุ้มทุนไม่ได้ค่ะ` : 'ยังไม่ได้ตั้งค่าใช้จ่ายคงที่ที่หลังร้านค่ะ';
    if (!money) return b.soldNow >= b.be ? 'เดือนนี้ถึงจุดคุ้มทุนแล้วค่ะ' : `เดือนนี้ยังไม่ถึงจุดคุ้มทุนค่ะ ดูตัวเลขบนจอนะคะ`;
    const L2 = [`เดือนนี้ขายแล้ว ${baht(b.soldNow)} จุดคุ้มทุน ${baht(b.be)}`];
    if (b.soldNow >= b.be) L2.push('ถึงจุดคุ้มทุนแล้ว');
    else if (b.need) L2.push(`ต้องขายเฉลี่ยวันละ ${baht(b.need)} อีก ${b.leftDays} วัน${b.cross ? ` คาดว่าถึงวันที่ ${+b.cross.slice(8)}` : ''}`);
    if (b.profit != null) L2.push(`คาดกำไรทั้งเดือนประมาณ ${baht(b.profit)}`);
    return L2.join(' · ') + ' ค่ะ';
  }
  function dayFc(fc, k) { return fc && (fc.days || []).find(d => d.date === k); }
  function sayTomorrow(fc, now, money, full) {
    const k = dayKey(now, 1), f = dayFc(fc, k);
    if (!f || f.none) return 'ยังพยากรณ์พรุ่งนี้ไม่ได้ค่ะ ข้อมูลยังไม่พอ';
    if (f.closed) return 'พรุ่งนี้ร้านปิดค่ะ';
    const parts = [`พรุ่งนี้วัน${TH_DAY[f.dow ?? new Date(k + 'T00:00:00').getDay()]} ${money ? `คาดขาย ${baht(f.sales)} ` : ''}ประมาณ ${f.dishes} จาน`];
    if (f.tag === 'busy') parts.push(`ยุ่งกว่าปกติ ${Math.abs(f.pct)}%`);
    if (f.tag === 'quiet') parts.push(`เงียบกว่าปกติ ${Math.abs(f.pct)}%`);
    if (f.wx && f.wx.prob != null && f.wx.prob >= 50) parts.push(`ฝนมีโอกาสตก ${f.wx.prob}%`);
    if (f.peak && f.peak.from != null) parts.push(`ช่วงยุ่ง ${f.peak.from} นาฬิกา ถึง ${f.peak.to + 1} นาฬิกา`);
    const prep = (f.prep && f.prep.length ? f.prep : (f.items || []).slice(0, 6)).slice(0, full ? 10 : 5);
    if (prep.length) parts.push('เตรียม ' + prep.map(p => `${p.name} ${p.hi > p.qty ? p.hi : p.qty}`).join(', '));
    if (f.use && f.use.length) parts.push('วัตถุดิบ ' + f.use.slice(0, full ? 10 : 4).map(u => `${u.name} ${amt(u.hi > u.qty ? u.hi : u.qty, u.unit)}`).join(', '));
    return parts.join(' · ') + ' ค่ะ';
  }
  function amt(q, unit) {
    if (unit === 'กรัม' && q >= 1000) return `${Math.round(q / 100) / 10} กิโล`;
    if (unit === 'มล.' && q >= 1000) return `${Math.round(q / 100) / 10} ลิตร`;
    if (['กรัม', 'กก.', 'มล.', 'ลิตร'].includes(unit)) return `${q >= 10 ? Math.round(q) : Math.round(q * 10) / 10} ${unit.replace('กก.', 'กิโล').replace('มล.', 'มิลลิลิตร')}`;
    return `${Math.ceil(q - 0.05)} ${unit}`;
  }
  function sayWeekAhead(fc, now, money) {
    const days = (fc && fc.days || []).filter(d => !d.none && !d.closed);
    if (!days.length) return 'ยังพยากรณ์สัปดาห์หน้าไม่ได้ค่ะ';
    const busy = days.filter(d => d.tag === 'busy'), quiet = days.filter(d => d.tag === 'quiet');
    const top = days.slice().sort((a, b) => b.sales - a.sales)[0];
    const dn = d => 'วัน' + TH_DAY[d.dow ?? new Date(d.date + 'T00:00:00').getDay()];
    const parts = [`7 วันข้างหน้า ขายดีสุด${dn(top)}${money ? ` ประมาณ ${baht(top.sales)}` : ''}`];
    if (busy.length) parts.push('ยุ่ง ' + busy.map(dn).join(', '));
    if (quiet.length) parts.push('เงียบ ' + quiet.map(dn).join(', '));
    return parts.join(' · ') + ' ค่ะ';
  }
  function itemsOf(r) { return ((r && r.summary && r.summary.items_list) || []).filter(x => x.qty > 0); }
  function sayTop(r, worst) {
    const it = itemsOf(r);
    if (!it.length) return 'วันนี้ยังไม่มีบิลที่ปิดค่ะ';
    const s = it.slice().sort((a, b) => worst ? a.qty - b.qty : b.qty - a.qty || b.amount - a.amount).slice(0, 5);
    return `${worst ? 'ขายได้น้อยสุดวันนี้' : 'ขายดีวันนี้'} ` + s.map((x, i) => `${i + 1} ${x.name} ${x.qty} จาน`).join(', ') + ' ค่ะ';
  }
  function avgMin(t) { return t && t.n ? Math.round(t.sum / t.n * 10) / 10 : null; }
  function saySpeed(r) {
    const c = r && r.summary && r.summary.cook;
    if (!c || !c.n) return 'วันนี้ยังไม่มีข้อมูลเวลาครัวค่ะ';
    const slow = Object.entries(c.items || {}).map(([n, x]) => ({ n, a: x.sum / x.n, c: x.n })).filter(x => x.c >= 2).sort((a, b) => b.a - a.a).slice(0, 3);
    const in15 = Math.round(((c.b[0] || 0) + (c.b[1] || 0)) / c.n * 100);
    return `วันนี้ครัวเฉลี่ย ${avgMin(c)} นาทีต่อจาน เสร็จใน 15 นาที ${in15}%` + (slow.length ? ` · ช้าสุด ${slow.map(x => `${x.n} ${Math.round(x.a)} นาที`).join(', ')}` : '') + ' ค่ะ';
  }
  function sayCancel(r, money) {
    const s = r && r.summary;
    if (!s || !s.cancelled || !s.cancelled.qty) return 'วันนี้ยังไม่มียกเลิกค่ะ';
    return `วันนี้ยกเลิก ${s.cancelled.qty} จาน${money ? ` ${baht(s.cancelled.amount)}` : ''}${s.voids && s.voids.bills ? ` ยกเลิกทั้งโต๊ะ ${s.voids.bills} โต๊ะ` : ''} ค่ะ`;
  }
  /** สรุปแบบ LINE → พูดได้ (ตัดอีโมจิ/สัญลักษณ์) และย่อ */
  function speakable(text, maxLines) {
    const lines = String(text || '').split('\n').map(l => l.replace(/[\u{1F300}-\u{1FAFF}☀-➿️]/gu, '').replace(/▲\s*/g, 'เพิ่ม ').replace(/▼\s*/g, 'ลด ').replace(/[•⚠]/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(l => l && !/^ความแม่น/.test(l));
    return lines.slice(1, maxLines || 12).join(' · ').replace(/฿/g, 'บาท').replace(/×/g, '').replace(/~/g, 'ประมาณ ');
  }
  function sayClosed(state) {
    const off = ((state && state.menu) || []).filter(m => m.available === false);
    return off.length ? `ปิดอยู่ ${off.length} เมนู ${listNames(off)} ค่ะ` : 'ไม่มีเมนูที่ปิดอยู่ค่ะ';
  }

  /** ตอบคำถามผู้จัดการจากข้อมูลที่โหลดมาแล้ว d = {pace, breakeven, forecast, report, state, 'line-day', ...} */
  function answer(q, d, opt) {
    opt = opt || {};
    const money = opt.money !== false, now = opt.now || Date.now();
    switch (q.topic) {
      case 'today': return sayToday(d.pace, money);
      case 'month': return sayMonth(d.breakeven, money);
      case 'tomorrow': return sayTomorrow(d.forecast, now, money, true);
      case 'week-ahead': return sayWeekAhead(d.forecast, now, money);
      case 'top': return sayTop(d.report, q.worst);
      case 'speed': return saySpeed(d.report);
      case 'cancel': return sayCancel(d.report, money);
      case 'closed': return sayClosed(d.state);
      case 'low': return sayLow(d.stock || {});
      case 'ing': return sayIng(d.stock || {}, q.id);
      case 'buy': return sayBuy(d.stock || {});
      case 'loss': return sayLoss(d.stock || {});
      case 'cost': return sayCost(d.stock || {}, q.word);
      case 'day': return money ? speakable(d['line-day'], 9) + ' ค่ะ' : 'สรุปวันนี้อยู่บนจอค่ะ';
      case 'week': return money ? speakable(d['line-week'], 8) + ' ค่ะ' : 'สรุปสัปดาห์อยู่บนจอค่ะ';
      case 'month-text': return money ? speakable(d['line-month'], 8) + ' ค่ะ' : 'สรุปเดือนอยู่บนจอค่ะ';
    }
    return 'ไม่แน่ใจค่ะ';
  }

  // ---------- แจ้งเตือนแบบผู้จัดการ (เทียบรอบก่อน) ----------
  /**
   * @param s  สถานะที่จำไว้ (แก้ในฟังก์ชันนี้) {day, said:{}, lastPaceAt, lastBacklogAt, cancelStep}
   * @param d  {pace, breakeven, report, orders, now}
   * @param o  ตั้งค่า {pace, paceDrop, milestone, backlog, backlogN, cancel, money, lateMin}
   * @returns ข้อความที่จะพูด []
   */
  function alerts(s, d, o) {
    const out = [], now = d.now || Date.now(), today = dayKey(now), money = o.money !== false;
    if (s.day !== today) { s.day = today; s.said = {}; s.lastPaceAt = 0; s.lastBacklogAt = 0; s.cancelStep = null; s.first = true; }
    const p = d.pace;
    const once = (k, msg) => { if (!s.said[k]) { s.said[k] = 1; if (!s.first) out.push(msg); } };
    if (p && !p.closed && !p.none) {
      if (o.pace && p.pace != null && p.expected >= 1500 && p.pace <= -(o.paceDrop || 25) && now - (s.lastPaceAt || 0) > 90 * 60000) {
        s.lastPaceAt = now;
        if (!s.first) out.push(`ยอดตอนนี้ต่ำกว่าที่คาด ${-p.pace}%${money ? ` ขายได้ ${baht(p.actual)} ควรได้ประมาณ ${baht(p.expected)}` : ''} ถามน้องได้ว่าควรทำอะไร`);
      }
      if (o.milestone && p.forecast && p.actual >= p.forecast) once('fc', `เยี่ยมเลย วันนี้ขายทะลุยอดที่คาดแล้ว${money ? ` ${baht(p.actual)}` : ''}`);
      if (o.milestone && p.high && p.actual >= p.high) once('hi', 'วันนี้ขายดีกว่าที่คาดไว้สูงสุดแล้ว เช็กของในครัวว่าพอไหมด้วย');
    }
    const b = d.breakeven;
    if (o.milestone && b && b.be && b.soldNow >= b.be) {
      const k = 'be-' + b.month;
      if (!s.said[k]) { s.said[k] = 1; if (!s.first && b.soldNow - (p ? p.actual : 0) < b.be) out.push(`เดือนนี้ถึงจุดคุ้มทุนแล้ว ต่อจากนี้เป็นกำไร`); }
    }
    if (o.backlog && d.orders) {
      const all = L.pendingDishes(d.orders), qty = all.reduce((a, x) => a + (x.quantity || 1), 0);
      const oldest = d.orders.length ? Math.max(...d.orders.map(x => L.mins(now, x.order_at))) : 0;
      if ((qty >= (o.backlogN || 12) || oldest >= (o.lateMin || 15) * 1.6) && now - (s.lastBacklogAt || 0) > 20 * 60000) {
        s.lastBacklogAt = now;
        const g = L.groups(d.orders).filter(x => x.tables.length > 1).slice(0, 2);
        if (!s.first) out.push(`ครัวค้าง ${qty} จาน รอนานสุด ${oldest} นาที` + (g.length ? ` แนะนำทำรวม ${g.map(x => `${x.name} ${x.qty}`).join(', ')}` : '') + ' ถ้ายุ่งมากปิดเมนูที่ทำนานชั่วคราวได้');
      }
    }
    if (o.stock && d.stock && d.stock.list) {
      for (const x of d.stock.list) {
        if (!x.tracked) continue;
        const st = x.out ? 'out' : x.low ? 'low' : 'ok', k = 'stk-' + x.id, prev = s.said[k];
        if (prev === undefined) { s.said[k] = st; continue; }   // เห็นครั้งแรก: จำไว้ ไม่พูด
        if (st !== prev) {
          s.said[k] = st;
          if (st === 'out') out.push(`${x.name}หมดสต๊อกแล้ว`);
          else if (st === 'low' && prev === 'ok') out.push(`${x.name}ใกล้หมด เหลือ ${qtyTxt(x.stock, x.unit)}`);
        }
      }
    }
    if (o.cancel && d.report && d.report.summary) {
      const q = (d.report.summary.cancelled || {}).qty || 0, step = Math.floor(q / 5);
      if (s.cancelStep == null) s.cancelStep = step;
      else if (step > s.cancelStep) { s.cancelStep = step; out.push(`วันนี้ยกเลิกไปแล้ว ${q} จาน ลองดูว่ายกเลิกเพราะอะไร`); }
    }
    s.first = false;
    return out;
  }

  /** ข้อมูลย่อสำหรับให้ AI ช่วยคิด (ไม่ส่งข้อมูลลูกค้า) */
  function aiContext(d, money) {
    const p = d.pace, b = d.breakeven, f = d.forecast && dayFc(d.forecast, dayKey(Date.now(), 1));
    const hide = n => money ? n : undefined;
    return {
      today: p ? { sales: hide(p.actual), bills: p.bills, expected_now: hide(p.expected), pace_pct: p.pace, projected_close: hide(p.projected),
        forecast_day: hide(p.forecast), last_week_same_time: hide(p.lastWeekNow), open_tables: p.openTables, weather: p.wx || undefined } : undefined,
      month: b ? { sold: hide(b.soldNow), breakeven: hide(b.be), need_per_day: hide(b.need), days_left: b.leftDays, projected_profit: hide(b.profit),
        food_cost_pct: b.foodPct, last_month_sales: hide(b.lastMonth && b.lastMonth.sales) } : undefined,
      top_today: itemsOf(d.report).sort((a, x) => x.qty - a.qty).slice(0, 10).map(x => ({ name: x.name, qty: x.qty, amount: hide(x.amount) })),
      kitchen_today: d.report && d.report.summary && d.report.summary.cook && d.report.summary.cook.n ? { avg_min: avgMin(d.report.summary.cook) } : undefined,
      cancelled_today: d.report && d.report.summary ? (d.report.summary.cancelled || {}).qty : undefined,
      tomorrow: f && !f.none ? { closed: f.closed, sales: hide(f.sales), dishes: f.dishes, tag: f.tag, pct_vs_normal: f.pct, weather: f.wx,
        prep: (f.prep || []).slice(0, 10).map(x => ({ name: x.name, qty: x.qty, max: x.hi })),
        ingredients: (f.use || []).slice(0, 10).map(u => ({ name: u.name, qty: Math.round(u.qty), unit: u.unit })) } : undefined,
      menus_closed: ((d.state && d.state.menu) || []).filter(m => m.available === false).map(m => m.name),
      stock: d.stock && d.stock.list && d.stock.list.some(x => x.tracked) ? d.stock.list.map(x => ({ id: x.id, name: x.name, unit: x.unit,
        on_hand: x.tracked ? x.stock : 'ไม่ได้นับ', low: x.low || undefined, per_day: x.perDay || undefined, tomorrow_need: x.tomorrow || undefined,
        to_buy: x.toBuy || undefined, cost_per_unit: x.cost || undefined, cost_change_pct: x.cost && x.costPrev ? Math.round((x.cost / x.costPrev - 1) * 100) : undefined })) : undefined,
      dish_cost: d.stock && d.stock.dishes && d.stock.dishes.length ? d.stock.dishes.slice(0, 20).map(x => ({ name: x.name, price: x.price, cost: x.cost, cost_pct: x.pct })) : undefined,
    };
  }

  const api = { parse, answer, alerts, aiContext, menusFor, menuIntent, menuCalls, speakable, sayToday, sayMonth, sayTomorrow, dayKey, listNames,
    stockIntent, readQty, shopListText, qtyTxt, roundBuy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KitchenManager = api;
})(this);
