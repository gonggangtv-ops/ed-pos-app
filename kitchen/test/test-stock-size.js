// ทดสอบสูตรวัตถุดิบแยกตามขนาด (กุ้ง+S / กุ้ง+M / ทะเล+S) กับเมนูจริงของร้าน (edpos-seed.json): node kitchen/test/test-stock-size.js
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
  if (r.status !== 200) throw new Error(r.status + ' ' + (j.error || ''));
  return j;
}
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/auth'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  await api('/api/auth/setup', { pin: '1234' });
  T = (await api('/api/login', { pin: '1234', want: 'admin' })).token;
  const st = await api('/api/state');
  const fr = st.menu.find(m => m.name === 'ข้าวผัด');
  // กุ้งอย่างเดียว S 5 / M 7 / L 9 · ราคาคนไทย (ไม่มีขนาด) 5 · ทะเล S 3 / M 5 / L 7 · ใส่ช่องว่างรอบ + ก็ได้
  let ing = (await api('/api/ingredients', { list: [{ name: 'กุ้ง', unit: 'ตัว', uses: [
    { t: 'c', r: 'กุ้ง', q: 5 }, { t: 'c', r: 'กุ้ง+S', q: 5 }, { t: 'c', r: 'กุ้ง + M', q: 7 }, { t: 'c', r: 'กุ้ง+L', q: 9 },
    { t: 'c', r: 'ทะเล+S', q: 3 }, { t: 'c', r: 'ทะเล+M', q: 5 }, { t: 'c', r: 'ทะเล+L', q: 7 }] }] })).list;
  ok(ing[0].uses[2].r === 'กุ้ง+M', 'เก็บสูตรเป็น กุ้ง+M: ' + ing[0].uses[2].r);
  const id = ing[0].id;
  await api('/api/stock/setup', { id, stock: 100 });
  const stock = async () => (await api('/api/stock')).list.find(x => x.id === id).stock;
  const oids = [];
  const order = (table, choices, extra = {}) => api('/api/order', { table, items: [{ menuId: fr.id, qty: 1, choices, ...extra }] }).then(r => (oids.push(r.orderId), r));
  const pick = (meats, size) => [...meats.map(c => ({ g: 'เนื้อสัตว์', c })), ...(size ? [{ g: 'ขนาด', c: size }] : [])];
  await order('1', pick(['กุ้ง'], 'S')); ok(await stock() === 95, 'กุ้ง S ใช้ 5 → ' + await stock());
  await order('2', pick(['กุ้ง'], 'M')); ok(await stock() === 88, 'กุ้ง M ใช้ 7 → ' + await stock());
  await order('3', pick(['กุ้ง'], 'L')); ok(await stock() === 79, 'กุ้ง L ใช้ 9 → ' + await stock());
  await order('4', pick(['ทะเล'], 'S')); ok(await stock() === 76, 'ทะเล S ใช้ 3 → ' + await stock());
  await order('5', pick(['ไก่'], 'M')); ok(await stock() === 76, 'ไก่ M ไม่ใช้กุ้ง → ' + await stock());
  await order('6', pick(['กุ้ง'], ''), { thai: true }).then(async () => ok(await stock() === 71, 'ราคาคนไทย (ไม่มีขนาด) ใช้ 5 → ' + await stock()),
    e => ok(false, 'สั่งราคาคนไทยไม่ได้: ' + e.message));
  // ยอดใช้วัตถุดิบรายวัน (หน้ายอดขาย) นับแบบเดียวกัน
  // ซื้อเป็นกิโล: รับ 2 กก. โลละ 40 = 80 ตัว 1,000 บาท → จำโลละ 40 · ต้นทุน 12.5 บาท/ตัว
  let mv = await api('/api/stock/move', { id, kind: 'in', qty: 80, cost: 1000, kg: 2, perKg: 40 });
  let sl = (await api('/api/stock')).list.find(x => x.id === id);
  ok(mv.stock === 151 && sl.perKg === 40 && sl.cost === 12.5, 'รับเป็นกิโล: ' + JSON.stringify({ stock: mv.stock, perKg: sl.perKg, cost: sl.cost }));
  await api('/api/stock/setup', { id, perKg: 36 });
  sl = (await api('/api/stock')).list.find(x => x.id === id);
  ok(sl.perKg === 36 && sl.stock === 151, 'ตั้งโลละใหม่ไม่แตะสต๊อก: ' + sl.perKg);
  await api('/api/ingredients', { list: [{ ...ing[0] }] });
  ok((await api('/api/stock')).list.find(x => x.id === id).perKg === 36, 'บันทึกสูตรใหม่ ไม่ล้างโลละ');
  // เมนูที่กุ้งเป็นตัวจาน (กุ้งชุบ Size S/M/L): สูตรแบบเมนู + ขนาด
  const cs = st.menu.find(m => m.name === 'กุ้งชุบ');
  const ing2 = (await api('/api/ingredients', { list: [{ ...ing[0], uses: [...ing[0].uses,
    { t: 'm', r: cs.id, q: 4 }, { t: 'm', r: cs.id, o: 'S', q: 6 }, { t: 'm', r: cs.id, o: 'M', q: 9 }, { t: 'm', r: cs.id, o: ' L ', q: 12 }] }] })).list;
  ok(ing2[0].uses.filter(u => u.r === cs.id).map(u => u.o || '-').join() === '-,S,M,L', 'เก็บขนาดของแถวเมนู');
  const sizeGroup = (cs.groups || []).map(g => g.ref ? st.optionSets.find(o => o.id === g.ref) : g).find(g => /size|ขนาด/i.test(g.name)).name;
  const before = await stock();
  const o2 = await api('/api/order', { table: '7', items: [
    { menuId: cs.id, qty: 1, choices: [{ g: sizeGroup, c: 'S' }] }, { menuId: cs.id, qty: 2, choices: [{ g: sizeGroup, c: 'M' }] }, { menuId: cs.id, qty: 1, choices: [{ g: sizeGroup, c: 'L' }] }] });
  oids.push(o2.orderId);
  ok(before - await stock() === 6 + 18 + 12, 'กุ้งชุบ S 6 + M 9×2 + L 12 = ' + (before - await stock()));
  const sr = await api('/api/stock/move', { id, kind: 'in', qty: 10, cost: 100 });
  const dish = (await api('/api/stock')).dishes.filter(x => x.name.startsWith('กุ้งชุบ')).map(x => x.name + ':' + x.cost);
  ok(dish.join() === 'กุ้งชุบ S:60,กุ้งชุบ M:90,กุ้งชุบ L:120', 'ต้นทุนต่อจานแยกขนาด: ' + dish.join());
  await api('/api/stock/move', { id, kind: 'adjust', delta: -10 });
  for (const orderId of oids) await api('/api/order/pay', { orderId, method: 'cash' });
  const u = (await api('/api/usage')).list.find(x => x.id === id);
  ok(u.total === 29 + 36, 'ยอดใช้รายวันหลังปิดบิล 5+7+9+3+5 + กุ้งชุบ 36 = ' + u.total);
  ok(u.by.some(([k, v]) => k === 'กุ้งชุบ M' && v === 18), 'แยกที่มา กุ้งชุบ M 18');
  ok(u.by.some(([k, v]) => k === 'ตัวเลือก กุ้ง+M' && v === 7) && u.by.some(([k, v]) => k === 'ตัวเลือก กุ้ง' && v === 5), 'แยกที่มา: ' + JSON.stringify(u.by));
  done(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); done(1); });
