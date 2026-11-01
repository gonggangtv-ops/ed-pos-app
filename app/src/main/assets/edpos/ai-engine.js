/*
 * ED POS — ผู้ช่วย AI ฝั่งเซิร์ฟเวอร์ (Gemini) · test-1.63
 * คีย์เก็บใน data.settings.ai.key (หน้าเว็บไม่เห็นคีย์ · ซิงก์ไปเครื่องสำรองพร้อมข้อมูลร้าน)
 *   ask()      ถามเรื่องยอดขาย: AI เรียกเครื่องมือดูข้อมูลร้านเองหลายรอบ (function calling) แล้วตอบ + กราฟเล็ก (ถ้ามี)
 *   summary()  สรุปร้านช่วงวันที่: ส่งตัวเลขที่คำนวณแล้วให้ AI เขียนบทวิเคราะห์ (ครั้งเดียว · จำผลไว้จนยอดเปลี่ยน)
 *   forecast() ปรับพยากรณ์ 7 วันด้วยวันหยุด/เทศกาล/อีเวนต์/ฤดูท่องเที่ยว (ค้นเว็บด้วย Google Search ถ้ารุ่นรองรับ)
 *   lineNote() ย่อหน้าสั้นต่อท้ายสรุป LINE รายวัน/สัปดาห์
 * ทุกอย่างอ่านข้อมูลอย่างเดียว ไม่แก้ข้อมูลร้าน
 * ทดสอบ: kitchen/test/test-ai-server.js (Gemini ปลอมผ่าน EDPOS_GEMINI_URL)
 */
'use strict';
const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];
const BASE = process.env.EDPOS_GEMINI_URL || 'https://generativelanguage.googleapis.com';
const WD = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

module.exports = function createAI(d) {
  // d = { data(), dayKey, addDays, buildReport, paceToday, forecastWeek, breakEven, usageReport, dishCosts, weatherInfo, lineTextOf }
  const cfg = () => ({ key: '', model: '', line: false, ...(d.data().settings.ai || {}) });
  const mem = { model: '', lastErr: '', calls: 0, day: '' };
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const r1 = n => n == null ? undefined : Math.round(n * 10) / 10;

  // ---------- เรียก Gemini ----------
  async function call(model, body, ms) {
    const key = cfg().key;
    if (!key) { const e = new Error('ยังไม่ได้ใส่ API key ที่หลังร้าน › AI'); e.code = 'nokey'; throw e; }
    let r, text;
    try {
      r = await fetch(`${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms || 60000) });
      text = await r.text();
    } catch (e) { const x = new Error(e.name === 'TimeoutError' ? 'AI ตอบช้าเกินไป ลองใหม่อีกที' : 'ติดต่อ AI ไม่ได้ (เครื่องหลักต่อเน็ตหรือยัง?)'); x.code = 'net'; throw x; }
    let j = null; try { j = JSON.parse(text); } catch {}
    if (r.status !== 200) {
      const msg = (j && j.error && j.error.message) || text.slice(0, 200);
      const e = new Error(r.status === 429 ? 'ใช้ AI ครบโควตาแล้ว รอสักพักหรือพรุ่งนี้' : r.status === 400 && /API key/i.test(msg) ? 'API key ไม่ถูกต้อง'
        : r.status === 401 || r.status === 403 ? 'API key ใช้ไม่ได้ (ตรวจคีย์อีกครั้ง)'
        : r.status === 503 || r.status === 500 || r.status === 504 ? 'AI ของ Google มีคนใช้เยอะชั่วคราว ลองใหม่อีกสักครู่' : `AI ตอบกลับ ${r.status}: ${msg}`);
      e.status = r.status; e.raw = msg; throw e;
    }
    const c = j && j.candidates && j.candidates[0];
    if (!c || !c.content) { const e = new Error(j && j.promptFeedback ? 'AI ไม่ยอมตอบคำถามนี้' : 'AI ไม่ได้ตอบอะไรกลับมา'); e.status = 200; throw e; }
    const today = d.dayKey(Date.now()); if (mem.day !== today) { mem.day = today; mem.calls = 0; } mem.calls++;
    return { parts: c.content.parts || [], content: c.content, grounding: c.groundingMetadata, finish: c.finishReason || '' };
  }
  // รุ่นนี้ไม่มี/เลิกแล้ว (ไม่ใช่ "ฟีเจอร์นี้ใช้ไม่ได้" เช่น ค้นเว็บ ซึ่งต้องให้คนเรียกจัดการเอง)
  const gone = e => e.status === 404 || (e.status === 400 && /models\/\S+ is not found|not supported for generateContent|is not available/i.test(e.raw || ''));
  // รุ่นนี้ไม่ว่าง (503/500/504 คนใช้เยอะ) หรือโควตาของรุ่นนี้หมด (429 · แบบฟรีนับโควตาแยกรุ่น) → ลองรุ่นอื่น
  const busy = e => [429, 500, 503, 504].includes(e.status);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  /** ลองรุ่นตามลำดับ (รุ่นที่ใช้ได้ล่าสุดก่อน) · รุ่นเลิกแล้ว/ไม่ว่าง/โควตาหมด → รุ่นถัดไป · ไม่ว่าง (503) ลองซ้ำรุ่นเดิม 1 ครั้งก่อน */
  async function gen(body, ms) {
    const c = cfg();
    const first = c.model || mem.model;
    const list = first ? [first, ...MODELS.filter(m => m !== first)] : MODELS;
    let last, busyHit = null;
    for (const m of list) {
      for (let tryN = 0; tryN < 2; tryN++) {
        try { const r = await call(m, body, ms); mem.model = m; mem.lastErr = ''; return r; }
        catch (e) {
          last = e;
          if (e.status === 503 && tryN === 0) { await wait(1500); continue; }   // ไม่ว่างชั่วคราว → รอแล้วลองรุ่นเดิมอีกครั้ง
          break;
        }
      }
      if (busy(last)) { busyHit = busyHit || last; continue; }
      if (!gone(last)) break;
    }
    if (busyHit && (!last || gone(last) || busy(last))) last = busyHit;   // ทุกรุ่นไม่ว่าง/หมดโควตา → บอกสาเหตุนั้น
    mem.lastErr = last ? last.message : 'error';
    throw last;
  }
  const textOf = parts => parts.filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
  // อ่าน JSON จากคำตอบ: ทนกับ ```json, ข้อความนำหน้า/ต่อท้าย, เลขอ้างอิง [1] จากการค้นเว็บ, จุลภาคเกินท้าย
  function jsonOf(t) {
    t = String(t || '').replace(/```(?:json)?/gi, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    const core = t.slice(a, b + 1);
    for (const x of [core, core.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, ''), core.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').replace(/,\s*([}\]])/g, '$1')]) {
      try { return JSON.parse(x); } catch {}
    }
    return null;
  }
  /**
   * ขอคำตอบแบบ JSON ให้ได้: ลองครั้งแรก → ถูกตัดกลางคัน (AI คิดยาวจนหมดโควตาคำ) ลองใหม่ 1 ครั้ง
   * → ยังอ่านไม่ได้ ส่งข้อความเดิมให้ AI จัดเป็น JSON (ไม่ค้นเว็บ ไม่เพิ่มข้อมูล)
   */
  async function genJSON(body, ok, shape) {
    let r = await gen(body), j = jsonOf(textOf(r.parts));
    if (ok(j)) return { r, j };
    if (r.finish === 'MAX_TOKENS' || !textOf(r.parts)) {
      const b2 = { ...body, generationConfig: { ...(body.generationConfig || {}), maxOutputTokens: 24000 } };
      const r2 = await gen(b2), j2 = jsonOf(textOf(r2.parts));
      if (ok(j2)) return { r: { ...r2, grounding: r2.grounding || r.grounding }, j: j2 };
      if (textOf(r2.parts)) r = { ...r2, grounding: r2.grounding || r.grounding };
    }
    const raw = textOf(r.parts);
    if (raw) {
      const fx = await gen({ contents: [{ role: 'user', parts: [{ text: `จัดข้อความด้านล่างให้เป็น JSON ที่ถูกต้องตามรูปแบบนี้ (ห้ามเพิ่มข้อมูลใหม่ ถ้าข้อความถูกตัดกลางคัน ให้ปิดโครงสร้างให้ครบ):\n${shape}\n\n----\n${raw.slice(0, 20000)}` }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 16000, responseMimeType: 'application/json' } });
      const j3 = jsonOf(textOf(fx.parts));
      if (ok(j3)) return { r, j: j3 };
    }
    const e = new Error('AI ตอบไม่ครบหรือไม่เป็นรูปแบบที่อ่านได้ ลองกดอีกครั้ง (ถ้าเป็นบ่อย ลองตั้งรุ่น AI เป็น gemini-flash-latest)'); e.code = 'format'; mem.lastErr = e.message; throw e;
  }

  // ---------- ข้อมูลร้านแบบย่อ ----------
  function sales(from, to) {
    const r = d.buildReport(from, to), s = r.summary || {}, p = r.prev || {}, items = (s.items_list || []).filter(x => x.qty > 0);
    const prevQty = name => { const v = p.items && p.items[name]; return typeof v === 'number' ? v : v && typeof v.qty === 'number' ? v.qty : undefined; };
    let daily = (r.days || []).filter(x => x.bills).map(x => ({ date: x.date, wd: WD[new Date(x.date + 'T00:00:00').getDay()], bills: x.bills, sales: x.subtotal, dishes: x.dishes }));
    if (daily.length > 62) {
      const m = {}; for (const x of daily) { const k = x.date.slice(0, 7); const a = (m[k] ||= { month: k, days: 0, bills: 0, sales: 0 }); a.days++; a.bills += x.bills; a.sales += x.sales; }
      daily = Object.values(m);
    }
    return { from: r.from, to: r.to, days_with_sales: (r.days || []).filter(x => x.bills).length,
      sales: s.subtotal, payments_count: s.bills, avg_per_payment: s.bills ? Math.round(s.subtotal / s.bills) : 0, dishes: s.dishes, card_fee: s.fee || undefined, by_method: s.byMethod,
      prev_period: p.from ? { from: p.from, to: p.to, sales: p.subtotal, payments_count: p.bills, dishes: p.dishes, partial_until_hour: p.partial ?? undefined } : undefined,
      daily, sales_by_hour: s.byHour, categories: s.cats,
      top_items: [...items].sort((a, b) => b.qty - a.qty).slice(0, 25).map(x => ({ name: x.name, qty: x.qty, amount: x.amount, prev_qty: prevQty(x.name) })),
      slow_items: [...items].sort((a, b) => a.qty - b.qty).slice(0, 10).map(x => ({ name: x.name, qty: x.qty })),
      cancelled_dishes: s.cancelled, voided_tables: s.voids, staff: s.staff_list,
      kitchen_avg_min: s.cook && s.cook.n ? r1(s.cook.sum / s.cook.n) : undefined, table_avg_min: s.sit && s.sit.n ? r1(s.sit.sum / s.sit.n) : undefined,
      takeaway: s.ta, customer_kind: s.kind, note: 'payments_count นับแต่ละครั้งที่จ่ายเงิน (โต๊ะที่แยกจ่ายนับหลายครั้ง)' };
  }
  const strip = (o, drop) => JSON.parse(JSON.stringify(o, (k, v) => drop.includes(k) ? undefined : v));
  function usage(from, to) {
    const u = d.usageReport(from, to);
    return { from: u.from, to: u.to, days: u.days, list: u.list.filter(x => x.total > 0).map(x => ({ name: x.name, unit: x.unit, used: x.total, per_day: x.perDay,
      cost_baht: x.cost ? Math.round(x.total * x.cost) : undefined, price_per_unit: x.cost || undefined, from_menus: x.by.slice(0, 8) })),
      not_used: u.list.filter(x => !x.total).map(x => x.name) };
  }
  function cap(o, max) {
    let s = JSON.stringify(o);
    const shrink = v => Array.isArray(v) ? v.slice(0, Math.max(3, Math.floor(v.length / 2))).map(shrink)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shrink(x)])) : v;
    for (let i = 0; i < 6 && s.length > max; i++) { o = shrink(o); s = JSON.stringify(o); }
    return s.length > max ? { note: 'ข้อมูลยาวเกิน ตัดบางส่วน', data: s.slice(0, max) } : o;
  }

  // ---------- เครื่องมือให้ AI เรียก ----------
  const S = desc => ({ type: 'string', description: desc });
  const RANGE = { type: 'object', properties: { from: S('วันเริ่ม YYYY-MM-DD'), to: S('วันสุดท้าย YYYY-MM-DD') }, required: ['from', 'to'] };
  const TOOLS = [
    { name: 'get_sales', parameters: RANGE, description: 'ยอดขายช่วงวันที่ (สูงสุด 400 วัน, บิลที่ปิดแล้ว): ยอด จำนวนครั้งที่จ่าย จาน เทียบช่วงก่อนยาวเท่ากัน รายวัน รายชั่วโมง หมวด เมนูขายดี/ขายไม่ออก (เทียบช่วงก่อน) ยกเลิก พนักงาน เวลาครัว เวลานั่ง กลับบ้าน ราคาคนไทย/ต่างชาติ' },
    { name: 'get_today_live', description: 'วันนี้ตอนนี้: ยอดสะสมรายชั่วโมง เทียบที่คาดและสัปดาห์ที่แล้วช่วงเวลาเดียวกัน คาดปิดวัน โต๊ะเปิดอยู่' },
    { name: 'get_forecast', description: 'พยากรณ์ 7 วันข้างหน้า (สถิติร้าน + อากาศ): ยอด จาน เมนู ของที่ควรเตรียม และความแม่นของพยากรณ์ 14 วันที่ผ่านมา' },
    { name: 'get_month', description: 'เดือนนี้: ขายแล้ว จุดคุ้มทุน ค่าใช้จ่ายคงที่ % ต้นทุนอาหาร ต้องขายวันละเท่าไร คาดกำไร เทียบเดือนที่แล้ว' },
    { name: 'get_ingredient_usage', parameters: RANGE, description: 'วัตถุดิบที่ใช้ตามสูตรในช่วงวันที่ (ไม่ใช่สต๊อก): ปริมาณ ต้นทุน มาจากเมนูไหน' },
    { name: 'get_dish_cost', description: 'ต้นทุนวัตถุดิบต่อจาน (จากราคาต่อหน่วยที่ร้านใส่): ราคาขาย ต้นทุน กำไรขั้นต้น %' },
    { name: 'get_menu', description: 'รายการเมนู: ชื่อ หมวด ราคา ปิดขายอยู่ไหม' },
    { name: 'get_weather', description: 'อากาศ/ฝนวันนี้และวันถัดไป และผลของฝนต่อยอดขายที่ผ่านมา' },
    { name: 'respond', parameters: { type: 'object', required: ['answer'], properties: {
      answer: S('คำตอบภาษาไทย เขียนแบบรายงานสั้นอ่านง่าย ใช้ **ตัวหนา** และบรรทัดขึ้นต้นด้วย "- " เป็นข้อได้ ตัวเลขเงินใส่คอมมา'),
      chart: { type: 'object', description: 'กราฟประกอบ (ใส่เมื่อช่วยให้เข้าใจ เช่น เทียบรายวัน/รายเมนู) ไม่เกิน 14 ค่า', properties: {
        type: S('bar | line'), title: S('ชื่อกราฟ'), unit: S('หน่วย เช่น บาท จาน'),
        labels: { type: 'array', items: { type: 'string' } }, values: { type: 'array', items: { type: 'number' } } } },
      followups: { type: 'array', items: { type: 'string' }, description: 'คำถามต่อที่น่าถาม 2-3 ข้อ' } } },
      description: 'ตอบผู้ใช้ (เรียกครั้งสุดท้ายเสมอหลังดูข้อมูลพอแล้ว)' },
  ];
  const decls = only => TOOLS.filter(t => !only || only.includes(t.name)).map(({ name, description, parameters }) => parameters ? { name, description, parameters } : { name, description });
  function runTool(name, a) {
    a = a || {};
    const today = d.dayKey(Date.now());
    const range = () => { if (!ok(a.from) || !ok(a.to)) throw new Error('ใส่วันที่ from/to เป็น YYYY-MM-DD'); return a.from <= a.to ? [a.from, a.to] : [a.to, a.from]; };
    switch (name) {
      case 'get_sales': { const [f, t] = range(); return sales(f, t); }
      case 'get_today_live': return strip(d.paceToday(), ['series']);
      case 'get_forecast': return strip(d.forecastWeek(), ['hours', 'series']);
      case 'get_month': return strip(d.breakEven(), ['series']);
      case 'get_ingredient_usage': { const [f, t] = range(); return usage(f, t); }
      case 'get_dish_cost': return { dishes: d.dishCosts().slice(0, 80) };
      case 'get_menu': return { menu: d.data().menu.map(m => ({ name: m.name, cat: m.category, price: m.price, closed: m.available === false || undefined })) };
      case 'get_weather': return d.weatherInfo();
    }
    throw new Error('ไม่มีเครื่องมือนี้');
  }
  function context() {
    const s = d.data().settings, now = new Date(), today = d.dayKey(Date.now());
    return [
      `ร้าน: ${s.shopName || 'ร้านอาหารไทย'} (กรุงเทพฯ ลูกค้าส่วนใหญ่เป็นนักท่องเที่ยวต่างชาติ มีราคาคนไทยแยก) · ตัดรอบวันขายตี ${s.dayCutoff ?? 5}`,
      `วันนี้ (วันขาย) ${today} วัน${WD[new Date(today + 'T00:00:00').getDay()]} เวลา ${now.toTimeString().slice(0, 5)}`,
    ].join('\n');
  }

  // ---------- ถาม AI ----------
  async function ask(q, history) {
    q = String(q || '').trim().slice(0, 1000);
    if (!q) throw new Error('พิมพ์คำถามก่อน');
    const sys = [
      'คุณคือนักวิเคราะห์ธุรกิจร้านอาหารที่เก่งและพูดตรง ช่วยเจ้าของร้านเข้าใจยอดขายและตัดสินใจ',
      context(),
      'ใช้เครื่องมือดูข้อมูลจริงก่อนตอบเสมอ เรียกได้หลายครั้ง (ไม่เกิน 6 รอบ) เช่น ถามว่าทำไมยอดตก → ดูยอดช่วงนั้น เทียบช่วงก่อน ดูรายวัน/รายชั่วโมง/เมนู/อากาศ แล้วสรุปสาเหตุ',
      'ห้ามแต่งตัวเลข ใช้เฉพาะตัวเลขจากเครื่องมือ · ข้อมูลไม่พอให้บอกตรงๆ ว่าขาดอะไร · แยกให้ชัดว่าอะไรเป็นข้อเท็จจริง อะไรเป็นการคาดเดา',
      'ตอบเป็นภาษาไทย กระชับ เริ่มด้วยคำตอบตรงๆ 1-2 ประโยค ตามด้วยตัวเลขสำคัญและสิ่งที่ควรทำ 1-3 ข้อ · ถ้าข้อมูลเหมาะกับกราฟ (เทียบหลายวัน/หลายเมนู) ใส่ chart',
      'ร้านนี้ไม่ได้นับสต๊อกคงเหลือ มีแค่วัตถุดิบที่ใช้ตามสูตร',
      'จบด้วยการเรียก respond เสมอ',
    ].join('\n');
    const contents = [];
    for (const h of (Array.isArray(history) ? history : []).slice(-6)) {
      if (h && h.q && h.a) { contents.push({ role: 'user', parts: [{ text: String(h.q).slice(0, 1000) }] }, { role: 'model', parts: [{ text: String(h.a).slice(0, 3000) }] }); }
    }
    contents.push({ role: 'user', parts: [{ text: q }] });
    const used = [];
    for (let round = 0; round <= 6; round++) {
      const last = round === 6;
      const r = await gen({ systemInstruction: { parts: [{ text: sys }] }, contents, tools: [{ functionDeclarations: decls(last ? ['respond'] : null) }],
        toolConfig: { functionCallingConfig: { mode: 'ANY' } }, generationConfig: { temperature: 0.3, maxOutputTokens: 12000 } });
      const calls = r.parts.filter(p => p.functionCall).map(p => ({ name: p.functionCall.name, args: p.functionCall.args || {} }));
      const fin = calls.find(c => c.name === 'respond');
      if (fin) return { answer: String(fin.args.answer || '').trim(), chart: cleanChart(fin.args.chart), followups: (fin.args.followups || []).slice(0, 3).map(String), tools: used, model: mem.model };
      if (!calls.length) return { answer: textOf(r.parts) || 'AI ไม่ได้ตอบ ลองถามใหม่อีกครั้ง', tools: used, model: mem.model };
      contents.push(r.content);
      contents.push({ role: 'user', parts: calls.map(c => {
        used.push(c.name);
        let out; try { out = cap(runTool(c.name, c.args), 16000); } catch (e) { out = { error: e.message }; }
        return { functionResponse: { name: c.name, response: { result: out } } };
      }) });
    }
    throw new Error('AI วนดูข้อมูลไม่จบ ลองถามให้แคบลง');
  }
  function cleanChart(c) {
    if (!c || !Array.isArray(c.labels) || !Array.isArray(c.values)) return null;
    const n = Math.min(c.labels.length, c.values.length, 31);
    if (n < 2) return null;
    const values = c.values.slice(0, n).map(Number);
    if (values.some(v => !isFinite(v))) return null;
    return { type: c.type === 'line' ? 'line' : 'bar', title: String(c.title || '').slice(0, 80), unit: String(c.unit || '').slice(0, 20), labels: c.labels.slice(0, n).map(x => String(x).slice(0, 24)), values };
  }

  // ---------- สรุปร้าน (จำผลไว้จนยอดเปลี่ยน) ----------
  const cache = () => (d.data().aiCache ||= {});
  async function summary(from, to, force) {
    if (!ok(from) || !ok(to)) throw new Error('ช่วงวันที่ไม่ถูกต้อง');
    const s = sales(from, to);
    const sig = `${from}|${to}|${s.sales}|${s.payments_count}|${s.dishes}`;
    const c = cache();
    if (!force && c.summary && c.summary[sig]) return { ...c.summary[sig], cached: true };
    const today = d.dayKey(Date.now());
    const input = { period: { from, to, includes_today: to >= today }, sales: s, ingredients: usage(from, to), dish_cost_top: d.dishCosts().slice(0, 12),
      month: strip(d.breakEven(), ['series']), next_days: strip(d.forecastWeek(), ['hours', 'series', 'accuracy']).days?.slice(0, 3),
      today_live: to >= today ? strip(d.paceToday(), ['series']) : undefined };
    const sys = [
      'คุณคือที่ปรึกษาร้านอาหารมืออาชีพ อ่านตัวเลขของร้านแล้วเขียนบทวิเคราะห์ให้เจ้าของร้านอ่านเข้าใจใน 1 นาที',
      context(),
      'ใช้เฉพาะตัวเลขในข้อมูล ห้ามแต่ง · เทียบกับช่วงก่อน (prev_period) เสมอเมื่อมี · ถ้าช่วงนี้รวมวันนี้ที่ยังไม่ปิดร้าน ให้ระวังการเทียบ',
      'หาสาเหตุจริงของการเปลี่ยนแปลง (จำนวนลูกค้า vs ยอดต่อบิล vs เมนู vs ช่วงเวลา vs ราคาคนไทย/ต่างชาติ vs อากาศ) และให้คำแนะนำที่ทำได้จริงพรุ่งนี้',
      'ตอบ JSON เท่านั้น: {"headline": "ประโยคเดียวสรุปช่วงนี้", "tone": "up|down|flat", "story": "2-4 ประโยค เล่าว่าเกิดอะไรขึ้นและเพราะอะไร",',
      ' "good": [{"t": "หัวข้อสั้น", "d": "รายละเอียด+ตัวเลข"}], "watch": [...], "todo": [{"t": "สิ่งที่ควรทำ", "d": "ทำไม/ทำยังไง"}], "numbers": [{"label": "...", "value": "...", "note": "..."}] }',
      'good/watch/todo อย่างละ 1-4 ข้อ · numbers 3-4 ตัวเลขสำคัญที่สุด',
    ].join('\n');
    const { j } = await genJSON({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify(cap(input, 30000)) }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 12000, responseMimeType: 'application/json' } }, x => !!(x && x.headline),
      '{"headline": "...", "tone": "up|down|flat", "story": "...", "good": [{"t": "...", "d": "..."}], "watch": [...], "todo": [...], "numbers": [{"label": "...", "value": "...", "note": "..."}]}');
    const list = a => (Array.isArray(a) ? a : []).slice(0, 5).map(x => ({ t: String(x.t || x.title || '').slice(0, 160), d: String(x.d || x.detail || '').slice(0, 400) })).filter(x => x.t);
    const out = { from, to, at: Date.now(), model: mem.model, headline: String(j.headline).slice(0, 200), tone: ['up', 'down', 'flat'].includes(j.tone) ? j.tone : 'flat',
      story: String(j.story || '').slice(0, 1200), good: list(j.good), watch: list(j.watch), todo: list(j.todo),
      numbers: (Array.isArray(j.numbers) ? j.numbers : []).slice(0, 4).map(x => ({ label: String(x.label || '').slice(0, 40), value: String(x.value ?? '').slice(0, 40), note: String(x.note || '').slice(0, 80) })) };
    c.summary = Object.fromEntries([...Object.entries(c.summary || {}).filter(([k]) => !k.startsWith(`${from}|${to}|`)), [sig, out]].slice(-20));
    return out;
  }

  // ---------- พยากรณ์ด้วย AI (วันละครั้ง · กดคิดใหม่ได้) ----------
  async function forecast(force) {
    const today = d.dayKey(Date.now()), c = cache();
    if (!force && c.forecast && c.forecast.asOf === today) return { ...c.forecast, cached: true };
    const base = d.forecastWeek();
    const days = (base.days || []).filter(x => !x.none);
    if (!days.length) throw new Error('ยังพยากรณ์พื้นฐานไม่ได้ (ข้อมูลยอดขายยังน้อย)');
    const wx = d.weatherInfo();
    const hist = sales(d.addDays(today, -56), d.addDays(today, -1));
    const k = hist.customer_kind || {}, tot = hist.sales || 0;
    const input = {
      customers: tot ? { thai_price_share_pct: Math.round(((k.thai && k.thai.amount) || 0) / tot * 100), note: 'ส่วนที่เหลือส่วนใหญ่เป็นลูกค้าต่างชาติ (ราคาปกติ)' } : undefined,
      base_forecast: days.map(x => ({ date: x.date, weekday: WD[new Date(x.date + 'T00:00:00').getDay()], closed: x.closed || undefined, sales: x.sales, low: x.low, high: x.high, dishes: x.dishes, tag: x.tag, pct_vs_normal: x.pct, weather: x.wx })),
      normal_day: base.normal, trend_pct: base.trend, accuracy_last_14d: base.accuracy, weather_next: wx.next, rain_effect: wx.rain,
      last_8_weeks: hist.daily,
    };
    const sys = [
      'คุณคือนักพยากรณ์ยอดขายร้านอาหาร ปรับพยากรณ์พื้นฐาน (จากสถิติร้านเอง) ด้วยสิ่งที่สถิติไม่รู้',
      context(),
      'ค้นเว็บหา: วันหยุดราชการ/วันหยุดยาวของไทย เทศกาล (เช่น ลอยกระทง สงกรานต์ ตรุษจีน คริสต์มาส ปีใหม่) วันหยุดของประเทศที่นักท่องเที่ยวมาเยอะ (จีน เกาหลี ยุโรป อเมริกา) ฤดูท่องเที่ยว อีเวนต์/คอนเสิร์ตใหญ่ในกรุงเทพ ช่วงวันที่ใน base_forecast',
      'ค้นข้อมูลนักท่องเที่ยวและเที่ยวบินด้วย: ยอดนักท่องเที่ยวต่างชาติเข้าไทยล่าสุดรายสัปดาห์และแนวโน้ม (กระทรวงการท่องเที่ยวฯ) แยกประเทศหลัก · ทอท./AOT คาดการณ์ผู้โดยสารหรือเที่ยวบินที่สุวรรณภูมิ/ดอนเมืองช่วงนี้ · สายการบินเพิ่ม/ลดเที่ยวบินหรือเส้นทางใหม่ · เหตุที่ทำให้นักท่องเที่ยวลด (ยกเลิกเที่ยวบิน พายุ นโยบายวีซ่า)',
      'ปรับเฉพาะวันที่มีเหตุผลชัด · ส่วนใหญ่ควรปรับ 0% · ช่วงที่ยอมรับ -50% ถึง +80% · คิดถึงลูกค้าต่างชาติเป็นหลัก (วันหยุดไทยบางวันร้านในย่านท่องเที่ยวอาจไม่ได้ขายดีขึ้น)',
      'ตอบ JSON เท่านั้น: {"days": [{"date": "YYYY-MM-DD", "pct": ตัวเลขเปอร์เซ็นต์ที่ปรับจากพยากรณ์พื้นฐาน, "reason": "เหตุผลสั้นๆ ภาษาไทย", "events": ["ชื่อเหตุการณ์"]}], "overview": "สรุป 7 วันนี้ 1-2 ประโยค",',
      ' "tourism": {"summary": "สถานการณ์นักท่องเที่ยว/เที่ยวบินตอนนี้ 1-2 ประโยค พร้อมตัวเลขที่ค้นเจอ", "trend": "up|down|flat", "points": ["ข้อมูลสำคัญสั้นๆ เช่น จีน +12% สัปดาห์ก่อน"]}}',
      'tourism ใส่เฉพาะสิ่งที่ค้นเจอจริง ถ้าค้นไม่เจอให้ summary เป็นข้อความว่าง',
    ].join('\n');
    const req = tools => ({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify(cap(input, 24000)) }] }],
      ...(tools ? { tools: [{ google_search: {} }] } : { generationConfig: { temperature: 0.2, maxOutputTokens: 12000, responseMimeType: 'application/json' } }),
      ...(tools ? { generationConfig: { temperature: 0.2, maxOutputTokens: 12000 } } : {}) });
    const okFc = x => !!(x && Array.isArray(x.days));
    const shape = '{"days": [{"date": "YYYY-MM-DD", "pct": 0, "reason": "...", "events": ["..."]}], "overview": "...", "tourism": {"summary": "...", "trend": "up|down|flat", "points": ["..."]}}';
    let r, j, searched = true;
    try { ({ r, j } = await genJSON(req(true), okFc, shape)); }
    catch (e) { if (e.status !== 400) throw e; searched = false; ({ r, j } = await genJSON(req(false), okFc, shape)); }   // รุ่นนี้ค้นเว็บไม่ได้ → ใช้ความรู้ของ AI อย่างเดียว
    const by = new Map(j.days.map(x => [x.date, x]));
    const out = { asOf: today, at: Date.now(), model: mem.model, searched: searched && !!(r.grounding && (r.grounding.webSearchQueries || r.grounding.groundingChunks)),
      overview: String(j.overview || '').slice(0, 400),
      tourism: j.tourism && j.tourism.summary ? { summary: String(j.tourism.summary).slice(0, 400), trend: ['up', 'down', 'flat'].includes(j.tourism.trend) ? j.tourism.trend : 'flat',
        points: (Array.isArray(j.tourism.points) ? j.tourism.points : []).slice(0, 5).map(x => String(x).slice(0, 120)) } : null,
      sources: ((r.grounding && r.grounding.groundingChunks) || []).map(x => x.web).filter(Boolean).slice(0, 6).map(w => ({ title: String(w.title || '').slice(0, 80), uri: String(w.uri || '') })),
      days: days.map(x => {
        const a = by.get(x.date) || {}, pct = Math.max(-50, Math.min(80, Math.round(+a.pct || 0)));
        return { date: x.date, base: x.sales, closed: !!x.closed, pct, sales: x.closed ? 0 : Math.round(x.sales * (1 + pct / 100)), reason: String(a.reason || '').slice(0, 200),
          events: (Array.isArray(a.events) ? a.events : []).slice(0, 4).map(e => String(e).slice(0, 60)) };
      }) };
    c.forecast = out;
    return out;
  }

  // ---------- ย่อหน้า AI ต่อท้าย LINE ----------
  async function lineNote(kind, from, to) {
    if (!cfg().key || !cfg().line) return '';
    try {
      const s = await summary(from, to);
      const todo = s.todo.slice(0, 2).map(x => '• ' + x.t).join('\n');
      return `🤖 AI วิเคราะห์\n${s.headline}${s.story ? '\n' + s.story : ''}${todo ? '\nควรทำ:\n' + todo : ''}`.slice(0, 1500);
    } catch (e) { return ''; }
  }

  async function test() {
    const r = await gen({ contents: [{ role: 'user', parts: [{ text: 'ตอบคำว่า พร้อม คำเดียว' }] }], generationConfig: { maxOutputTokens: 1000 } }, 30000);
    return { ok: true, model: mem.model, reply: textOf(r.parts).slice(0, 40) };
  }
  function status() {
    const c = cfg();
    return { hasKey: !!c.key, keyHint: c.key ? c.key.slice(-4) : '', model: c.model || '', usedModel: mem.model, line: !!c.line, lastErr: mem.lastErr, callsToday: mem.day === d.dayKey(Date.now()) ? mem.calls : 0 };
  }
  return { ask, summary, forecast, lineNote, test, status, runTool, sales, usage, MODELS };
};
