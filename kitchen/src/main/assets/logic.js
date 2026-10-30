/*
 * ผู้ช่วยครัว — ส่วนเข้าใจคำพูด (ไม่ใช้ AI · ทำงานในเครื่อง)
 * รับข้อความที่ระบบฟังเสียงได้ยิน + ออเดอร์ค้างจากจอครัว (GET /api/orders) → บอกว่าจะพูดอะไร/ทำอะไร
 * ไฟล์นี้ไม่แตะหน้าจอหรือเครือข่าย ทดสอบด้วย node ได้ (node test-logic.js)
 */
(function (root) {
  'use strict';

  const TH_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
  const DEFAULT_WAKE = ['น้องมาม่า', 'น้องมามา', 'น้องม่าม้า', 'น้องหม่าม้า', 'น้องมาม๊า', 'น้องมะม่า', 'น้องมาร์ม่า', 'น้องหมาม่า'];

  /** ตัดช่องว่าง/เครื่องหมาย เลขไทย→อารบิก ตัวเล็ก */
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[๐-๙]/g, d => String(TH_DIGITS.indexOf(d)))
      .replace(/(\d),(\d{3})/g, '$1$2')          // 1,000 → 1000
      .replace(/(\d)\.(\d)/g, '$1\u2396$2')       // เก็บทศนิยม 2.5 (กิโลครึ่ง ฯลฯ) ไว้ก่อนตัดเครื่องหมาย
      .replace(/[\s\u200b.,!?'"“”()\-–—:;/]+/g, '')
      .replace(/\u2396/g, '.');
  }

  // ---------- ตัวเลข ----------
  const NUMW = [['ศูนย์', 0], ['หนึ่ง', 1], ['เอ็ด', 1], ['สอง', 2], ['ยี่', 2], ['สาม', 3], ['สี่', 4], ['ห้า', 5],
    ['หก', 6], ['เจ็ด', 7], ['แปด', 8], ['เก้า', 9]];
  function digitWord(s, i) {
    for (const [w, n] of NUMW) if (s.startsWith(w, i)) return { n, len: w.length };
    return null;
  }
  /** อ่านตัวเลขที่ตำแหน่ง i (เลข หรือคำ เช่น สาม สิบสอง ยี่สิบเอ็ด) → {n, len} */
  function readNumber(s, i) {
    const m = /^\d+/.exec(s.slice(i));
    if (m) return { n: parseInt(m[0], 10), len: m[0].length };
    let j = i, tens = 0, d = digitWord(s, j);
    if (s.startsWith('สิบ', j)) { tens = 1; j += 3; }
    else if (d && s.startsWith('สิบ', j + d.len)) { tens = d.n; j += d.len + 3; }
    if (tens) {
      const u = digitWord(s, j);
      return u && u.n > 0 ? { n: tens * 10 + u.n, len: j + u.len - i } : { n: tens * 10, len: j - i };
    }
    if (d && !s.startsWith('ยี่', j)) return { n: d.n, len: d.len };   // "ยี่" เดี่ยวๆ ไม่ใช่ตัวเลข
    return null;
  }

  // ชื่อตัวอักษรอังกฤษที่ระบบฟังมักเขียนเป็นไทย (โต๊ะ A1 → "เอ 1")
  const LETTERS = [['เอ', 'a'], ['บี', 'b'], ['ซี', 'c'], ['ดี', 'd'], ['อี', 'e'], ['เอฟ', 'f'], ['วี', 'v']];

  /** หาโต๊ะ/คิวกลับบ้านในคำพูด → {kind:'table'|'ta', key, raw, start, end} */
  function findTable(c) {
    const re = /(โต๊ะ|โต้ะ|โต๊|โตะ|table|คิว|กลับบ้าน|ห่อกลับ|ห่อ|takeaway|ta)(ที่|เบอร์|หมายเลข|no)?/g;
    let m;
    while ((m = re.exec(c))) {
      let i = m.index + m[0].length, prefix = '';
      const lat = /^[a-z]/.exec(c.slice(i));
      if (lat && /\d/.test(c[i + 1] || '')) { prefix = lat[0]; i += 1; }
      else for (const [th, en] of LETTERS) {
        if (c.startsWith(th, i) && (/\d/.test(c[i + th.length] || '') || readNumber(c, i + th.length))) { prefix = en; i += th.length; break; }
      }
      const num = readNumber(c, i);
      if (!num) continue;
      const kind = /คิว|กลับบ้าน|ห่อ|takeaway|^ta/.test(m[1]) ? 'ta' : 'table';
      return { kind, key: prefix + num.n, raw: c.slice(m.index, i + num.len), start: m.index, end: i + num.len };
    }
    return null;
  }

  function tableKey(o) {
    return o.order_type === 'takeaway' ? norm(o.pick_up_code) : norm(o.table_num);
  }
  function tableLabel(o) {
    return o.order_type === 'takeaway' ? `กลับบ้าน ${o.pick_up_code}` : `โต๊ะ ${o.table_num}`;
  }
  /** ออเดอร์ที่ตรงกับโต๊ะที่พูด (ตรงทุกตัว ก่อน · ถ้าพูดแค่เลข ให้เทียบเฉพาะตัวเลขของชื่อโต๊ะ) */
  function matchOrders(orders, t) {
    const pool = orders.filter(o => (t.kind === 'ta') === (o.order_type === 'takeaway'));
    let hit = pool.filter(o => tableKey(o) === t.key);
    if (!hit.length && /^\d+$/.test(t.key)) hit = pool.filter(o => tableKey(o).replace(/\D/g, '') === t.key);
    if (!hit.length) {   // พูดว่าโต๊ะ แต่จริงๆ เป็นคิวกลับบ้าน (หรือกลับกัน)
      hit = orders.filter(o => tableKey(o) === t.key);
    }
    return hit;
  }

  // ---------- ชื่อเมนู ----------
  function lcs(a, b) {   // ความยาวส่วนที่เหมือนกันยาวที่สุด (ต่อเนื่อง)
    let best = 0;
    const prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      let diag = 0;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
        if (prev[j] > best) best = prev[j];
        diag = tmp;
      }
    }
    return best;
  }

  // คำสั่ง/คำลงท้าย · ตัดเฉพาะที่หัวหรือท้ายข้อความ (ตัดกลางคำไม่ได้ เช่น "มี" อยู่ใน "บะหมี่")
  const FILLER = '(?:ครับผม|ครับ|คับ|ค่ะ|คะ|ค่า|จ้า|จ้ะ|นะ|หน่อย|ด้วย|แล้ว|ล่ะ|เลย|ไหม|มั้ย|หรือยัง|ยัง|ของ|ที่|มี|อยู่|ค้าง|เหลือ|ต้องทำ|ทั้งหมด|ทุกโต๊ะ|ทุกจาน|หมดเลย|หมด|ทั้งโต๊ะ|เสร็จ|เรียบร้อย|ออกแล้ว|ส่งแล้ว|เสิร์ฟ|ทำแล้ว|กี่จาน|กี่ที่|กี่อัน|กี่ชุด|กี่ถ้วย|กี่ชาม|กี่แก้ว|กี่|เท่าไหร่|เท่าไร|จาน|อัน|ชุด|ถ้วย|ชาม|รายการ|เมนู|อะไรบ้าง|อะไร|บ้าง|สั่ง|ทำ|รวม|ขอ|ดู|บอก|ช่วย|เช็ค|เช็ก|\\d+)';
  const HEAD = new RegExp('^' + FILLER), TAIL = new RegExp(FILLER + '$');

  function trimFiller(s) {
    let prev;
    do { prev = s; s = s.replace(HEAD, '').replace(TAIL, ''); } while (s !== prev && s);
    return s;
  }

  /** ตัดคำสั่ง/คำลงท้ายออก เหลือคำที่น่าจะเป็นชื่อเมนู */
  function dishPhrase(c, table) {
    const parts = table ? [c.slice(0, table.start), c.slice(table.end)] : [c];
    return parts.map(trimFiller).filter(w => w.length >= 2).sort((a, b) => b.length - a.length)[0] || '';
  }

  /** จานที่ตรงกับคำ (เทียบชื่อ + ตัวเลือก เช่น "กะเพราหมู" ตรงกับ ผัดกะเพรา (หมูสับ))
   *  1) คำที่พูดอยู่ในชื่อ/ตัวเลือก  2) ชื่อเมนูเต็มอยู่ในประโยค  3) คล้ายกัน (ระบบฟังเพี้ยนบางตัว) */
  function matchDishes(dishes, phrase, full) {
    const hay = d => norm(d.name + (d.extra_option || []).join(''));
    if (phrase) {
      const inName = dishes.filter(d => hay(d).includes(phrase) || phrase.includes(norm(d.name)));
      if (inName.length) return inName;
    }
    if (full) {
      const exact = dishes.filter(d => norm(d.name).length >= 2 && full.includes(norm(d.name)));
      if (exact.length) {
        const longest = Math.max(...exact.map(d => norm(d.name).length));
        return exact.filter(d => norm(d.name).length === longest);
      }
    }
    if (!phrase || phrase.length < 3) return [];
    const scored = dishes.map(d => {
      const l = Math.max(lcs(phrase, norm(d.name)), lcs(phrase, hay(d)));
      return { d, score: l >= Math.max(3, Math.ceil(phrase.length * 0.7)) ? l / phrase.length : 0 };
    }).filter(x => x.score > 0);
    if (!scored.length) return [];
    const best = Math.max(...scored.map(x => x.score));
    return scored.filter(x => x.score >= best - 0.05).map(x => x.d);
  }

  // ---------- สรุปออเดอร์ ----------
  function pendingDishes(orders) {
    const out = [];
    for (const o of orders) for (const d of o.pending_dishes || []) out.push({ ...d, order: o });
    return out;
  }

  /** ทำรวม: จานชื่อเดียวกันจากทุกโต๊ะ (เนื้อสัตว์ต่างกันก็รวม แล้วบอกแยกตัวเลือก) */
  function groups(orders) {
    const map = new Map();
    for (const d of pendingDishes(orders)) {
      let g = map.get(d.name);
      if (!g) map.set(d.name, g = { name: d.name, qty: 0, tables: [], opts: new Map(), alerts: 0, first: d.at || d.order.order_at, dishes: [] });
      g.qty += d.quantity || 1;
      g.dishes.push(d);
      const lab = tableLabel(d.order);
      if (!g.tables.includes(lab)) g.tables.push(lab);
      const opt = (d.extra_option || []).join(' ').trim();
      if (opt) g.opts.set(opt, (g.opts.get(opt) || 0) + (d.quantity || 1));
      if (/⚠/.test(d.remark || '')) g.alerts++;
      g.first = Math.min(g.first, d.at || d.order.order_at);
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty || a.first - b.first);
  }

  const say = s => s.replace(/⚠\s*/g, 'ระวัง ').replace(/\s*·\s*/g, ' ').replace(/\s+/g, ' ').trim();
  function dishText(d, withNote) {
    const opt = (d.extra_option || []).join(' ');
    let t = `${d.name}${opt ? ' ' + opt : ''} ${d.quantity || 1}`;
    if (withNote && d.remark) t += ` (${d.remark})`;
    return t;
  }
  const mins = (now, t) => Math.max(0, Math.round((now - t) / 60000));
  /** ["โต๊ะ 3","โต๊ะ 5","กลับบ้าน 7"] → "โต๊ะ 3, 5 และ กลับบ้าน 7" */
  function listTables(arr) {
    const t = arr.filter(l => l.startsWith('โต๊ะ ')).map(l => l.slice(5));
    const ta = arr.filter(l => !l.startsWith('โต๊ะ ')).map(l => l.replace(/^กลับบ้าน /, ''));
    const parts = [];
    if (t.length) parts.push('โต๊ะ ' + t.join(', '));
    if (ta.length) parts.push('กลับบ้าน ' + ta.join(', '));
    return parts.join(' และ ');
  }

  function replyPending(orders) {
    if (!orders.length) return 'ตอนนี้ไม่มีออเดอร์ค้างค่ะ';
    const gs = groups(orders);
    const top = gs.slice(0, 6).map(g => `${g.name} ${g.qty}`).join(', ');
    const more = gs.length > 6 ? ` และอีก ${gs.length - 6} เมนู` : '';
    return `ค้าง ${orders.length} ออเดอร์ค่ะ ${top}${more}`;
  }
  function replyTable(o) {
    const ds = o.pending_dishes || [];
    if (!ds.length) return `${tableLabel(o)} ไม่มีจานค้างค่ะ`;
    return `${tableLabel(o)} ค้าง ${ds.length} รายการค่ะ ` + ds.map(d => dishText(d, true)).join(', ');
  }

  // ---------- เข้าใจคำสั่ง ----------
  /** หาชื่อเรียก → {woke, rest} rest = คำสั่งหลังชื่อ (ข้อความดิบ ไม่ตัดช่องว่าง) */
  function findWake(text, wakeWords) {
    const words = (wakeWords && wakeWords.length ? wakeWords : DEFAULT_WAKE).map(norm).filter(Boolean);
    const raw = String(text || '');
    const n = norm(raw);
    let best = -1, len = 0;
    for (const w of words) {
      const i = n.indexOf(w);
      if (i >= 0 && (best < 0 || i < best)) { best = i; len = w.length; }
    }
    if (best < 0) return { woke: false, rest: '' };
    // ตัดส่วนที่เป็นชื่อเรียกออกจากข้อความดิบ (นับเฉพาะตัวอักษรที่ norm เก็บไว้)
    let count = 0, k = 0;
    const target = best + len;
    while (k < raw.length && count < target) { if (norm(raw[k])) count++; k++; }
    return { woke: true, rest: raw.slice(k).trim() };
  }

  // ---------- คำเฉพาะร้าน ----------
  /** "กพ = กะเพรา" ทีละบรรทัด → [[กพ, กะเพรา]] (ยาวก่อน) */
  function parseWords(txt) {
    return String(txt || '').split(/\n|;/).map(l => l.split(/=|→|>/)).filter(p => p.length === 2)
      .map(([f, t]) => [norm(f), norm(t)]).filter(([f, t]) => f && t && f !== t).sort((a, b) => b[0].length - a[0].length);
  }
  function applyWords(c, words) {
    for (const [f, t] of words || []) c = c.split(f).join(t);
    return c;
  }

  // ---------- ทำต่อไป (ทีละชุด) ----------
  /** จานที่ควรทำรอบถัดไป: เมนูของจานที่รอนานสุด รวมทุกโต๊ะที่สั่งเมนูเดียวกัน (ไม่เกิน max จาน เรียงตามที่รอนาน) */
  function nextBatch(orders, max) {
    const all = pendingDishes(orders).map(d => ({ ...d, t: d.at || d.order.order_at }));
    if (!all.length) return null;
    all.sort((a, b) => a.t - b.t);
    const name = all[0].name;
    const pick = [];
    let qty = 0;
    for (const d of all) {
      if (d.name !== name) continue;
      if (qty && max && qty + (d.quantity || 1) > max) break;
      pick.push(d); qty += d.quantity || 1;
    }
    return { name, qty, dishes: pick };
  }
  /** "ผัดกะเพรา 3 จาน: หมูสับ ไข่ดาว 2 โต๊ะ 3, ไก่ 1 โต๊ะ 5 ระวัง โต๊ะ 3 แพ้ถั่ว" */
  function batchText(b) {
    const parts = new Map();
    for (const d of b.dishes) {
      const k = (d.extra_option || []).join(' ') || 'ธรรมดา';
      const p = parts.get(k) || { n: 0, t: [] };
      p.n += d.quantity || 1;
      const lab = tableLabel(d.order);
      if (!p.t.includes(lab)) p.t.push(lab);
      parts.set(k, p);
    }
    const detail = [...parts].map(([k, p]) => `${k} ${p.n} ${listTables(p.t)}`).join(', ');
    const notes = b.dishes.filter(d => d.remark).map(d => `${tableLabel(d.order)} ${d.remark}`);
    return say(`${b.name} ${b.qty} จาน: ${detail}${notes.length ? ' · ' + notes.join(' · ') : ''}`);
  }
  function doneDishes(dishes) {
    return {
      calls: dishes.map(d => ({ path: '/api/dish/complete', body: { order_id: d.order.id, dishes_id: d.id } })),
      undo: dishes.map(d => ({ path: '/api/dish/complete', body: { order_id: d.order.id, dishes_id: d.id, status: 'pending' } })),
    };
  }

  // ---------- จับเวลา ----------
  /** "จับเวลา 4 นาที ของทอด" / "ตั้งเวลา 90 วิ" / "นาทีครึ่ง" → {sec, label} */
  function parseTimer(c) {
    const m = /(จับเวลา|ตั้งเวลา|เตือนอีก|เตือนในอีก|นับเวลา|timer)/.exec(c);
    if (!m) return null;
    let rest = c.slice(m.index + m[0].length), sec = 0, i = 0, label = rest;
    if (rest.startsWith('ครึ่งนาที')) { sec = 30; i = 9; }
    else {
      const n = readNumber(rest, 0);
      if (n) {
        i = n.len;
        const u = /^(ชั่วโมง|ชม|นาที|นาฑี|วินาที|วิ|min|sec|s)/.exec(rest.slice(i));
        const unit = u ? u[1] : 'นาที';
        if (u) i += u[1].length;
        sec = /ชั่วโมง|ชม/.test(unit) ? n.n * 3600 : /วิ|sec|^s$/.test(unit) ? n.n : n.n * 60;
        if (rest.startsWith('ครึ่ง', i)) { sec += /วิ/.test(unit) ? 0 : 30; i += 5; }
      } else if (rest.startsWith('นาทีครึ่ง')) { sec = 90; i = 9; }
    }
    if (!sec) return { sec: 0 };
    label = rest.slice(i).replace(/^(สำหรับ|ให้|ที่)/, '').replace(/(ค่ะ|ครับ|นะ|หน่อย|ด้วย)+$/, '');
    return { sec: Math.min(sec, 4 * 3600), label };
  }
  const fmtSec = s => s >= 60 ? `${Math.floor(s / 60)} นาที${s % 60 ? ' ' + (s % 60) + ' วินาที' : ''}` : `${s} วินาที`;

  const YES = /^(ใช่|ช่าย|ใช่ค่ะ|ใช่ครับ|ถูก|ถูกต้อง|ตกลง|โอเค|โอเคร|ok|okay|ยืนยัน|เอาเลย|เอา|ได้เลย|ได้|จัดไป|เยส|yes)/;
  const NO = /^(ไม่|ม่าย|ยกเลิก|ไม่ใช่|ไม่เอา|ผิด|no)/;

  /**
   * ตีความคำสั่ง
   * @param text   คำสั่ง (ตัดชื่อเรียกออกแล้ว)
   * @param orders ออเดอร์ค้างจาก /api/orders
   * @param ctx    {now, awaitingConfirm, screen, words: parseWords(), batch: nextBatch() ที่บอกล่าสุด, batchMax, name}
   * @returns {kind, say, confirm?, calls?, undo?, highlight?}
   *   calls/undo = [{path, body}] (POST) · confirm = ต้องถามยืนยันก่อนทำ
   */
  function interpret(text, orders, ctx) {
    ctx = ctx || {};
    const now = ctx.now || Date.now();
    const screen = ctx.screen || '';
    const c = applyWords(norm(text), ctx.words);
    orders = orders || [];
    const name = ctx.name || 'น้องมาม่า';

    if (ctx.awaitingConfirm) {
      if (YES.test(c)) return { kind: 'yes' };
      if (NO.test(c)) return { kind: 'no', say: 'ยกเลิกแล้วค่ะ' };
    }
    if (!c) return { kind: 'wake' };
    if (ctx.ringing && /^(รับทราบ|โอเค|ok|ได้|ทราบ|รู้แล้ว|หยุด|พอ|ปิด)/.test(c)) return { kind: 'ack' };

    // ----- จับเวลา -----
    if (/(ยกเลิก|หยุด|ลบ|ปิด)(การ)?(จับเวลา|ตั้งเวลา|นาฬิกา|เวลา)/.test(c)) return { kind: 'timer-cancel', label: c.replace(/.*(จับเวลา|ตั้งเวลา|นาฬิกา|เวลา)/, '') };
    if (/(เหลือ(อีก)?กี่นาที|เวลาเหลือ|เหลือเวลา|จับเวลาอะไรอยู่)/.test(c)) return { kind: 'timer-status' };
    const tm = parseTimer(c);
    if (tm) return tm.sec ? { kind: 'timer', sec: tm.sec, label: tm.label, say: `จับเวลา ${fmtSec(tm.sec)}${tm.label ? ' ' + tm.label : ''} ค่ะ` }
      : { kind: 'ask', say: 'จับเวลากี่นาทีคะ เช่น จับเวลา 4 นาที ของทอด' };

    if (/^(หยุด|เงียบ|พอแล้ว|พอ|stop)/.test(c)) return { kind: 'stop' };
    if (/(พูดอีกที|พูดใหม่|ทวน|อีกรอบ|ว่าไงนะ|อะไรนะ|ไม่ได้ยิน)/.test(c)) return { kind: 'repeat' };
    if (/(ย้อนกลับ|เอาคืน|เรียกกลับ|ยกเลิกเสร็จ|undo|กดผิด|ยังไม่เสร็จ)/.test(c)) return { kind: 'undo' };
    if (/(ทำอะไรได้|ช่วยอะไรได้|ใช้ยังไง|ใช้งานยังไง|วิธีใช้|สั่งอะไรได้)/.test(c)) {
      return { kind: 'help', say: `เรียก ${name} แล้วพูดได้เลยค่ะ เช่น ต่อไป, เสร็จ, ค้างอะไรบ้าง, โต๊ะ 3 สั่งอะไร, กะเพรากี่จาน, โต๊ะ 3 เสร็จ, จับเวลา 4 นาที, ย้อนกลับ` };
    }

    const table = findTable(c);
    const all = pendingDishes(orders);
    const phrase = dishPhrase(c, table);
    const done = /(เสร็จ|เรียบร้อย|ออกแล้ว|ส่งแล้ว|เสิร์ฟแล้ว|ทำแล้ว)/.test(c) && !/(เสร็จ|เรียบร้อย)(หรือ)?ยัง/.test(c);

    // ----- ทำอะไรต่อ: บอกชุดที่ควรผัดรอบถัดไป (เมนูเดียวกันหลายโต๊ะรวมกัน) -----
    if (/^(ต่อไป|ถัดไป|อันต่อไป|จานต่อไป|ชุดต่อไป|next)|(ทำอะไรต่อ|ทำอะไรดี|ทำอะไรก่อน|อันไหนก่อน|ทำอันไหน|ต้องทำอะไร$)/.test(c) && !done) {
      const b = nextBatch(orders, ctx.batchMax || 0);
      if (!b) return { kind: 'next', say: 'ไม่มีออเดอร์ค้างค่ะ', batch: null };
      return { kind: 'next', batch: b, highlight: { orders: [...new Set(b.dishes.map(d => d.order.id))], dishes: b.dishes.map(d => d.id) },
        say: 'ต่อไป ' + batchText(b) + ' ค่ะ' };
    }

    if (/(รอนาน|นานสุด|นานที่สุด|โต๊ะไหนก่อน|คิวแรก|ช้าสุด)/.test(c) && !done) {
      if (!orders.length) return { kind: 'oldest', say: 'ตอนนี้ไม่มีออเดอร์ค้างค่ะ' };
      const o = orders.slice().sort((a, b) => a.order_at - b.order_at)[0];
      return { kind: 'oldest', highlight: { orders: [o.id] },
        say: say(`รอนานสุด ${tableLabel(o)} รอ ${mins(now, o.order_at)} นาทีค่ะ ` + (o.pending_dishes || []).map(d => dishText(d, true)).join(', ')) };
    }

    // ----- เสร็จ -----
    if (done) {
      let hits = table ? matchOrders(orders, table) : orders;
      if (table && !hits.length) return { kind: 'notfound', say: `ไม่เจอ${table.kind === 'ta' ? 'คิวกลับบ้าน ' : 'โต๊ะ '}${table.key} ในรายการค้างค่ะ` };
      const dishes = phrase ? matchDishes(all.filter(d => hits.includes(d.order)), phrase, c) : [];
      if (phrase && !dishes.length && !table) return { kind: 'notfound', say: `ไม่เจอ ${phrase} ในรายการค้างค่ะ` };

      if (dishes.length) {
        const tables = [...new Set(dishes.map(d => d.order))];
        const everyTable = /(ทุกโต๊ะ|ทั้งหมด|หมดเลย|ทุกจาน)/.test(c);
        if (!table && tables.length > 1 && !everyTable) {
          return { kind: 'ask', highlight: { orders: tables.map(o => o.id) },
            say: `${dishes[0].name} มี ${tables.length} ที่ คือ ${listTables(tables.map(tableLabel))} บอกเลขโต๊ะ หรือพูดว่า ${dishes[0].name}เสร็จทุกโต๊ะ ค่ะ` };
        }
        const qty = dishes.reduce((s, d) => s + (d.quantity || 1), 0);
        const where = listTables(tables.map(tableLabel));
        return {
          kind: 'done-dish', confirm: true, highlight: { orders: tables.map(o => o.id), dishes: dishes.map(d => d.id) },
          ask: `${dishes[0].name} ${qty} จาน ${where} เสร็จ ใช่ไหมคะ`,
          say: `เรียบร้อย ${dishes[0].name} ${where} เสร็จแล้วค่ะ`,
          ...doneDishes(dishes),
        };
      }
      if (!table) {
        // พูดแค่ "เสร็จ" หลังถาม "ต่อไป" = ชุดที่บอกล่าสุด (เฉพาะจานที่ยังค้าง)
        const live = ctx.batch ? all.filter(d => ctx.batch.dishes.some(x => x.id === d.id)) : [];
        if (live.length) {
          const qty = live.reduce((s2, d) => s2 + (d.quantity || 1), 0);
          const where = listTables([...new Set(live.map(d => tableLabel(d.order)))]);
          return { kind: 'done-dish', confirm: true, batchDone: true, highlight: { orders: live.map(d => d.order.id), dishes: live.map(d => d.id) },
            ask: `${live[0].name} ${qty} จาน ${where} เสร็จ ใช่ไหมคะ`, say: `เรียบร้อย ${live[0].name} ${qty} จาน เสร็จแล้วค่ะ`, ...doneDishes(live) };
        }
        return { kind: 'ask', say: 'เสร็จโต๊ะไหนคะ บอกเลขโต๊ะด้วยค่ะ' };
      }
      if (hits.length > 1) return { kind: 'ask', say: `มี ${hits.length} ออเดอร์ที่ตรงกับ ${table.key} ค่ะ ดูบนจอแล้วกดเองนะคะ`, highlight: { orders: hits.map(o => o.id) } };
      const o = hits[0];
      const ds = o.pending_dishes || [];
      return {
        kind: 'done-table', confirm: true, highlight: { orders: [o.id] },
        ask: `${tableLabel(o)} เสร็จทั้งโต๊ะ ${ds.length} รายการ ใช่ไหมคะ`,
        say: `เรียบร้อย ${tableLabel(o)} เสร็จแล้วค่ะ`,
        calls: [{ path: '/api/order/complete', body: { order_id: o.id, screen } }],
        undo: [
          ...ds.map(d => ({ path: '/api/dish/complete', body: { order_id: o.id, dishes_id: d.id, status: 'pending' } })),
          { path: '/api/order/complete', body: { order_id: o.id, screen, status: 'pending' } },
        ],
      };
    }

    // ----- ถาม -----
    if (table) {
      const hits = matchOrders(orders, table);
      if (!hits.length) return { kind: 'notfound', say: `${table.kind === 'ta' ? 'คิวกลับบ้าน' : 'โต๊ะ'} ${table.key} ไม่มีจานค้างค่ะ` };
      if (phrase) {
        const ds = matchDishes(all.filter(d => hits.includes(d.order)), phrase, c);
        if (ds.length) return { kind: 'count', highlight: { orders: hits.map(o => o.id), dishes: ds.map(d => d.id) },
          say: say(`${tableLabel(hits[0])} มี ` + ds.map(d => dishText(d, true)).join(', ') + ' ค่ะ') };
      }
      return { kind: 'table', highlight: { orders: hits.map(o => o.id) }, say: say(hits.map(replyTable).join(' ')) };
    }

    if (phrase) {
      const ds = matchDishes(all, phrase, c);
      if (ds.length) {
        const qty = ds.reduce((s, d) => s + (d.quantity || 1), 0);
        const tables = [...new Set(ds.map(d => tableLabel(d.order)))];
        const names = [...new Set(ds.map(d => d.name))];
        const opts = new Map();
        for (const d of ds) { const k = (d.extra_option || []).join(' '); if (k) opts.set(k, (opts.get(k) || 0) + (d.quantity || 1)); }
        const optTxt = opts.size > 1 ? ' แยกเป็น ' + [...opts].map(([k, n]) => `${k} ${n}`).join(', ') : '';
        return { kind: 'count', highlight: { orders: [...new Set(ds.map(d => d.order.id))], dishes: ds.map(d => d.id) },
          say: `${names.length === 1 ? names[0] : phrase} ค้าง ${qty} จาน ที่ ${listTables(tables)}${optTxt} ค่ะ` };
      }
      if (/(กี่|เท่าไร|เท่าไหร่)/.test(c) || /^มี/.test(c)) return { kind: 'notfound', say: `ไม่เจอ ${phrase} ในรายการค้างค่ะ` };
    }

    if (/(ค้าง|เหลือ|ต้องทำ|มีอะไร|รออะไร|ทำรวม|รวมจาน|ออเดอร์|สรุป|งาน)/.test(c)) {
      // มีคำอื่นที่ไม่รู้จักปนอยู่ (เช่น "โต๊ะริมหน้าต่างเหลืออะไร") → vague: ถ้ามี AI ให้ AI ตอบแทน
      return { kind: 'pending', say: replyPending(orders), vague: phrase.length >= 3 };
    }
    return { kind: 'unknown', say: 'ไม่แน่ใจค่ะ ลองพูดว่า ค้างอะไรบ้าง หรือ โต๊ะ 3 เสร็จ' };
  }

  const api = { norm, readNumber, findTable, findWake, matchDishes, dishPhrase, groups, interpret, tableLabel, mins, DEFAULT_WAKE,
    parseWords, nextBatch, batchText, doneDishes, parseTimer, fmtSec, pendingDishes, listTables, say };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KitchenLogic = api;
})(this);
