// ทดสอบโหมดคิดเอง (think.js) ด้วย Gemini ปลอม + เซิร์ฟเวอร์ ED POS จริง: node kitchen/test/test-think.js
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const TH = require('../src/main/assets/think.js');
let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const gem = parts => ({ code: 200, text: JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }) });
const fc = (name, args) => ({ functionCall: { name, args } });

// ---------- เครื่องมือ ----------
const d0 = TH.declarations(false).map(x => x.name), d1 = TH.declarations(true).map(x => x.name);
ok(!d0.includes('get_sales') && d0.includes('respond') && d0.includes('remember') && d1.includes('get_sales') && d1.includes('get_stock'), 'ไม่มีสิทธิ์ผู้จัดการ = ไม่มีเครื่องมือยอดขาย');
ok(TH.declarations(true).every(x => !x.parameters || Object.keys(x.parameters.properties).length), 'ไม่มี parameters ว่าง');
ok(TH.toolPath('get_sales', { from: '2026-10-31', to: '2026-10-01' }) === '/api/report?from=2026-10-01&to=2026-10-31', 'สลับวันที่ให้ถูก');
ok(TH.toolPath('get_sales', { from: 'เมื่อวาน' }).error, 'วันที่ผิดรูปแบบ → error ให้ AI แก้');
const b = TH.body({ manager: true, mode: 'auto', recent: ['กุ้งใกล้หมด'], memory: ['ร้านส่งกุ้งวันอังคาร'], today: '2026-10-31' }, []);
ok(b.toolConfig.functionCallingConfig.mode === 'ANY' && /ตรวจร้านเอง/.test(b.systemInstruction.parts[0].text) && /กุ้งใกล้หมด/.test(b.systemInstruction.parts[0].text)
  && /ร้านส่งกุ้งวันอังคาร/.test(b.systemInstruction.parts[0].text), 'system: โหมด auto + เรื่องที่บอกแล้ว + ความจำ');

// ---------- ความจำ / กันพูดซ้ำ ----------
let mem = TH.memAdd('', 'ร้านส่งกุ้งวันอังคาร'); mem = TH.memAdd(mem, 'ต้นทุนไม่เกิน 35%'); mem = TH.memAdd(mem, 'ร้านส่งกุ้งวันอังคาร');
ok(TH.memList(mem).length === 2 && TH.memList(mem)[1] === 'ร้านส่งกุ้งวันอังคาร', 'จดซ้ำ = ย้ายไปล่าสุด');
const fg = TH.memForget(mem, 'กุ้ง'); ok(fg.n === 1 && !/กุ้ง/.test(fg.text), 'ลืม');
ok(TH.similar('กุ้งใกล้หมดแล้ว เหลือ 20 ตัว', 'กุ้งใกล้หมดแล้วค่ะ เหลือ 20 ตัว') && !TH.similar('กุ้งใกล้หมด', 'ยอดวันนี้ต่ำกว่าที่คาด'), 'จับเรื่องซ้ำ');
const big = { a: Array.from({ length: 500 }, (_, i) => ({ i, name: 'x'.repeat(30) })) };
const c = TH.cap(big, 4000); ok(JSON.stringify(c).length <= 4200 && c.note, 'ตัดข้อมูลยาว: ' + JSON.stringify(c).length);

// ---------- run กับเซิร์ฟเวอร์จริง ----------
const SRC = path.join(__dirname, '../../app/src/main/assets/edpos');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edpos-'));
fs.cpSync(SRC, dir, { recursive: true });
fs.copyFileSync(path.join(SRC, '../edpos-seed.json'), path.join(dir, 'data.json'));
const PORT = 39000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const done = code => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(code); };
const B = 'http://localhost:' + PORT;
let T = '';
async function api(p, body) {
  const r = await fetch(B + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-pin-token': T }, body: body ? JSON.stringify(body) : undefined });
  return { code: r.status, text: await r.text() };
}
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/auth'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  await api('/api/auth/setup', { pin: '1234' });
  T = JSON.parse((await api('/api/login', { pin: '1234', want: 'admin' })).text).token;
  const st = JSON.parse((await api('/api/state')).text);
  const fr = st.menu.find(m => m.name === 'ข้าวผัด');
  for (const [t, meat, size] of [['1', 'กุ้ง', 'M'], ['2', 'ไก่', 'S'], ['3', 'กุ้ง', 'L']]) {
    const o = JSON.parse((await api('/api/order', { table: t, items: [{ menuId: fr.id, qty: 2, choices: [{ g: 'เนื้อสัตว์', c: meat }, { g: 'ขนาด', c: size }] }] })).text);
    await api('/api/order/pay', { orderId: o.orderId, method: 'cash' });
  }
  const today = JSON.parse((await api('/api/pace')).text).date;

  // AI: ดูยอดวันนี้ + เมนู → จดความจำ → ตอบ
  const sent = [], memory = [];
  const script = [
    gem([fc('get_sales', { from: today, to: today }), fc('get_menu', {})]),
    gem([{ text: 'กำลังคิด', thought: true }, fc('remember', { note: 'เจ้าของอยากเน้นขายข้าวผัดกุ้ง' })]),
    gem([fc('respond', { say: 'วันนี้ขายข้าวผัด 6 จาน กุ้งขายดีกว่าไก่ค่ะ', show: 'ข้าวผัด 6 จาน', action: { type: 'none' } })]),
  ];
  const io = { gen: async body => { sent.push(JSON.parse(body)); return script.shift(); }, get: p => api(p), remember: n => memory.push(n), forget: () => 0 };
  const r = await TH.run({ text: 'วันนี้อะไรขายดี ทำไม', manager: true, today, orders: [], menu: [] }, io);
  ok(r.say === 'วันนี้ขายข้าวผัด 6 จาน กุ้งขายดีกว่าไก่ค่ะ' && r.show && r.tools.join() === 'get_sales,get_menu,remember' && memory[0] === 'เจ้าของอยากเน้นขายข้าวผัดกุ้ง', 'คิดหลายขั้นแล้วตอบ: ' + r.tools);
  const resp = sent[1].contents[sent[1].contents.length - 1].parts;
  const sales = resp.find(x => x.functionResponse.name === 'get_sales').functionResponse.response.result;
  const menu = resp.find(x => x.functionResponse.name === 'get_menu').functionResponse.response.result;
  ok(sales.bills === 3 && sales.dishes === 6 && sales.top_items[0].name === 'ข้าวผัด' && sales.avg_bill > 0, 'ส่งยอดจริงให้ AI: ' + JSON.stringify({ bills: sales.bills, sales: sales.sales, top: sales.top_items[0] }));
  ok(menu.menu.length > 100 && menu.menu[0].id && !('grid' in menu.menu[0]), 'ส่งเมนูแบบย่อ ' + menu.menu.length + ' เมนู');
  ok(sent[1].contents.some(c => c.role === 'model' && c.parts.some(x => x.functionCall)), 'ส่งคำเรียกเครื่องมือกลับไปในบทสนทนา (thought signature อยู่ครบ)');

  // ไม่มีสิทธิ์ผู้จัดการ แต่ AI ยังเรียก get_sales → ได้ error ไม่ยิงเซิร์ฟเวอร์
  let got = 0; const s2 = [gem([fc('get_sales', { from: today, to: today })]), gem([fc('respond', { say: 'ต้องเปิดโหมดผู้จัดการก่อนค่ะ' })])], sent2 = [];
  const r2 = await TH.run({ text: 'ยอดวันนี้', manager: false, today }, { gen: async x => { sent2.push(JSON.parse(x)); return s2.shift(); }, get: async () => { got++; return { code: 200, text: '{}' }; }, remember() {}, forget() {} });
  ok(got === 0 && /ผู้จัดการ/.test(JSON.stringify(sent2[1].contents.slice(-1))) && r2.say, 'ไม่มีสิทธิ์ = ไม่ดึงยอด');

  // วนเรียกเครื่องมือไม่จบ → รอบสุดท้ายบังคับให้ตอบ
  let n = 0; const sent3 = [];
  const r3 = await TH.run({ text: 'x', manager: true, today }, { gen: async x => { sent3.push(JSON.parse(x)); n++; return n <= 6 ? gem([fc('get_weather', {})]) : gem([fc('respond', { say: 'สรุปค่ะ' })]); }, get: p => api(p), remember() {}, forget() {} });
  ok(r3.say === 'สรุปค่ะ' && sent3[sent3.length - 1].tools[0].functionDeclarations.length === 1, 'รอบสุดท้ายเหลือแค่ respond');

  // Gemini error → ส่งต่อให้แอปเลือกทางสำรอง
  const r4 = await TH.run({ text: 'x', today }, { gen: async () => ({ code: 400, text: JSON.stringify({ error: { message: 'Function calling is not enabled' } }) }), get() {}, remember() {}, forget() {} });
  ok(r4.error === 'http' && r4.code === 400 && /Function/.test(r4.message), 'error 400 ส่งต่อ');
  // ตอบเป็นข้อความเฉยๆ (ไม่เรียก respond)
  const r5 = await TH.run({ text: 'x', today }, { gen: async () => gem([{ text: 'สวัสดีค่ะ' }]), get() {}, remember() {}, forget() {} });
  ok(r5.say === 'สวัสดีค่ะ', 'ข้อความเฉยๆ ก็ใช้ได้');
  console.log(fail ? `${fail} FAILED` : 'all passed');
  done(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e.stack); done(1); });
