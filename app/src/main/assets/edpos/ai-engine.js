/*
 * ED POS — ผู้ช่วย AI ฝั่งเซิร์ฟเวอร์ (Gemini) · test-1.63
 * คีย์เก็บใน data.settings.ai.key (หน้าเว็บไม่เห็นคีย์ · ซิงก์ไปเครื่องสำรองพร้อมข้อมูลร้าน)
 *   ask()      ถามเรื่องยอดขาย: AI เรียกเครื่องมือดูข้อมูลร้านเองหลายรอบ (function calling) แล้วตอบ + กราฟเล็ก (ถ้ามี)
 *   summary()  สรุปร้านช่วงวันที่: ส่งตัวเลขที่คำนวณแล้วให้ AI เขียนบทวิเคราะห์ (ครั้งเดียว · จำผลไว้จนยอดเปลี่ยน)
 *   forecast() ปรับพยากรณ์ 7 วันด้วยวันหยุด/เทศกาล/อีเวนต์/ฤดูท่องเที่ยว (ค้นเว็บด้วย Google Search ถ้ารุ่นรองรับ)
 *   lineNote() ย่อหน้าสั้นต่อท้ายสรุป LINE รายวัน/สัปดาห์
 *   trends()   test-1.79 เมนูไทย/ขนมไทย/เครื่องดื่มที่กำลังไวรัลในชาวต่างชาติ + ข่าว (ค้นเว็บ วันละครั้ง)
 * test-1.79 ถาม AI อิสระขึ้น: ถามได้ทุกเรื่อง · query_sales จัดกลุ่ม/กรองเอง · get_bills · web_search · จำเรื่องร้าน (remember/forget)
 * ทุกอย่างอ่านข้อมูลอย่างเดียว ไม่แก้ข้อมูลร้าน (ยกเว้นบันทึกเรื่องที่เจ้าของร้านให้ AI จำ: data.aiNotes)
 * ทดสอบ: kitchen/test/test-ai-server.js (Gemini ปลอมผ่าน EDPOS_GEMINI_URL)
 */
'use strict';
const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];
const BASE = process.env.EDPOS_GEMINI_URL || 'https://generativelanguage.googleapis.com';
const WD = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

module.exports = function createAI(d) {
  // d = { data(), dayKey, addDays, buildReport, paceToday, forecastWeek, breakEven, usageReport, dishCosts, weatherInfo, menuEng, dayOf, detailFrom, save }
  const cfg = () => ({ key: '', model: '', line: false, ...(d.data().settings.ai || {}) });
  const mem = { model: '', lastErr: '', lastRaw: '', calls: 0, day: '', prog: new Map() };
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
      // 429 แยกสาเหตุจากข้อความของ Google: รุ่นนี้ไม่มีในแบบฟรี (limit: 0) · ครบโควตารายวัน · เรียกถี่เกินต่อนาที · ค้นเว็บครบโควตา
      const q = r.status === 429 ? (/limit:\s*0\b/i.test(msg) ? 'รุ่นนี้ใช้กับคีย์ฟรีไม่ได้' : /search|grounding/i.test(msg) ? 'การค้นเว็บของ AI ครบโควตาฟรีแล้ว'
        : /per\s*day|PerDay|daily/i.test(msg) ? 'ใช้ AI ครบโควตาฟรีของวันนี้แล้ว (รีเซ็ตราวบ่าย 3 โมง)' : /per\s*minute|PerMinute/i.test(msg) ? 'เรียก AI ถี่เกินไป รอ 1 นาทีแล้วลองใหม่' : 'ใช้ AI ครบโควตาแล้ว รอสักพักแล้วลองใหม่') : '';
      const e = new Error(r.status === 429 ? q : r.status === 400 && /API key/i.test(msg) ? 'API key ไม่ถูกต้อง'
        : r.status === 401 || r.status === 403 ? 'API key ใช้ไม่ได้ (ตรวจคีย์อีกครั้ง)'
        : r.status === 503 || r.status === 500 || r.status === 504 ? 'AI ของ Google มีคนใช้เยอะชั่วคราว ลองใหม่อีกสักครู่' : `AI ตอบกลับ ${r.status}: ${msg}`);
      e.status = r.status; e.raw = msg; mem.lastRaw = `${model}: ${r.status} ${String(msg).slice(0, 160)}`; throw e;
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
    { name: 'query_sales', description: 'ค้นยอดขายแบบยืดหยุ่น จัดกลุ่ม/กรองเองได้ (เช่น เมนูไหนขายดีวันเสาร์ · เนื้อสัตว์ไหนขายดีในผัดกะเพรา · ชั่วโมงไหนคนสั่งเบียร์ · โต๊ะไหน/พนักงานคนไหนขายได้เท่าไร) · ได้ qty (จาน) sales (บาท) bills (จำนวนบิลที่มี) ต่อกลุ่ม · ชั่วโมง/โต๊ะ/พนักงาน/วิธีจ่าย/ประเภท ละเอียดเฉพาะบิล 7 วันล่าสุด',
      parameters: { type: 'object', required: ['from', 'to'], properties: { from: S('วันเริ่ม YYYY-MM-DD'), to: S('วันสุดท้าย YYYY-MM-DD'),
        group_by: { type: 'array', items: { type: 'string' }, description: 'จัดกลุ่มได้ 0-2 อย่าง: day weekday month hour menu category option (ตัวเลือกทั้งชุด เช่น "หมู M") choice (ตัวเลือกทีละคำ เช่น หมู / M / ไข่ดาว) payment table staff kind' },
        filter: { type: 'object', description: 'กรอง (ไม่ใส่ = ทั้งหมด) ค่าแบบรายการ จับคู่แบบมีคำนี้อยู่', properties: {
          menu: { type: 'array', items: { type: 'string' } }, category: { type: 'array', items: { type: 'string' } }, choice: { type: 'array', items: { type: 'string' } },
          weekday: { type: 'array', items: { type: 'string' }, description: 'เช่น เสาร์ อาทิตย์ หรือ 0-6 (0=อาทิตย์)' }, hour_from: { type: 'number' }, hour_to: { type: 'number', description: 'รวมชั่วโมงนี้ด้วย' },
          payment: { type: 'array', items: { type: 'string' }, description: 'cash transfer card' }, table: { type: 'array', items: { type: 'string' } }, staff: { type: 'array', items: { type: 'string' } },
          kind: { type: 'array', items: { type: 'string' }, description: 'ทานที่ร้าน กลับบ้าน กลับต่างประเทศ' }, thai_price: { type: 'boolean', description: 'true = เฉพาะจานราคาคนไทย · false = เฉพาะราคาปกติ (ต่างชาติ)' } } },
        sort: S('sales | qty | bills | key (เรียงตามชื่อกลุ่ม เช่น วัน/ชั่วโมง)'), limit: { type: 'number', description: 'จำนวนแถว ค่าเริ่ม 40 สูงสุด 120' } } } },
    { name: 'get_bills', description: 'ดูบิลจริงทีละใบ (เฉพาะ 7 วันล่าสุด): เวลา โต๊ะ ยอด วิธีจ่าย รายการอาหาร คนรับเงิน เวลานั่ง · กรองตามโต๊ะ/เมนูในบิล/ยอดขั้นต่ำ',
      parameters: { type: 'object', properties: { from: S('YYYY-MM-DD (ไม่ใส่ = วันนี้)'), to: S('YYYY-MM-DD'), table: S('ชื่อโต๊ะ'), contains: S('มีเมนูนี้ในบิล'), min_total: { type: 'number' }, sort: S('latest | biggest'), limit: { type: 'number', description: 'สูงสุด 25' } } } },
    { name: 'get_menu_engineering', description: 'วิเคราะห์เมนูแบบมือโปร (menu engineering) ช่วงวันที่: แบ่งเมนูเป็น star (ขายดี กำไรดี) plow (ขายดี กำไรน้อย) puzzle (กำไรดี ขายน้อย) dog (ขายน้อย กำไรน้อย) พร้อมราคาเฉลี่ย ต้นทุน กำไรต่อจาน กำไรรวม และกำไรที่เพิ่มต่อเดือนถ้าขึ้นราคา raise_by บาท (raise_gain_per_month) หรือขายเพิ่ม 20% (more20_per_month)',
      parameters: { type: 'object', required: ['from', 'to'], properties: { from: S('วันเริ่ม YYYY-MM-DD'), to: S('วันสุดท้าย YYYY-MM-DD'), scope: S('food | drink | dessert | all | cat:ชื่อหมวด (ค่าเริ่ม food)') } } },
    { name: 'get_viral_trends', description: 'เมนูอาหารไทย ขนมไทย เครื่องดื่มไทย ที่กำลังไวรัลในชาวต่างชาติตอนนี้ + ข่าวที่เกี่ยวข้อง (ค้นเว็บวันละครั้ง) และร้านเรามีเมนูนั้นแล้วหรือยัง' },
    { name: 'web_search', description: 'ค้นเว็บ (Google) หาข้อมูลโลกภายนอกที่เป็นปัจจุบัน เช่น ราคาร้านอื่น เทรนด์ ข่าว อีเวนต์ วันหยุด อัตราแลกเปลี่ยน รีวิว กฎหมาย ได้สรุป + แหล่งที่มา',
      parameters: { type: 'object', required: ['query'], properties: { query: S('สิ่งที่อยากค้น (เขียนให้ชัด ใส่ปี/สถานที่ถ้าเกี่ยว)') } } },
    { name: 'remember', description: 'จำเรื่องร้านไว้ใช้ครั้งต่อไป (เมื่อเจ้าของร้านสั่งให้จำ หรือบอกข้อเท็จจริงถาวร เช่น ร้านปิดทุกวันพุธ · ค่าเช่าขึ้นเป็น 50,000 · กุ้งขึ้นราคา) · ห้ามจำรหัส/เลขบัญชี/ข้อมูลส่วนตัวของลูกค้า',
      parameters: { type: 'object', required: ['note'], properties: { note: S('สิ่งที่จะจำ ประโยคเดียว สั้น ชัด') } } },
    { name: 'forget', description: 'ลบเรื่องที่เคยจำไว้ (เมื่อเจ้าของร้านบอกให้ลืม หรือข้อมูลเปลี่ยน)', parameters: { type: 'object', required: ['match'], properties: { match: S('คำที่อยู่ในเรื่องที่จะลบ') } } },
    { name: 'respond', parameters: { type: 'object', required: ['answer'], properties: {
      answer: S('คำตอบ ภาษาเดียวกับที่ผู้ใช้ถาม (ปกติไทย) ยาวเท่าที่จำเป็น · จัดรูปแบบได้: ## หัวข้อ, **ตัวหนา**, บรรทัด "- " เป็นข้อ, "1. " เป็นลำดับ, ตาราง | หัว | หัว | · ตัวเลขเงินใส่คอมมา'),
      chart: { type: 'object', description: 'กราฟประกอบ (ใส่เมื่อช่วยให้เข้าใจ เช่น เทียบรายวัน/รายเมนู) ไม่เกิน 14 ค่า', properties: {
        type: S('bar | line'), title: S('ชื่อกราฟ'), unit: S('หน่วย เช่น บาท จาน'),
        labels: { type: 'array', items: { type: 'string' } }, values: { type: 'array', items: { type: 'number' } } } },
      followups: { type: 'array', items: { type: 'string' }, description: 'คำถามหรือคำสั่งต่อที่น่าถาม 2-3 ข้อ (สั้น)' } } },
      description: 'ตอบผู้ใช้ (เรียกครั้งสุดท้ายเสมอ)' },
  ];
  const decls = only => TOOLS.filter(t => !only || only.includes(t.name)).map(({ name, description, parameters }) => parameters ? { name, description, parameters } : { name, description });
  const arr = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(x => String(x).trim()).filter(Boolean);
  const WD_EN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const wdNum = x => { const s = String(x).toLowerCase().replace(/^วัน/, ''); if (/^[0-6]$/.test(s)) return +s; const i = WD.findIndex(w => s.startsWith(w) || w.startsWith(s)); return i >= 0 ? i : WD_EN.findIndex(w => s.startsWith(w)); };
  const wdOf = k => new Date(k + 'T00:00:00').getDay();
  const KIND = { dine: 'ทานที่ร้าน', ta: 'กลับบ้าน', abroad: 'กลับต่างประเทศ' }, PAY = { cash: 'เงินสด', transfer: 'โอน', card: 'บัตร' };
  // ---------- query_sales: แถวรายจาน (บิลละเอียด 7 วัน + สรุปรายวันที่เก่ากว่า) แล้วจัดกลุ่ม/กรองตามที่ AI ขอ ----------
  const DIMS = ['day', 'weekday', 'month', 'hour', 'menu', 'category', 'option', 'choice', 'payment', 'table', 'staff', 'kind'];
  const DETAIL = ['hour', 'payment', 'table', 'staff', 'kind'];
  function querySales(from, to, a) {
    const by = arr(a.group_by).filter(x => DIMS.includes(x)).slice(0, 2), f = a.filter && typeof a.filter === 'object' ? a.filter : {};
    const fl = { menu: arr(f.menu), category: arr(f.category), choice: arr(f.choice), table: arr(f.table), staff: arr(f.staff), kind: arr(f.kind), payment: arr(f.payment).map(x => x.toLowerCase()) };
    const wds = arr(f.weekday).map(wdNum).filter(x => x >= 0), hf = Number.isFinite(+f.hour_from) && f.hour_from !== '' && f.hour_from != null ? +f.hour_from : null, ht = Number.isFinite(+f.hour_to) && f.hour_to !== '' && f.hour_to != null ? +f.hour_to : null;
    const thai = typeof f.thai_price === 'boolean' ? f.thai_price : null;
    const needDetail = by.some(x => DETAIL.includes(x)) || hf != null || ht != null || fl.table.length || fl.staff.length || fl.kind.length || fl.payment.length || thai != null;
    const dFrom = d.detailFrom(), rows = [];
    const has = (v, list) => !list.length || list.some(x => String(v || '').includes(x));
    let byOrder = null, paidBy = null;   // ทำดัชนีครั้งเดียว (บิล 7 วันมีหลายพันจาน)
    for (let k = from; k <= to; k = d.addDays(k, 1)) {
      if (wds.length && !wds.includes(wdOf(k))) continue;
      if (k >= dFrom) {
        if (!byOrder) {
          byOrder = new Map(); for (const i of d.data().items) { if (!byOrder.has(i.orderId)) byOrder.set(i.orderId, []); byOrder.get(i.orderId).push(i); }
          paidBy = new Map(); for (const o of d.data().orders) if (o.status === 'paid') { const dk = d.dayKey(o.paidAt); if (!paidBy.has(dk)) paidBy.set(dk, []); paidBy.get(dk).push(o); }
        }
        for (const o of paidBy.get(k) || []) {
          const pay = o.payments && o.payments.length > 1 ? 'split' : (o.payments && o.payments[0] && o.payments[0].method) || o.payMethod || 'cash';
          for (const i of byOrder.get(o.id) || []) {
            if (i.status === 'cancelled') continue;
            rows.push({ day: k, hour: new Date(i.createdAt || o.createdAt).getHours(), menu: i.name, category: i.category || 'อื่นๆ', option: i.option || '', payment: pay,
              table: String(o.table || ''), staff: i.by || '', kind: i.abroad ? 'abroad' : i.takeaway ? 'ta' : 'dine', thai: !!i.thai, qty: i.qty, sales: i.price * i.qty, bill: o.id });
          }
        }
      } else if (!needDetail) {
        const day = d.dayOf(k);
        for (const it of Object.values(day.items || {})) {
          let rest = it.qty;
          const add = (opt, q) => rows.push({ day: k, menu: it.name, category: it.category || 'อื่นๆ', option: opt, qty: q, sales: it.qty ? it.amount * q / it.qty : 0, bill: null });
          for (const [o, q] of Object.entries(it.opts || {})) { add(o, q); rest -= q; }
          if (rest > 0) add('', rest);
        }
      }
    }
    // ชื่อที่ตรงกับเมนู/หมวดจริง = ต้องตรงทั้งคำ (กรอง "ผัดกะเพรา" ไม่เอา "ปลาผัดกะเพรา") · ไม่ตรงชื่อไหน = หาคำที่อยู่ในชื่อ
    const menuNames = new Set([...d.data().menu.map(m => m.name), ...rows.map(r => r.menu)]), catNames = new Set([...(d.data().categories || []), ...rows.map(r => r.category)]);
    const tableNames = new Set(rows.map(r => r.table)), staffNames = new Set(rows.map(r => r.staff));
    const like = (v, list, exact) => !list.length || list.some(x => exact.has(x) ? String(v || '') === x : String(v || '').includes(x));
    const pass = r => like(r.menu, fl.menu, menuNames) && like(r.category, fl.category, catNames) && (!fl.choice.length || fl.choice.some(c => (r.option || '').split(' ').includes(c) || (r.option || '').includes(c)))
      && like(r.table, fl.table, tableNames) && like(r.staff, fl.staff, staffNames) && (!fl.kind.length || fl.kind.some(x => (KIND[r.kind] || '').includes(x) || r.kind === x))
      && (!fl.payment.length || fl.payment.some(x => r.payment === x || (PAY[r.payment] || '').includes(x))) && (thai == null || r.thai === thai)
      && (hf == null || r.hour >= hf) && (ht == null || r.hour <= ht);
    const val = (r, dim) => dim === 'weekday' ? WD[wdOf(r.day)] : dim === 'month' ? r.day.slice(0, 7) : dim === 'kind' ? KIND[r.kind] : dim === 'payment' ? (PAY[r.payment] || r.payment) : dim === 'option' ? (r.option || '(ไม่มีตัวเลือก)') : r[dim];
    const g = new Map(), tot = { qty: 0, sales: 0, bills: new Set() };
    for (const r of rows) {
      if (!pass(r)) continue;
      tot.qty += r.qty; tot.sales += r.sales; if (r.bill) tot.bills.add(r.bill);
      const keysOf = by.includes('choice') ? ((r.option || '').split(' ').filter(Boolean).length ? (r.option || '').split(' ').filter(Boolean) : ['(ไม่มีตัวเลือก)']) : [null];
      for (const ch of keysOf) {
        const key = by.map(x => x === 'choice' ? ch : val(r, x));
        const id = key.join('\u0001'), e = g.get(id) || (g.set(id, { key, qty: 0, sales: 0, bills: new Set() }), g.get(id));
        e.qty += r.qty; e.sales += r.sales; if (r.bill) e.bills.add(r.bill);
      }
    }
    let anyBill = rows.some(r => r.bill);
    // จัดกลุ่มแค่ตามวัน/วันในสัปดาห์/เดือน ไม่กรองรายจาน → จำนวนบิลจริงจากสรุปรายวัน (ครบทุกวัน ไม่ใช่แค่ 7 วัน)
    const dayOnly = by.every(x => ['day', 'weekday', 'month'].includes(x)) && !needDetail && !fl.menu.length && !fl.category.length && !fl.choice.length;
    if (dayOnly) {
      for (const e of g.values()) e.bills = new Set();
      tot.bills = new Set();
      for (let k = from; k <= to; k = d.addDays(k, 1)) {
        if (wds.length && !wds.includes(wdOf(k))) continue;
        const n = d.dayOf(k).bills || 0; if (!n) continue;
        const r0 = { day: k }, key = by.map(x => val(r0, x)), e = g.get(key.join('\u0001'));
        for (let i = 0; i < n; i++) { const t = k + '#' + i; tot.bills.add(t); if (e) e.bills.add(t); }
      }
      anyBill = true;
    }
    const sort = ['sales', 'qty', 'bills', 'key'].includes(a.sort) ? a.sort : by.every(x => ['day', 'month', 'hour'].includes(x)) && by.length ? 'key' : 'sales';
    const lim = Math.max(1, Math.min(120, Math.round(+a.limit || 40)));
    const list = [...g.values()].sort((x, y) => sort === 'key' ? String(x.key.join()).localeCompare(String(y.key.join()), 'th', { numeric: true }) : sort === 'bills' ? y.bills.size - x.bills.size : y[sort] - x[sort]);
    const matched = fl.menu.length ? [...new Set(rows.filter(r => like(r.menu, fl.menu, menuNames)).map(r => r.menu))].slice(0, 20) : undefined;
    return { from, to, group_by: by, ...(matched ? { matched_menus: matched } : {}), rows: list.slice(0, lim).map(e => ({ ...Object.fromEntries(by.map((x, i) => [x, e.key[i]])), qty: e.qty, sales: Math.round(e.sales), ...(anyBill ? { bills: e.bills.size } : {}) })),
      more_rows: Math.max(0, list.length - lim), total: { qty: tot.qty, sales: Math.round(tot.sales), ...(anyBill ? { bills: tot.bills.size } : {}) },
      note: [needDetail && from < dFrom ? `ข้อมูลรายบิล (ชั่วโมง โต๊ะ พนักงาน วิธีจ่าย ประเภท ราคาคนไทย) มีตั้งแต่ ${dFrom} · ก่อนหน้านั้นไม่ได้นับในผลนี้` : '',
        anyBill && !dayOnly ? 'bills = จำนวนบิลที่มีจานในกลุ่มนั้น (นับเฉพาะ 7 วันล่าสุด)' : dayOnly ? 'bills = จำนวนครั้งที่จ่ายเงิน' : '', by.includes('hour') ? 'hour = ชั่วโมงที่สั่งจาน' : '', by.includes('choice') ? 'choice: 1 จานที่มีหลายตัวเลือกนับในทุกตัวเลือก' : ''].filter(Boolean).join(' · ') || undefined };
  }
  function getBills(a) {
    const today = d.dayKey(Date.now()), from = ok(a.from) ? a.from : today, to = ok(a.to) ? a.to : from, lo = from <= to ? from : to, hi = from <= to ? to : from;
    const dFrom = d.detailFrom();
    let list = d.data().orders.filter(o => o.status === 'paid' && d.dayKey(o.paidAt) >= lo && d.dayKey(o.paidAt) <= hi);
    if (a.table) list = list.filter(o => String(o.table) === String(a.table).trim());
    const itemsOf = o => d.data().items.filter(i => i.orderId === o.id && i.status !== 'cancelled');
    if (a.contains) list = list.filter(o => itemsOf(o).some(i => i.name.includes(String(a.contains).trim())));
    if (+a.min_total > 0) list = list.filter(o => (o.subtotal ?? o.total ?? 0) >= +a.min_total);
    list.sort((x, y) => a.sort === 'biggest' ? (y.subtotal ?? y.total ?? 0) - (x.subtotal ?? x.total ?? 0) : y.paidAt - x.paidAt);
    const hm = t => new Date(t).toTimeString().slice(0, 5);
    const lim = Math.max(1, Math.min(25, Math.round(+a.limit || 15)));
    return { from: lo, to: hi, found: list.length, detail_from: dFrom, note: lo < dFrom ? `บิลรายใบเก็บตั้งแต่ ${dFrom}` : undefined,
      bills: list.slice(0, lim).map(o => ({ day: d.dayKey(o.paidAt), opened: hm(o.createdAt), paid: hm(o.paidAt), table: o.table, total: o.subtotal ?? o.total,
        method: o.payments && o.payments.length > 1 ? 'แยกจ่าย ' + o.payments.map(p => PAY[p.method] || p.method).join('+') : PAY[o.payMethod] || o.payMethod,
        sit_min: o.createdAt && o.paidAt ? Math.round((o.paidAt - o.createdAt) / 60000) : undefined, by: o.paidBy || undefined,
        items: itemsOf(o).map(i => `${i.name}${i.option ? ' ' + i.option : ''} ×${i.qty} = ${Math.round(i.price * i.qty)}${i.thai ? ' (ราคาคนไทย)' : ''}`) })) };
  }
  // ---------- ความจำของ AI (เรื่องร้านที่เจ้าของบอกไว้) ----------
  const notes = () => { const n = d.data().aiNotes; return Array.isArray(n) ? n : (d.data().aiNotes = []); };
  function noteAdd(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!t) throw new Error('ไม่มีข้อความที่จะจำ');
    const n = notes(); if (!n.some(x => x.t === t)) n.push({ t, at: Date.now() });
    while (n.length > 60) n.shift();
    if (d.save) d.save();
    return { ok: true, saved: t, total: n.length };
  }
  function noteDel(m) {
    m = String(m || '').trim(); if (!m) throw new Error('บอกคำที่จะลบ');
    const n = notes(), keep = n.filter(x => !x.t.includes(m) && String(x.at) !== m);
    d.data().aiNotes = keep; if (keep.length !== n.length && d.save) d.save();
    return { removed: n.length - keep.length, total: keep.length };
  }
  // ---------- ค้นเว็บ (เรียก Gemini อีกครั้งพร้อม Google Search) ----------
  async function webSearch(q) {
    q = String(q || '').trim().slice(0, 300); if (!q) throw new Error('ใส่สิ่งที่จะค้น');
    const today = d.dayKey(Date.now());
    if (mem.noSearch === today) return { error: 'วันนี้ค้นเว็บครบโควตาฟรีแล้ว · ตอบจากความรู้ที่มี และบอกผู้ใช้ว่าไม่ได้ค้นเว็บ' };
    try {
      const r = await gen({ contents: [{ role: 'user', parts: [{ text: `ค้นเว็บแล้วสรุปข้อมูลล่าสุดเกี่ยวกับ: ${q}\n(${context().split('\n').join(' · ')})\nสรุปเป็นข้อ ภาษาไทย กระชับ ใส่ตัวเลข ราคา วันที่ และชื่อแหล่งที่มา บอกถ้าข้อมูลเก่า` }] }],
        tools: [{ google_search: {} }], generationConfig: { temperature: 0.2, maxOutputTokens: 6000 } }, 70000);
      const g = r.grounding || {};
      return { summary: textOf(r.parts).slice(0, 5000), searched_for: g.webSearchQueries || [q],
        sources: (g.groundingChunks || []).map(x => x.web).filter(Boolean).slice(0, 6).map(w => ({ title: String(w.title || '').slice(0, 80), uri: String(w.uri || '') })) };
    } catch (e) {
      if (e.status === 429) mem.noSearch = today;
      if ([400, 429, 500, 503, 504].includes(e.status)) return { error: 'ค้นเว็บไม่ได้ตอนนี้ (' + e.message + ') · ตอบจากความรู้ที่มี และบอกผู้ใช้ว่าไม่ได้ค้นเว็บ' };
      throw e;
    }
  }
  function menuEngLite(from, to, scope) {
    const m = d.menuEng(from, to, scope);
    return { ...m, cats: undefined, items: m.items.slice(0, 60).map(x => ({ name: x.name, cat: x.cat, class: x.cls, qty: x.qty, share_pct: x.share, avg_price: x.price, cost: x.cost,
      cost_from: x.costSrc === 'recipe' ? 'สูตรวัตถุดิบ' : 'ประมาณ ' + m.foodPct + '% ของราคา', cm: x.cm, gp: Math.round(x.gp), prev_qty: x.prevQty, raise_by: x.raiseBy, raise_gain_per_month: x.raiseGain, more20_per_month: x.more20 })),
      note: 'class: star=ขายดีกำไรดี plow=ขายดีกำไรน้อย puzzle=กำไรดีขายน้อย dog=ขายน้อยกำไรน้อย · เกณฑ์ขายดี = ส่วนแบ่ง ≥ popMinPct% · กำไรดี = cm ≥ cmAvg' };
  }
  async function runTool(name, a) {
    a = a || {};
    const today = d.dayKey(Date.now());
    const range = () => { if (!ok(a.from) || !ok(a.to)) throw new Error('ใส่วันที่ from/to เป็น YYYY-MM-DD'); return a.from <= a.to ? [a.from, a.to] : [a.to, a.from]; };
    switch (name) {
      case 'query_sales': { const [f, t] = range(); return querySales(f, t, a); }
      case 'get_bills': return getBills(a);
      case 'get_menu_engineering': { const [f, t] = range(); return menuEngLite(f, t, a.scope); }
      case 'get_viral_trends': { const x = await trends(false); return { ...x, sources: undefined }; }
      case 'web_search': return webSearch(a.query);
      case 'remember': return noteAdd(a.note);
      case 'forget': return noteDel(a.match);
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
  const notesText = () => { const n = notes(); return n.length ? 'เรื่องที่เจ้าของร้านให้จำไว้ (ใช้ประกอบคำตอบ):\n' + n.map(x => '- ' + x.t).join('\n') : ''; };

  // ---------- ถาม AI (test-1.79: ถามได้ทุกเรื่อง ใช้เครื่องมือเท่าที่จำเป็น) ----------
  const MAX_ROUNDS = 10;
  async function ask(q, history, rid) {
    q = String(q || '').trim().slice(0, 2000);
    if (!q) throw new Error('พิมพ์คำถามก่อน');
    const sys = [
      'คุณคือผู้ช่วย AI ประจำร้าน เป็นคู่คิดของเจ้าของร้าน เก่งทั้งธุรกิจร้านอาหาร ตัวเลข การตลาด เมนูและราคา การจัดคน งานเขียน และหลายภาษา (ไทย อังกฤษ จีน ญี่ปุ่น เกาหลี ฯลฯ)',
      context(),
      notesText(),
      'ถามได้ทุกเรื่อง ไม่จำกัดแค่ยอดขาย: วิเคราะห์ร้าน หาสาเหตุ วางแผน คิดโปรโมชัน เขียนโพสต์/แคปชัน/ป้าย/ข้อความตอบรีวิว แปลเมนู ตั้งราคา จัดตารางคน ความรู้ทั่วไป หรือคุยเล่นก็ได้ · คิดเองได้อย่างอิสระ มีความเห็นของตัวเอง กล้าแนะนำตรงๆ',
      `วิธีทำงาน: ถ้าคำถามเกี่ยวกับตัวเลขของร้าน → ดูข้อมูลจริงด้วยเครื่องมือก่อน เรียกได้หลายครั้ง (ไม่เกิน ${MAX_ROUNDS} รอบ) ขุดเองจนได้คำตอบ เช่น query_sales จัดกลุ่ม/กรองตามที่อยากรู้ get_bills ดูบิลจริง get_menu_engineering ดูว่าเมนูไหนควรขึ้นราคา/โปรโมต/ตัด`,
      'ถ้าต้องใช้ข้อมูลโลกภายนอกที่เป็นปัจจุบัน (ราคาร้านอื่น เทรนด์ ข่าว อีเวนต์ วันหยุด อัตราแลกเปลี่ยน) → web_search · เรื่องเมนูที่กำลังไวรัล → get_viral_trends · ความรู้ทั่วไป งานเขียน ไอเดีย → ตอบได้เลย (ถ้าข้อมูลร้านช่วยให้ดีขึ้น เช่น โพสต์โปรโมตเมนูขายดี ให้ดูก่อน)',
      'ถ้าเจ้าของร้านสั่งให้จำ หรือบอกข้อเท็จจริงถาวรของร้าน → remember (บอกในคำตอบด้วยว่าจำแล้ว) · สั่งให้ลืม → forget',
      'ตัวเลขของร้านใช้เฉพาะที่ได้จากเครื่องมือ ห้ามแต่ง · แยกให้ชัดว่าอะไรคือข้อมูลจริง อะไรคือการคาดเดาหรือความเห็น · ข้อมูลไม่พอให้บอกตรงๆ ว่าขาดอะไร',
      'ตอบภาษาเดียวกับที่ผู้ใช้ถาม ยาวเท่าที่จำเป็น: คำถามสั้นตอบสั้น งานเขียน/แผนยาวได้ เริ่มด้วยคำตอบตรงๆ ใช้ ## หัวข้อ ตาราง | และรายการ - ได้ · ใส่ chart เมื่อช่วยให้เข้าใจ (เทียบหลายวัน/หลายเมนู)',
      'ร้านนี้ไม่ได้นับสต๊อกคงเหลือ มีแค่วัตถุดิบที่ใช้ตามสูตร',
      'จบด้วยการเรียก respond เสมอ',
    ].filter(Boolean).join('\n');
    const contents = [];
    for (const h of (Array.isArray(history) ? history : []).slice(-8)) {
      if (h && h.q && h.a) { contents.push({ role: 'user', parts: [{ text: String(h.q).slice(0, 2000) }] }, { role: 'model', parts: [{ text: String(h.a).slice(0, 4000) }] }); }
    }
    contents.push({ role: 'user', parts: [{ text: q }] });
    const used = [], sources = [];
    let notesChanged = false;
    const prog = rid ? { steps: [], at: Date.now() } : null;
    if (rid) { mem.prog.set(String(rid).slice(0, 40), prog); while (mem.prog.size > 8) mem.prog.delete(mem.prog.keys().next().value); }
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const last = round === MAX_ROUNDS;
      const r = await gen({ systemInstruction: { parts: [{ text: sys }] }, contents, tools: [{ functionDeclarations: decls(last ? ['respond'] : null) }],
        toolConfig: { functionCallingConfig: { mode: 'ANY' } }, generationConfig: { temperature: 0.5, maxOutputTokens: 16000 } });
      const calls = r.parts.filter(p => p.functionCall).map(p => ({ name: p.functionCall.name, args: p.functionCall.args || {} }));
      const fin = calls.find(c => c.name === 'respond');
      const done = (answer, extra) => {
        if (prog) prog.done = true;
        const src = [...new Map(sources.filter(x => x.uri).map(x => [x.uri, x])).values()].slice(0, 8);
        return { answer, tools: used, model: mem.model, ...(src.length ? { sources: src } : {}), ...(notesChanged ? { notes: notes() } : {}), ...extra };
      };
      if (fin) return done(String(fin.args.answer || '').trim(), { chart: cleanChart(fin.args.chart), followups: (fin.args.followups || []).slice(0, 3).map(String) });
      if (!calls.length) return done(textOf(r.parts) || 'AI ไม่ได้ตอบ ลองถามใหม่อีกครั้ง');
      contents.push(r.content);
      const parts = [];
      for (const c of calls) {
        used.push(c.name); if (prog) prog.steps.push(c.name);
        let out; try { out = cap(await runTool(c.name, c.args), 14000); } catch (e) { out = { error: e.message }; }
        if (c.name === 'web_search' && out && Array.isArray(out.sources)) sources.push(...out.sources);
        if ((c.name === 'remember' || c.name === 'forget') && out && !out.error) notesChanged = true;
        parts.push({ functionResponse: { name: c.name, response: { result: out } } });
      }
      contents.push({ role: 'user', parts });
    }
    throw new Error('AI วนดูข้อมูลไม่จบ ลองถามให้แคบลง');
  }
  const progress = rid => { const p = mem.prog.get(String(rid || '')); return p ? { steps: p.steps, done: !!p.done, sec: Math.round((Date.now() - p.at) / 1000) } : { steps: [] }; };
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
    let r, j, searched = mem.noSearch !== today;   // วันนี้ค้นเว็บไม่ได้แล้ว → ไม่ลองซ้ำทั้งวัน
    try { if (!searched) { const e = new Error('skip'); e.status = 429; throw e; } ({ r, j } = await genJSON(req(true), okFc, shape)); }
    catch (e) {   // ค้นเว็บไม่ได้ (รุ่นไม่รองรับ 400 · ค้นเว็บครบโควตาฟรี/ไม่มีในแบบฟรี 429 · Google ไม่ว่าง) → ใช้ความรู้ของ AI อย่างเดียว
      if (![400, 429, 500, 503, 504].includes(e.status) && e.code !== 'format') throw e;
      if (searched && e.status === 429) mem.noSearch = today;
      searched = false; ({ r, j } = await genJSON(req(false), okFc, shape));
    }
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

  // ---------- 🔥 เมนูไทยที่กำลังไวรัลในชาวต่างชาติ (ค้นเว็บวันละครั้ง · กดอัปเดตเองได้) ----------
  const normTh = x => String(x || '').replace(/\s+/g, '').toLowerCase();
  function matchMenu(name, hint) {
    const menu = d.data().menu.filter(m => m.available !== false).map(m => m.name);
    for (const c of [hint, name].filter(Boolean)) {
      const n = normTh(c); if (n.length < 2) continue;
      const exact = menu.find(m => normTh(m) === n); if (exact) return { name: exact, exact: true };
      const part = menu.filter(m => normTh(m).length >= 3 && (n.includes(normTh(m)) || normTh(m).includes(n))).sort((a, b) => b.length - a.length)[0];
      if (part) return { name: part, exact: false };
    }
    return null;
  }
  async function trends(force) {
    const today = d.dayKey(Date.now()), c = cache();
    if (!force && c.trends && c.trends.asOf === today) return { ...c.trends, cached: true };
    const menu = d.data().menu.filter(m => m.available !== false).map(m => m.name);
    const sys = [
      'คุณคือนักล่าเทรนด์อาหารให้ร้านอาหารไทยในย่านท่องเที่ยวกรุงเทพ (ลูกค้าส่วนใหญ่เป็นนักท่องเที่ยวต่างชาติ)',
      context(),
      'ค้นเว็บหา เมนูอาหารไทย ขนมไทย และเครื่องดื่มไทย ที่กำลังไวรัล/ฮิตในหมู่ชาวต่างชาติ ช่วง 1-2 เดือนล่าสุด จาก TikTok Instagram YouTube Reddit Xiaohongshu (小红书) รีวิว Google/TripAdvisor ข่าวอาหาร Michelin TasteAtlas และเทรนด์ในประเทศที่มาเที่ยวไทยเยอะ (จีน เกาหลี ญี่ปุ่น อินเดีย ยุโรป อเมริกา ออสเตรเลีย)',
      'เลือกเฉพาะที่ฮิตจริงและเกี่ยวกับร้านอาหาร 6-10 รายการ เรียงจากฮิตมากไปน้อย · ข่าวสั้นที่เจ้าของร้านควรรู้ 2-5 ข่าว (เทรนด์อาหาร การท่องเที่ยว รางวัล เทศกาลอาหาร)',
      `เมนูของร้าน (เทียบว่าร้านมีแล้วไหม): ${menu.join(', ')}`,
      'ตอบ JSON เท่านั้น: {"overview": "สรุปภาพรวม 1-2 ประโยค", "items": [{"name": "ชื่อภาษาไทย", "en": "ชื่อที่ชาวต่างชาติเรียก/ค้น", "kind": "food|dessert|drink", "heat": 1-5, "why": "ทำไมกำลังฮิต 1-2 ประโยค", "where": "ฮิตที่ไหน/กับใคร เช่น TikTok · ชาวเกาหลี", "fit": "have|similar|new", "match": "ชื่อเมนูของร้านที่ตรงหรือใกล้เคียง (ว่างถ้าไม่มี)", "idea": "ร้านควรทำอะไร 1 ประโยค"}], "news": [{"title": "หัวข่าวสั้น", "detail": "1 ประโยค", "date": "YYYY-MM-DD หรือว่าง"}]}',
      'ทุกข้อความเป็นภาษาไทย ยกเว้น en · ใส่เฉพาะสิ่งที่ค้นเจอจริง ห้ามแต่ง',
    ].join('\n');
    const req = tools => ({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: 'หาเทรนด์ล่าสุดตอนนี้' }] }],
      ...(tools ? { tools: [{ google_search: {} }], generationConfig: { temperature: 0.3, maxOutputTokens: 12000 } } : { generationConfig: { temperature: 0.3, maxOutputTokens: 12000, responseMimeType: 'application/json' } }) });
    const okT = x => !!(x && Array.isArray(x.items) && x.items.length);
    const shape = '{"overview": "...", "items": [{"name": "...", "en": "...", "kind": "food|dessert|drink", "heat": 3, "why": "...", "where": "...", "fit": "have|similar|new", "match": "...", "idea": "..."}], "news": [{"title": "...", "detail": "...", "date": ""}]}';
    let r, j, searched = mem.noSearch !== today;
    try { if (!searched) { const e = new Error('skip'); e.status = 429; throw e; } ({ r, j } = await genJSON(req(true), okT, shape)); }
    catch (e) {
      if (![400, 429, 500, 503, 504].includes(e.status) && e.code !== 'format') throw e;
      if (searched && e.status === 429) mem.noSearch = today;
      searched = false; ({ r, j } = await genJSON(req(false), okT, shape));
    }
    const S1 = (v, n) => String(v ?? '').replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '').trim().slice(0, n);
    const items = j.items.slice(0, 12).map(x => {
      const name = S1(x.name, 60); if (!name) return null;
      const mm = matchMenu(name, S1(x.match, 60));
      const fit = mm ? (mm.exact && normTh(mm.name) === normTh(name) ? 'have' : ['have', 'similar'].includes(x.fit) ? x.fit : 'similar') : x.fit === 'have' || x.fit === 'similar' ? 'similar' : 'new';
      return { name, en: S1(x.en, 80), kind: ['food', 'dessert', 'drink'].includes(x.kind) ? x.kind : 'food', heat: Math.max(1, Math.min(5, Math.round(+x.heat || 3))),
        why: S1(x.why, 260), where: S1(x.where, 120), fit: mm ? fit : fit === 'similar' && !x.match ? 'new' : fit, match: mm ? mm.name : '', idea: S1(x.idea, 200) };
    }).filter(Boolean);
    if (!items.length) { const e = new Error('AI หาเทรนด์ไม่เจอ ลองกดอัปเดตอีกครั้ง'); e.code = 'format'; throw e; }
    const out = { asOf: today, at: Date.now(), model: mem.model, searched: searched && !!(r.grounding && (r.grounding.webSearchQueries || r.grounding.groundingChunks)),
      overview: S1(j.overview, 400), items,
      news: (Array.isArray(j.news) ? j.news : []).slice(0, 6).map(x => ({ title: S1(x.title, 140), detail: S1(x.detail, 300), date: ok(x.date) ? x.date : '' })).filter(x => x.title),
      sources: ((r.grounding && r.grounding.groundingChunks) || []).map(x => x.web).filter(Boolean).slice(0, 8).map(w => ({ title: String(w.title || '').slice(0, 80), uri: String(w.uri || '') })) };
    c.trends = out;
    if (d.save) d.save();
    return out;
  }
  const trendsCached = () => { const t = cache().trends; return t ? { ...t, cached: true, stale: t.asOf !== d.dayKey(Date.now()) } : null; };

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
    return { hasKey: !!c.key, keyHint: c.key ? c.key.slice(-4) : '', model: c.model || '', usedModel: mem.model, line: !!c.line, lastErr: mem.lastErr, lastRaw: mem.lastErr ? mem.lastRaw || '' : '', callsToday: mem.day === d.dayKey(Date.now()) ? mem.calls : 0, notes: notes().length };
  }
  return { ask, progress, summary, forecast, trends, trendsCached, lineNote, test, status, runTool, sales, usage, notes, noteAdd, noteDel, MODELS };
};
