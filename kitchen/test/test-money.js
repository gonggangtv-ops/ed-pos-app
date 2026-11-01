// ทดสอบเงิน/บิลแบบครบวง กับเซิร์ฟเวอร์จริง: node kitchen/test/test-money.js
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SRC = path.join(__dirname, '../../app/src/main/assets/edpos');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edpos-'));
fs.cpSync(SRC, dir, { recursive: true });
fs.copyFileSync(path.join(SRC, '../edpos-seed.json'), path.join(dir, 'data.json'));
const PORT = 39000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const done = code => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(code); };
const B = 'http://localhost:' + PORT;
let T = '', fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
async function api(p, body) {
  const r = await fetch(B + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-pin-token': T }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200) { const e = new Error(j.error || String(r.status)); e.status = r.status; throw e; }
  return j;
}
const err = p => p.then(() => null, e => e.message);
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/auth'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  await api('/api/auth/setup', { pin: '1234' });
  T = (await api('/api/login', { pin: '1234', want: 'admin' })).token;
  await api('/api/settings', { payments: { cash: true, transfer: true, card: true, cardFeePct: 3 } }).catch(e => console.log('settings', e.message));
  const st = await api('/api/state');
  const fr = st.menu.find(m => m.name === 'ข้าวผัด');
  const ch = (meat, size) => [{ g: 'เนื้อสัตว์', c: meat }, { g: 'ขนาด', c: size }];
  const order = (table, items) => api('/api/order', { table, items });
  const bill = async id => { const s = await api('/api/state'); return { o: s.orders.find(o => o.id === id), its: s.items.filter(i => i.orderId === id) }; };

  // 1) ชำระเต็ม แล้วยกเลิกจานหลังปิดบิล → ต้องไม่ได้ (ยอดขายที่ปิดแล้วห้ามเปลี่ยน)
  let o = await order('1', [{ menuId: fr.id, qty: 1, choices: ch('กุ้ง', 'M') }, { menuId: fr.id, qty: 1, choices: ch('ไก่', 'S') }]);
  await api('/api/order/pay', { orderId: o.orderId, method: 'cash' });
  ok(!!(await err(api('/api/item/cancel', { id: o.added[0] }))), 'ยกเลิกจานในบิลที่ปิดแล้ว → ไม่ได้');

  // 2) หารเท่า 3 คน: รวมแล้วเท่ายอด · ปิดบิลคนสุดท้าย
  o = await order('2', [{ menuId: fr.id, qty: 2, choices: ch('กุ้ง', 'M') }]);   // 2 × 200 = 400
  let b = await bill(o.orderId), total = b.its.reduce((s, i) => s + i.price * i.qty, 0);
  let paid = 0, closed = false;
  for (let k = 0; k < 3 && !closed; k++) {
    const left = total - paid, share = k === 2 ? left : Math.ceil(left / (3 - k));
    const r = await api('/api/order/pay', { orderId: o.orderId, method: 'cash', mode: 'share', amount: share, parts: 3 });
    paid += share; closed = r.closed;
  }
  ok(closed && paid === total, `หารเท่า 3 คน รวม ${paid} = ${total} ปิดบิล`);

  // 3) แยกตามรายการ + บัตร 3%: ยอดขายไม่รวมค่าธรรมเนียม
  o = await order('3', [{ menuId: fr.id, qty: 1, choices: ch('ไก่', 'M') }, { menuId: fr.id, qty: 1, choices: ch('หมู', 'L') }]);
  b = await bill(o.orderId);
  await api('/api/order/pay', { orderId: o.orderId, method: 'card', mode: 'items', lines: [{ id: b.its[0].id, qty: 1 }] });
  ok(!!(await err(api('/api/item/cancel', { id: b.its[0].id }))), 'ยกเลิกจานที่จ่ายแล้ว → ไม่ได้');
  const r3 = await api('/api/order/pay', { orderId: o.orderId, method: 'cash', mode: 'full' });
  b = await bill(o.orderId);
  ok(r3.closed && b.o.payments[0].fee === 4.5, 'จ่ายบัตร 150 ค่าธรรมเนียม 3% = 4.5: ' + JSON.stringify(b.o.payments.map(p => [p.method, p.amount, p.fee])));

  // 4) จ่ายเกิน/ซ้ำ
  ok(!!(await err(api('/api/order/pay', { orderId: o.orderId, method: 'cash' }))), 'จ่ายบิลที่ปิดแล้วซ้ำ → ไม่ได้');
  o = await order('4', [{ menuId: fr.id, qty: 1, choices: ch('ไก่', 'S') }]);
  ok(!!(await err(api('/api/order/pay', { orderId: o.orderId, method: 'cash', mode: 'share', amount: 99999, parts: 2 }))), 'หารเท่าเกินยอด → ไม่ได้');
  ok(!!(await err(api('/api/order/pay', { orderId: o.orderId, method: 'cash', received: 10 }))), 'รับเงินน้อยกว่ายอด → ไม่ได้');
  const neg = await api('/api/order', { table: '4', items: [{ menuId: fr.id, qty: -2, choices: ch('ไก่', 'S') }, { menuId: fr.id, qty: 1.5, choices: ch('ไก่', 'S') }] });
  ok((await bill(neg.orderId)).its.every(i => i.qty === 1), 'จำนวนติดลบ/ทศนิยม → ปัดเป็น 1');
  ok(!!(await err(api('/api/item/status', { id: neg.added[0], status: 'cancelled' }))), 'เปลี่ยนสถานะเป็นยกเลิกทางลัด → ไม่ได้');
  ok(!!(await err(api('/api/order', { table: '4', items: [{ custom: { name: 'x', price: -50 }, qty: 1 }] }))), 'เมนูพิเศษราคาติดลบ → ไม่ได้');

  // 5) ย้ายโต๊ะไปโต๊ะที่มีบิลเปิด → รวมบิล
  const a = await order('5', [{ menuId: fr.id, qty: 1, choices: ch('กุ้ง', 'M') }]);
  const c = await order('6', [{ menuId: fr.id, qty: 1, choices: ch('ไก่', 'M') }]);
  await api('/api/order/move', { orderId: a.orderId, table: '6' }).catch(e => console.log('move', e.message));
  const s1 = await api('/api/state');
  const open6 = s1.orders.filter(x => x.table === '6' && x.status === 'open');
  ok(open6.length === 1 && s1.items.filter(i => i.orderId === open6[0].id && i.status !== 'cancelled').length === 2, 'ย้ายโต๊ะ 5 → 6 รวมเป็นบิลเดียว');
  // 6) ยกเลิกทั้งโต๊ะ (ยังไม่ทำ)
  await api('/api/order/void', { orderId: open6[0].id });
  ok((await api('/api/state')).orders.find(x => x.id === open6[0].id).status === 'void', 'ยกเลิกทั้งโต๊ะ');

  // 6.5) เครื่องหลักพัง → รวมออเดอร์จากเครื่องเดิม
  const key = (await api('/api/sync/key', { pin: '1234' })).key;
  const now = Date.now();
  const mg = await fetch(B + '/api/merge', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sync-key': key }, body: JSON.stringify({ mergeId: 'mg1', from: 'old',
    orders: [{ id: 'oX', table: '20', status: 'open', createdAt: now }],
    items: [{ id: 'iX', orderId: 'oX', menuId: fr.id, name: 'ข้าวผัด', option: 'กุ้ง M', qty: 2, price: 200, status: 'new', createdAt: now, stk: true },
      { id: 'iY', orderId: 'oX', menuId: fr.id, name: 'ข้าวผัด', option: 'กุ้ง M', qty: 1, price: 200, status: 'cancelled', createdAt: now, stk: false }] }) }).then(r => r.json());
  ok(mg.items === 2, 'รวมออเดอร์จากเครื่องเดิม 2 จาน');
  const mOrder = (await api('/api/state')).orders.find(x => x.table === '20' && x.status === 'open');
  await api('/api/order/void', { orderId: mOrder.id });

  // 7) รายงาน = ผลรวมบิลจริง
  const rep = await api('/api/report');
  const bills = (await api('/api/state')).orders.filter(x => x.status === 'paid');
  const sum = bills.reduce((s, x) => s + x.subtotal, 0);
  // แยกจ่าย: รายงานนับแต่ละครั้งที่จ่ายเป็นหนึ่งบิล (1 + หาร 3 + แยก 2 = 6)
  ok(Math.abs(rep.summary.subtotal - sum) < 0.01 && rep.summary.bills === 6, `รายงาน ${rep.summary.subtotal} = บิล ${sum} (${bills.length} บิล / รายงาน ${rep.summary.bills} บิล)`);
  ok(rep.summary.fee === 4.5, 'ค่าธรรมเนียมบัตรในรายงาน: ' + rep.summary.fee);
  console.log(fail ? `${fail} FAILED` : 'all passed');
  done(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e.stack); done(1); });
