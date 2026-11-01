// ทดสอบวัตถุดิบที่ใช้ตามสูตร (ไม่มีสต๊อกแล้ว): แยกตามขนาด กุ้ง+S/M/L · เมนู+ขนาด (กุ้งชุบ) · ราคาต่อหน่วย/ต้นทุนต่อจาน · ข้อมูลสต๊อกเก่าถูกล้าง
// ใช้เมนูจริงของร้าน (edpos-seed.json): node kitchen/test/test-usage.js
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SRC = path.join(__dirname, '../../app/src/main/assets/edpos');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edpos-'));
fs.cpSync(SRC, dir, { recursive: true });
// ข้อมูลเก่าที่ยังมีสต๊อก → ต้องถูกล้างตอนเปิดเซิร์ฟเวอร์
const seed = JSON.parse(fs.readFileSync(path.join(SRC, '../edpos-seed.json'), 'utf8'));
seed.ingredients = [{ id: 'ingold', name: 'หมึก', unit: 'กรัม', cost: 0.2, stock: 500, min: 100, perKg: 5, costPrev: 0.18, uses: [] }];
seed.stockLog = [{ at: Date.now(), id: 'ingold', d: -5, kind: 'sale' }];
seed.settings.stock = { autoClose: true };
const closed = seed.menu.find(m => m.name === 'หมึกชุบ'); closed.available = false; closed.stockOff = true;
fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(seed));
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
  let st = await api('/api/state');
  const old = st.ingredients.find(g => g.id === 'ingold');
  ok(old && old.cost === 0.2 && old.stock === undefined && old.perKg === undefined && old.min === undefined, 'ข้อมูลสต๊อกเก่าถูกล้าง เหลือราคา: ' + JSON.stringify(old));
  ok(st.menu.find(m => m.name === 'หมึกชุบ').available !== false, 'เมนูที่ระบบสต๊อกปิดไว้ เปิดคืนแล้ว');
  ok((await fetch(B + '/api/stock', { headers: { 'x-pin-token': T } })).status === 404, 'ไม่มี /api/stock แล้ว');

  const fr = st.menu.find(m => m.name === 'ข้าวผัด'), cs = st.menu.find(m => m.name === 'กุ้งชุบ');
  const csSize = (cs.groups || []).map(g => g.ref ? st.optionSets.find(o => o.id === g.ref) : g).find(g => /size|ขนาด/i.test(g.name)).name;
  // กุ้งอย่างเดียว S 5 / M 7 / L 9 · ราคาคนไทย (ไม่มีขนาด) 5 · ทะเล S 3 · กุ้งชุบ S 6 / M 9 / L 12 · ราคาตัวละ 12.5
  const ing = (await api('/api/ingredients', { list: [{ name: 'กุ้ง', unit: 'ตัว', cost: '12.5', uses: [
    { t: 'c', r: 'กุ้ง', q: 5 }, { t: 'c', r: 'กุ้ง+S', q: 5 }, { t: 'c', r: 'กุ้ง + M', q: 7 }, { t: 'c', r: 'กุ้ง+L', q: 9 }, { t: 'c', r: 'ทะเล+S', q: 3 },
    { t: 'm', r: cs.id, o: 'S', q: 6 }, { t: 'm', r: cs.id, o: 'M', q: 9 }, { t: 'm', r: cs.id, o: ' L ', q: 12 }] }] })).list;
  const g = ing[0];
  ok(g.cost === 12.5 && g.uses[2].r === 'กุ้ง+M' && g.uses.filter(u => u.r === cs.id).map(u => u.o).join() === 'S,M,L', 'เก็บราคา + สูตร กุ้ง+M + เมนูแยกขนาด');
  const used = async () => (await api('/api/usage')).list.find(x => x.id === g.id);
  const sell = async (items, extra) => { const o = await api('/api/order', { table: String(Math.random()).slice(2, 6), items }); await api('/api/order/pay', { orderId: o.orderId, method: 'cash' }); };
  const fried = (meat, size, extra = {}) => ({ menuId: fr.id, qty: 1, choices: [{ g: 'เนื้อสัตว์', c: meat }, ...(size ? [{ g: 'ขนาด', c: size }] : [])], ...extra });
  let last = 0;
  const step = async (label, items, want) => { await sell(items); const u = await used(); ok(u.total - last === want, `${label} ใช้ ${u.total - last} (ควร ${want})`); last = u.total; };
  await step('กุ้ง S', [fried('กุ้ง', 'S')], 5);
  await step('กุ้ง M', [fried('กุ้ง', 'M')], 7);
  await step('กุ้ง L', [fried('กุ้ง', 'L')], 9);
  await step('ทะเล S', [fried('ทะเล', 'S')], 3);
  await step('ไก่ M', [fried('ไก่', 'M')], 0);
  await step('กุ้ง ราคาคนไทย', [fried('กุ้ง', '', { thai: true })], 5);
  await step('กุ้งชุบ S + M×2 + L', [{ menuId: cs.id, qty: 1, choices: [{ g: csSize, c: 'S' }] }, { menuId: cs.id, qty: 2, choices: [{ g: csSize, c: 'M' }] }, { menuId: cs.id, qty: 1, choices: [{ g: csSize, c: 'L' }] }], 36);
  const u = await used();
  ok(u.cost === 12.5 && u.daily.length === 1 && u.daily[0] === 65, 'รายวัน + ราคา: ' + JSON.stringify({ daily: u.daily, cost: u.cost }));
  ok(u.by.some(([k, v]) => k === 'กุ้งชุบ M' && v === 18) && u.by.some(([k, v]) => k === 'ตัวเลือก กุ้ง' && v === 5), 'แยกที่มา: ' + JSON.stringify(u.by));
  const dish = (await api('/api/dishcost')).dishes.filter(x => x.name.startsWith('กุ้งชุบ')).map(x => x.name + ':' + x.cost);
  ok(dish.join() === 'กุ้งชุบ S:75,กุ้งชุบ M:112.5,กุ้งชุบ L:150' || dish.sort().join() === ['กุ้งชุบ L:150', 'กุ้งชุบ M:112.5', 'กุ้งชุบ S:75'].sort().join(), 'ต้นทุนต่อจานแยกขนาด: ' + dish.join());
  // ยกเลิกจานก่อนจ่าย → ไม่นับว่าใช้
  const o = await api('/api/order', { table: 'x1', items: [fried('กุ้ง', 'L')] });
  await api('/api/item/cancel', { id: o.added[0] });
  await api('/api/order/void', { orderId: o.orderId }).catch(() => {});
  ok((await used()).total === last, 'จานที่ยกเลิกไม่นับ');
  console.log(fail ? `${fail} FAILED` : 'all passed');
  done(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e.message); done(1); });
