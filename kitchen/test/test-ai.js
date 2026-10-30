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
const menu = [{ id: 'm1', name: 'ต้มยำกุ้ง' }, { id: 'm2', name: 'ผัดไทย', available: false }];
const req2 = A.buildRequest({ text: 'ทำไมวันนี้ยอดตก', orders, menuList: menu, manager: { today: { pace_pct: -20 } } });
ok(/ผู้จัดการ/.test(req2.systemInstruction.parts[0].text) && /"menu_list"/.test(req2.contents[0].parts[0].text) && /"closed":true/.test(req2.contents[0].parts[0].text), 'manager request');
r = A.toResult(A.parseResponse(gem({ say: 'ปิดต้มยำกุ้งใช่ไหมคะ', action: { type: 'menu_off', menu_ids: ['m1', 'm2', 'x'] } })), orders, { menu });
ok(r.kind === 'menu-off' && r.calls.length === 1 && r.calls[0].body.available === false && r.undo[0].body.available === true, 'menu_off validated');
r = A.toResult(A.parseResponse(gem({ say: 'ok', action: { type: 'menu_on', menu_ids: ['m1'] } })), orders, { menu });
ok(r.kind === 'ai' && !r.calls, 'menu_on on already-open menu → no action');
const stock = { list: [{ id: 'g1', name: 'กุ้ง', unit: 'กรัม', tracked: true, stock: 1200 }, { id: 'g2', name: 'นม', unit: 'มล.', tracked: false }] };
r = A.toResult(A.parseResponse(gem({ say: 'รับกุ้ง 2000 กรัม 800 บาท ใช่ไหมคะ', action: { type: 'stock_move', ingredient_id: 'g1', kind: 'in', qty: 2000, cost: 800 } })), orders, { stock });
ok(r.kind === 'stock-move' && r.confirm && r.calls[0].body.cost === 800 && r.undo[0].body.delta === -2000, 'AI stock in');
r = A.toResult(A.parseResponse(gem({ say: 'x', action: { type: 'stock_move', ingredient_id: 'g2', kind: 'count', qty: 900 } })), orders, { stock });
ok(r.calls[0].path === '/api/stock/setup' && r.undo[0].body.track === false, 'AI count untracked → setup');
r = A.toResult(A.parseResponse(gem({ say: 'x', action: { type: 'stock_move', ingredient_id: 'zz', kind: 'in', qty: 1 } })), orders, { stock });
ok(r.kind === 'ai' && !r.calls, 'AI stock unknown id → no action');
const rq = A.buildReceiptRequest('QUJD', [{ id: 'g1', name: 'กุ้ง', unit: 'กรัม' }]);
ok(rq.contents[0].parts[0].inline_data.data === 'QUJD' && /กุ้ง/.test(rq.contents[0].parts[1].text), 'receipt request');
const rc = A.parseReceipt(gem('```json\n' + JSON.stringify({ store: 'แม็คโคร', total: 1290, lines: [{ text: 'กุ้งขาวแช่แข็ง 1กก.x2', ingredient_id: 'g1', qty: 2000, unit: 'กรัม', total: 780 }, { text: 'ถุงร้อน', ingredient_id: 'nope', qty: 1, unit: 'แพ็ค', total: 45 }] }) + '\n```'), [{ id: 'g1' }]);
ok(rc.store === 'แม็คโคร' && rc.lines.length === 2 && rc.lines[0].id === 'g1' && rc.lines[1].id === null, 'parse receipt');
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
