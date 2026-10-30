// ทดสอบระบบสต๊อกของเซิร์ฟเวอร์ ED POS (รันเซิร์ฟเวอร์จริงในโฟลเดอร์ชั่วคราว): node kitchen/test/test-stock-server.js
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SRC = path.join(__dirname, '../../app/src/main/assets/edpos');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edpos-'));
fs.cpSync(SRC, dir, { recursive: true });
for (const f of ['data.json', 'edpos-seed.json']) fs.rmSync(path.join(dir, f), { force: true });
const PORT = 39000 + Math.floor(Math.random() * 900);
const srv = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const done = code => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(code); };
const B = 'http://localhost:' + PORT;
let T = '', fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
async function api(path, body, method) {
  const r = await fetch(B + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'x-pin-token': T }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status !== 200) throw new Error(r.status + ' ' + (j.error || ''));
  return j;
}
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/auth'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  await api('/api/auth/setup', { pin: '1234' }).catch(e => console.log('setup', e.message));
  T = (await api('/api/login', { pin: '1234', want: 'admin' })).token;
  const st = await api('/api/state');
  const m1 = (await api('/api/menu/save', { item: { name: 'ต้มยำกุ้ง', price: 150, category: 'ต้ม', screens: [st.settings.kdsScreens[0].id] } })).id;
  const m2 = (await api('/api/menu/save', { item: { name: 'กุ้งผัดพริกเกลือ', price: 180, category: 'ผัด', screens: [st.settings.kdsScreens[0].id] } })).id;
  const m3 = (await api('/api/menu/save', { item: { name: 'ชาเย็น', price: 40, category: 'เครื่องดื่ม', screens: [] } })).id;
  let ing = (await api('/api/ingredients', { list: [
    { name: 'กุ้ง', unit: 'กรัม', uses: [{ t: 'm', r: m1, q: 100 }, { t: 'm', r: m2, q: 150 }] },
    { name: 'นม', unit: 'มล.', uses: [{ t: 'm', r: m3, q: 50 }] }] })).list;
  const shrimp = ing[0].id, milk = ing[1].id;
  // เริ่มนับ: กุ้ง 1 กก. เตือน 300 กรัม
  await api('/api/stock/setup', { id: shrimp, stock: 1000, min: 300 });
  await api('/api/stock/setup', { id: milk, stock: 1000, min: 200 });
  await api('/api/stock/settings', { autoClose: true });
  // สั่ง ต้มยำ 2 + กุ้งผัด 1 + ชาเย็น 3 → กุ้ง -350 นม -150
  const o = await api('/api/order', { table: '3', items: [{ menuId: m1, qty: 2 }, { menuId: m2, qty: 1 }, { menuId: m3, qty: 3 }] });
  let s = await api('/api/stock');
  const g = id => s.list.find(x => x.id === id);
  ok(g(shrimp).stock === 650 && g(milk).stock === 850, `ขายแล้วตัดสต๊อก กุ้ง ${g(shrimp).stock} นม ${g(milk).stock}`);
  // ยกเลิกกุ้งผัด (ยังไม่ทำ) → คืน 150
  await api('/api/item/cancel', { id: o.added[1] });
  s = await api('/api/stock'); ok(g(shrimp).stock === 800, 'ยกเลิกจานที่ยังไม่ทำ คืนสต๊อก: ' + g(shrimp).stock);
  // ทำต้มยำเสร็จแล้วยกเลิก → ไม่คืน
  await api('/api/dish/complete', { order_id: o.orderId, dishes_id: o.added[0] });
  await api('/api/item/cancel', { id: o.added[0] });
  s = await api('/api/stock'); ok(g(shrimp).stock === 800, 'ยกเลิกจานที่ทำแล้ว ไม่คืน: ' + g(shrimp).stock);
  // รับกุ้ง 2 กก. 700 บาท → ต้นทุน 0.35/กรัม · ครั้งถัดไป 800 บาท → +14%
  let r = await api('/api/stock/move', { id: shrimp, kind: 'in', qty: 2000, cost: 700, note: 'แม็คโคร' });
  ok(r.stock === 2800 && r.cost === 0.35, 'รับเข้า + ต้นทุน: ' + JSON.stringify(r));
  r = await api('/api/stock/receipt', { lines: [{ id: shrimp, qty: 1000, cost: 400 }] });
  ok(r.lines[0].costChange === 14 && r.lines[0].stock === 3800, 'บิลซื้อของ: ราคาขึ้น ' + r.lines[0].costChange + '%');
  // นับจริงเหลือ 3500 → ส่วนต่าง -300 · เสีย 100
  r = await api('/api/stock/move', { id: shrimp, kind: 'count', qty: 3500 }); ok(r.d === -300, 'นับสต๊อก ส่วนต่าง ' + r.d);
  r = await api('/api/stock/move', { id: shrimp, kind: 'waste', qty: 100 }); ok(r.stock === 3400, 'ของเสีย ' + r.stock);
  s = await api('/api/stock');
  ok(s.gap7.find(x => x.id === shrimp).d === -400, 'ของหาย/เสีย 7 วัน -400');
  const d1 = s.dishes.find(x => x.name === 'ต้มยำกุ้ง');
  ok(d1 && d1.cost === 40 && d1.pct === 27, 'ต้นทุนต่อจาน ต้มยำ ' + JSON.stringify(d1));
  // หมดสต๊อก → ปิดเมนูเอง → เติม → เปิดคืน
  await api('/api/stock/move', { id: shrimp, kind: 'count', qty: 120 });
  await api('/api/order', { table: '5', items: [{ menuId: m1, qty: 2 }] });
  let state = await api('/api/state');
  ok(state.menu.filter(m => m.available === false).length === 2, 'กุ้งหมด → ปิด 2 เมนูเอง');
  ok(state.events.some(e => /กุ้ง หมดสต๊อก/.test(e.text)), 'มีแจ้งเตือนหมดสต๊อก');
  await api('/api/stock/move', { id: shrimp, kind: 'in', qty: 1000 });
  state = await api('/api/state');
  ok(state.menu.every(m => m.available !== false), 'เติมกุ้ง → เปิดเมนูคืนเอง');
  // หลังร้านบันทึกสูตรใหม่ (ส่งของเก่า) ต้องไม่ทับสต๊อก
  const before = (await api('/api/stock')).list.find(x => x.id === shrimp).stock;
  await api('/api/ingredients', { list: ing.map(x => ({ ...x, stock: 99999 })) });
  s = await api('/api/stock'); ok(g(shrimp).stock === before && g(shrimp).cost === 0.4, 'หลังร้านบันทึกสูตร ไม่ทับสต๊อก ' + g(shrimp).stock);
  ok(s.list.every(x => 'toBuy' in x) && Array.isArray(s.log) && s.log[0].name, 'รายงานมีรายการซื้อ + ประวัติ');
  // ไม่มีโทเค็น → ห้าม
  const t0 = T; T = ''; let denied = false; try { await api('/api/stock'); } catch (e) { denied = /401/.test(e.message); } T = t0;
  ok(denied, 'ต้องใช้รหัสเจ้าของร้าน');
  console.log(fail ? fail + ' FAILED' : 'all passed');
  done(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e); done(1); });
