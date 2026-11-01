// ทดสอบ AI ฝั่งเซิร์ฟเวอร์ ED POS (ai-engine.js) ด้วย Gemini ปลอม: node kitchen/test/test-ai-server.js
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), { spawn } = require('child_process');
let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };

// ---------- Gemini ปลอม ----------
const seen = [];
let mode = {};
const gem = parts => JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] });
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
    const body = JSON.parse(b || '{}'), model = decodeURIComponent(req.url.split('/models/')[1].split(':')[0]);
    seen.push({ model, key: req.headers['x-goog-api-key'], body });
    const send = (code, t) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(t); };
    if (model === 'gemini-3.5-flash') return send(404, JSON.stringify({ error: { code: 404, message: 'models/gemini-3.5-flash is not found' } }));   // รุ่นแรกเลิกแล้ว → ต้องลองรุ่นถัดไป
    const sys = JSON.stringify(body.systemInstruction || '');
    const fns = (body.tools || []).flatMap(t => t.functionDeclarations || []).map(f => f.name);
    if (fns.includes('respond')) {
      const lastUser = body.contents[body.contents.length - 1].parts;
      if (lastUser.some(p => p.functionResponse)) {
        const got = Object.fromEntries(lastUser.map(p => [p.functionResponse.name, p.functionResponse.response.result]));
        mode.got = got;
        return send(200, gem([{ functionCall: { name: 'respond', args: { answer: `**ขายได้ ${got.get_sales.sales} บาท** จาก ${got.get_sales.payments_count} ครั้ง\n- ขายดี ${got.get_sales.top_items[0].name}`,
          chart: { type: 'bar', title: 'เมนูขายดี', unit: 'จาน', labels: got.get_sales.top_items.map(x => x.name), values: got.get_sales.top_items.map(x => x.qty) }, followups: ['เทียบสัปดาห์ที่แล้ว'] } } }]));
      }
      return send(200, gem([{ functionCall: { name: 'get_sales', args: { from: mode.today, to: mode.today } }, thoughtSignature: 'sig1' }, { functionCall: { name: 'get_dish_cost', args: {} } }]));
    }
    if (body.tools && body.tools.some(t => t.google_search)) {
      if (mode.noSearch) return send(400, JSON.stringify({ error: { code: 400, message: 'Search Grounding is not supported' } }));
      const input = JSON.parse(body.contents[0].parts[0].text);
      mode.fcInput = input;
      const d0 = input.base_forecast[0].date;
      return send(200, JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '```json\n' + JSON.stringify({ overview: 'สัปดาห์นี้มีวันหยุดยาว', days: [{ date: d0, pct: 200, reason: 'วันหยุดยาว นักท่องเที่ยวเยอะ', events: ['วันหยุดยาว'] }] }) + '\n```' }] },
        groundingMetadata: { webSearchQueries: ['bangkok events'], groundingChunks: [{ web: { title: 'TAT', uri: 'https://www.tourismthailand.org' } }] } }] }));
    }
    if (body.generationConfig && body.generationConfig.responseMimeType === 'application/json') {
      mode.summaryInput = JSON.parse(body.contents[0].parts[0].text);
      return send(200, gem([{ text: JSON.stringify({ headline: 'ยอดดีขึ้นจากกุ้ง', tone: 'up', story: 'ลูกค้าสั่งกุ้งเยอะ', good: [{ t: 'กุ้งขายดี', d: '6 จาน' }], watch: [], todo: [{ t: 'เตรียมกุ้งเพิ่ม', d: 'พรุ่งนี้วันหยุด' }], numbers: [{ label: 'ยอด', value: '1,140' }] }) }]));
    }
    if (/นักพยากรณ์/.test(sys)) { const input = JSON.parse(body.contents[0].parts[0].text); return send(200, gem([{ text: JSON.stringify({ overview: 'ไม่ได้ค้นเว็บ', days: [{ date: input.base_forecast[0].date, pct: 5, reason: 'ช่วงไฮซีซั่น' }] }) }])); }
    return send(200, gem([{ text: 'พร้อม' }]));
  });
});

const SRC = path.join(__dirname, '../../app/src/main/assets/edpos');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edpos-'));
fs.cpSync(SRC, dir, { recursive: true });
fs.copyFileSync(path.join(SRC, '../edpos-seed.json'), path.join(dir, 'data.json'));
const PORT = 39000 + Math.floor(Math.random() * 900), GPORT = PORT + 1000;
let srv;
const done = code => { if (srv) srv.kill(); fake.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(code); };
const B = 'http://localhost:' + PORT;
let T = '';
async function api(p, body) {
  const r = await fetch(B + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-pin-token': T }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200) throw new Error(j.error || String(r.status));
  return j;
}
const err = p => p.then(() => null, e => e.message);
fake.listen(GPORT, async () => {
  srv = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, PORT: String(PORT), EDPOS_GEMINI_URL: 'http://localhost:' + GPORT }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/auth'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    await api('/api/auth/setup', { pin: '1234' });
    T = (await api('/api/login', { pin: '1234', want: 'admin' })).token;
    const staff = (await api('/api/login', { pin: '1234', want: 'staff' })).token;
    // ยังไม่มีคีย์
    ok(/API key/.test(await err(api('/api/ai/ask', { q: 'ยอดวันนี้' }))), 'ไม่มีคีย์ → บอกให้ใส่');
    ok(/รูปแบบ/.test(await err(api('/api/ai/settings', { key: 'abc' }))), 'คีย์สั้น/ผิดรูปแบบ → ไม่รับ');
    const KEY = 'AIzaSyFAKE_key-1234567890abcdef';
    let st = await api('/api/ai/settings', { key: KEY, line: true });
    ok(st.hasKey && st.keyHint === 'cdef' && st.line && !JSON.stringify(st).includes(KEY), 'ตั้งคีย์ (ตอบกลับไม่มีคีย์เต็ม)');
    const state = await api('/api/state');
    ok(state.settings.ai.hasKey && !JSON.stringify(state).includes(KEY), 'หน้าเว็บไม่เห็นคีย์');
    const sr = await fetch(B + '/api/ai/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-pin-token': staff }, body: '{"q":"x"}' });
    ok(sr.status === 401, 'รหัสพนักงานใช้ AI ไม่ได้ (เจ้าของร้านเท่านั้น)');
    const t = await api('/api/ai/test', {});
    ok(t.ok && t.reply === 'พร้อม' && t.model === 'gemini-3.1-flash' && seen[0].model === 'gemini-3.5-flash' && seen[1].key === KEY, 'ทดสอบคีย์ + รุ่นแรก 404 → ใช้รุ่นถัดไป: ' + t.model);

    // ขายของ
    const menu = state.menu, fr = menu.find(m => m.name === 'ข้าวผัด');
    for (const [meat, size, n] of [['กุ้ง', 'M', 2], ['กุ้ง', 'L', 1], ['ไก่', 'S', 3]]) {
      const o = await api('/api/order', { table: meat + size, items: [{ menuId: fr.id, qty: n, choices: [{ g: 'เนื้อสัตว์', c: meat }, { g: 'ขนาด', c: size }] }] });
      await api('/api/order/pay', { orderId: o.orderId, method: 'cash' });
    }
    const tea = await api('/api/order', { table: 'tea', items: [{ custom: { name: 'ชาเย็น', price: 40 }, qty: 2 }] });
    await api('/api/order/pay', { orderId: tea.orderId, method: 'transfer' });
    mode.today = (await api('/api/pace')).date;

    // ถาม AI: เรียกเครื่องมือ 2 ตัวพร้อมกัน แล้วตอบ + กราฟ
    seen.length = 0;
    const a = await api('/api/ai/ask', { q: 'วันนี้เป็นยังไง', history: [{ q: 'สวัสดี', a: 'สวัสดีค่ะ' }] });
    ok(/ขายได้ \d+ บาท/.test(a.answer) && a.tools.join() === 'get_sales,get_dish_cost' && a.chart && a.chart.type === 'bar' && a.chart.values.join() === '6,2' && a.followups.length === 1, 'ถาม AI: ' + a.answer.split('\n')[0]);
    ok(mode.got.get_sales.dishes === 6 + 0 || mode.got.get_sales.dishes > 0, 'AI ได้ยอดจริงจากเครื่องมือ: ' + JSON.stringify({ sales: mode.got.get_sales.sales, dishes: mode.got.get_sales.dishes }));
    const second = seen[1].body.contents;
    ok(second.length === 5 && second[3].parts[0].thoughtSignature === 'sig1' && second[0].parts[0].text === 'สวัสดี', 'ส่งประวัติแชท + thought signature กลับครบ');
    ok(/ไม่ได้นับสต๊อก/.test(JSON.stringify(seen[0].body.systemInstruction)), 'บอก AI ว่าร้านไม่ได้นับสต๊อก');

    // สรุปร้าน (จำผลไว้)
    seen.length = 0;
    const s1 = await api('/api/ai/summary', { from: mode.today, to: mode.today });
    ok(s1.headline === 'ยอดดีขึ้นจากกุ้ง' && s1.tone === 'up' && s1.todo[0].t === 'เตรียมกุ้งเพิ่ม' && mode.summaryInput.sales.sales > 0 && mode.summaryInput.period.includes_today, 'สรุปร้านด้วย AI');
    const s2 = await api('/api/ai/summary', { from: mode.today, to: mode.today });
    ok(s2.cached && seen.length === 1, 'ขอซ้ำ → ใช้ผลเดิม ไม่เรียก AI ซ้ำ');
    const o = await api('/api/order', { table: 'x', items: [{ menuId: fr.id, qty: 1, choices: [{ g: 'เนื้อสัตว์', c: 'หมู' }, { g: 'ขนาด', c: 'S' }] }] });
    await api('/api/order/pay', { orderId: o.orderId, method: 'cash' });
    const s3 = await api('/api/ai/summary', { from: mode.today, to: mode.today });
    ok(!s3.cached && seen.length === 2, 'ยอดเปลี่ยน → วิเคราะห์ใหม่');

    // พยากรณ์: ยังไม่มีข้อมูลย้อนหลัง → บอกตรงๆ (ไม่เรียก AI)
    seen.length = 0;
    const fe = await err(api('/api/ai/forecast', {}));
    ok(/ข้อมูล/.test(fe || '') && seen.length === 0, 'พยากรณ์ตอนข้อมูลน้อย: ' + fe);
    // ใส่ยอดย้อนหลัง 4 สัปดาห์ (ก๊อปบิลวันนี้ไปวันก่อนๆ) แล้วเปิดเซิร์ฟเวอร์ใหม่
    srv.kill(); await new Promise(r => setTimeout(r, 600));
    const dj = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
    const paid = dj.orders.filter(x => x.status === 'paid');
    const shift = (x, ms) => JSON.parse(JSON.stringify(x), (k, v) => typeof v === 'number' && /At$|^at$/.test(k) && v > 1e12 ? v - ms : v);
    for (let day = 1; day <= 28; day++) for (const po of paid) {
      const nid = po.id + 'h' + day, no = shift(po, day * 864e5); no.id = nid; dj.orders.push(no);
      for (const it of dj.items.filter(i => i.orderId === po.id)) { const ni = shift(it, day * 864e5); ni.id = it.id + 'h' + day; ni.orderId = nid; dj.items.push(ni); }
    }
    fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(dj));
    srv = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, PORT: String(PORT), EDPOS_GEMINI_URL: 'http://localhost:' + GPORT }, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/auth'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    seen.length = 0;
    const f1 = await api('/api/ai/forecast', {});
    const d0 = f1.days[0];
    ok(f1.days.length >= 6 && d0.pct === 80 && d0.sales === Math.round(d0.base * 1.8) && /วันหยุดยาว/.test(d0.reason) && f1.days[1].pct === 0, 'AI ปรับพยากรณ์ (จำกัด +80%): ' + JSON.stringify(d0));
    ok(f1.searched && f1.sources[0].uri.includes('tourismthailand') && mode.fcInput.last_8_weeks.length >= 20 && seen[0].body.tools[0].google_search, 'ค้นเว็บ + ส่งยอด 8 สัปดาห์ให้ AI');
    const n1 = seen.length;
    const f2 = await api('/api/ai/forecast', {});
    ok(f2.cached && seen.length === n1, 'พยากรณ์วันละครั้ง (ขอซ้ำใช้ผลเดิม)');
    mode.noSearch = true; seen.length = 0;
    const f3 = await api('/api/ai/forecast', { force: true });
    ok(seen.length === 2 && !seen[1].body.tools && !f3.searched && f3.days[0].pct === 5, 'รุ่นที่ค้นเว็บไม่ได้ → ลองใหม่แบบไม่ค้น: ' + f3.days[0].reason);
    console.log(fail ? `${fail} FAILED` : 'all passed');
    done(fail ? 1 : 0);
  } catch (e) { console.log('ERR', e.stack); done(1); }
});
