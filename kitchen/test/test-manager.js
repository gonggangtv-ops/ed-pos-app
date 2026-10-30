// ทดสอบโหมดผู้จัดการ (ไม่ต่อเครื่องจริง): node kitchen/test/test-manager.js
const M = require('../src/main/assets/manager.js');
let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
const menu = [
  { id: 'm1', name: 'ต้มยำกุ้ง' }, { id: 'm2', name: 'กุ้งผัดพริกเกลือ' }, { id: 'm3', name: 'ผัดกะเพรา' },
  { id: 'm4', name: 'ผัดไทย', available: false }, { id: 'm5', name: 'ข้าวผัดปู' }, { id: 'm6', name: 'ยำวุ้นเส้น' },
];
const ingredients = [{ id: 'ing1', name: 'วุ้นเส้น', unit: 'กรัม', uses: [{ t: 'm', r: 'm6', q: 80 }, { t: 'm', r: 'm1', q: 30 }] }];
const ctx = { menu, ingredients, optionNames: ['ไข่ดาว', 'หมูสับ'] };
const P = t => M.parse(t, ctx);
let r;
r = P('กุ้งหมด'); ok(r.kind === 'menu-off' && r.menus.length === 2 && r.calls.every(c => c.body.available === false) && r.undo[0].body.available === true, 'กุ้งหมด → ปิด 2 เมนู: ' + r.ask);
r = P('ปิดเมนูผัดกะเพรา'); ok(r.kind === 'menu-off' && r.menus[0].id === 'm3', 'ปิดเมนูผัดกะเพรา: ' + r.ask);
r = P('กระเพราหมดแล้ว'); ok(r.kind === 'menu-off' && r.menus[0].id === 'm3', 'กระเพรา (สะกดเพี้ยน) หมดแล้ว');
r = P('วุ้นเส้นหมด'); ok(r.kind === 'menu-off' && r.menus.length === 2, 'วัตถุดิบวุ้นเส้นหมด → 2 เมนู: ' + r.ask);
r = P('เปิดเมนูผัดไทย'); ok(r.kind === 'menu-on' && r.calls[0].body.available === true, 'เปิดเมนูผัดไทย');
r = P('ผัดไทยมาแล้ว'); ok(r.kind === 'menu-on', 'ผัดไทยมาแล้ว');
r = P('ผัดไทยหมด'); ok(r.kind === 'say' && /ปิดอยู่แล้ว/.test(r.say), 'ผัดไทยปิดอยู่แล้ว');
r = P('ไข่ดาวหมด'); ok(r.kind === 'say' && /ตัวเลือก/.test(r.say), 'ไข่ดาว = ตัวเลือก');
r = P('ปลาหมึกหมด'); ok(r.kind === 'notfound', 'ไม่มีเมนูปลาหมึก');
ok(P('ปิดเสียง') === null && P('ปิดไมค์') === null, 'ปิดเสียง ไม่ใช่เมนู');
for (const [t, topic] of [['วันนี้ขายได้เท่าไร', 'today'], ['ยอดตอนนี้', 'today'], ['เดือนนี้คุ้มทุนยัง', 'month'], ['พรุ่งนี้ต้องเตรียมอะไร', 'tomorrow'],
  ['ต้องซื้อของอะไร', 'tomorrow'], ['เมนูไหนขายดี', 'top'], ['อะไรขายไม่ออก', 'top'], ['ครัวช้าไหมวันนี้', 'speed'], ['สรุปวันนี้', 'day'],
  ['สรุปสัปดาห์', 'week'], ['เมนูไหนปิดอยู่', 'closed'], ['สัปดาห์หน้าวันไหนยุ่ง', 'week-ahead'], ['โต๊ะเปิดกี่โต๊ะ', 'today']]) {
  r = P(t); ok(r && r.topic === topic, `${t} → ${r && r.topic}`);
}
ok(P('โต๊ะ 3 เสร็จ') === null && P('ค้างอะไรบ้าง') === null && P('กะเพรากี่จาน') === null, 'คำสั่งครัวไม่ชนกับผู้จัดการ');

const now = Date.parse('2026-10-31T13:00:00+07:00');
const pace = { date: '2026-10-31', actual: 8200, bills: 21, expected: 10500, pace: -22, projected: 19800, forecast: 21000, high: 25000, openTables: 4, openDue: 1350, lastWeekNow: 9800 };
console.log('  ' + M.answer({ topic: 'today' }, { pace }, { now }));
console.log('  ' + M.answer({ topic: 'today' }, { pace }, { now, money: false }));
const breakeven = { month: '2026-10', soldNow: 420000, be: 380000, need: 0, leftDays: 1, profit: 52000, foodPct: 35 };
console.log('  ' + M.answer({ topic: 'month' }, { breakeven }, { now }));
console.log('  ' + M.answer({ topic: 'month' }, { breakeven: { ...breakeven, soldNow: 300000, need: 16000, leftDays: 5, cross: '2026-11-04' } }, { now }));
const forecast = { days: [{ date: '2026-11-01', dow: 0, sales: 24500, dishes: 180, tag: 'busy', pct: 18, wx: { prob: 70 }, peak: { from: 18, to: 20 },
  prep: [{ name: 'ผัดกะเพรา', qty: 32, hi: 40 }, { name: 'ต้มยำกุ้ง', qty: 12, hi: 15 }], use: [{ name: 'กุ้ง', qty: 1800, hi: 2300, unit: 'กรัม' }] },
  { date: '2026-11-02', dow: 1, sales: 15000, tag: 'quiet', pct: -20 }] };
r = M.answer({ topic: 'tomorrow' }, { forecast }, { now }); ok(/อาทิตย์/.test(r) && /กะเพรา 40/.test(r) && /กุ้ง 2.3 กิโล/.test(r) && /ฝน/.test(r), r);
r = M.answer({ topic: 'week-ahead' }, { forecast }, { now }); ok(/ยุ่ง วันอาทิตย์/.test(r) && /เงียบ วันจันทร์/.test(r), r);
const report = { summary: { items_list: [{ name: 'ผัดกะเพรา', qty: 30, amount: 2700 }, { name: 'ยำวุ้นเส้น', qty: 2, amount: 180 }, { name: 'ต้มยำกุ้ง', qty: 11, amount: 2200 }],
  cook: { n: 40, sum: 480, b: [10, 20, 6, 3, 1], items: { 'ต้มยำกุ้ง': { n: 10, sum: 190 }, 'ผัดกะเพรา': { n: 20, sum: 180 } } }, cancelled: { qty: 6, amount: 640 }, voids: { bills: 1 } } };
console.log('  ' + M.answer({ topic: 'top' }, { report }));
console.log('  ' + M.answer({ topic: 'top', worst: true }, { report }));
console.log('  ' + M.answer({ topic: 'speed' }, { report }));
console.log('  ' + M.answer({ topic: 'closed' }, { state: { menu } }));
r = M.speakable('📊 สรุปยอดขาย Mama Mia\nวันเสาร์ 31 ต.ค. 2569\n\n💰 ยอดขาย 18,200 ฿\n▲ 12% จากวันเสาร์ที่แล้ว\n🏆 ขายดี\n1. ผัดกะเพรา × 30\nความแม่นสูง');
ok(!/[💰▲฿×]/u.test(r) && /18,200 บาท/.test(r) && !/ความแม่น/.test(r), 'speakable: ' + r);

// แจ้งเตือน
const s = {}, opt = { pace: true, paceDrop: 20, milestone: true, backlog: true, backlogN: 6, cancel: true, lateMin: 15 };
let a = M.alerts(s, { pace, now }, opt); ok(a.length === 0, 'รอบแรกไม่พูด (จำสถานะไว้ก่อน)');
a = M.alerts(s, { pace: { ...pace }, now: now + 91 * 60000 }, opt); ok(a.some(x => /ต่ำกว่าที่คาด 22%/.test(x)), 'ยอดต่ำ: ' + a.join(' | '));
a = M.alerts(s, { pace: { ...pace }, now: now + 100 * 60000 }, opt); ok(!a.length, 'ไม่เตือนยอดต่ำซ้ำภายใน 90 นาที');
a = M.alerts(s, { pace: { ...pace, actual: 21500, pace: 3 }, now: now + 200 * 60000 }, opt); ok(a.some(x => /ทะลุยอดที่คาด/.test(x)), 'ทะลุยอดคาด: ' + a);
a = M.alerts(s, { pace: { ...pace, actual: 22000, pace: 5 }, now: now + 210 * 60000 }, opt); ok(!a.some(x => /ทะลุ/.test(x)), 'ไม่พูดทะลุซ้ำ');
const t0 = now + 300 * 60000, dd = (id, n) => ({ id, name: 'ผัดกะเพรา', quantity: n, extra_option: [] });
const orders = [{ id: 'o1', table_num: '3', order_type: 'dine_in', order_at: t0 - 30 * 60000, pending_dishes: [dd('a', 3)] },
  { id: 'o2', table_num: '5', order_type: 'dine_in', order_at: t0 - 5 * 60000, pending_dishes: [dd('b', 4)] }];
a = M.alerts(s, { orders, now: t0 }, opt); ok(a.some(x => /ครัวค้าง 7 จาน รอนานสุด 30 นาที แนะนำทำรวม ผัดกะเพรา 7/.test(x)), 'ครัวค้าง: ' + a);
a = M.alerts(s, { report: { summary: { cancelled: { qty: 4 } } }, now: t0 }, opt);
a = M.alerts(s, { report: { summary: { cancelled: { qty: 6 } } }, now: t0 + 60000 }, opt); ok(a.some(x => /ยกเลิกไปแล้ว 6 จาน/.test(x)), 'ยกเลิกถึง 5: ' + a);
a = M.alerts(s, { breakeven: { month: '2026-10', be: 380000, soldNow: 381000 }, pace: { ...pace, actual: 5000, pace: 3 }, now: t0 + 2 * 60000 }, opt);
ok(a.some(x => /คุ้มทุน/.test(x)), 'ถึงจุดคุ้มทุนวันนี้: ' + a);
const ctxAi = M.aiContext({ pace, breakeven, forecast: { days: [{ ...forecast.days[0], date: M.dayKey(Date.now(), 1) }] }, report, state: { menu } }, false);
ok(ctxAi.today.sales === undefined && ctxAi.today.bills === 21 && ctxAi.menus_closed[0] === 'ผัดไทย' && ctxAi.tomorrow.prep.length === 2, 'AI context ซ่อนเงินได้');
// ---------- สต๊อก ----------
const stock = { hasLine: true, tomorrow: { date: '2026-11-01' }, list: [
  { id: 'g1', name: 'กุ้ง', unit: 'กรัม', tracked: true, stock: 1200, min: 500, perDay: 900, daysLeft: 1.3, tomorrow: 1500, toBuy: 800, cost: 0.4, costPrev: 0.35 },
  { id: 'g2', name: 'ไข่ไก่', unit: 'ฟอง', tracked: true, stock: 20, min: 30, low: true, perDay: 40, toBuy: 55 },
  { id: 'g3', name: 'น้ำมันหอย', unit: 'มล.', tracked: false, stock: null },
  { id: 'g4', name: 'หมูสับ', unit: 'กก.', tracked: true, stock: 3, min: 1, toBuy: 0 }],
  dishes: [{ name: 'ต้มยำกุ้ง', price: 150, cost: 62, margin: 88, pct: 41 }, { name: 'ผัดกะเพรา', price: 70, cost: 20, margin: 50, pct: 29 }],
  gap7: [{ id: 'g1', name: 'กุ้ง', d: -400 }] };
const SP = t => M.parse(t, { ...ctx, stock });
for (const [t, kind, check] of [
  ['รับกุ้งมา 2 กิโล', 'stock-move', r => r.calls[0].body.kind === 'in' && r.calls[0].body.qty === 2000 && r.undo[0].body.delta === -2000],
  ['ซื้อกุ้งมาสองกิโลครึ่ง ราคา 1,000 บาท', 'stock-move', r => r.calls[0].body.qty === 2500 && r.calls[0].body.cost === 1000],
  ['รับกุ้ง 2.5 กิโล 950 บาท', 'stock-move', r => r.calls[0].body.qty === 2500 && r.calls[0].body.cost === 950],
  ['เติมไข่ไก่ 2 แผง', 'stock-move', r => r.calls[0].body.qty === 60],
  ['ได้หมูสับมา 5 ขีด', 'stock-move', r => r.calls[0].body.qty === 0.5],
  ['กุ้งเหลือ 800 กรัม', 'stock-move', r => r.calls[0].body.kind === 'count' && r.calls[0].body.qty === 800 && /น้อยกว่าในระบบ 400 กรัม/.test(r.ask) && r.undo[0].body.qty === 1200],
  ['นับน้ำมันหอยได้ 2 ลิตร', 'stock-move', r => r.calls[0].path === '/api/stock/setup' && r.calls[0].body.stock === 2000],
  ['กุ้งเสีย 3 ขีด', 'stock-move', r => r.calls[0].body.kind === 'waste' && r.calls[0].body.qty === 300],
  ['ทิ้งไข่ไก่ 5 ฟอง', 'stock-move', r => r.calls[0].body.kind === 'waste' && r.calls[0].body.qty === 5],
  ['ไข่ไก่เหลือ 2 กิโล', 'say', r => /นับเป็นฟอง/.test(r.say)],
]) { const r = SP(t); ok(r && r.kind === kind && (!check || check(r)), `${t} → ${r && (r.ask || r.say || r.kind)}`); }
for (const [t, topic] of [['กุ้งเหลือเท่าไร', 'ing'], ['สต๊อกกุ้ง', 'ing'], ['อะไรใกล้หมด', 'low'], ['ต้องซื้ออะไรบ้าง', 'buy'], ['พรุ่งนี้ไปแม็คโครซื้ออะไร', 'buy'],
  ['ของหายไปเท่าไร', 'loss'], ['ต้มยำกุ้งต้นทุนเท่าไร', 'cost'], ['ต้นทุนเมนู', 'cost']]) {
  const r = SP(t); ok(r && r.topic === topic, `${t} → ${r && r.topic}: ${r ? M.answer(r, { stock }) : ''}`);
}
let r2 = SP('ส่งรายการซื้อของเข้าไลน์'); ok(r2.kind === 'stock-line', 'ส่งไลน์');
r2 = SP('กุ้งหมด'); ok(r2.kind === 'menu-off' && r2.calls.some(c => c.path === '/api/stock/move' && c.body.qty === 0) && /ศูนย์/.test(r2.ask), 'กุ้งหมด → ปิดเมนู + สต๊อก 0: ' + r2.ask);
ok(SP('โต๊ะ 3 เสร็จ') === null && SP('กะเพรากี่จาน') === null, 'คำสั่งครัวไม่ชนกับสต๊อก');
const txt = M.shopListText(stock, 'Mama Mia');
ok(/กุ้ง 800 กรัม/.test(txt) && /ไข่ไก่ 55 ฟอง/.test(txt) && !/หมูสับ/.test(txt), 'รายการซื้อ:\n' + txt);
const sa = {}; M.alerts(sa, { stock, now }, { stock: true });
const st2 = JSON.parse(JSON.stringify(stock)); st2.list[0].low = true; st2.list[0].stock = 400; st2.list[1].out = true; st2.list[1].stock = 0;
a = M.alerts(sa, { stock: st2, now: now + 60000 }, { stock: true }); ok(a.some(x => /กุ้งใกล้หมด เหลือ 400/.test(x)) && a.some(x => /ไข่ไก่หมดสต๊อก/.test(x)), 'เตือนสต๊อก: ' + a.join(' | '));
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
