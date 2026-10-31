/*
 * ผู้ช่วยครัว — โหมด "คิดเอง" (test-1.58)
 * AI (Gemini) ค้นข้อมูลร้านเองได้หลายขั้นก่อนตอบ ด้วย function calling:
 *   ยอดขายช่วงไหนก็ได้ (เทียบช่วงก่อน รายวัน รายชั่วโมง เมนู พนักงาน ยกเลิก) · พยากรณ์ 7 วัน · เดือนนี้/คุ้มทุน · ยอดสดวันนี้
 *   สต๊อก/ต้นทุนต่อจาน/ของหาย · วัตถุดิบที่ใช้ · รายการเมนู · อากาศ · จดจำ/ลืมเรื่องของร้าน
 * · เครื่องมือข้อมูลอ่านอย่างเดียว · ทำอะไรกับร้านจริง (กดเสร็จ ปิดเมนู สต๊อก) ทำผ่าน action ของ respond
 *   → ตรวจกับข้อมูลจริงใน ai.js toResult แล้วถามยืนยันก่อนทุกครั้ง (เหมือนเดิม)
 * · ข้อมูลยอดขายต้องเปิดโหมดผู้จัดการ (โทเค็นเจ้าของร้านอยู่ฝั่ง Java)
 * · โหมด auto = แอปให้ AI ตรวจร้านเองเป็นระยะ ถ้าไม่มีเรื่องสำคัญ say ว่าง = ไม่พูด
 * ทดสอบด้วย node (kitchen/test/test-think.js)
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const AI = isNode ? require('./ai.js') : root.KitchenAI;

  // รุ่นที่คิดได้ลึกกว่า lite ก่อน → หมดก็ใช้รุ่น lite เดิม (404 = เลิกให้บริการ → รุ่นถัดไป)
  const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash', 'gemini-flash-latest', 'gemini-2.5-flash', ...AI.MODELS];
  const MAX_ROUNDS = 6;

  const S = (description, extra) => ({ type: 'string', description, ...(extra || {}) });
  const DATE = d => S(d + ' รูปแบบ YYYY-MM-DD');
  const RANGE = { type: 'object', properties: { from: DATE('วันเริ่ม'), to: DATE('วันสุดท้าย (รวมวันนี้ได้)') }, required: ['from', 'to'] };
  const NONE = { type: 'object', properties: {} };

  const TOOL_DEFS = [
    { name: 'get_sales', mgr: true, parameters: RANGE,
      description: 'ยอดขายช่วงวันที่กำหนด (สูงสุด 400 วัน, บิลปิดแล้วเท่านั้น): ยอด บิล เฉลี่ยต่อบิล เทียบช่วงก่อนหน้ายาวเท่ากัน ยอดรายวัน/รายชั่วโมง หมวด เมนูขายดี/ขายไม่ออก ยกเลิก พนักงาน เวลาครัว เวลานั่ง กลับบ้าน' },
    { name: 'get_today_live', mgr: true, parameters: NONE, description: 'วันนี้ตอนนี้: ยอดสะสม บิล เทียบที่คาดและสัปดาห์ที่แล้วช่วงเดียวกัน คาดปิดวัน โต๊ะเปิดอยู่ อากาศ' },
    { name: 'get_forecast', mgr: true, parameters: NONE, description: 'พยากรณ์ 7 วันข้างหน้า: ยอด จำนวนจาน ของที่ควรเตรียม วัตถุดิบ อากาศ วันหยุด และความแม่นของพยากรณ์ที่ผ่านมา' },
    { name: 'get_month', mgr: true, parameters: NONE, description: 'เดือนนี้: ขายแล้ว จุดคุ้มทุน ค่าใช้จ่ายคงที่ % ต้นทุนอาหาร ต้องขายวันละเท่าไร คาดกำไร เทียบเดือนที่แล้ว' },
    { name: 'get_stock', mgr: true, parameters: NONE, description: 'สต๊อกวัตถุดิบ: คงเหลือ ใช้ต่อวัน พอกี่วัน พรุ่งนี้ต้องใช้ ต้องซื้อ ต้นทุนต่อหน่วยและการเปลี่ยนราคา ต้นทุนต่อจาน ของหาย/เสีย 7 วัน ประวัติรับของล่าสุด' },
    { name: 'get_ingredient_usage', mgr: true, parameters: RANGE, description: 'วัตถุดิบที่ใช้ไปตามยอดขายในช่วงวันที่ แยกว่ามาจากเมนู/ตัวเลือกไหน' },
    { name: 'get_menu', mgr: true, parameters: NONE, description: 'รายการเมนูทั้งหมด: id ชื่อ หมวด ราคา ปิดขายอยู่ไหม' },
    { name: 'get_weather', mgr: true, parameters: NONE, description: 'อากาศ/ฝนวันนี้และวันถัดไปที่ร้าน และผลของฝนต่อยอดขายที่ผ่านมา' },
    { name: 'remember', parameters: { type: 'object', properties: { note: S('สิ่งที่ควรจำเกี่ยวกับร้าน เป็นประโยคสั้น') }, required: ['note'] },
      description: 'จดเรื่องของร้านที่ผู้ใช้บอกและควรจำไว้ใช้ครั้งหน้า (ข้อเท็จจริง/ความชอบ/กฎของร้าน) เช่น "ร้านส่งกุ้งมาวันอังคาร" · ไม่จดตัวเลขยอดขายที่ดูได้จากระบบ' },
    { name: 'forget', parameters: { type: 'object', properties: { text: S('คำในเรื่องที่จะลบ') }, required: ['text'] },
      description: 'ลบเรื่องที่เคยจดไว้ เมื่อผู้ใช้บอกว่าไม่จริงแล้ว/ให้ลืม' },
    { name: 'respond', parameters: { type: 'object', required: ['say'], properties: {
      say: S('คำตอบที่จะอ่านออกเสียง ภาษาไทยพูด ไม่มีสัญลักษณ์/อีโมจิ'),
      show: S('รายละเอียดเพิ่มเติมที่แสดงบนจอ (ตัวเลข ตาราง ขั้นตอน) ไม่ต้องใส่ถ้าคำพูดครบแล้ว'),
      action: { type: 'object', description: 'ทำกับร้านจริง (ระบบถามยืนยันผู้ใช้เองก่อน) ใส่เมื่อผู้ใช้สั่งชัดเจนเท่านั้น', properties: {
        type: S('none | done_dishes | done_table | timer | next | menu_off | menu_on | stock_move'),
        dish_ids: { type: 'array', items: { type: 'string' } }, order_id: S('id ออเดอร์'), seconds: { type: 'number' }, label: S('ชื่อตัวจับเวลา'),
        menu_ids: { type: 'array', items: { type: 'string' } }, ingredient_id: S('id วัตถุดิบ'), kind: S('in | waste | count'),
        qty: { type: 'number' }, cost: { type: 'number' } } } } },
      description: 'ตอบผู้ใช้ (เรียกครั้งสุดท้ายเสมอ หลังค้นข้อมูลพอแล้ว)' },
  ];
  // ไม่มีพารามิเตอร์ → ไม่ใส่ parameters (Gemini ไม่รับ object ว่าง)
  const declarations = manager => TOOL_DEFS.filter(t => manager || !t.mgr)
    .map(({ name, description, parameters }) => Object.keys(parameters.properties || {}).length ? { name, description, parameters } : { name, description });

  const WD = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
  function system(p) {
    const pt = p.particle || 'ค่ะ', d = new Date(p.now || Date.now());
    const s = [
      `คุณคือ "${p.name || 'น้องมาม่า'}" ผู้ช่วยในครัวและผู้ช่วยผู้จัดการร้านอาหารไทย Mama Mia Bangkok (ลูกค้าส่วนใหญ่ต่างชาติ) คุยผ่านลำโพงกับพ่อครัว/เจ้าของร้านที่มือไม่ว่าง`,
      `ตอนนี้ ${WD[d.getDay()]} ${p.today || ''} เวลา ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · วันขายตัดรอบตามที่ร้านตั้ง ("วันนี้" = ${p.today || 'วันนี้'})`,
      'คิดเองได้: ใช้เครื่องมือค้นข้อมูลร้านกี่ครั้งก็ได้ (ไม่เกิน 5 รอบ) จนตอบได้จริง เช่น ถามว่าทำไมยอดตก → ดูยอดวันนี้ เทียบสัปดาห์ก่อน ดูรายชั่วโมง ดูอากาศ แล้วค่อยสรุป',
      'วิเคราะห์แบบผู้จัดการร้านที่เก่ง: หาสาเหตุจากตัวเลขจริง เทียบกับช่วงก่อน บอกสิ่งที่ทำได้ทันที 1-3 ข้อ กล้าให้ความเห็นและข้อเสนอของตัวเอง แต่แยกให้ชัดว่าอะไรเป็นตัวเลข อะไรเป็นการเดา',
      'ห้ามแต่งตัวเลข ออเดอร์ เลขโต๊ะ หรือเมนูที่ไม่มีในข้อมูล · ข้อมูลไม่พอให้บอกตรงๆ ว่าขาดอะไร',
      `จบด้วยการเรียก respond เสมอ: say = คำพูดสั้น (ปกติ 1-3 ประโยค ลงท้าย "${pt}") อ่านออกเสียงได้ ไม่มีสัญลักษณ์ · รายละเอียด/ตัวเลขยาวใส่ show (แสดงบนจอ)`,
      'ข้อความผู้ใช้มาจากเสียงพูด อาจสะกดเพี้ยน ให้เดาจากเมนู/คำที่ใกล้ที่สุด ถ้ากำกวมจริงให้ถามกลับสั้นๆ',
      'action ใน respond: done_dishes (dish_ids จากออเดอร์) · done_table (order_id) · timer (seconds, label) · next · menu_off/menu_on (menu_ids จาก get_menu) · stock_move (ingredient_id, kind, qty หน่วยของวัตถุดิบ, cost) · ใส่เมื่อสั่งชัดเจน ระบบถามยืนยันเอง เมื่อมี action ให้ say เป็นคำถามยืนยัน',
      'เรื่องแพ้อาหาร: ตอบตามหมายเหตุ/สูตรในข้อมูลเท่านั้น ไม่แน่ใจให้บอกให้เช็กกับหน้าร้าน',
      'ผู้ใช้บอกเรื่องของร้านที่ควรจำ (วันส่งของ กฎในครัว ความชอบ) → เรียก remember แล้วค่อยตอบ',
    ];
    if (!p.manager) s.push('ตอนนี้ยังไม่ได้เปิดโหมดผู้จัดการ: ไม่มีข้อมูลยอดขาย/สต๊อก ถ้าถามเรื่องนี้ให้บอกว่าต้องใส่รหัสเจ้าของร้านในหน้าตั้งค่า');
    if (p.manager && p.money === false) s.push('เจ้าของร้านตั้งไม่ให้พูดยอดเงินออกเสียง: say ใช้เปอร์เซ็นต์/จำนวนบิล ตัวเลขเงินใส่ใน show ได้');
    if (p.mode === 'auto') s.push(
      'รอบนี้ไม่มีใครถาม: คุณกำลังเดินตรวจร้านเอง ดูข้อมูลที่จำเป็น แล้วเลือกบอกเฉพาะเรื่องที่สำคัญและทำได้ตอนนี้ 1 เรื่อง (เช่น ยอดต่ำผิดปกติและควรทำอะไร ของจะหมดก่อนปิดร้าน ครัวช้าในเมนูไหน พรุ่งนี้ต้องสั่งของ)',
      'ถ้าไม่มีเรื่องใหม่ที่ควรรบกวนครัว ให้ respond say เป็นข้อความว่าง "" · ห้ามพูดซ้ำเรื่องที่บอกไปแล้วด้านล่าง · ไม่ใส่ action');
    if (p.notes) s.push('ข้อมูลร้านที่เจ้าของเขียนไว้:\n' + String(p.notes).slice(0, 3000));
    if (p.memory && p.memory.length) s.push('เรื่องที่คุณจดไว้เอง (เชื่อได้ ใช้ประกอบคำตอบ):\n' + p.memory.map(x => '- ' + x).join('\n'));
    if (p.mode === 'auto' && p.recent && p.recent.length) s.push('บอกไปแล้ววันนี้:\n' + p.recent.map(x => '- ' + x).join('\n'));
    return s.join('\n');
  }

  function firstRequest(p) {
    const data = {
      kitchen_now: AI.snapshot(p.orders || [], p.now || Date.now()),
      current_batch: p.batch ? { name: p.batch.name, dish_ids: p.batch.dishes.map(d => d.id) } : undefined,
      timers: p.timers && p.timers.length ? p.timers : undefined,
      menu_names: p.manager ? undefined : (p.menu || []).slice(0, 300),
    };
    const contents = [];
    for (const h of (p.history || []).slice(-6)) {
      contents.push({ role: 'user', parts: [{ text: h.u }] });
      contents.push({ role: 'model', parts: [{ text: h.a }] });
    }
    const ask = p.mode === 'auto' ? 'ตรวจร้านตอนนี้ แล้วบอกเรื่องที่สำคัญที่สุด 1 เรื่อง (หรือไม่บอกถ้าไม่มี)' : `ผู้ใช้พูดว่า: "${p.text}"`;
    contents.push({ role: 'user', parts: [{ text: `ครัวตอนนี้: ${JSON.stringify(data)}\n\n${ask}` }] });
    return { contents };
  }
  function body(p, contents) {
    return {
      systemInstruction: { parts: [{ text: system(p) }] },
      contents,
      tools: [{ functionDeclarations: declarations(!!p.manager) }],
      toolConfig: { functionCallingConfig: { mode: 'ANY' } },
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    };
  }

  /** คำตอบ Gemini → {content (ไว้ต่อบทสนทนา), calls [{name,args}], text} | {error} */
  function step(text) {
    let j; try { j = JSON.parse(text); } catch { return { error: 'bad' }; }
    if (j.error) return { error: j.error.status || j.error.code || 'error', message: j.error.message };
    const c = j.candidates && j.candidates[0];
    if (!c || !c.content) return { error: j.promptFeedback ? 'blocked' : 'empty' };
    const parts = c.content.parts || [];
    return { content: { role: 'model', parts }, calls: parts.filter(x => x.functionCall).map(x => ({ name: x.functionCall.name, args: x.functionCall.args || {} })),
      text: parts.filter(x => x.text && !x.thought).map(x => x.text).join('').trim() };
  }

  // ---------- ย่อข้อมูลจาก ED POS ให้พอดีกับ AI ----------
  const r1 = n => n == null ? undefined : Math.round(n * 10) / 10;
  const avg = t => t && t.n ? r1(t.sum / t.n) : undefined;
  function sales(r) {
    const s = r.summary || {}, p = r.prev || {}, items = (s.items_list || []).filter(x => x.qty > 0);
    const prevQty = name => { const v = p.items && p.items[name]; return typeof v === 'number' ? v : v && typeof v.qty === 'number' ? v.qty : undefined; };
    const days = (r.days || []).map(d => ({ date: d.date, wd: WD[new Date(d.date + 'T00:00:00').getDay()], bills: d.bills, sales: d.subtotal, dishes: d.dishes }));
    let daily = days.filter(d => d.bills);
    if (daily.length > 62) {   // ช่วงยาว → สรุปรายเดือน
      const m = {}; for (const d of daily) { const k = d.date.slice(0, 7); const x = (m[k] ||= { month: k, days: 0, bills: 0, sales: 0 }); x.days++; x.bills += d.bills; x.sales += d.sales; }
      daily = Object.values(m);
    }
    return {
      from: r.from, to: r.to, days_with_sales: days.filter(d => d.bills).length,
      sales: s.subtotal, bills: s.bills, avg_bill: s.bills ? Math.round(s.subtotal / s.bills) : 0, dishes: s.dishes,
      card_fee: s.fee || undefined, by_method: s.byMethod,
      prev_period: p.from ? { from: p.from, to: p.to, sales: p.subtotal, bills: p.bills, dishes: p.dishes, kitchen_avg_min: p.cook && p.cook.avg != null ? r1(p.cook.avg) : undefined } : undefined,
      daily, sales_by_hour: s.byHour, bills_by_hour: s.billsByHour, categories: s.cats,
      top_items: [...items].sort((a, b) => b.qty - a.qty).slice(0, 25).map(x => ({ name: x.name, qty: x.qty, amount: x.amount, prev_qty: prevQty(x.name) })),
      slow_items: [...items].sort((a, b) => a.qty - b.qty).slice(0, 10).map(x => ({ name: x.name, qty: x.qty })),
      cancelled_dishes: s.cancelled, voided_bills: s.voids, cancel_list: (r.cancels || []).slice(-15),
      staff: s.staff_list, kitchen_avg_min: avg(s.cook), table_avg_min: avg(s.sit), takeaway: s.ta, customer_kind: s.kind,
    };
  }
  const strip = (o, drop) => JSON.parse(JSON.stringify(o, (k, v) => drop.includes(k) ? undefined : v));
  function stock(st) {
    return { list: (st.list || []).map(x => ({ id: x.id, name: x.name, unit: x.unit, on_hand: x.tracked ? x.stock : 'ไม่ได้นับ', min: x.min || undefined,
        per_day: x.perDay || undefined, days_left: x.daysLeft ?? undefined, tomorrow_need: x.tomorrow ?? undefined, to_buy: x.toBuy || undefined,
        cost_per_unit: x.cost || undefined, cost_change_pct: x.cost && x.costPrev ? Math.round((x.cost / x.costPrev - 1) * 100) : undefined, pcs_per_kg: x.perKg || undefined })),
      dish_cost: (st.dishes || []).slice(0, 40), loss_7d: st.gap7, recent_moves: (st.log || []).slice(0, 15) };
  }
  const COMPACT = {
    get_sales: sales,
    get_today_live: x => strip(x, ['series']),
    get_forecast: x => strip(x, ['hours', 'series']),
    get_month: x => strip(x, ['series']),
    get_stock: stock,
    get_ingredient_usage: x => x,
    get_menu: x => ({ menu: (x.menu || []).map(m => ({ id: m.id, name: m.name, cat: m.category, price: m.price, closed: m.available === false || undefined })) }),
    get_weather: x => x,
  };
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  /** เครื่องมือ → URL ของ ED POS (GET) */
  function toolPath(name, a) {
    a = a || {};
    switch (name) {
      case 'get_sales': case 'get_ingredient_usage': {
        if (!ok(a.from) || !ok(a.to)) return { error: 'ใส่วันที่ from/to เป็น YYYY-MM-DD' };
        const [f, t] = a.from <= a.to ? [a.from, a.to] : [a.to, a.from];
        return (name === 'get_sales' ? '/api/report' : '/api/usage') + `?from=${f}&to=${t}`;
      }
      case 'get_today_live': return '/api/pace';
      case 'get_forecast': return '/api/forecast';
      case 'get_month': return '/api/breakeven';
      case 'get_stock': return '/api/stock';
      case 'get_menu': return '/api/state';
      case 'get_weather': return '/api/weather';
    }
    return null;
  }
  // ตัดให้ไม่เกินขนาด (ข้อมูลยาวเกิน = เสียโควตาและช้า)
  function cap(o, max) {
    let s = JSON.stringify(o);
    if (s.length <= max) return o;
    const shrink = v => Array.isArray(v) ? v.slice(0, Math.max(3, Math.floor(v.length / 2))).map(shrink)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shrink(x)])) : v;
    for (let i = 0; i < 6 && s.length > max; i++) { o = shrink(o); s = JSON.stringify(o); }
    return s.length > max ? { note: 'ข้อมูลยาวเกิน ตัดบางส่วน', data: s.slice(0, max) } : { ...o, note: 'ตัดรายการยาวบางส่วนออก' };
  }

  /**
   * คุยกับ AI จนได้คำตอบ
   * @param p {text, mode:'ask'|'auto', orders, menu, history, name, particle, notes, memory[], recent[], manager, money, today, now, batch, timers}
   * @param io {gen(bodyJson) → Promise<{code,text}>, get(path) → Promise<{code,text}>, remember(note), forget(text) → n}
   * @returns {say, show, action, tools:[ชื่อที่ใช้], memo?:[...]} | {error, code, message}
   */
  async function run(p, io) {
    const contents = firstRequest(p).contents, used = [], memo = [];
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const last = round === MAX_ROUNDS;
      const b = body(p, contents);
      if (last) b.tools = [{ functionDeclarations: declarations(false).filter(t => t.name === 'respond') }];   // รอบสุดท้าย: ต้องตอบแล้ว
      const res = await io.gen(JSON.stringify(b));
      if (!res || res.code !== 200) return { error: 'http', code: res ? res.code : 0, message: (() => { try { return JSON.parse(res.text).error.message; } catch { return ''; } })() };
      const st = step(res.text);
      if (st.error) return { error: st.error, code: 200, message: st.message };
      const fin = st.calls.find(c => c.name === 'respond');
      if (fin) return { say: String(fin.args.say || '').trim(), show: String(fin.args.show || '').trim(), action: fin.args.action || { type: 'none' }, tools: used, memo };
      if (!st.calls.length) return { say: st.text, show: '', action: { type: 'none' }, tools: used, memo };   // ตอบเป็นข้อความเฉยๆ
      contents.push(st.content);
      const replies = [];
      for (const c of st.calls) {
        used.push(c.name);
        let out;
        try {
          if (c.name === 'remember') { const n = String(c.args.note || '').trim().slice(0, 200); if (n) { io.remember(n); memo.push(n); } out = { ok: !!n }; }
          else if (c.name === 'forget') out = { removed: io.forget(String(c.args.text || '')) };
          else if (TOOL_DEFS.some(t => t.name === c.name && t.mgr) && !p.manager) out = { error: 'ยังไม่ได้เปิดโหมดผู้จัดการ ดูข้อมูลร้านไม่ได้' };
          else {
            const path = toolPath(c.name, c.args);
            if (!path) out = { error: 'ไม่มีเครื่องมือนี้' };
            else if (path.error) out = path;
            else {
              const r = await io.get(path);
              if (r.code === 401) out = { error: 'สิทธิ์ผู้จัดการหมดอายุ' };
              else if (r.code !== 200) out = { error: 'ติดต่อเครื่อง ED POS ไม่ได้ (' + r.code + ')' };
              else out = cap(COMPACT[c.name](JSON.parse(r.text)), 14000);
            }
          }
        } catch (e) { out = { error: String(e.message || e) }; }
        replies.push({ functionResponse: { name: c.name, response: { result: out } } });
      }
      contents.push({ role: 'user', parts: replies });
    }
    return { error: 'loop' };
  }

  // ---------- ความจำของน้อง ----------
  const memList = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
  function memAdd(s, note) { const l = memList(s).filter(x => x !== note); l.push(note); return l.slice(-40).join('\n'); }
  function memForget(s, text) {
    const t = String(text || '').trim(); if (!t) return { text: s, n: 0 };
    const l = memList(s), keep = l.filter(x => !x.includes(t));
    return { text: keep.join('\n'), n: l.length - keep.length };
  }
  /** เรื่องที่พูดอัตโนมัติไปแล้ว ใกล้กันเกินไหม (กันพูดซ้ำ) */
  function similar(a, b) {
    const g = s => { const t = String(s).replace(/\s+/g, ''), o = new Set(); for (let i = 0; i < t.length - 2; i++) o.add(t.slice(i, i + 3)); return o; };
    const A = g(a), B = g(b); if (!A.size || !B.size) return false;
    let n = 0; for (const x of A) if (B.has(x)) n++;
    return n / Math.min(A.size, B.size) > 0.6;
  }

  const api = { MODELS, TOOL_DEFS, declarations, system, firstRequest, body, step, sales, stock, toolPath, cap, run, memList, memAdd, memForget, similar };
  if (isNode) module.exports = api; else root.KitchenThink = api;
})(this);
