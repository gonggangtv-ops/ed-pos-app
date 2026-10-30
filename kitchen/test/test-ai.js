// ทดสอบส่วน AI (ไม่เรียก Gemini จริง): node kitchen/test/test-ai.js
const A = require('../src/main/assets/ai.js');
const now = Date.now();
const d = (id, name, q, o = [], r = '') => ({ id, name, quantity: q, extra_option: o, remark: r, at: now - 300000 });
const orders = [
  { id: 'o1', table_num: '3', order_type: 'dine_in', order_at: now - 600000, pending_dishes: [d('i1', 'ผัดกะเพรา', 2, ['หมูสับ']), d('i2', 'ต้มยำกุ้ง', 1, [], '⚠ แพ้ถั่ว')] },
  { id: 'o2', table_num: '5', order_type: 'dine_in', order_at: now - 200000, pending_dishes: [d('i3', 'ผัดไทย', 1)] },
];
let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const gem = obj => JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] });

const req = A.buildRequest({ text: 'โต๊ะริมหน้าต่างเหลืออะไร', orders, menu: ['ผัดกะเพรา', 'ต้มยำกุ้ง'], history: [{ u: 'ค้างอะไร', a: 'ค้าง 2 ออเดอร์ค่ะ' }], notes: 'โต๊ะ 3 อยู่ริมหน้าต่าง', particle: 'ครับ' });
ok(req.contents.length === 3 && /ริมหน้าต่าง/.test(req.systemInstruction.parts[0].text) && /"id":"i2"/.test(req.contents[2].parts[0].text), 'request has history, notes, dish ids');
ok(/ครับ/.test(req.systemInstruction.parts[0].text), 'particle ครับ');

let r = A.toResult(A.parseResponse(gem({ say: 'กะเพรา 2 จาน โต๊ะ 3 เสร็จ ใช่ไหมคะ', action: { type: 'done_dishes', dish_ids: ['i1', 'zzz'] } })), orders);
ok(r.kind === 'done-dish' && r.confirm && r.calls.length === 1 && r.calls[0].body.dishes_id === 'i1', 'done_dishes keeps only real ids, needs confirm');
r = A.toResult(A.parseResponse(gem({ say: 'ok', action: { type: 'done_dishes', dish_ids: ['fake'] } })), orders);
ok(r.kind === 'ai' && !r.calls, 'made-up dish ids → no action');
r = A.toResult(A.parseResponse(gem({ say: 'โต๊ะ 5 เสร็จทั้งโต๊ะ ใช่ไหมคะ', action: { type: 'done_table', order_id: 'o2' } })), orders, { screen: 'main' });
ok(r.kind === 'done-table' && r.calls[0].body.screen === 'main' && r.undo.length === 2, 'done_table');
r = A.toResult(A.parseResponse(gem('```json\n{"say":"จับเวลา 5 นาทีค่ะ","action":{"type":"timer","seconds":300,"label":"ซุป"}}\n```')), orders);
ok(r.kind === 'timer' && r.sec === 300 && r.label === 'ซุป', 'timer in code fence');
r = A.toResult(A.parseResponse(gem('ต้มยำใช้ข่า ตะไคร้ ใบมะกรูดค่ะ')), orders);
ok(r.kind === 'ai' && /ข่า/.test(r.say), 'plain text answer');
r = A.parseResponse(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } }));
ok(r.error === 'RESOURCE_EXHAUSTED', 'error body');
ok(/โควตา/.test(A.errorText(429)) && /คีย์/.test(A.errorText(400, 'API key not valid')), 'error texts');
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
