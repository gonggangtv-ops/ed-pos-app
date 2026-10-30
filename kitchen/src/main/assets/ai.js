/*
 * ผู้ช่วยครัว — ส่วนถาม AI (Gemini) ใช้เมื่อเข้าใจคำพูดเองไม่ได้ หรือเป็นคำถามทั่วไป
 * · แอปส่งข้อมูลออเดอร์ค้าง + รายชื่อเมนู + บทสนทนาล่าสุด → AI ตอบเป็น JSON {say, action}
 * · AI ทำอะไรเองไม่ได้: action ทุกอย่างผ่านการตรวจกับออเดอร์จริงในไฟล์นี้ และ "เสร็จ" ต้องพูดยืนยันก่อนเสมอ
 * · ไม่ส่งข้อมูลลูกค้า (ไม่มีชื่อ/เบอร์ในจอครัวอยู่แล้ว) ส่งแค่ชื่อจาน ตัวเลือก หมายเหตุ เลขโต๊ะ
 * ทดสอบด้วย node ได้ (kitchen/test/test-ai.js)
 */
(function (root) {
  'use strict';
  const L = typeof module !== 'undefined' && module.exports ? require('./logic.js') : root.KitchenLogic;

  const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];

  function snapshot(orders, now) {
    return orders.map(o => ({
      id: o.id,
      table: L.tableLabel(o),
      wait_min: L.mins(now, o.order_at),
      dishes: (o.pending_dishes || []).map(d => ({
        id: d.id, name: d.name, qty: d.quantity || 1,
        options: (d.extra_option || []).join(' ') || undefined,
        note: d.remark || undefined,
        wait_min: d.at ? L.mins(now, d.at) : undefined,
      })),
    }));
  }

  /**
   * สร้างคำขอ generateContent
   * @param p {text, orders, menu[], history[{u,a}], name, particle, notes, now, batch, timers[{label,left}]}
   */
  function buildRequest(p) {
    const now = p.now || Date.now();
    const pt = p.particle || 'ค่ะ';
    const sys = [
      `คุณคือ "${p.name || 'น้องมาม่า'}" ผู้ช่วยในครัวร้านอาหารไทย คุยกับพ่อครัวที่กำลังผัดอาหาร มือไม่ว่าง ฟังผ่านลำโพง`,
      `ตอบเป็นภาษาไทยพูด สั้นที่สุดที่ยังครบ (ปกติ 1-2 ประโยค) ลงท้ายด้วย "${pt}" ไม่ใช้สัญลักษณ์ อีโมจิ หรือหัวข้อ เพราะจะถูกอ่านออกเสียง`,
      'ข้อมูลออเดอร์ในข้อความผู้ใช้คือรายการค้างจริงตอนนี้ (เฉพาะที่ยังไม่เสร็จ) ห้ามแต่งออเดอร์/เลขโต๊ะ/จำนวนที่ไม่มีในข้อมูล',
      'ข้อความของผู้ใช้มาจากระบบแปลงเสียงเป็นข้อความ อาจสะกดผิดหรือคำเพี้ยน ให้เดาจากเมนูที่ใกล้เคียงที่สุด ถ้าไม่แน่ใจให้ถามกลับสั้นๆ',
      'ถ้าไม่มีข้อมูล "shop" ห้ามตอบตัวเลขยอดขาย/กำไร/พยากรณ์ ให้บอกว่าต้องเปิดโหมดผู้จัดการ',
      'เรื่องแพ้อาหาร: บอกตามหมายเหตุในข้อมูลเท่านั้น ถ้าถามว่าเมนูไหนปลอดภัยและไม่แน่ใจส่วนผสม ให้บอกว่าควรเช็กสูตร/ถามหน้าร้าน',
      'ตอบคำถามทั่วไปเรื่องทำอาหาร เทคนิค เวลา อุณหภูมิ การเตรียมของได้ (สั้นๆ)',
      'ตอบเป็น JSON เท่านั้น: {"say": "ข้อความที่จะพูด", "action": {"type": "none"}}',
      'action.type ที่ใช้ได้: "none" · "done_dishes" (ทำจานเหล่านี้เสร็จ: "dish_ids": [...] ใช้ id จากข้อมูล) · "done_table" ("order_id") · "timer" ("seconds", "label") · "next" (ผู้ใช้อยากรู้ว่าทำอะไรต่อ)',
      'ใส่ action เมื่อผู้ใช้สั่งชัดเจนเท่านั้น ระบบจะถามยืนยันผู้ใช้เองก่อนทำ เมื่อมี action "done_*" ให้ say เป็นคำถามยืนยัน เช่น "กะเพรา 2 จาน โต๊ะ 3 เสร็จ ใช่ไหม' + (pt === 'ครับ' ? 'ครับ' : 'คะ') + '"',
    ];
    if (p.manager) {
      sys.push(
        'คุณเป็นผู้จัดการร้านด้วย (เจ้าของร้านเปิดโหมดผู้จัดการ): ข้อมูล "shop" คือยอดขาย คุ้มทุน พยากรณ์พรุ่งนี้ ของที่ต้องเตรียม ขายดี เวลาครัว เมนูที่ปิด',
        'ตอบคำถามธุรกิจแบบผู้จัดการที่เก่ง: วิเคราะห์จากตัวเลขจริง บอกสาเหตุที่เป็นไปได้ และแนะนำสิ่งที่ทำได้ทันที 1-3 ข้อ (โปร เมนูแนะนำ ปรับการเตรียมของ ปิดเมนูที่ทำช้าตอนยุ่ง) ห้ามแต่งตัวเลข',
        'ถ้าตัวเลขเงินไม่มีในข้อมูล แปลว่าเจ้าของร้านตั้งไม่ให้พูดยอดเงินออกเสียง ให้พูดเป็นเปอร์เซ็นต์หรือบอกให้ดูบนจอแทน',
        'action เพิ่มเติม: "menu_off" / "menu_on" ("menu_ids": [...] ใช้ id จาก menu_list) เมื่อผู้ใช้สั่งปิด/เปิดเมนู หรือบอกว่าวัตถุดิบหมด/มาแล้ว · ระบบจะถามยืนยันก่อน');
    }
    if (p.notes) sys.push('ข้อมูลเฉพาะร้าน (เจ้าของร้านเขียนไว้):\n' + String(p.notes).slice(0, 4000));

    const data = {
      time: new Date(now).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
      orders: snapshot(p.orders || [], now),
      menu: (p.menu || []).slice(0, 300),
      current_batch: p.batch ? { name: p.batch.name, dish_ids: p.batch.dishes.map(d => d.id) } : undefined,
      timers: p.timers && p.timers.length ? p.timers : undefined,
      shop: p.manager || undefined,
      menu_list: p.manager && p.menuList ? p.menuList.slice(0, 300).map(m => ({ id: m.id, name: m.name, closed: m.available === false || undefined })) : undefined,
    };
    if (data.menu_list) delete data.menu;
    const contents = [];
    for (const h of (p.history || []).slice(-6)) {
      contents.push({ role: 'user', parts: [{ text: h.u }] });
      contents.push({ role: 'model', parts: [{ text: JSON.stringify({ say: h.a, action: { type: 'none' } }) }] });
    }
    contents.push({ role: 'user', parts: [{ text: `ข้อมูลครัวตอนนี้: ${JSON.stringify(data)}\n\nพ่อครัวพูดว่า: "${p.text}"` }] });
    return {
      systemInstruction: { parts: [{ text: sys.join('\n') }] },
      contents,
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 500 },
    };
  }

  /** ข้อความจาก Gemini → {say, action} (ทนกับ JSON ที่มี ``` หรือข้อความปน) */
  function parseResponse(text) {
    let j;
    try { j = JSON.parse(text); } catch { return { error: 'bad' }; }
    if (j.error) return { error: j.error.status || j.error.code || 'error', message: j.error.message };
    const c = j.candidates && j.candidates[0];
    if (!c) return { error: j.promptFeedback ? 'blocked' : 'empty' };
    let t = ((c.content && c.content.parts) || []).map(x => x.text || '').join('').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const m = /\{[\s\S]*\}/.exec(t);
    try {
      const o = JSON.parse(m ? m[0] : t);
      return { say: String(o.say || '').trim(), action: o.action || { type: 'none' } };
    } catch {
      return { say: t.replace(/[{}"]/g, '').trim(), action: { type: 'none' } };
    }
  }

  /** ตรวจ action ของ AI กับออเดอร์จริง → ผลแบบเดียวกับ KitchenLogic.interpret */
  function toResult(r, orders, ctx) {
    ctx = ctx || {};
    const say = L.say(r.say || '');
    const a = r.action || {};
    const all = L.pendingDishes(orders || []);
    if (a.type === 'done_dishes' && Array.isArray(a.dish_ids)) {
      const ds = all.filter(d => a.dish_ids.includes(d.id));
      if (ds.length) {
        const qty = ds.reduce((s, d) => s + (d.quantity || 1), 0);
        const where = L.listTables([...new Set(ds.map(d => L.tableLabel(d.order)))]);
        return { kind: 'done-dish', confirm: true, ai: true, highlight: { orders: ds.map(d => d.order.id), dishes: ds.map(d => d.id) },
          ask: say || `${ds[0].name} ${qty} จาน ${where} เสร็จ ใช่ไหมคะ`, say: `เรียบร้อย ${ds[0].name} ${qty} จาน เสร็จแล้วค่ะ`, ...L.doneDishes(ds) };
      }
    }
    if (a.type === 'done_table' && a.order_id) {
      const o = (orders || []).find(x => x.id === a.order_id);
      if (o) {
        const ds = o.pending_dishes || [];
        return { kind: 'done-table', confirm: true, ai: true, highlight: { orders: [o.id] },
          ask: say || `${L.tableLabel(o)} เสร็จทั้งโต๊ะ ใช่ไหมคะ`, say: `เรียบร้อย ${L.tableLabel(o)} เสร็จแล้วค่ะ`,
          calls: [{ path: '/api/order/complete', body: { order_id: o.id, screen: ctx.screen || '' } }],
          undo: [...ds.map(d => ({ path: '/api/dish/complete', body: { order_id: o.id, dishes_id: d.id, status: 'pending' } })),
            { path: '/api/order/complete', body: { order_id: o.id, screen: ctx.screen || '', status: 'pending' } }] };
      }
    }
    if (a.type === 'timer' && +a.seconds > 0) {
      const sec = Math.min(4 * 3600, Math.round(+a.seconds));
      return { kind: 'timer', sec, label: String(a.label || '').slice(0, 30), say: say || `จับเวลา ${L.fmtSec(sec)} ค่ะ` };
    }
    if ((a.type === 'menu_off' || a.type === 'menu_on') && Array.isArray(a.menu_ids) && ctx.menu) {
      const off = a.type === 'menu_off';
      const ms = ctx.menu.filter(m => a.menu_ids.includes(m.id) && (off ? m.available !== false : m.available === false));
      if (ms.length) {
        const calls = ms.map(m => ({ path: '/api/menu/available', body: { id: m.id, available: !off } }));
        return { kind: off ? 'menu-off' : 'menu-on', confirm: true, ai: true, menus: ms,
          ask: say || `${off ? 'ปิด' : 'เปิด'} ${ms.length} เมนู ใช่ไหมคะ`, say: `${off ? 'ปิด' : 'เปิดขาย'} ${ms.length} เมนูแล้วค่ะ`,
          calls, undo: calls.map(c => ({ path: c.path, body: { ...c.body, available: off } })) };
      }
      return { kind: 'ai', say: off ? 'เมนูนั้นปิดอยู่แล้วหรือหาไม่เจอค่ะ' : 'เมนูนั้นเปิดอยู่แล้วหรือหาไม่เจอค่ะ' };
    }
    if (a.type === 'next') return { kind: 'ai-next' };
    // AI อยากให้ทำ "เสร็จ" แต่ id ไม่ตรงกับของจริง → ไม่ทำ แค่พูด (ไม่ใช้คำถามยืนยันที่ไม่มีอะไรรองรับ)
    if (/^(done|menu)/.test(a.type || '')) return { kind: 'ai', say: 'หาจานที่จะกดเสร็จไม่เจอค่ะ บอกเลขโต๊ะด้วยค่ะ' };
    return { kind: 'ai', say: say || 'ขอโทษค่ะ ตอบไม่ได้' };
  }

  /** ข้อความเมื่อเรียก AI ไม่สำเร็จ */
  function errorText(code, err) {
    if (code === 0) return 'ต่ออินเทอร์เน็ตไม่ได้ ถาม AI ไม่ได้ค่ะ';
    if (code === 429) return 'วันนี้ใช้ AI ครบโควตาฟรีแล้วค่ะ คำสั่งหลักยังใช้ได้ตามปกติ';
    if (code === 400 && /API key|API_KEY/i.test(err || '')) return 'คีย์ AI ไม่ถูกต้องค่ะ ตรวจในหน้าตั้งค่า';
    if (code === 401 || code === 403) return 'คีย์ AI ใช้ไม่ได้ค่ะ ตรวจในหน้าตั้งค่า';
    if (code >= 500) return 'ระบบ AI ไม่ว่างค่ะ ลองใหม่อีกที';
    return 'ถาม AI ไม่สำเร็จค่ะ';
  }

  const api = { MODELS, buildRequest, parseResponse, toResult, errorText, snapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KitchenAI = api;
})(this);
