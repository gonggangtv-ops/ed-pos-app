// ED POS — ระบบสั่งอาหาร + พิมพ์ใบเสร็จ + KDS
// รันด้วย: node server.js   (ไม่ต้องติดตั้ง package เพิ่ม)
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const crypto = require('crypto');
const https = require('https');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const BACKUP_DIR = path.join(__dirname, 'backup');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- ข้อมูล ----------
// ผังโต๊ะเริ่มต้น (ตำแหน่งตามผังร้านจริง) · x,y,w,h เป็นพิกัดบนผืนผ้าใบ LAYOUT_W x LAYOUT_H
// type: 'table' = โต๊ะ (กดได้) · 'wall' = ฉากกั้น/ผนัง · 'label' = ป้ายข้อความ
const LAYOUT_W = 1520, LAYOUT_H = 740;
function defaultLayout() {
  // [ชื่อ, x, y, w, h] วัดจากรูปผัง (ต้นทาง 309,225)
  const T = [
    ['1', 667, 239, 72, 72], ['2', 746, 242, 72, 72], ['3', 834, 236, 72, 72], ['4', 910, 238, 72, 72],
    ['5', 677, 328, 72, 72], ['6', 675, 404, 72, 72],
    ['7ติดป้าย', 667, 501, 72, 72], ['7กลาง', 748, 500, 72, 72], ['8', 825, 500, 72, 72],
    ['9', 1027, 245, 72, 72], ['10', 1027, 327, 72, 72],
    ['11', 978, 468, 72, 72], ['12', 1059, 464, 72, 72], ['15', 1138, 463, 72, 72], ['16', 1221, 463, 72, 72],
    ['13', 1188, 227, 72, 72], ['14', 1188, 301, 72, 72],
    ['17', 1348, 227, 72, 72], ['18', 1346, 302, 72, 72],
    ['19', 1330, 402, 72, 72], ['19//2', 1412, 402, 72, 72], ['20', 1330, 480, 72, 72], ['20//2', 1412, 482, 72, 72],
    ['21', 1623, 227, 72, 72], ['22', 1623, 301, 72, 72], ['23', 1612, 384, 72, 72], ['24', 1610, 460, 72, 72],
    ['25', 1731, 325, 95, 95],
    ['45', 533, 330, 72, 72], ['46', 460, 328, 72, 72], ['47', 384, 327, 72, 72], ['48', 310, 329, 72, 72],
    ['35', 1217, 696, 95, 95], ['34', 1320, 696, 95, 95], ['33', 1421, 696, 95, 95],
    ['32', 1524, 692, 95, 95], ['31', 1626, 692, 95, 95], ['30', 1727, 692, 95, 95],
    ['39', 1404, 837, 95, 95], ['38', 1504, 837, 95, 95], ['37', 1602, 836, 95, 95], ['36', 1727, 832, 95, 95],
    ['44', 331, 808, 95, 95], ['43', 437, 810, 95, 95], ['42', 538, 809, 95, 95], ['41', 641, 807, 95, 95], ['40', 741, 809, 95, 95],
  ];
  const sn = v => Math.round(v / 2) * 2;
  const items = T.map(([name, x, y, w, h]) => ({ type: 'table', name, x: sn(x - 309), y: sn(y - 225), w, h }));
  items.push({ type: 'wall', name: 'ฉากกั้น', x: 299, y: 5, w: 50, h: 410 });
  return { w: LAYOUT_W, h: LAYOUT_H, items };
}
// ตรวจผังที่ส่งมา: ชื่อโต๊ะห้ามซ้ำ/ว่าง, ไม่ขึ้นต้นด้วย TA (ใช้เป็นรหัสกลับบ้าน)
function cleanLayout(l) {
  const n = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  const seen = new Set(), items = [];
  for (const it of Array.isArray(l?.items) ? l.items.slice(0, 400) : []) {
    const type = ['table', 'wall', 'label'].includes(it.type) ? it.type : 'table';
    let name = String(it.name ?? '').trim().slice(0, 20);
    if (type === 'table') {
      if (!name) throw new Error('มีโต๊ะที่ยังไม่ได้ตั้งชื่อ');
      if (/^TA/i.test(name)) throw new Error(`ชื่อโต๊ะ "${name}" ห้ามขึ้นต้นด้วย TA (ใช้สำหรับกลับบ้าน)`);
      if (seen.has(name)) throw new Error(`ชื่อโต๊ะ "${name}" ซ้ำกัน`);
      seen.add(name);
    }
    items.push({ type, name, x: n(it.x, -200, 4000, 0), y: n(it.y, -200, 4000, 0), w: n(it.w, 16, 2000, 72), h: n(it.h, 16, 2000, 72) });
  }
  return { w: n(l?.w, 400, 4000, LAYOUT_W), h: n(l?.h, 300, 4000, LAYOUT_H), items };
}
const IMG_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

const defaultData = {
  settings: {
    shopName: 'ร้านของฉัน',
    shopInfo: 'ขอบคุณที่ใช้บริการ',
    // เครื่องพิมพ์ เพิ่มได้ไม่จำกัด · id ใช้อ้างจากเมนู (menu.printers) จึงไม่เปลี่ยนแม้เปลี่ยนชื่อ
    // dots: กระดาษ 80mm = 576, 58mm = 384 · copies = จำนวนใบสั่งอาหารที่พิมพ์ต่อครั้ง
    printers: [
      { id: 'front', name: 'หน้าร้าน', ip: '192.168.1.100', port: 9100, dots: 576, copies: 1 },
      { id: 'kitchen', name: 'ครัว', ip: '192.168.1.101', port: 9100, dots: 576, copies: 1 },
    ],
    receiptPrinter: 'front', // ใบเสร็จ/ใบแจ้งยอดออกเครื่องนี้
    receiptCopies: 1,        // ใบเสร็จที่จ่ายแล้วพิมพ์กี่ใบ (ใบแจ้งยอดพิมพ์ใบเดียวเสมอ)
    // จอครัว (KDS) หลายจอ เช่น ครัว / บาร์น้ำ · เปิด /kds.html?screen=<id> · เมนูเลือกได้ว่าขึ้นจอไหน (menu.screens)
    kdsScreens: [{ id: 'main', name: 'ครัว' }],
    printTickets: true, // พิมพ์ใบสั่งทุกครั้งที่ส่งออเดอร์
    layout: null,   // ผังโต๊ะ (สร้างตอนเริ่มจาก defaultLayout)
    takeaway: true,
    // รูปแบบใบเสร็จ (รูปเก็บใน receipt.images แต่ไม่ส่งไปกับ /api/state)
    receipt: {
      logoMode: 'dither', logoWidth: 60,       // dither = ภาพถ่าย · threshold = โลโก้ขาวดำคมชัด
      footerImgMode: 'threshold', footerImgWidth: 50,
      nameSize: 36, header: '',                // header = บรรทัดใต้ชื่อร้าน (ที่อยู่ โทร เลขผู้เสียภาษี)
      footerSize: 22,
      showNo: true, showTime: true, showTable: true,
      lang: 'th', headerEn: '', footerEn: '',  // ภาษาใบแจ้งยอด/ใบเสร็จ th | en | both (แต่ละบิลเปลี่ยนเองได้ order.lang)
      images: {},
    },
    // คำแปลชื่อเมนู/ตัวเลือก สำหรับใบเสร็จ {en: {คำไทย: English}} (เพิ่มภาษาอื่นได้ เช่น zh)
    i18n: { en: {} },
    // หมวดใหญ่บนหน้าสั่งอาหาร [{name: 'อาหาร', cats: ['ข้าว', 'เส้น']}] · [] = แถบละหมวดเหมือนเดิม
    catGroups: [],
    // วิธีชำระเงินที่เปิดใช้ + ค่าธรรมเนียมบัตร (%)
    payments: { cash: true, transfer: true, card: true, cardFeePct: 3 },
    // ปุ่มหมายเหตุด่วนตอนสั่ง (ใช้ได้ทุกเมนู)
    quickNotes: ['พิเศษ', 'ไม่ผัก', 'ไม่ใส่หอม', 'แยกน้ำ'],
  },
  categories: ['จานเดียว', 'เพิ่ม', 'ของทอด', 'เครื่องดื่ม', 'ของหวาน'],
  // ชุดตัวเลือกสำเร็จรูป ผูกกับหลายเมนูได้ แก้ที่เดียวเปลี่ยนทุกเมนู
  optionSets: [
    { id: 'os1', name: 'ความเผ็ด', type: 'single', required: false, alert: false,
      choices: [{ name: 'ไม่เผ็ด', add: 0 }, { name: 'เผ็ดน้อย', add: 0 }, { name: 'เผ็ดกลาง', add: 0 }, { name: 'เผ็ดมาก', add: 0 }] },
    { id: 'os2', name: 'แพ้อาหาร', type: 'multi', required: false, alert: true,
      choices: [{ name: 'แพ้ถั่ว', add: 0 }, { name: 'แพ้กุ้ง/อาหารทะเล', add: 0 }, { name: 'แพ้นม', add: 0 },
                { name: 'แพ้ไข่', add: 0 }, { name: 'ไม่ใส่ผงชูรส', add: 0 }] },
  ],
  menu: [
    // printers = พิมพ์ใบสั่งออกเครื่องไหนบ้าง (id ของเครื่องพิมพ์ ใส่ได้หลายเครื่อง, [] = ไม่พิมพ์)
    // screens = ขึ้นจอครัวจอไหน ([] = ไม่ขึ้นจอ เช่น เครื่องดื่ม) · available = false คือของหมด
    // groups = กลุ่มตัวเลือก: type 'single' เลือกได้ 1 / 'multi' เลือกได้หลายอย่าง, required = ต้องเลือก
    { id: 'm1', name: 'กะเพรา', category: 'จานเดียว', price: 60, printers: ['kitchen'], screens: ['main'], available: true,
      groups: [
        { name: 'เนื้อสัตว์', type: 'single', required: true,
          choices: [{ name: 'หมู', add: 0 }, { name: 'ไก่', add: 0 }, { name: 'หมูกรอบ', add: 10 }, { name: 'กุ้ง', add: 20 }] },
        { name: 'เพิ่ม', type: 'multi', required: false,
          choices: [{ name: 'ไข่ดาว', add: 10 }, { name: 'ไข่เจียว', add: 10 }] },
        { ref: 'os1' }, { ref: 'os2' },
      ] },
    { id: 'm2', name: 'ข้าวผัด', category: 'จานเดียว', price: 60, printers: ['kitchen'], screens: ['main'], available: true,
      groups: [{ name: 'เนื้อสัตว์', type: 'single', required: true,
        choices: [{ name: 'หมู', add: 0 }, { name: 'ไก่', add: 0 }, { name: 'กุ้ง', add: 20 }] }, { ref: 'os2' }] },
    { id: 'm3', name: 'ไข่ดาว', category: 'เพิ่ม', price: 10, printers: ['kitchen'], screens: ['main'], available: true, groups: [] },
    { id: 'm5', name: 'เฟรนช์ฟรายส์', category: 'ของทอด', price: 59, printers: ['front'], screens: ['main'], available: true, groups: [] },
    { id: 'm6', name: 'ไก่ทอด', category: 'ของทอด', price: 79, printers: ['front'], screens: ['main'], available: true, groups: [] },
    { id: 'm4', name: 'น้ำเปล่า', category: 'เครื่องดื่ม', price: 10, printers: ['front'], screens: [], available: true, groups: [] },
    { id: 'm7', name: 'ชาเย็น', category: 'เครื่องดื่ม', price: 35, printers: ['front'], screens: [], available: true,
      groups: [{ name: 'ความหวาน', type: 'single', required: true,
        choices: [{ name: 'หวานปกติ', add: 0 }, { name: 'หวานน้อย', add: 0 }, { name: 'ไม่หวาน', add: 0 }] }] },
    { id: 'm8', name: 'บัวลอย', category: 'ของหวาน', price: 35, printers: ['front'], screens: [], available: true, groups: [] },
  ],
  // status 'void' = ยกเลิกทั้งโต๊ะ (ลูกค้าไม่เอาแล้ว) เก็บ voidedAt, voidReason ไว้ดูย้อนหลัง ไม่นับเป็นยอดขาย
  orders: [], // {id, table, status:'open'|'paid'|'void', createdAt, paidAt, payMethod, received, kdsCleared}
  // items: printers/screens คัดลอกจากเมนูตอนสั่ง (แก้เมนูทีหลังไม่กระทบจานที่สั่งไปแล้ว)
  items: [],  // {id, orderId, menuId, name, option, note, qty, price, printers:[], screens:[], status:'new'|'done'|'cancelled', createdAt, doneAt, cancelledAt}
  events: [], // แจ้งเตือนสำหรับ KDS: {id, type:'cancel'|'move', text, at}
  daily: {},  // สรุปยอดขายรายวันของวันที่เก่ากว่า 7 วัน: {'2026-10-01': {...}}
  seq: 1,
};

let data;
// โหลดข้อมูล (จากไฟล์ตอนเปิดโปรแกรม หรือจากไฟล์สำรองตอนกู้คืน) แล้วแปลงรูปแบบรุ่นเก่าให้เป็นปัจจุบัน
function loadData(raw) {
  if (raw) {
    const hadCats = Array.isArray(raw.categories);
    data = { ...JSON.parse(JSON.stringify(defaultData)), ...raw, settings: { ...defaultData.settings, ...raw.settings } };
    if (!hadCats) data.categories = []; // ไฟล์รุ่นเก่า: สร้างหมวดจากเมนูที่มีจริงเท่านั้น
  } else data = JSON.parse(JSON.stringify(defaultData));
  migrateData();
}
// แปลงข้อมูลจากเวอร์ชันเครื่องพิมพ์เดียว
function migrateData() {
  const s = data.settings;
  // รุ่นแรกสุด: เครื่องพิมพ์เดียว
  if (s.printerIp) {
    s.printers = { front: { ip: s.printerIp, port: s.printerPort || 9100, dots: s.paperDots || 576 },
      kitchen: { ip: '192.168.1.101', port: 9100, dots: 576 } };
    delete s.printerIp; delete s.printerPort; delete s.paperDots;
  }
  // รุ่นก่อน: เครื่องพิมพ์ตายตัว 2 เครื่อง {front, kitchen} → รายการเครื่องพิมพ์ (คง id เดิมไว้ เมนูเก่าจึงชี้ถูกเครื่อง)
  if (s.printers && !Array.isArray(s.printers)) {
    const names = { front: 'หน้าร้าน', kitchen: 'ครัว' };
    s.printers = Object.entries(s.printers).map(([id, pr]) => ({ id, name: names[id] || id, ...pr }));
  }
  s.printers = cleanPrinters(Array.isArray(s.printers) ? s.printers : defaultData.settings.printers);
  s.kdsScreens = cleanScreens(Array.isArray(s.kdsScreens) && s.kdsScreens.length ? s.kdsScreens : defaultData.settings.kdsScreens);
  if (!s.printers.some(p => p.id === s.receiptPrinter)) s.receiptPrinter = s.printers[0]?.id || '';
  s.receiptCopies = Math.min(5, Math.max(1, Number(s.receiptCopies) || 1));
  // เมนูรุ่นก่อน: station ('front'|'kitchen') + kds (true/false) → printers[] + screens[]
  for (const m of data.menu) {
    if (!Array.isArray(m.printers)) m.printers = [m.station || (m.kitchen === false ? 'front' : 'kitchen')];
    if (!Array.isArray(m.screens)) {
      const kds = typeof m.kds === 'boolean' ? m.kds : !isNoKdsCategory(m.category);
      m.screens = kds ? [s.kdsScreens[0].id] : [];
    }
    delete m.station; delete m.kitchen; delete m.kds;
  }
  fixMenuRefs();
  // ตัวเลือกแบบเดิม (options ชุดเดียว) → กลุ่มตัวเลือก
  for (const m of data.menu) {
    if (!Array.isArray(m.groups)) {
      m.groups = (m.options || []).length
        ? [{ name: 'ตัวเลือก', type: 'single', required: true, choices: m.options }] : [];
    }
    delete m.options;
    if (typeof m.available !== 'boolean') m.available = true;
  }
  if (!Array.isArray(data.categories)) data.categories = [];
  for (const m of data.menu) if (m.category && !data.categories.includes(m.category)) data.categories.push(m.category);
  s.payments = { ...defaultData.settings.payments, ...(s.payments || {}) };
  s.receipt = { ...defaultData.settings.receipt, ...(s.receipt || {}), images: { ...(s.receipt?.images || {}) } };
  s.i18n = cleanI18n(s.i18n);
  if (!Array.isArray(s.layout?.items)) s.layout = defaultLayout();
  delete s.tables;
  if (!Array.isArray(data.optionSets)) data.optionSets = JSON.parse(JSON.stringify(defaultData.optionSets));
  if (!Array.isArray(s.quickNotes)) s.quickNotes = [...defaultData.settings.quickNotes];
}
// ---------- โหลดข้อมูลร้านตอนเปิดโปรแกรม ----------
// ไฟล์ข้อมูลอ่านไม่ได้ (ไฟดับ/เมมเต็ม/แตกไฟล์ทับผิด) → ห้ามเริ่มเป็นร้านเปล่าแล้วบันทึกทับ
// เก็บไฟล์เสียแยกไว้ (data-broken-เวลา.json) แล้วใช้ไฟล์สำรองล่าสุดที่อ่านได้แทน · แจ้งในหลังร้านและ LINE
let startupWarn = '';
{
  const readOk = f => { try { const r = JSON.parse(fs.readFileSync(f, 'utf8')); return r && typeof r === 'object' && r.settings && Array.isArray(r.menu) ? r : null; } catch { return null; } };
  let raw = null;
  if (fs.existsSync(DATA_FILE)) {
    raw = readOk(DATA_FILE);
    if (!raw) {
      const aside = path.join(__dirname, `data-broken-${Date.now()}.json`);
      try { fs.renameSync(DATA_FILE, aside); } catch {}
      let backups = [];
      try { backups = fs.readdirSync(BACKUP_DIR).filter(n => /\.json$/.test(n)).map(n => path.join(BACKUP_DIR, n)); } catch {}
      const cands = [DATA_FILE + '.tmp', ...backups.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)];
      let from = '';
      for (const f of cands) { if (fs.existsSync(f) && (raw = readOk(f))) { from = path.basename(f); break; } }
      startupWarn = from ? `ไฟล์ข้อมูลเสีย เปิดโปรแกรมด้วยข้อมูลจากไฟล์สำรอง ${from} แทน (บิลหลังจากไฟล์สำรองนั้นอาจหาย) · ไฟล์เสียเก็บไว้ที่ ${path.basename(aside)}`
        : `ไฟล์ข้อมูลเสีย และไม่มีไฟล์สำรองที่ใช้ได้ เริ่มเป็นร้านใหม่ · ไฟล์เสียเก็บไว้ที่ ${path.basename(aside)} ติดต่อผู้ดูแลระบบ`;
      console.log('⚠ ' + startupWarn);
    }
  }
  loadData(raw);
}
// ---------- โปรแกรมไม่ดับเพราะ error ที่ไม่ได้ดักไว้ (จดลง error.log แทน) ----------
// ในแอป MAMA POS เปิด Node ใหม่ในกระบวนการเดิมไม่ได้ การไม่ดับจึงสำคัญมาก
const ERR_LOG = path.join(__dirname, 'error.log');
function logError(kind, e) {
  const line = `[${new Date().toISOString()}] ${kind}: ${e?.stack || e}\n`;
  console.error(line);
  try { if (fs.existsSync(ERR_LOG) && fs.statSync(ERR_LOG).size > 1e6) fs.renameSync(ERR_LOG, ERR_LOG + '.old'); fs.appendFileSync(ERR_LOG, line); } catch {}
}
process.on('uncaughtException', e => { logError('uncaughtException', e); healthEvent('error', { msg: String(e?.message || e).slice(0, 200) }); });
process.on('unhandledRejection', e => logError('unhandledRejection', e));
const r2 = n => Math.round(n * 100) / 100;

// ================= สุขภาพระบบ (หน้ายอดขาย > ระบบ) =================
// health.json แยกจาก data.json (ไม่ซิงก์ไปเครื่องสำรอง ไม่ทำให้ไฟล์ข้อมูลร้านใหญ่) · แต่ละเครื่องเก็บของตัวเอง
// alive = ชีพจรทุก 1 นาที → เปิดใหม่แล้วรู้ว่าดับไปนานแค่ไหน · events = เหตุการณ์ย้อนหลัง 120 วัน
// prints = {วันขาย: {printerId: {ok, fail}}} · bat = แบตเครื่องหลักล่าสุด (แอปส่งมาทุก 2 นาที) · batDay = {วันขาย: {min, max}}
const HEALTH_FILE = path.join(__dirname, 'health.json');
let health = { events: [], prints: {}, batDay: {} };
try { health = { ...health, ...JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8')) }; } catch {}
let healthDirty = false;
const BOOT = Date.now();
function healthEvent(k, extra = {}) {
  health.events.push({ t: Date.now(), k, ...extra });
  const keep = Date.now() - 120 * 86400000;
  if (health.events.length > 3000 || health.events[0]?.t < keep) health.events = health.events.filter(e => e.t >= keep).slice(-3000);
  healthDirty = true;
}
function saveHealth() {
  try { fs.writeFileSync(HEALTH_FILE + '.tmp', JSON.stringify(health)); fs.renameSync(HEALTH_FILE + '.tmp', HEALTH_FILE); healthDirty = false; } catch {}
}
// เปิดเซิร์ฟเวอร์: ชีพจรล่าสุดเก่ากว่า 3 นาที = ดับไปช่วงหนึ่ง (ปิดเครื่อง/แอปถูกปิด/ไฟดับ)
healthEvent('start', health.alive && BOOT - health.alive > 180000 ? { down: Math.round((BOOT - health.alive) / 60000), since: health.alive } : {});
health.alive = BOOT; saveHealth();
setInterval(() => { health.alive = Date.now(); saveHealth(); }, 60000);
setInterval(() => { if (healthDirty) saveHealth(); }, 10000);

// ================= รหัส PIN 4 หลัก =================
// staff = หน้าสั่งอาหาร · admin = หลังร้าน (รหัสเจ้าของร้านเข้าได้ทุกหน้า)
// เก็บเฉพาะค่าแฮช · โทเค็นที่ให้เครื่องที่ใส่รหัสถูก = HMAC(secret, ระดับ + รุ่น) จึงใช้ได้หลังรีสตาร์ต
// และใช้กับเครื่องสำรองได้ด้วย (ข้อมูลซิงก์ไปด้วย) · เปลี่ยนรหัส = รุ่นเปลี่ยน → ทุกเครื่องต้องใส่รหัสใหม่
if (!data.auth?.secret) {
  data.auth = { salt: crypto.randomBytes(16).toString('hex'), secret: crypto.randomBytes(32).toString('hex'),
    admin: null, staff: null, ver: { admin: 1, staff: 1 } };
}
// ลืมรหัส: พิมพ์ใน Termux ของเครื่องหลัก  node server.js --reset-pin  แล้วเปิดโปรแกรมใหม่ จะให้ตั้งรหัสใหม่
// ในแอป MAMA POS: หน้าตั้งค่าของแอปสร้างไฟล์ reset-pin.flag แล้วเปิดเซิร์ฟเวอร์ใหม่ (ไม่ต้องพิมพ์คำสั่ง)
const RESET_FLAG = path.join(__dirname, 'reset-pin.flag');
const pinResetByFlag = fs.existsSync(RESET_FLAG);
if (process.argv.includes('--reset-pin') || pinResetByFlag) {
  data.auth.admin = null; data.auth.staff = null;
  data.auth.ver = { admin: (data.auth.ver?.admin || 1) + 1, staff: (data.auth.ver?.staff || 1) + 1 };
  for (const s of data.auth.staffs || []) s.ver = (s.ver || 1) + 1;
  data.rev = (data.rev || 0) + 1;
  fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(data)); fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
  try { fs.unlinkSync(RESET_FLAG); } catch {}
  console.log('ล้างรหัสแล้ว · เปิดหลังร้าน จะให้ตั้งรหัสเจ้าของร้านใหม่');
  if (!pinResetByFlag) process.exit(0);
}
const LEVELS = { staff: 1, admin: 2 };
const pinHash = pin => crypto.createHash('sha256').update(data.auth.salt + ':' + pin).digest('hex');
// พนักงานรายคน: data.auth.staffs = [{id, name, hash, lead, ver}] · lead = หัวหน้า (อนุมัติยกเลิกทั้งโต๊ะได้)
// โทเค็น: admin.<hmac> = เจ้าของร้าน (หลังร้าน) · staff.<hmac> = รหัสรวม (ไม่รู้ว่าใคร)
//         staff.owner.<hmac> = เจ้าของร้านเข้าหน้าสั่งอาหาร · staff.<id>.<hmac> = พนักงานคนนั้น
// เปลี่ยนรหัส/ลบพนักงาน = ver ของคนนั้นเปลี่ยน · "ออกจากระบบทุกเครื่อง" = ver.staff เปลี่ยน ทุกโทเค็นหน้าสั่งอาหารใช้ไม่ได้
if (!Array.isArray(data.auth.staffs)) data.auth.staffs = [];
const staffById = id => data.auth.staffs.find(s => s.id === id);
const tokenFor = (level, who) => {
  const v = who === 'owner' ? 'o' + (data.auth.ver?.admin || 1) : who ? 's' + (staffById(who)?.ver || 1) : '';
  return level + '.' + (who ? who + '.' : '') + crypto.createHmac('sha256', data.auth.secret)
    .update(level + ':' + (data.auth.ver?.[level] || 1) + (who ? ':' + who + ':' + v : '')).digest('hex').slice(0, 40);
};
// โทเค็นนี้เป็นใคร · level 0 = ไม่มี/ใช้ไม่ได้แล้ว
function tokenInfo(t) {
  const parts = String(t || '').split('.'), level = parts[0], who = parts.length === 3 ? parts[1] : '';
  const none = { level: 0, id: '', name: '', lead: false };
  if (!LEVELS[level] || !data.auth.admin || (who && (level !== 'staff' || (who !== 'owner' && !staffById(who))))) return none;
  const a = Buffer.from(String(t)), b = Buffer.from(tokenFor(level, who || undefined));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return none;
  if (level === 'admin' || who === 'owner') return { level: LEVELS[level], id: 'owner', name: 'เจ้าของร้าน', lead: true };
  if (who) { const s = staffById(who); return { level: 1, id: s.id, name: s.name, lead: !!s.lead }; }
  return { level: 1, id: 'staff', name: 'พนักงาน (รหัสรวม)', lead: false };
}
const tokenLevel = t => tokenInfo(t).level;
const whoOf = req => tokenInfo(req?.headers?.['x-pin-token']);
// รหัสทุกคนต้องไม่ซ้ำกัน (ใส่รหัสแล้วต้องรู้ว่าเป็นใคร) · except = id ที่กำลังแก้
function pinTaken(h, except) {
  if (except !== 'owner' && h === data.auth.admin) return 'เจ้าของร้าน';
  if (except !== 'staff' && h === data.auth.staff) return 'รหัสรวมพนักงาน';
  return data.auth.staffs.find(s => s.id !== except && s.hash === h)?.name || '';
}
// ใส่ผิด 5 ครั้ง → พัก 30 วินาที (ครั้งต่อไปนานขึ้น) กันการไล่กดทุกรหัส
const pinFails = new Map();
function checkPinLimit(ip) {
  const f = pinFails.get(ip);
  if (f && f.until > Date.now()) throw new Error(`ใส่รหัสผิดหลายครั้ง รออีก ${Math.ceil((f.until - Date.now()) / 1000)} วินาที`);
}
function pinFailed(ip) {
  const f = pinFails.get(ip) || { n: 0, until: 0 };
  f.n++;
  if (f.n % 5 === 0) f.until = Date.now() + 30000 * Math.min(10, f.n / 5);
  pinFails.set(ip, f);
  const left = 5 - (f.n % 5);
  throw new Error(f.until > Date.now() ? 'ใส่รหัสผิดหลายครั้ง รอ 30 วินาทีแล้วลองใหม่' : `รหัสไม่ถูกต้อง${left <= 2 ? ` (เหลืออีก ${left} ครั้ง)` : ''}`);
}
const cleanPin = p => { p = String(p ?? ''); if (!/^\d{4}$/.test(p)) throw new Error('รหัสต้องเป็นตัวเลข 4 หลัก'); return p; };
const clientIp = req => String(req.socket.remoteAddress || '').replace('::ffff:', '');

// เลขใบเสร็จ: วันที่-ลำดับ เช่น 20261012-007 (นับต่อเนื่องในวัน รวมใบเสร็จจากการแยกจ่าย)
function nextReceiptNo() {
  const d = dayKey(Date.now()).replace(/-/g, '');   // นับเลขต่อเนื่องทั้งวันขาย (ไม่เริ่ม 001 ใหม่ตอนเที่ยงคืน)
  if (!data.rcpt || data.rcpt.day !== d) {
    // เริ่มวันใหม่ หรือข้อมูลรุ่นเก่า: นับต่อจากใบเสร็จที่มีอยู่แล้วในวันนี้
    const nums = [];
    for (const o of data.orders) {
      for (const r of [o.receiptNo, ...(o.payments || []).map(p => p.receiptNo)])
        if (r && r.startsWith(d + '-')) nums.push(Number(r.slice(d.length + 1)) || 0);
    }
    data.rcpt = { day: d, n: nums.length ? Math.max(...nums) : 0 };
  }
  data.rcpt.n++;
  return `${d}-${String(data.rcpt.n).padStart(3, '0')}`;
}
// จำนวนที่จ่ายไปแล้วของแต่ละจาน (จากการแยกจ่ายตามรายการ)
function paidQtyOf(order) {
  const q = {};
  for (const p of order.payments || []) for (const l of p.lines || []) q[l.id] = (q[l.id] || 0) + l.qty;
  return q;
}

// กลุ่มตัวเลือกของเมนู: กลุ่มที่เขียนในเมนูเอง + ชุดสำเร็จรูปที่ผูกไว้ ({ref: id})
function groupsOf(m) {
  return (m.groups || []).map(g => (g.ref ? data.optionSets.find(s => s.id === g.ref) : g)).filter(Boolean);
}
function cleanGroup(g) {
  return {
    name: String(g.name || '').trim() || 'ตัวเลือก',
    type: g.type === 'multi' ? 'multi' : 'single',
    required: !!g.required,
    alert: !!g.alert,   // เตือนครัวเป็นสีแดง เช่น แพ้อาหาร
    // printers = พิมพ์ใบแยกที่เครื่องนี้ด้วยเมื่อเลือกตัวเลือกนี้ (เช่น ไข่ดาว → หน้าร้าน) · [] = ไม่แยก
    choices: (g.choices || []).map(c => {
      const printers = pickIds(c.printers, data.settings.printers || []);
      // addTh = บวกราคาเมื่อสั่งราคาคนไทย (เช่น ไข่ดาว ฝรั่งฟรี คนไทย +10) · ไม่ใส่ = บวกเท่าราคาปกติ
      const th = c.addTh === '' || c.addTh == null ? NaN : Number(c.addTh);
      return { name: String(c.name || '').trim(), add: r2(Number(c.add) || 0), ...(th >= 0 ? { addTh: r2(th) } : {}),
        ...(printers.length ? { printers } : {}) };
    }).filter(c => c.name),
  };
}

// เลือกเฉพาะ id ที่มีอยู่จริง ไม่ซ้ำ
const pickIds = (ids, list) => [...new Set((Array.isArray(ids) ? ids : []).filter(id => list.some(x => x.id === id)))];
// ทำให้ข้อมูลเมนูที่ส่งมาจากหน้าตั้งค่าถูกรูปแบบเสมอ
function cleanMenuItem(m) {
  const name = String(m.name || '').trim();
  if (!name) throw new Error('ใส่ชื่อเมนูก่อน');
  const price = Number(m.price);
  if (!(price >= 0)) throw new Error('ราคาไม่ถูกต้อง');
  const seen = new Set();
  const groups = (m.groups || []).map(g => {
    if (g.ref) {   // ผูกชุดสำเร็จรูป: เก็บแค่รหัส ไม่ซ้ำ
      if (seen.has(g.ref) || !data.optionSets.some(s => s.id === g.ref)) return null;
      seen.add(g.ref); return { ref: g.ref };
    }
    const c = cleanGroup(g); return c.choices.length ? c : null;
  }).filter(Boolean);
  let id = m.id;
  if (!id) do { id = newId('m'); } while (data.menu.some(x => x.id === id));  // กันชนกับเมนูที่มีอยู่
  const grid = cleanGrid(m.grid, groupsOf({ groups }));
  return {
    id, name,
    category: String(m.category || '').trim() || 'อื่นๆ',
    price: grid ? Math.min(...Object.values(grid.prices)) : r2(price),   // มีตารางราคา: ราคาเริ่มต้น = ถูกสุดในตาราง
    printers: pickIds(m.printers, data.settings.printers), screens: pickIds(m.screens, data.settings.kdsScreens),
    available: m.available !== false, groups, ...(grid ? { grid } : {}),
    ...(m.noNote ? { noNote: true } : {}),   // ไม่มีช่องหมายเหตุตอนสั่ง (เช่น น้ำเปล่า)
    // ราคาคนไทย (ไม่ใส่ = เมนูนี้มีราคาเดียว) · เมนูที่ใช้ตารางราคาเก็บใน grid.pricesTh แทน
    ...(!grid && m.priceTh !== '' && m.priceTh != null && Number(m.priceTh) >= 0 ? { priceTh: r2(Number(m.priceTh)) } : {}),
  };
}

// ---------- ตารางราคา: ราคาขึ้นกับตัวเลือก 1–2 กลุ่มพร้อมกัน (เช่น เนื้อสัตว์ × ขนาด S/M/L) ----------
// grid = {groups: [ชื่อกลุ่ม, ชื่อกลุ่ม], prices: {'ทะเล|S': 150, 'ไก่/หมู|S': 120, ...}}
// ช่องที่ไม่มีในตาราง = ไม่มีขาย (เช่น ผัดน้ำมันหอยไม่มีเจ) · กลุ่มในตารางต้องเป็นแบบ "เลือก 1"
// ราคาจาน = ราคาในตาราง + "บวกราคา" ของกลุ่มอื่นที่ไม่อยู่ในตาราง
function cleanGrid(grid, groups) {
  if (!grid || !Array.isArray(grid.groups) || !grid.prices || typeof grid.prices !== 'object') return undefined;
  const names = [...new Set(grid.groups.map(String))].slice(0, 2);
  const gs = names.map(n => groups.find(g => g.name === n));
  if (!names.length || gs.some(g => !g)) return undefined;
  // กลุ่มแบบ "หลายอย่าง" ใช้ได้ (เช่น เนื้อสัตว์ผสม ไก่ + กุ้ง) → คิดราคาของตัวที่แพงที่สุด
  const prices = {};
  for (const [k, v] of Object.entries(grid.prices)) {
    const parts = k.split('|'), n = Number(v);
    if (parts.length !== gs.length || v === '' || v == null || !(n >= 0)) continue;
    if (parts.every((c, i) => gs[i].choices.some(x => x.name === c))) prices[k] = r2(n);
  }
  if (!Object.keys(prices).length) return undefined;
  // ราคาคนไทย: เฉพาะช่องที่มีราคาปกติ · ไม่ใส่ = ใช้ราคาปกติ
  // thaiSkip = ราคาคนไทยไม่แยกตามกลุ่มนี้ (เช่น "ขนาด") → ตารางราคาไทยใช้กลุ่มที่เหลือ ('' = ราคาเดียว) · ช่องไม่ใส่ = ไม่มีราคาไทย
  const skip = names.length && names.includes(String(grid.thaiSkip || '')) ? String(grid.thaiSkip) : undefined;
  const remG = skip ? gs.filter((g, i) => names[i] !== skip) : gs;
  const pricesTh = {};
  for (const [k, v] of Object.entries(grid.pricesTh && typeof grid.pricesTh === 'object' ? grid.pricesTh : {})) {
    const n = Number(v);
    if (v === '' || v == null || !(n >= 0)) continue;
    if (!skip) { if (k in prices) pricesTh[k] = r2(n); continue; }
    const parts = k === '' ? [] : k.split('|');
    if (parts.length === remG.length && parts.every((c, i) => remG[i].choices.some(x => x.name === c))) pricesTh[k] = r2(n);
  }
  return { groups: names, prices, ...(Object.keys(pricesTh).length ? { pricesTh } : {}), ...(skip ? { thaiSkip: skip } : {}) };
}

// ตรวจตัวเลือกที่ลูกค้าเลือก แล้วคิดราคา
// thai = ใช้ราคาคนไทย (เฉพาะเมนูที่ตั้งราคาคนไทยไว้ · ตัวเลือกบวกตาม addTh ถ้าตั้งไว้ ไม่งั้นบวกเท่าราคาปกติ)
function resolveChoices(m, picked, thai = false) {
  // picked: [{g: ชื่อกลุ่ม, c: ชื่อตัวเลือก}] · รองรับแบบเก่า: string ชื่อตัวเลือกเดียว
  const groups = groupsOf(m);
  if (typeof picked === 'string') picked = picked ? [{ g: groups[0]?.name, c: picked }] : [];
  picked = Array.isArray(picked) ? picked : [];
  const names = [], parts = [], opts = [], alerts = [], split = [];
  const grid = m.grid?.groups?.length ? m.grid : null, key = {};
  let add = 0;
  // ราคาคนไทยที่ไม่แยกตามกลุ่มหนึ่ง (เช่น ไม่มีไซส์): ข้ามกลุ่มนั้นทั้งการบังคับเลือกและราคา
  const skip = thai && grid?.thaiSkip && Object.keys(grid.pricesTh || {}).length ? grid.thaiSkip : null;
  for (const g of groups) {
    if (g.name === skip) continue;
    const sel = g.choices.filter(c => picked.some(p => p.g === g.name && p.c === c.name));
    const inGrid = grid?.groups.includes(g.name);
    if ((g.required || inGrid) && !sel.length) throw new Error(`${m.name}: ต้องเลือก${g.name}`);
    if (g.type === 'single' && sel.length > 1) throw new Error(`${m.name}: ${g.name} เลือกได้อย่างเดียว`);
    for (const c of sel) {
      names.push(c.name); (g.alert ? alerts : opts).push(c.name); if (!inGrid) add += addOf(c, thai);
      if (c.printers?.length) split.push({ name: c.name, printers: [...c.printers] });
    }
    if (inGrid) key[g.name] = sel.map(c => c.name);
    if (sel.length) parts.push({ g: g.name, c: sel.map(c => c.name) });
  }
  let base = thai && m.priceTh != null ? m.priceTh : m.price;
  if (grid && skip) {
    // ราคาคนไทยตามกลุ่มที่เหลือ (เช่น ตามเนื้อสัตว์) · เนื้อสัตว์ผสม = แพงสุด
    let combos = [[]];
    for (const n of grid.groups.filter(n => n !== skip)) combos = combos.flatMap(c => (key[n] || []).map(x => [...c, x]));
    base = -1;
    for (const c of combos) {
      const p = grid.pricesTh[c.join('|')];
      if (p == null) throw new Error(`${m.name}: ยังไม่ได้ตั้งราคาคนไทยของ ${c.join(' ') || 'เมนูนี้'}`);
      base = Math.max(base, p);
    }
    if (base < 0) throw new Error(`${m.name}: เลือกตัวเลือกให้ครบ`);
  } else if (grid) {
    // ทุกคู่ที่เลือก (เนื้อสัตว์ผสมได้หลายอย่าง × ขนาด) ต้องมีในตาราง · ราคา = แพงสุด
    let combos = [[]];
    for (const n of grid.groups) combos = combos.flatMap(c => (key[n] || []).map(x => [...c, x]));
    base = -1;
    for (const c of combos) {
      const k = c.join('|'), p = grid.prices[k];
      if (p == null) throw new Error(`${m.name}: ไม่มี ${c.join(' ')}`);
      if (thai && grid.pricesTh?.[k] != null) { base = Math.max(base, grid.pricesTh[k]); continue; }   // ช่องที่ไม่ได้ใส่ราคาไทย = ราคาปกติ
      base = Math.max(base, p);
    }
    if (base < 0) throw new Error(`${m.name}: เลือกตัวเลือกให้ครบ`);
  }
  return { names, add, parts, opts, alerts, base, split };
}
const addOf = (c, thai) => (thai && c.addTh != null ? c.addTh : c.add);
// มีราคาคนไทย = ตั้งราคาเมนู/ตารางราคาไทย หรือมีตัวเลือกที่บวกราคาคนไทยต่างจากปกติ
const hasThaiPrice = m => m.priceTh != null || !!(m.grid?.pricesTh && Object.keys(m.grid.pricesTh).length)
  || groupsOf(m).some(g => g.choices.some(c => c.addTh != null));
function isNoKdsCategory(c) { return /เครื่องดื่ม|ของหวาน|น้ำ|ขนม/.test(c || ''); }

// ---------- เครื่องพิมพ์ / จอครัว ----------
// จานที่สั่งก่อนอัปเดต ใช้ station/kitchen แบบเก่า → แปลงตอนอ่าน
function itemPrinters(i) { return Array.isArray(i.printers) ? i.printers : [i.station || 'kitchen']; }
function itemScreens(i) { return Array.isArray(i.screens) ? i.screens : i.kitchen ? [data.settings.kdsScreens?.[0]?.id || 'main'] : []; }
const onScreen = i => itemScreens(i).length > 0;   // ครัวต้องทำ (ติดตามสถานะ รอทำ/เสร็จ)
const kdsScreenOf = id => (id === 'all' ? 'all' : data.settings.kdsScreens.some(k => k.id === id) ? id : data.settings.kdsScreens[0].id);
// ---------- ภาษาใบเสร็จ ----------
const LANGS = ['th', 'en', 'both'];
// {en: {คำไทย: English}} · ตัดคำว่าง/ยาวเกิน · ภาษาละไม่เกิน 3000 คำ
function cleanI18n(v) {
  const out = { en: {} };
  for (const [lang, dict] of Object.entries(v && typeof v === 'object' ? v : {})) {
    if (!/^[a-z]{2}$/.test(lang) || !dict || typeof dict !== 'object') continue;
    const d = {};
    for (const [k, t] of Object.entries(dict).slice(0, 3000)) {
      const kk = String(k).trim().slice(0, 80), tt = String(t ?? '').trim().slice(0, 80);
      if (kk && tt) d[kk] = tt;
    }
    out[lang] = d;
  }
  return out;
}
// ---------- หน้าตาหน้าสั่งอาหาร (หลังร้าน > หน้าสั่งอาหาร) ----------
function cleanOrderUi(u) {
  u = u && typeof u === 'object' ? u : {};
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  return {
    theme: pick(u.theme, ['classic', 'dark', 'green', 'blue', 'pink'], 'classic'),
    size: pick(u.size, ['sm', 'md', 'lg', 'xl'], 'md'), font: pick(u.font, ['sm', 'md', 'lg'], 'md'),
    cols: pick(String(u.cols), ['auto', '2', '3', '4', '5', '6'], 'auto'),
    showEn: u.showEn !== false, showPrice: u.showPrice !== false, showSearch: u.showSearch !== false,
    abroad: u.abroad !== false,   // ปุ่ม "กลับต่างประเทศ"
  };
}
// ---------- รูปแบบใบสั่งครัว (หลังร้าน > ใบสั่งครัว) ----------
function cleanTicket(t) {
  t = t && typeof t === 'object' ? t : {};
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; };
  const on = (v, d) => (typeof v === 'boolean' ? v : d);
  return {
    lang: pick(t.lang, LANGS, 'th'),
    sizeTable: num(t.sizeTable, 28, 72, 44), sizeItem: num(t.sizeItem, 24, 60, 36), sizeOpt: num(t.sizeOpt, 20, 48, 30),
    showTime: on(t.showTime, true), showType: on(t.showType, false), showRound: on(t.showRound, false),
    showStation: on(t.showStation, false), showCount: on(t.showCount, false), divider: on(t.divider, false), showThai: on(t.showThai, true),
    qtyPos: pick(t.qtyPos, ['front', 'back'], 'front'), optStyle: pick(t.optStyle, ['inline', 'line'], 'inline'),
    noteStyle: pick(t.noteStyle, ['normal', 'bold', 'invert'], 'normal'), alertStyle: pick(t.alertStyle, ['bold', 'invert'], 'bold'),
    mode: pick(t.mode, ['all', 'cat', 'grp', 'each'], 'all'),
    price: pick(t.price, ['off', 'all', 'thai'], 'all'),   // ราคาบนใบสั่งที่พิมพ์ (จอครัวไม่แสดง)
    footer: String(t.footer || '').slice(0, 200),
    feed: num(t.feed, 0, 10, 4), beep: num(t.beep, 0, 5, 0),
  };
}
function slug(prefix, taken) { let k = 1; while (taken.has(prefix + k)) k++; return prefix + k; }
function cleanPrinters(list) {
  const ids = new Set(), out = [];
  for (const p of (list || []).slice(0, 20)) {
    let id = String(p.id || '').replace(/[^\w-]/g, '').slice(0, 20);
    if (!id || ids.has(id)) id = slug('p', ids);
    ids.add(id);
    const port = Math.round(Number(p.port));
    out.push({ id, name: String(p.name || '').trim().slice(0, 30) || 'เครื่องพิมพ์ ' + (out.length + 1),
      ip: String(p.ip || '').trim().slice(0, 64), port: port > 0 && port < 65536 ? port : 9100,
      dots: Number(p.dots) === 384 ? 384 : 576, copies: Math.min(5, Math.max(1, Math.round(Number(p.copies)) || 1)),
      // การแบ่งใบของเครื่องนี้ · '' = ตามหลังร้าน > ใบสั่งครัว
      slip: ['all', 'cat', 'grp', 'each'].includes(p.slip) ? p.slip : '' });
  }
  return out;
}
function cleanScreens(list) {
  const ids = new Set(), out = [];
  for (const k of (list || []).slice(0, 10)) {
    let id = String(k.id || '').replace(/[^\w-]/g, '').slice(0, 20);
    if (!id || ids.has(id)) id = slug('k', ids);
    ids.add(id);
    out.push({ id, name: String(k.name || '').trim().slice(0, 30) || 'จอ ' + (out.length + 1) });
  }
  if (!out.length) throw new Error('ต้องมีจอครัวอย่างน้อย 1 จอ');
  return out;
}
// ลบเครื่องพิมพ์/จอแล้ว เอาออกจากเมนูที่อ้างถึงด้วย
function fixMenuRefs() {
  const P = new Set(data.settings.printers.map(p => p.id)), K = new Set(data.settings.kdsScreens.map(k => k.id));
  for (const m of data.menu) {
    m.printers = [...new Set((m.printers || []).filter(id => P.has(id)))];
    m.screens = [...new Set((m.screens || []).filter(id => K.has(id)))];
  }
  // ตัวเลือกที่ตั้งให้พิมพ์แยกไปเครื่องที่ถูกลบ → เลิกพิมพ์แยก
  const fixChoices = g => { for (const c of g?.choices || []) if (c.printers) { c.printers = c.printers.filter(id => P.has(id)); if (!c.printers.length) delete c.printers; } };
  for (const m of data.menu) for (const g of m.groups || []) if (!g.ref) fixChoices(g);
  for (const s of data.optionSets || []) fixChoices(s);
}

function saveRaw() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, DATA_FILE); // เขียนแบบปลอดภัย ไฟล์ไม่พังถ้าไฟดับกลางคัน
}
function save() {
  data.rev = (data.rev || 0) + 1;   // เลขรุ่นของข้อมูล เครื่องสำรองใช้ดูว่ามีอะไรเปลี่ยน
  saveRaw();
}

// ================= เครื่องหลัก / เครื่องสำรอง =================
// เครื่องสำรองดึงข้อมูลจากเครื่องหลักทุก 2 วินาที ถ้าเครื่องหลักพัง กด "ใช้เครื่องนี้เป็นเครื่องหลัก"
// epoch เพิ่มทุกครั้งที่สลับเครื่อง ถ้าเครื่องเก่ากลับมา มันจะเห็นว่าอีกเครื่อง epoch สูงกว่า แล้วลดตัวเองเป็นเครื่องสำรอง
const ROLE_FILE = path.join(__dirname, 'role.json');
const normUrl = u => {
  u = String(u || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//.test(u)) u = 'http://' + u;
  if (!/:\d+$/.test(u.replace(/^https?:\/\//, ''))) u += ':3000';
  return u;
};
let role = { role: 'main', peer: '' };
try { role = { ...role, ...JSON.parse(fs.readFileSync(ROLE_FILE, 'utf8')) }; } catch {}
{
  const i = process.argv.indexOf('--standby');
  if (i > 0) role = { role: 'standby', peer: normUrl(process.argv[i + 1] || role.peer || data.settings.nodes?.main) };
  if (process.argv.includes('--main')) role = { role: 'main', peer: role.peer };
  if (role.role === 'standby' && !role.peer) {
    console.log('ใส่ที่อยู่เครื่องหลักด้วย เช่น: node server.js --standby 192.168.1.50:3000'); process.exit(1);
  }
}
if (!data.epoch) data.epoch = 1;
const saveRole = () => { try { fs.writeFileSync(ROLE_FILE, JSON.stringify(role)); } catch {} };
saveRole();
const myIps = () => Object.values(os.networkInterfaces()).flat()
  .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
const myUrls = () => [...myIps(), 'localhost', '127.0.0.1'].map(ip => `http://${ip}:${PORT}`);
function peerUrl() {
  const mine = new Set(myUrls());
  return [role.peer, data.settings.nodes?.main, data.settings.nodes?.standby].map(normUrl).find(u => u && !mine.has(u)) || '';
}
const repl = { lastSync: 0, syncErr: '', standbySeen: 0, standbyIp: '', peerRole: null, peerSeen: 0, conflict: false,
  needPair: false, pairAsk: 0, pairAskIp: '' };
// กุญแจคัดลอกข้อมูล: /api/sync ส่งข้อมูลทั้งร้านให้เฉพาะเครื่องที่มีกุญแจนี้
// คำนวณจาก auth.secret ของข้อมูลร้าน → เครื่องสำรองที่เคยคัดลอกแล้วมีอยู่แล้ว (สลับเครื่องหลักไปมาก็ใช้ต่อได้)
// เครื่องสำรองใหม่ (ยังไม่เคยคัดลอก) จับคู่ครั้งแรกด้วยรหัสเจ้าของร้านของเครื่องหลัก → ได้กุญแจเก็บไว้ใน role.key
const syncKey = () => crypto.createHmac('sha256', data.auth.secret).update('edpos-sync').digest('hex');
const syncKeyOk = k => { const a = Buffer.from(String(k || '')), b = Buffer.from(syncKey()); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const getJSON = async (u, opt = {}) => {
  const r = await fetch(u, { ...opt, signal: AbortSignal.timeout(3000) });
  return r.json();
};

// เครื่องสำรอง: ดึงข้อมูลล่าสุด
async function syncTick() {
  if (role.role !== 'standby') return;
  try {
    // ลองกุญแจจากข้อมูลของเครื่องนี้ก่อน ไม่ผ่านค่อยใช้กุญแจที่ได้ตอนจับคู่ (ซึ่งต้องดึงข้อมูลทั้งชุด rev=-1)
    let j = null;
    for (const k of [...new Set([syncKey(), role.key].filter(Boolean))]) {
      j = await getJSON(`${role.peer}/api/sync?rev=${k === syncKey() ? data.rev || 0 : -1}`, { headers: { 'X-Sync-Key': k } });
      if (!j.auth) break;
    }
    if (j.role === 'main' && j.auth) {
      repl.needPair = true; repl.syncErr = 'ยังไม่ได้จับคู่กับเครื่องหลัก ใส่รหัสเจ้าของร้านที่หน้าเครื่องสำรอง'; return;
    }
    repl.needPair = false;
    if (j.role !== 'main') { repl.syncErr = 'เครื่องที่ตั้งไว้ไม่ได้เป็นเครื่องหลัก'; return; }
    if (j.data) {
      data = j.data; saveRaw(); broadcast();
      if (role.key) { delete role.key; saveRole(); }   // ข้อมูลชุดนี้มีกุญแจของเครื่องหลักแล้ว
    }
    repl.lastSync = Date.now(); repl.syncErr = '';
  } catch { repl.syncErr = 'ติดต่อเครื่องหลักไม่ได้'; }
}
setInterval(syncTick, 2000);

// เครื่องหลัก: คอยดูอีกเครื่อง ถ้าอีกเครื่องรับงานแทนไปแล้ว (epoch สูงกว่า) ให้ตัวเองเป็นเครื่องสำรอง
async function peerTick() {
  if (role.role !== 'main') return;
  const peer = peerUrl(); if (!peer) return;
  try {
    const j = await getJSON(`${peer}/api/role`);
    repl.peerRole = j.role; repl.peerSeen = Date.now();
    repl.conflict = j.role === 'main' && j.epoch === data.epoch;
    if (j.role === 'main' && j.epoch > data.epoch) {
      console.log(`เครื่อง ${peer} รับงานแทนแล้ว → เครื่องนี้เปลี่ยนเป็นเครื่องสำรอง`);
      role = { role: 'standby', peer }; saveRole(); broadcast(); syncTick();
    }
  } catch { repl.peerRole = null; }
}
setInterval(peerTick, 5000);

function noteBattery(q, req) {
  const pct = Number(q?.get('bat'));
  if (!q?.has('bat') || !(pct >= 0 && pct <= 100)) return;
  const ip = String(req.socket.remoteAddress || '');
  if (!/^(::1|127\.|::ffff:127\.)/.test(ip)) return;   // รับเฉพาะจากแอปในเครื่องนี้
  const chg = q.get('chg') === '1', prev = health.bat;
  health.bat = { pct, chg, at: Date.now() };
  const k = dayKey(Date.now()), d = (health.batDay[k] ||= { min: pct, max: pct });
  d.min = Math.min(d.min, pct); d.max = Math.max(d.max, pct);
  // แบตต่ำกว่า 20% และไม่ได้ชาร์จ → จดครั้งเดียวจนกว่าจะชาร์จ/แบตกลับมาเกิน 30%
  if (pct < 20 && !chg && !health.batLow) { health.batLow = true; healthEvent('battery', { pct }); }
  if (health.batLow && (chg || pct > 30)) health.batLow = false;
  if (prev && prev.chg && !chg && Date.now() - prev.at < 600000) healthEvent('unplug', { pct });   // ถอดสายชาร์จ
  healthDirty = true;
}
// สรุปสุขภาพระบบของช่วงวันขาย from–to
function healthReport(from, to) {
  const a = bizStart(from), z = bizStart(addDays(to, 1));
  const ev = health.events.filter(e => e.t >= a && e.t < z);
  const starts = ev.filter(e => e.k === 'start');
  const prn = {};
  for (let k = from; k <= to; k = addDays(k, 1)) for (const [id, c] of Object.entries(health.prints[k] || {})) {
    const x = prn[id] || (prn[id] = { ok: 0, fail: 0 }); x.ok += c.ok; x.fail += c.fail;
  }
  let bmin = null;
  for (let k = from; k <= to; k = addDays(k, 1)) if (health.batDay[k]) bmin = Math.min(bmin ?? 100, health.batDay[k].min);
  const firstStart = health.events.find(e => e.k === 'start')?.t || BOOT;
  return {
    from, to, since: firstStart,   // เริ่มเก็บข้อมูลเมื่อ (ก่อนหน้านี้ไม่มีบันทึก)
    now: {
      uptime: Date.now() - BOOT, role: role.role, bat: health.bat || null,
      standby: role.role === 'main' ? (repl.standbySeen ? { seen: repl.standbySeen, ip: repl.standbyIp } : null) : { lastSync: repl.lastSync, err: repl.syncErr || '' },
      printers: (data.settings.printers || []).map(p => ({ id: p.id, name: p.name, ip: p.ip || '', down: !!prnState[p.id]?.down,
        lastErr: prnState[p.id]?.lastErr || '', lastAt: prnState[p.id]?.lastAt || 0 })),
      line: data.settings.line?.lastErr || data.settings.line?.alertErr || '',
    },
    starts: starts.length, downMin: starts.reduce((s, e) => s + (e.down || 0), 0),
    printers: prn, batMin: bmin,
    standbyLost: ev.filter(e => e.k === 'standby' && !e.ok).length,
    errors: ev.filter(e => e.k === 'error').length,
    events: ev.slice(-200).reverse(),
  };
}
function roleInfo() {
  return { role: role.role, epoch: data.epoch, rev: data.rev || 0, peer: peerUrl(), me: myUrls().slice(0, -2),
    nodes: data.settings.nodes || {}, lastSync: repl.lastSync, syncErr: repl.syncErr,
    standbySeen: repl.standbySeen, standbyIp: repl.standbyIp, peerRole: repl.peerRole, peerSeen: repl.peerSeen,
    // hasData = มีข้อมูลร้านแล้ว (เคยคัดลอก/ตั้งรหัส)
    conflict: repl.conflict, now: Date.now(), hasData: !!data.auth.admin, tz: new Date().getTimezoneOffset(), needPair: repl.needPair, app: !!process.env.EDPOS_APP, startupWarn,
    pairAsk: Date.now() - repl.pairAsk < 15000 ? repl.pairAskIp : '',
    openTables: data.orders.filter(o => o.status === 'open').length };
}

// สำรองข้อมูลวันละไฟล์ (เก็บย้อนหลัง 30 วัน)
function dailyBackup() {
  if (!fs.existsSync(DATA_FILE)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const f = path.join(BACKUP_DIR, `data-${today()}.json`);
  fs.copyFileSync(DATA_FILE, f);
  const files = fs.readdirSync(BACKUP_DIR).filter(n => n.startsWith('data-')).sort();
  while (files.length > 30) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
}
setInterval(dailyBackup, 60 * 60 * 1000);

// ล้างบิลเก่า (เก็บบิลที่จ่ายแล้วไว้ 7 วันในไฟล์หลัก ที่เหลืออยู่ใน backup)
// ---------- สรุปยอดขาย ----------
// บิลละเอียดเก็บไว้ 7 วันเต็ม (ไฟล์ไม่โตจนแท็บเล็ตช้า) ก่อนลบจะย่อเป็นสรุปรายวันเก็บใน data.daily ไว้ตลอด
const KEEP_DAYS = 7;
// วันที่ตามปฏิทิน (ไม่เลื่อน) · ใช้ไล่วันในช่วงรายงาน
const ymdOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// ตัดรอบวันขาย (หลังร้าน > ข้อมูลร้าน): ร้านเปิดเลยเที่ยงคืน ตั้งเช่น 5 = บิลก่อนตี 5 นับเป็นของวันก่อน
// ใช้กับยอดขาย สรุป LINE ประวัติการสั่ง เลขใบเสร็จ ให้ตรงกันทั้งระบบ · 0 = ตัดตอนเที่ยงคืน (เดิม)
const cutoffH = () => Math.min(8, Math.max(0, Math.round(Number(data.settings?.dayCutoff) || 0)));
const dayKey = t => ymdOf(new Date(+new Date(t) - cutoffH() * 3600000));
// เวลาเริ่มวันขายของวันที่ k (เช่น 2026-10-24 ตัดรอบตี 5 → 24 ต.ค. 05:00)
const bizStart = k => { const d = new Date(k + 'T00:00:00'); d.setHours(cutoffH()); return d.getTime(); };
// ลำดับชั่วโมงในวันขาย (ตัดรอบตี 5: 05:00 = 0 … 04:00 = 23)
const relH = h => (Number(h) - cutoffH() + 24) % 24;
const catOf = i => i.category || data.menu.find(m => m.id === i.menuId)?.category || 'อื่นๆ';

function emptyDay(date) {
  return { date, bills: 0, subtotal: 0, fee: 0, total: 0,
    byMethod: { cash: 0, transfer: 0, card: 0 }, billsByMethod: { cash: 0, transfer: 0, card: 0 },
    byHour: {}, items: {}, cats: {}, cancelled: { qty: 0, amount: 0 }, dishes: 0, voids: { bills: 0, amount: 0 }, staff: {},
    cook: emptyTimes(), sit: emptyTimes(), tables: {}, occ: {}, ta: { bills: 0, amount: 0 }, addons: {},
    billB: [0, 0, 0, 0, 0], billBAmt: [0, 0, 0, 0, 0], billsByHour: {}, kind: emptyKind() };
}
// ขนาดบิล: <100 · 100–199 · 200–499 · 500–999 · 1,000+ บาท
const BILL_B = [100, 200, 500, 1000];
// ประเภทการขาย (รายจาน): ทานที่ร้าน / กลับบ้าน / กลับต่างประเทศ · thai = จานที่สั่งราคาคนไทย (ซ้อนกับประเภทอื่นได้)
const emptyKind = () => ({ dine: { qty: 0, amount: 0 }, ta: { qty: 0, amount: 0 }, abroad: { qty: 0, amount: 0 }, thai: { qty: 0, amount: 0 } });
function addKind(day, k, qty, amt) {
  if (!day.kind) day.kind = emptyKind();
  const x = day.kind[k]; x.qty += qty; x.amount = r2(x.amount + amt);
}
// ---------- โต๊ะ: ยอด/เวลานั่งรายโต๊ะ · occ = นาทีที่มีโต๊ะนั่งอยู่ในแต่ละชั่วโมง (รวมทุกโต๊ะ) ----------
function addTable(day, o, subtotal) {
  if (String(o.table).startsWith('TA')) {
    if (!day.ta) day.ta = { bills: 0, amount: 0 };
    day.ta.bills++; day.ta.amount = r2(day.ta.amount + subtotal); return;
  }
  if (!day.tables) day.tables = {};
  const t = day.tables[o.table] || (day.tables[o.table] = { bills: 0, amount: 0, n: 0, sum: 0 });
  t.bills++; t.amount = r2(t.amount + subtotal);
  const min = o.createdAt && o.paidAt ? (o.paidAt - o.createdAt) / 60000 : -1;
  if (!(min >= 0) || min > TIME_MAX.sit) return;
  t.n++; t.sum = r2(t.sum + min);
  if (!day.occ) day.occ = {};
  // แบ่งเวลานั่งลงแต่ละชั่วโมง เช่น 18:40–19:30 → 18 = 20 นาที, 19 = 30 นาที
  for (let a = o.createdAt; a < o.paidAt;) {
    const d = new Date(a), next = new Date(d); next.setMinutes(60, 0, 0);
    const b = Math.min(o.paidAt, next.getTime()), h = d.getHours();
    day.occ[h] = r2((day.occ[h] || 0) + (b - a) / 60000); a = b;
  }
}
// ---------- ตัวเลือกที่บวกราคา (เช่น ไข่ดาว เพิ่มกุ้ง): นับจากกลุ่มที่มีตัวเลือกบวกราคา (ไม่นับตารางราคา/เตือนครัว) ----------
function addAddons(day, i) {
  const m = data.menu.find(x => x.id === i.menuId), picked = i.opts || [];
  if (!m || !picked.length) return;
  for (const g of groupsOf(m)) {
    if (g.alert || m.grid?.groups?.includes(g.name) || !g.choices.some(c => c.add > 0 || c.addTh > 0)) continue;
    for (const c of g.choices) if (picked.includes(c.name)) {
      if (!day.addons) day.addons = {};
      const a = day.addons[c.name] || (day.addons[c.name] = { qty: 0, amount: 0 });
      a.qty += i.qty; a.amount = r2(a.amount + addOf(c, !!i.thai) * i.qty);
    }
  }
}
// ---------- เวลา: ครัวทำนานแค่ไหน (cook) · ลูกค้านั่งนานแค่ไหน (sit) ----------
// เก็บเป็นนาที: n = จำนวน · sum = รวมนาที · b = จำนวนในแต่ละช่วงเวลา (TIME_B) · byHour = แยกตามชั่วโมงที่เริ่ม
// cook.items = แยกตามเมนู {name: {n, sum, max}}
const TIME_B = { cook: [10, 15, 20, 30], sit: [30, 60, 90, 120] };   // ช่วง: <10, 10–15, 15–20, 20–30, 30+ นาที
const TIME_MAX = { cook: 120, sit: 360 };   // นานเกินนี้ = ลืมกดเสร็จ/ลืมปิดโต๊ะ ไม่นับ
function emptyTimes() { return { n: 0, sum: 0, b: [0, 0, 0, 0, 0], byHour: {}, items: {} }; }
function addTime(day, kind, from, to, name) {
  if (!from || !to) return;
  const min = (to - from) / 60000;
  if (!(min >= 0) || min > TIME_MAX[kind]) return;
  const t = day[kind] || (day[kind] = emptyTimes());
  t.n++; t.sum = r2(t.sum + min);
  t.b[TIME_B[kind].filter(x => min >= x).length]++;
  const h = new Date(from).getHours(), hr = t.byHour[h] || (t.byHour[h] = { n: 0, sum: 0 });
  hr.n++; hr.sum = r2(hr.sum + min);
  if (name) { const it = t.items[name] || (t.items[name] = { n: 0, sum: 0, max: 0 }); it.n++; it.sum = r2(it.sum + min); it.max = Math.max(it.max, r2(min)); }
}
// รวมเวลาของหลายวัน (สรุปรายวันรุ่นเก่าไม่มี cook/sit → ข้าม)
function mergeTimes(into, t) {
  if (!t) return;
  into.n += t.n; into.sum = r2(into.sum + t.sum);
  t.b.forEach((v, i) => (into.b[i] += v));
  for (const h in t.byHour) { const a = into.byHour[h] || (into.byHour[h] = { n: 0, sum: 0 }); a.n += t.byHour[h].n; a.sum = r2(a.sum + t.byHour[h].sum); }
  for (const k in t.items || {}) {
    const a = into.items[k] || (into.items[k] = { n: 0, sum: 0, max: 0 }), x = t.items[k];
    a.n += x.n; a.sum = r2(a.sum + x.sum); a.max = Math.max(a.max, x.max);
  }
}
const avgMin = t => (t?.n ? Math.round(t.sum / t.n) : null);
// ยอดรายพนักงาน (เฉพาะบิลที่บันทึกชื่อไว้ · บิลก่อนมีระบบพนักงานรายคนไม่มีชื่อ)
// dishes = จานที่สั่ง · cancels = จานที่ยกเลิก · voids = โต๊ะที่ยกเลิกทั้งโต๊ะ · bills = ครั้งที่รับเงิน
function staffRow(day, name) {
  if (!day.staff) day.staff = {};
  return day.staff[name] || (day.staff[name] = { name, dishes: 0, amount: 0, cancels: 0, cancelAmt: 0, voids: 0, voidAmt: 0, bills: 0, billAmt: 0 });
}
// บิลที่ยกเลิกทั้งโต๊ะ: ไม่นับเป็นยอดขาย แต่นับจำนวนโต๊ะและมูลค่าที่ยกเลิกไว้ดู
function addVoid(day, its, o = {}) {
  if (!day.voids) day.voids = { bills: 0, amount: 0 };
  day.voids.bills++;
  let tot = 0;
  for (const i of its) {
    const amt = r2(i.price * i.qty);
    day.voids.amount = r2(day.voids.amount + amt);
    day.cancelled.qty += i.qty; day.cancelled.amount = r2(day.cancelled.amount + amt);
    if (i.by) { const r = staffRow(day, i.by); r.dishes += i.qty; r.amount = r2(r.amount + amt); }
    // จานที่ยกเลิกทีละจานไปก่อนแล้ว = การยกเลิกของคนนั้น · ที่เหลือ = ยกเลิกพร้อมทั้งโต๊ะ
    if (i.cancelledBy) { const r = staffRow(day, i.cancelledBy); r.cancels += i.qty; r.cancelAmt = r2(r.cancelAmt + amt); }
    else tot = r2(tot + amt);
  }
  if (o.voidedBy && its.length) { const r = staffRow(day, o.voidedBy); r.voids++; r.voidAmt = r2(r.voidAmt + tot); }
}
// รวมบิลที่จ่ายแล้วเข้าสรุปของวัน
function addBill(day, o, its) {
  const subtotal = o.subtotal ?? o.total ?? 0;
  day.subtotal = r2(day.subtotal + subtotal); day.fee = r2(day.fee + (o.fee || 0));
  day.total = r2(day.total + (o.total ?? subtotal));
  // แยกจ่าย: แต่ละครั้งที่จ่ายนับเป็นหนึ่งบิล ตามวิธีชำระของครั้งนั้น
  const parts = o.payments?.length ? o.payments.map(p => ({ m: p.method, amt: p.amount, tot: p.total, at: p.at, by: p.by }))
    : [{ m: o.payMethod, amt: subtotal, tot: o.total ?? subtotal, at: o.paidAt, by: o.paidBy }];
  for (const p of parts) {
    if (p.by) { const r = staffRow(day, p.by); r.bills++; r.billAmt = r2(r.billAmt + p.amt); }
    const m = p.m in day.byMethod ? p.m : 'cash';
    day.bills++; day.byMethod[m] = r2(day.byMethod[m] + p.tot); day.billsByMethod[m]++;
    const h = new Date(p.at).getHours();
    day.byHour[h] = r2((day.byHour[h] || 0) + p.amt);
    if (!day.billsByHour) day.billsByHour = {};
    day.billsByHour[h] = (day.billsByHour[h] || 0) + 1;
    if (!day.billB) { day.billB = [0, 0, 0, 0, 0]; day.billBAmt = [0, 0, 0, 0, 0]; }
    const bi = BILL_B.filter(x => p.amt >= x).length;
    day.billB[bi]++; day.billBAmt[bi] = r2(day.billBAmt[bi] + p.amt);
  }
  // ลูกค้านั่งนานแค่ไหน: เปิดโต๊ะ → จ่ายครบ (ไม่นับกลับบ้าน TA)
  if (!String(o.table).startsWith('TA')) addTime(day, 'sit', o.createdAt, o.paidAt);
  addTable(day, o, subtotal);
  for (const i of its) {
    const amt = r2(i.price * i.qty);
    if (i.by) { const r = staffRow(day, i.by); r.dishes += i.qty; r.amount = r2(r.amount + amt); }
    if (i.status === 'cancelled') {
      day.cancelled.qty += i.qty; day.cancelled.amount = r2(day.cancelled.amount + amt);
      if (i.cancelledBy) { const r = staffRow(day, i.cancelledBy); r.cancels += i.qty; r.cancelAmt = r2(r.cancelAmt + amt); }
      continue;
    }
    const it = day.items[i.name] || (day.items[i.name] = { name: i.name, category: catOf(i), qty: 0, amount: 0, opts: {} });
    it.qty += i.qty; it.amount = r2(it.amount + amt);
    if (i.option) it.opts[i.option] = (it.opts[i.option] || 0) + i.qty;
    day.cats[it.category] = r2((day.cats[it.category] || 0) + amt);
    day.dishes += i.qty;
    // ครัวทำนานแค่ไหน: สั่ง → จอครัวกดเสร็จ (เฉพาะจานที่ขึ้นจอครัว)
    if (i.status === 'done' && onScreen(i)) addTime(day, 'cook', i.createdAt, i.doneAt, i.name);
    addAddons(day, i);
    addKind(day, i.abroad ? 'abroad' : i.takeaway ? 'ta' : 'dine', i.qty, amt);
    if (i.thai) addKind(day, 'thai', i.qty, amt);
  }
}
function summarizeLive(date) {
  const day = emptyDay(date);
  for (const o of data.orders) if (o.status === 'paid' && dayKey(o.paidAt) === date)
    addBill(day, o, data.items.filter(i => i.orderId === o.id));
  for (const o of data.orders) if (o.status === 'void' && dayKey(o.voidedAt) === date)
    addVoid(day, data.items.filter(i => i.orderId === o.id), o);
  return day;
}

const itemLabelSrv = i => i.name + (i.option ? ' ' + i.option : '');
function prune() {
  const keepFrom = new Date(bizStart(addDays(dayKey(Date.now()), -KEEP_DAYS)));
  const old = data.orders.filter(o => (o.status === 'paid' && o.paidAt < keepFrom.getTime())
    || (o.status === 'void' && o.voidedAt < keepFrom.getTime()));
  if (!old.length) return;
  if (!data.daily) data.daily = {};
  for (const o of old) {
    const k = dayKey(o.status === 'void' ? o.voidedAt : o.paidAt);
    const day = data.daily[k] || (data.daily[k] = emptyDay(k));
    const its = data.items.filter(i => i.orderId === o.id);
    if (o.status === 'void') addVoid(day, its, o); else addBill(day, o, its);
  }
  const ids = new Set(old.map(o => o.id));
  data.orders = data.orders.filter(o => !ids.has(o.id));
  data.items = data.items.filter(i => !ids.has(i.orderId));
}

// สรุปของวันเดียว: บิลละเอียด (7 วันล่าสุด) หรือสรุปรายวันที่ย่อเก็บไว้
function dayOf(k) {
  const live = summarizeLive(k);
  return live.bills || live.voids.bills ? live : (data.daily?.[k] || emptyDay(k));
}
const addDays = (k, n) => { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() + n); return ymdOf(d); };
// เทียบช่วงก่อนหน้า: ดูวันเดียว = วันเดียวกันของสัปดาห์ก่อน · หลายวัน = ช่วงยาวเท่ากันก่อนหน้า
// ช่วงที่จบวันนี้ (ร้านยังไม่ปิด) → วันสุดท้ายของช่วงก่อนนับยอดถึงชั่วโมงเดียวกันเท่านั้น จะได้เทียบกันได้จริง
function prevPeriod(from, n, to) {
  const pf = n === 1 ? addDays(from, -7) : addDays(from, -n), pt = n === 1 ? pf : addDays(from, -1);
  const cut = to === dayKey(Date.now()) ? new Date().getHours() : null;
  const out = { from: pf, to: pt, subtotal: 0, bills: 0, dishes: 0, partial: cut, cook: emptyTimes(), sit: emptyTimes(), items: {}, cats: {}, byHour: {} };
  for (let k = pf; k <= pt; k = addDays(k, 1)) {
    const d = dayOf(k), last = k === pt;
    out.subtotal = r2(out.subtotal + (last && cut != null
      ? Object.entries(d.byHour).reduce((s, [h, v]) => s + (relH(h) <= relH(cut) ? v : 0), 0) : d.subtotal));
    out.bills += d.bills; out.dishes += d.dishes;
    mergeTimes(out.cook, d.cook); mergeTimes(out.sit, d.sit);
    for (const n in d.items) { const a = out.items[n] || (out.items[n] = { qty: 0, amount: 0 }); a.qty += d.items[n].qty; a.amount = r2(a.amount + d.items[n].amount); }
    for (const c in d.cats) out.cats[c] = r2((out.cats[c] || 0) + d.cats[c]);
    for (const h in d.byHour) out.byHour[h] = r2((out.byHour[h] || 0) + d.byHour[h]);
  }
  out.cook = { n: out.cook.n, avg: avgMin(out.cook) }; out.sit = { n: out.sit.n, avg: avgMin(out.sit) };
  return out;
}

// รวมหลายวันเป็นรายงานเดียว
function buildReport(from, to) {
  const days = [];
  for (let d = new Date(from + 'T00:00:00'); ymdOf(d) <= to; d.setDate(d.getDate() + 1)) {
    days.push(dayOf(ymdOf(d)));
    if (days.length > 400) break;
  }
  // ตารางวันในสัปดาห์ × ชั่วโมง (ยอดรวม และจำนวนวันของแต่ละวันในสัปดาห์ เอาไว้หาค่าเฉลี่ย) · ดูตั้งแต่ 7 วันขึ้นไป
  const heat = days.length >= 7 ? { sums: Array.from({ length: 7 }, () => ({})), days: Array(7).fill(0) } : null;
  if (heat) for (const d of days) {
    const w = new Date(d.date + 'T00:00:00').getDay(); heat.days[w]++;
    for (const h in d.byHour) heat.sums[w][h] = r2((heat.sums[w][h] || 0) + d.byHour[h]);
  }
  const sum = emptyDay(`${from}..${to}`);
  for (const d of days) {
    for (const f of ['bills', 'dishes']) sum[f] += d[f];
    for (const f of ['subtotal', 'fee', 'total']) sum[f] = r2(sum[f] + d[f]);
    for (const m in d.byMethod) { sum.byMethod[m] = r2(sum.byMethod[m] + d.byMethod[m]); sum.billsByMethod[m] += d.billsByMethod[m]; }
    for (const h in d.byHour) sum.byHour[h] = r2((sum.byHour[h] || 0) + d.byHour[h]);
    for (const c in d.cats) sum.cats[c] = r2((sum.cats[c] || 0) + d.cats[c]);
    sum.cancelled.qty += d.cancelled.qty; sum.cancelled.amount = r2(sum.cancelled.amount + d.cancelled.amount);
    sum.voids.bills += d.voids?.bills || 0; sum.voids.amount = r2(sum.voids.amount + (d.voids?.amount || 0));
    mergeTimes(sum.cook, d.cook); mergeTimes(sum.sit, d.sit);
    for (const t in d.tables || {}) {
      const a = sum.tables[t] || (sum.tables[t] = { bills: 0, amount: 0, n: 0, sum: 0 }), x = d.tables[t];
      a.bills += x.bills; a.amount = r2(a.amount + x.amount); a.n += x.n; a.sum = r2(a.sum + x.sum);
    }
    for (const h in d.occ || {}) sum.occ[h] = r2((sum.occ[h] || 0) + d.occ[h]);
    if (d.ta) { sum.ta.bills += d.ta.bills; sum.ta.amount = r2(sum.ta.amount + d.ta.amount); }
    for (const n in d.addons || {}) { const a = sum.addons[n] || (sum.addons[n] = { qty: 0, amount: 0 }); a.qty += d.addons[n].qty; a.amount = r2(a.amount + d.addons[n].amount); }
    (d.billB || []).forEach((v, i) => { sum.billB[i] += v; sum.billBAmt[i] = r2(sum.billBAmt[i] + d.billBAmt[i]); });
    for (const h in d.billsByHour || {}) sum.billsByHour[h] = (sum.billsByHour[h] || 0) + d.billsByHour[h];
    for (const k in d.kind || {}) { sum.kind[k].qty += d.kind[k].qty; sum.kind[k].amount = r2(sum.kind[k].amount + d.kind[k].amount); }
    for (const n in d.staff || {}) {
      const a = d.staff[n], s = staffRow(sum, n);
      for (const f of ['dishes', 'cancels', 'voids', 'bills']) s[f] += a[f] || 0;
      for (const f of ['amount', 'cancelAmt', 'voidAmt', 'billAmt']) s[f] = r2(s[f] + (a[f] || 0));
    }
    for (const n in d.items) {
      const a = d.items[n], s = sum.items[n] || (sum.items[n] = { name: n, category: a.category, qty: 0, amount: 0, opts: {} });
      s.qty += a.qty; s.amount = r2(s.amount + a.amount);
      for (const o in a.opts) s.opts[o] = (s.opts[o] || 0) + a.opts[o];
    }
  }
  // บิลรายตัว (มีเฉพาะช่วง 7 วันล่าสุด)
  const bills = data.orders.filter(o => o.status === 'paid' && dayKey(o.paidAt) >= from && dayKey(o.paidAt) <= to)
    .sort((a, b) => b.paidAt - a.paidAt)
    .flatMap(o => {
      const its = data.items.filter(i => i.orderId === o.id && i.status !== 'cancelled');
      if (o.payments?.length) return o.payments.map(p => ({ id: o.id, payNo: p.no, receiptNo: p.receiptNo, table: o.table,
        paidAt: p.at, method: p.method, subtotal: p.amount, fee: p.fee, total: p.total, split: `${p.no}/${o.payments.length}`,
        items: p.lines ? p.lines.reduce((n, l) => n + l.qty, 0) : null })).reverse();
      return [{ id: o.id, receiptNo: o.receiptNo, table: o.table, paidAt: o.paidAt, method: o.payMethod,
        subtotal: o.subtotal ?? o.total, fee: o.fee || 0, total: o.total, items: its.reduce((n, i) => n + i.qty, 0) }];
    });
  const detailFrom = new Date(bizStart(addDays(dayKey(Date.now()), -KEEP_DAYS)));
  return {
    from, to, summary: { ...sum, items: undefined, items_list: Object.values(sum.items), staff: undefined, staff_list: Object.values(sum.staff) },
    // จานที่ยกเลิกทีละจาน (ไม่นับโต๊ะที่ยกเลิกทั้งโต๊ะ) · มีเฉพาะ 7 วันล่าสุด
    cancels: data.items.filter(i => i.status === 'cancelled' && i.cancelledAt && dayKey(i.cancelledAt) >= from && dayKey(i.cancelledAt) <= to
        && data.orders.find(o => o.id === i.orderId)?.status !== 'void')
      .sort((a, b) => b.cancelledAt - a.cancelledAt)
      .map(i => ({ at: i.cancelledAt, table: data.orders.find(o => o.id === i.orderId)?.table || '', name: itemLabelSrv(i), qty: i.qty,
        amount: r2(i.price * i.qty), by: i.cancelledBy || '', cooking: !!i.kdsCancel })),
    // รายวัน: ใช้ทั้งกราฟและตารางรายวัน · kindOk = วันนี้เก็บประเภทการขายแล้ว (สรุปรายวันรุ่นเก่าไม่มี)
    days: days.map(d => ({ date: d.date, bills: d.bills, subtotal: d.subtotal, total: d.total, fee: d.fee, dishes: d.dishes,
      byMethod: d.byMethod, cancelled: d.cancelled.amount, voids: d.voids?.bills || 0, byHour: d.byHour,
      wk: dayOf(addDays(d.date, -7)).subtotal })),   // wk = ยอดวันเดียวกันของสัปดาห์ก่อน
    prev: prevPeriod(from, days.length, to), heat,
    bills, billsComplete: from >= dayKey(detailFrom),
    // โต๊ะที่ยกเลิกทั้งโต๊ะ (รายตัว มีเฉพาะ 7 วันล่าสุด)
    voids: data.orders.filter(o => o.status === 'void' && dayKey(o.voidedAt) >= from && dayKey(o.voidedAt) <= to)
      .sort((a, b) => b.voidedAt - a.voidedAt)
      .map(o => { const its = data.items.filter(i => i.orderId === o.id);
        return { id: o.id, table: o.table, at: o.voidedAt, reason: o.voidReason || '', by: o.voidedBy || '', approvedBy: o.approvedBy || '',
          items: its.reduce((n, i) => n + i.qty, 0), amount: r2(its.reduce((s, i) => s + i.price * i.qty, 0)) }; }),
    open: data.orders.filter(o => o.status === 'open').map(o => ({ table: o.table,
      amount: r2(data.items.filter(i => i.orderId === o.id && i.status !== 'cancelled').reduce((s, i) => s + i.price * i.qty, 0)
        - (o.payments || []).reduce((s, p) => s + p.amount, 0)) })),
  };
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const newId = p => p + (data.seq++);

// ---------- แจ้งทุกหน้าจอแบบเรียลไทม์ (Server-Sent Events) ----------
const clients = new Set();
function broadcast() {
  for (const res of clients) res.write(`data: changed\n\n`);
}
// ชีพจรทุก 20 วินาที: หน้าเว็บใช้ดูว่าสายยังเชื่อมอยู่ (เงียบเกิน 45 วินาที → ต่อใหม่เอง)
// เป็น event ชื่อ ping จึงไม่ไปเรียกโหลดข้อมูลใหม่ (หน้าเว็บรุ่นเก่าไม่สนใจ event นี้)
setInterval(() => { for (const res of clients) res.write(`event: ping\ndata: ${data.rev || 0}\n\n`); }, 20000);

// ================= สรุปยอดส่งเข้า LINE (LINE Official Account · Messaging API) =================
// settings.line = {on, token, to, time:'23:00', lastSent:'2026-10-24', lastErr}
// to ว่าง = ส่งถึงทุกคนที่เพิ่ม LINE OA ของร้านเป็นเพื่อน (broadcast) · ใส่ User ID / Group ID = ส่งถึงคนหรือกลุ่มนั้น
const TH_DAY = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const PAY_TH = { cash: 'เงินสด', transfer: 'โอน/พร้อมเพย์', card: 'บัตร' };
const LINE_ID = /^[UCR][0-9a-f]{32}$/;
const LINE_ALERTS = ['printer', 'standby', 'takeover', 'void'];
function cleanLine(l, old = {}) {
  const to = String(l.to || '').trim();
  if (to && !LINE_ID.test(to)) throw new Error('User ID / Group ID ไม่ถูกต้อง (ขึ้นต้นด้วย U หรือ C ตามด้วยตัวอักษร 32 ตัว) หรือเว้นว่างไว้');
  return { on: !!l.on, to, time: /^([01]\d|2[0-3]):[0-5]\d$/.test(l.time) ? l.time : '23:00',
    // ช่องโทเค็นว่าง = ใช้ของเดิม (หน้าเว็บไม่เคยได้เห็นโทเค็น) · null = ลบ
    token: l.token === null ? '' : String(l.token || '').trim().slice(0, 600) || old.token || '',
    // แจ้งเตือนทันที (ไม่ระบุ = เปิด)
    alerts: Object.fromEntries(LINE_ALERTS.map(k => [k, (l.alerts || old.alerts || {})[k] !== false])),
    // สรุปรายสัปดาห์ (จ.–อา. ส่งคืนวันอาทิตย์) / รายเดือน (ส่งคืนวันสุดท้ายของเดือน) ตามเวลาส่งเดียวกัน
    // เพิ่งเปิด → จำว่าส่งช่วงที่จบไปแล้วแล้ว จะได้ไม่ส่งของเก่าทันที (กด "ส่งทดสอบ" ดูได้)
    weekly: !!l.weekly, monthly: !!l.monthly,
    counts: Array.isArray(l.counts) ? cleanCounts(l.counts) : old.counts,
    lastWeek: l.weekly && !old.weekly ? lastPeriod('week').to : old.lastWeek || '',
    lastMonth: l.monthly && !old.monthly ? lastPeriod('month').to : old.lastMonth || '',
    lastSent: old.lastSent || '', lastErr: old.lastErr || '', alertErr: old.alertErr || '' };
}
// ---------- นับจำนวนที่ขาย (เช่น กุ้งแม่น้ำ ปู หมึก) ใส่ในสรุป LINE ทุกแบบ ----------
// counts = [{name, menus: [menuId], opts: [ชื่อตัวเลือก]}] · จานนับเข้ารายการถ้าเป็นเมนูที่เลือก หรือสั่งตัวเลือกที่เลือก (เช่น เนื้อสัตว์: หมึก)
// ยังไม่เคยตั้ง → รายการเริ่มต้นจากชื่อเมนู (เจ้าของร้านแก้ได้ที่ หลังร้าน > สรุปยอดเข้า LINE)
const COUNT_DEFAULT = ['กุ้งแม่น้ำ', 'เนื้อปู', 'ปู', 'ปลาทอด', 'ปลาเผา', 'หมึก', 'ข้าวเหนียวมะม่วง', 'น้ำมะม่วง'];
function defaultCounts() {
  const choices = new Set(data.menu.flatMap(m => groupsOf(m).filter(g => !g.alert).flatMap(g => g.choices.map(c => c.name))));
  return COUNT_DEFAULT.map(name => ({ name,
    menus: data.menu.filter(m => m.name.includes(name) && !(name === 'ปู' && m.name.includes('เนื้อปู'))).map(m => m.id),
    opts: choices.has(name) ? [name] : [] }));
}
const lineCountsOf = () => (Array.isArray(data.settings.line?.counts) ? data.settings.line.counts : defaultCounts());
function cleanCounts(arr) {
  return arr.slice(0, 20).map(c => ({ name: String(c.name || '').trim().slice(0, 30),
    menus: [...new Set((Array.isArray(c.menus) ? c.menus : []).filter(id => data.menu.some(m => m.id === id)))],
    opts: [...new Set((Array.isArray(c.opts) ? c.opts : []).map(x => String(x).trim()).filter(Boolean))].slice(0, 20) })).filter(c => c.name);
}
// นับจากสรุปรายวัน (บิลที่ปิดแล้ว ตรงกับยอดขาย) · ตัวเลือกดูจากข้อความตัวเลือกของจาน ("ทะเล เผ็ดน้อย")
function countSold(from, to) {
  const list = lineCountsOf().filter(c => c.menus.length || c.opts.length);
  const out = list.map(c => ({ name: c.name, qty: 0, by: {} }));
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const d = dayOf(k);
    list.forEach((c, i) => {
      const names = new Set(c.menus.map(id => data.menu.find(m => m.id === id)?.name).filter(Boolean));
      for (const [n, it] of Object.entries(d.items)) {
        let q = 0;
        if (names.has(n)) {
          q = it.qty;
          const g = soloGroup(n);   // เบียร์: แยกขวดเล็ก/ขวดใหญ่
          if (g && Object.keys(it.opts || {}).length) {
            let rest = it.qty;
            for (const [o, oq] of Object.entries(it.opts)) { const k = n + ' ' + soloLabel(g, o); out[i].by[k] = (out[i].by[k] || 0) + oq; rest -= oq; }
            if (rest > 0) out[i].by[n] = (out[i].by[n] || 0) + rest;
            out[i].qty += q; out[i].sized = true; continue;
          }
        }
        else if (c.opts.length) for (const [o, oq] of Object.entries(it.opts || {})) if (o.split(' ').some(x => c.opts.includes(x))) q += oq;
        if (q) { out[i].qty += q; out[i].by[n] = (out[i].by[n] || 0) + q; }
      }
    });
  }
  return out;
}
// เมนูที่มีกลุ่มตัวเลือกกลุ่มเดียว (เช่น เบียร์ ขวด: เล็ก/ใหญ่) → แยกตามตัวเลือก ชื่ออ่านง่าย "ขวดเล็ก"
function soloGroup(name) { const m = data.menu.find(x => x.name === name), gs = m ? groupsOf(m).filter(g => !g.alert) : []; return gs.length === 1 ? gs[0] : null; }
const soloLabel = (g, o) => g.name + (/^[ก-๙]/.test(o) ? '' : ' ') + o;
// "ช้าง × 5 (ขวดเล็ก 3 · ขวดใหญ่ 2)"
function sizeTxt(it) {
  const g = soloGroup(it.name), e = Object.entries(it.opts || {}).sort((a, b) => b[1] - a[1]);
  return g && e.length ? ` (${e.map(([o, q]) => `${soloLabel(g, o)} ${q}`).join(' · ')})` : '';
}
// บรรทัดในข้อความ LINE: • กุ้งแม่น้ำ 12 ที่ (เผา 5 · นึ่ง 4 · ทอดกระเทียม 3)
function countLines(from, to) {
  const rows = countSold(from, to);
  if (!rows.length) return [];
  return ['📋 จำนวนที่ขาย', ...rows.map(r => {
    const by = Object.entries(r.by).sort((a, b) => b[1] - a[1]);
    const short = n => n.replace(r.name, '').trim() || n;   // "กุ้งแม่น้ำเผา" → "เผา"
    const detail = by.length > 1 || r.sized ? ` (${by.slice(0, 6).map(([n, q]) => `${short(n)} ${q}`).join(' · ')}${by.length > 6 ? ' …' : ''})` : '';
    return `• ${r.name} ${r.qty} ที่${detail}`;
  })];
}

// ช่วงล่าสุดที่จบไปแล้ว (นับตามวันขาย) · สัปดาห์ = จันทร์–อาทิตย์ · ถึงเวลาส่งของวันอาทิตย์/วันสิ้นเดือนแล้ว = นับช่วงนั้นด้วย
function lastPeriod(kind, k = dayKey(Date.now()), passed = lineTimePassed()) {
  if (kind === 'week') {
    const dow = new Date(k + 'T00:00:00').getDay();
    const to = dow === 0 && passed ? k : addDays(k, -(dow || 7));
    return { from: addDays(to, -6), to };
  }
  const lastDay = addDays(k, 1).endsWith('-01');
  const to = lastDay && passed ? k : addDays(k.slice(0, 8) + '01', -1);
  return { from: to.slice(0, 8) + '01', to };
}
// ถึงเวลาส่งของวันขายนี้หรือยัง (เทียบตามลำดับในวันขาย: ตัดรอบตี 5 ส่ง 01:00 = หลังปิดร้านคืนนั้น)
function lineTimePassed(now = new Date()) {
  const rel = (h, m) => relH(h) * 60 + m, [sh, sm] = String(data.settings.line?.time || '23:00').split(':').map(Number);
  return rel(now.getHours(), now.getMinutes()) >= rel(sh, sm);
}
function lineText(k) {
  const d = dayOf(k), dt = new Date(k + 'T00:00:00'), fmt = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const L = [`📊 สรุปยอดขาย ${data.settings.shopName || ''}`.trim(), `วัน${TH_DAY[dt.getDay()]} ${dt.getDate()} ${TH_MON[dt.getMonth()]} ${dt.getFullYear() + 543}`, ''];
  if (!d.bills) L.push('วันนี้ยังไม่มีบิลที่ปิด');
  else {
    const pv = prevPeriod(k, 1, k), pct = pv.subtotal ? Math.round((d.subtotal - pv.subtotal) / pv.subtotal * 100) : null;
    L.push(`💰 ยอดขาย ${fmt(d.subtotal)} ฿`);
    if (pct != null) L.push(`${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% จากวัน${TH_DAY[dt.getDay()]}ที่แล้ว (${fmt(pv.subtotal)} ฿${pv.partial != null ? ` ถึง ${pv.partial}:59` : ''})`);
    L.push(`🧾 ${d.bills} บิล · เฉลี่ย ${fmt(Math.round(d.subtotal / d.bills))} ฿/บิล · ${d.dishes} จาน`);
    if (d.fee) L.push(`รับจริง ${fmt(d.total)} ฿ (รวมค่าธรรมเนียมบัตร ${fmt(d.fee)} ฿)`);
    L.push('', 'ช่องทางชำระ');
    for (const m of ['cash', 'transfer', 'card']) if (d.billsByMethod[m]) L.push(`• ${PAY_TH[m]} ${fmt(d.byMethod[m])} ฿ (${d.billsByMethod[m]} บิล)`);
    const best = Object.entries(d.byHour).sort((a, b) => b[1] - a[1])[0];
    if (best) L.push('', `⏰ ช่วงขายดี ${best[0]}:00–${best[0]}:59 · ${fmt(best[1])} ฿`);
    const top = Object.values(d.items).sort((a, b) => b.qty - a.qty || b.amount - a.amount).slice(0, 5);
    if (top.length) L.push('', '🏆 ขายดี', ...top.map((it, i) => `${i + 1}. ${it.name} × ${it.qty}${sizeTxt(it)}`));
    const cl = countLines(k, k);
    if (cl.length) L.push('', ...cl);
    const tl = timeLines(d);
    if (tl.length) L.push('', ...tl);
  }
  if (d.cancelled.qty) L.push('', `❌ ยกเลิก ${d.cancelled.qty} จาน (${fmt(d.cancelled.amount)} ฿)${d.voids?.bills ? ` · ยกเลิกทั้งโต๊ะ ${d.voids.bills} โต๊ะ` : ''}`);
  if (k === dayKey(Date.now())) {
    const open = data.orders.filter(o => o.status === 'open');
    if (open.length) {
      const due = open.reduce((s, o) => s + data.items.filter(i => i.orderId === o.id && i.status !== 'cancelled').reduce((a, i) => a + i.price * i.qty, 0)
        - (o.payments || []).reduce((a, p) => a + p.amount, 0), 0);
      L.push('', `⚠ ยังเปิดอยู่ ${open.length} โต๊ะ ยอดรอเก็บ ${fmt(r2(due))} ฿ (ยังไม่นับในยอดขาย)`);
    }
  }
  return L.join('\n');
}
// เวลาครัว / เวลานั่ง (ใช้ทั้งสรุปรายวัน รายสัปดาห์ รายเดือน)
function timeLines(d) {
  const L = [], c = d.cook, st = d.sit;
  if (c?.n) {
    const slow = c.b[3] + c.b[4];
    L.push(`👨‍🍳 ครัวเฉลี่ย ${avgMin(c)} นาที/จาน · ภายใน 15 นาที ${Math.round((c.b[0] + c.b[1]) / c.n * 100)}%${slow ? ` · เกิน 20 นาที ${slow} จาน` : ''}`);
  }
  if (st?.n) L.push(`🪑 ลูกค้านั่งเฉลี่ย ${avgMin(st)} นาที/โต๊ะ (${st.n} โต๊ะ)`);
  return L;
}
// สรุปรายสัปดาห์ / รายเดือน · เทียบสัปดาห์ก่อน / เดือนก่อน (ทั้งเดือน)
function lineRangeText(kind, from, to) {
  const fmt = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const dt = k => new Date(k + 'T00:00:00'), DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  const short = k => `${DOW[dt(k).getDay()]} ${dt(k).getDate()} ${TH_MON[dt(k).getMonth()]}`;
  const r = buildReport(from, to), d = r.summary, nDays = r.days.length;
  const shop = data.settings.shopName || '';
  const L = kind === 'week'
    ? [`📊 สรุปยอดขายรายสัปดาห์ ${shop}`.trim(), `${short(from)} – ${short(to)} ${dt(to).getFullYear() + 543}`, '']
    : [`📊 สรุปยอดขายประจำเดือน ${shop}`.trim(), `${TH_MON[dt(from).getMonth()]} ${dt(from).getFullYear() + 543} (${nDays} วัน)`, ''];
  if (!d.bills) { L.push(kind === 'week' ? 'สัปดาห์นี้ไม่มีบิลที่ปิด' : 'เดือนนี้ไม่มีบิลที่ปิด'); return L.join('\n'); }
  // ช่วงก่อนหน้า: สัปดาห์ก่อน 7 วัน · เดือนก่อนทั้งเดือน
  const pt = addDays(from, -1), pf = kind === 'week' ? addDays(from, -7) : pt.slice(0, 8) + '01';
  let prev = 0; for (let k = pf; k <= pt; k = addDays(k, 1)) prev = r2(prev + dayOf(k).subtotal);
  L.push(`💰 ยอดขาย ${fmt(d.subtotal)} ฿`);
  if (prev) {
    const pct = Math.round((d.subtotal - prev) / prev * 100);
    L.push(`${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% จาก${kind === 'week' ? 'สัปดาห์ก่อน' : 'เดือน ' + TH_MON[dt(pf).getMonth()]} (${fmt(prev)} ฿)`);
  }
  const open = r.days.filter(x => x.bills);
  L.push(`🧾 ${d.bills} บิล · เฉลี่ย ${fmt(Math.round(d.subtotal / d.bills))} ฿/บิล · ${d.dishes} จาน`);
  L.push(`📅 เปิดขาย ${open.length} วัน · เฉลี่ยวันละ ${fmt(Math.round(d.subtotal / open.length))} ฿`);
  if (d.fee) L.push(`รับจริง ${fmt(d.total)} ฿ (รวมค่าธรรมเนียมบัตร ${fmt(d.fee)} ฿)`);
  if (open.length > 1) {
    const by = [...open].sort((a, b) => b.subtotal - a.subtotal), hi = by[0], lo = by[by.length - 1];
    L.push(`🔝 ขายดีสุด ${short(hi.date)} ${fmt(hi.subtotal)} ฿`, `🔻 ขายน้อยสุด ${short(lo.date)} ${fmt(lo.subtotal)} ฿`);
  }
  // วันในสัปดาห์ที่ขายดี (รายเดือน: เฉลี่ยต่อวัน)
  if (kind === 'month') {
    const w = Array.from({ length: 7 }, () => ({ s: 0, n: 0 }));
    for (const x of open) { const a = w[dt(x.date).getDay()]; a.s += x.subtotal; a.n++; }
    const best = w.map((a, i) => ({ i, avg: a.n ? a.s / a.n : 0 })).sort((a, b) => b.avg - a.avg)[0];
    if (best.avg) L.push(`📆 วัน${TH_DAY[best.i]}ขายดีที่สุด เฉลี่ย ${fmt(Math.round(best.avg))} ฿/วัน`);
  }
  L.push('', 'ช่องทางชำระ');
  for (const m of ['cash', 'transfer', 'card']) if (d.billsByMethod[m]) L.push(`• ${PAY_TH[m]} ${fmt(d.byMethod[m])} ฿ (${d.billsByMethod[m]} บิล)`);
  const best = Object.entries(d.byHour).sort((a, b) => b[1] - a[1])[0];
  if (best) L.push('', `⏰ ช่วงขายดี ${best[0]}:00–${best[0]}:59 (รวม ${fmt(best[1])} ฿)`);
  const top = d.items_list.sort((a, b) => b.qty - a.qty || b.amount - a.amount).slice(0, 10);
  if (top.length) L.push('', '🏆 ขายดี', ...top.map((it, i) => `${i + 1}. ${it.name} × ${it.qty}${sizeTxt(it)}`));
  const cl = countLines(from, to);
  if (cl.length) L.push('', ...cl);
  const tl = timeLines(d);
  if (tl.length) L.push('', ...tl);
  if (d.cancelled.qty) L.push('', `❌ ยกเลิก ${d.cancelled.qty} จาน (${fmt(d.cancelled.amount)} ฿)${d.voids?.bills ? ` · ยกเลิกทั้งโต๊ะ ${d.voids.bills} โต๊ะ` : ''}`);
  return L.join('\n');
}
// ข้อความตามชนิด: day (วันนี้) · week (สัปดาห์ล่าสุดที่จบแล้ว) · month (เดือนล่าสุดที่จบแล้ว)
function lineTextOf(kind, k = dayKey(Date.now())) {
  if (kind === 'week' || kind === 'month') { const p = lastPeriod(kind, k, true); return lineRangeText(kind, p.from, p.to); }
  return lineText(k);
}
function linePost(token, to, text) {
  const body = JSON.stringify(to ? { to, messages: [{ type: 'text', text }] } : { messages: [{ type: 'text', text }] });
  return new Promise((ok, fail) => {
    const req = https.request({ host: 'api.line.me', path: to ? '/v2/bot/message/push' : '/v2/bot/message/broadcast', method: 'POST', timeout: 15000,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'Content-Length': Buffer.byteLength(body) } }, res => {
      let t = ''; res.on('data', c => (t += c));
      res.on('end', () => {
        if (res.statusCode === 200) return ok();
        let msg = t; try { msg = JSON.parse(t).message || t; } catch {}
        fail(new Error(res.statusCode === 401 ? 'โทเค็นไม่ถูกต้อง (Channel access token)' : res.statusCode === 429 ? 'ใช้โควตาข้อความ LINE ของเดือนนี้หมดแล้ว' : `LINE ตอบกลับ ${res.statusCode}: ${msg}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('ติดต่อ LINE ไม่ได้ (เครื่องหลักต่อเน็ตหรือยัง?)')));
    req.on('error', e => fail(e.code ? new Error('ติดต่อ LINE ไม่ได้ (เครื่องหลักต่อเน็ตหรือยัง?) · ' + e.code) : e));
    req.end(body);
  });
}
async function sendLine(k, kind = 'day', period) {
  const L = data.settings.line || {};
  if (!L.token) throw new Error('ยังไม่ได้ใส่ Channel access token');
  await linePost(L.token, L.to, period ? lineRangeText(kind, period.from, period.to) : lineTextOf(kind, k));
}
// ---------- แจ้งเตือนทันที ----------
// kind: printer = เครื่องพิมพ์พิมพ์ไม่ออก/กลับมาได้ · standby = เครื่องสำรองหลุด/กลับมา · takeover = เครื่องสำรองรับงานแทน · void = ยกเลิกทั้งโต๊ะ
// ส่งจากเครื่องหลักเท่านั้น · ส่งไม่สำเร็จจดไว้ใน alertErr (ไม่ลองซ้ำ จะได้ไม่ส่งเรื่องเก่าทีหลัง)
function lineAlert(kind, text) {
  const L = data.settings.line;
  if (!L?.token || role.role !== 'main' || L.alerts?.[kind] === false) return;
  const t = new Date(), hm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  linePost(L.token, L.to, `${text}\n— ${data.settings.shopName || 'ED POS'} · ${hm} น.`)
    .then(() => { if (L.alertErr) { L.alertErr = ''; save(); broadcast(); } })
    .catch(e => { L.alertErr = e.message; console.log('แจ้งเตือน LINE ไม่สำเร็จ: ' + e.message); save(); broadcast(); });
}
// เครื่องพิมพ์: แจ้งครั้งเดียวต่อการเสียหนึ่งรอบ (พิมพ์ไม่ออก → แจ้ง · พิมพ์ได้อีก → แจ้งว่ากลับมาแล้ว) · เสียซ้ำภายใน 10 นาทีไม่แจ้งซ้ำ
const prnState = {};
function printerResult(id, err) {
  const st = prnState[id] || (prnState[id] = { down: false, at: 0 });
  // นับพิมพ์สำเร็จ/ไม่สำเร็จรายวัน + เหตุการณ์ตอนเสีย/กลับมา
  const pk = dayKey(Date.now()), pd = (health.prints[pk] ||= {}), pc = (pd[id] ||= { ok: 0, fail: 0 });
  err ? pc.fail++ : pc.ok++; healthDirty = true;
  if (err && !st.down) healthEvent('printer', { p: id, ok: false, err: String(err.message || err).slice(0, 160) });
  else if (!err && st.down) healthEvent('printer', { p: id, ok: true });
  st.lastErr = err ? String(err.message || err) : ''; st.lastAt = Date.now();
  const name = data.settings.printers.find(p => p.id === id)?.name || id;
  if (err && !st.down) {
    st.down = true;
    if (Date.now() - st.at > 10 * 60000) { st.at = Date.now(); lineAlert('printer', `🖨 เครื่องพิมพ์ "${name}" พิมพ์ไม่ออก\n${err.message}\nตรวจว่าเปิดเครื่อง มีกระดาษ และต่อ Wi-Fi/สาย LAN อยู่`); }
  } else if (!err && st.down) {
    st.down = false;
    if (st.at) lineAlert('printer', `✅ เครื่องพิมพ์ "${name}" กลับมาพิมพ์ได้แล้ว`);
  }
}
// เครื่องสำรอง: เคยเชื่อมแล้วหายไปเกิน 2 นาที → แจ้ง · กลับมา → แจ้ง
const sbWatch = { alerted: false };
setInterval(() => {
  if (role.role !== 'main' || !repl.standbySeen) return;
  const gone = Date.now() - repl.standbySeen > 120000;
  if (gone && !sbWatch.alerted) { sbWatch.alerted = true; healthEvent('standby', { ok: false }); lineAlert('standby', `⚠ เครื่องสำรองหลุด ไม่ได้คัดลอกข้อมูลมา ${Math.round((Date.now() - repl.standbySeen) / 60000)} นาทีแล้ว\nถ้าเครื่องหลักพังตอนนี้ จะไม่มีเครื่องรับงานแทน · ตรวจว่าเครื่องสำรองเปิดอยู่และต่อ Wi-Fi`); }
  if (!gone && sbWatch.alerted) { sbWatch.alerted = false; healthEvent('standby', { ok: true }); lineAlert('standby', '✅ เครื่องสำรองกลับมาเชื่อมแล้ว'); }
}, 30000);

// ส่งอัตโนมัติวันละครั้งตามเวลาที่ตั้ง (เฉพาะเครื่องหลัก · เครื่องหลักปิดอยู่ตอนถึงเวลา → ส่งตอนเปิดในวันเดียวกัน)
// ส่งไม่สำเร็จ → ลองใหม่ทุก 10 นาที
let lineRetryAt = 0, lineBusy = false;
// รายสัปดาห์/รายเดือน: ส่งต่อจากสรุปของวันอาทิตย์/วันสิ้นเดือน · เครื่องหลักปิดอยู่คืนนั้น → ส่งคืนถัดไปตามเวลาเดิม
setInterval(async () => {
  const L = data.settings.line, k = dayKey(Date.now());
  if (!L?.token || !(L.on || L.weekly || L.monthly) || role.role !== 'main' || lineBusy || !lineTimePassed() || Date.now() < lineRetryAt) return;
  const jobs = [];
  if (L.on && L.lastSent !== k) jobs.push({ kind: 'day', mark: () => (L.lastSent = k) });
  for (const [kind, key] of [['week', 'lastWeek'], ['month', 'lastMonth']]) {
    if (!L[kind === 'week' ? 'weekly' : 'monthly']) continue;
    const p = lastPeriod(kind, k, true);
    if (L[key] !== p.to) jobs.push({ kind, period: p, mark: () => (L[key] = p.to) });
  }
  if (!jobs.length) return;
  lineBusy = true;
  try {
    for (const j of jobs) { await sendLine(k, j.kind, j.period); j.mark(); console.log(`ส่งสรุปยอด (${j.kind}) เข้า LINE แล้ว`); }
    L.lastErr = '';
  } catch (e) { L.lastErr = e.message; lineRetryAt = Date.now() + 10 * 60000; healthEvent('line', { err: e.message }); console.log('ส่ง LINE ไม่สำเร็จ: ' + e.message); }
  finally { lineBusy = false; save(); broadcast(); }
}, 30000);

// ================= ชุดการพิมพ์ (preset) =================
// เช่น "ปกติ" กับ "วันจันทร์" (จัดร้านไม่เหมือนเดิม) · สลับเองได้ หรือผูกกับวันในสัปดาห์ให้สลับตอนเริ่มวันขาย
// settings.printPresets = [{id, name, days: [0–6], snap}] · activePreset = ชุดที่ใช้อยู่ · presetDay = วันขายที่สลับอัตโนมัติแล้ว
// snap = เมนูไหนออกเครื่องไหน, การแบ่งใบ/จำนวนสำเนาของแต่ละเครื่อง, เครื่องพิมพ์ใบเสร็จ, ตัวเลือกที่พิมพ์แยก (ไม่เก็บ IP/ชื่อเครื่อง)
function choiceRefs(fn) {
  for (const s of data.optionSets || []) for (const c of s.choices || []) fn('s:' + s.id + '|' + c.name, c);
  for (const m of data.menu) for (const g of m.groups || []) if (!g.ref) for (const c of g.choices || []) fn('m:' + m.id + '|' + g.name + '|' + c.name, c);
}
function snapPrint() {
  const S = data.settings, choice = {}, choiceKeys = [];
  choiceRefs((k, c) => { choiceKeys.push(k); if (c.printers?.length) choice[k] = [...c.printers]; });
  return { printers: Object.fromEntries(S.printers.map(p => [p.id, { copies: p.copies || 1, slip: p.slip || '' }])),
    receiptPrinter: S.receiptPrinter || '', receiptCopies: S.receiptCopies || 1, printTickets: S.printTickets !== false,
    menu: Object.fromEntries(data.menu.map(m => [m.id, [...(m.printers || [])]])), choice, choiceKeys };
}
// เมนู/ตัวเลือกที่เพิ่มหลังบันทึกชุด → ไม่แตะ (คงค่าปัจจุบัน)
function applyPrint(snap) {
  const S = data.settings, P = new Set(S.printers.map(p => p.id)), ok = ids => [...new Set((ids || []).filter(id => P.has(id)))];
  for (const p of S.printers) { const x = snap.printers?.[p.id]; if (x) { p.copies = x.copies; p.slip = x.slip; } }
  if (P.has(snap.receiptPrinter)) S.receiptPrinter = snap.receiptPrinter;
  if (snap.receiptCopies) S.receiptCopies = snap.receiptCopies;
  if ('printTickets' in snap) S.printTickets = !!snap.printTickets;
  for (const m of data.menu) if (snap.menu && m.id in snap.menu) m.printers = ok(snap.menu[m.id]);
  const keys = new Set(snap.choiceKeys || []);
  choiceRefs((k, c) => { if (!keys.has(k)) return; const v = ok(snap.choice?.[k]); if (v.length) c.printers = v; else delete c.printers; });
}
const presetOf = id => (data.settings.printPresets || []).find(p => p.id === id);
// ชุดที่ใช้อยู่ถูกแก้หลังบันทึกไหม (หน้าเครื่องพิมพ์บอกให้กด "บันทึกทับ")
function presetModified() {
  const p = presetOf(data.settings.activePreset); if (!p) return false;
  const a = snapPrint(), b = p.snap, sameIds = (x, y) => JSON.stringify([...(x || [])].sort()) === JSON.stringify([...(y || [])].sort());
  if (a.receiptPrinter !== b.receiptPrinter || a.receiptCopies !== b.receiptCopies || a.printTickets !== b.printTickets) return true;
  for (const [id, x] of Object.entries(a.printers)) if (b.printers?.[id] && (b.printers[id].copies !== x.copies || b.printers[id].slip !== x.slip)) return true;
  for (const [id, ids] of Object.entries(a.menu)) if (b.menu && id in b.menu && !sameIds(ids, b.menu[id])) return true;
  const keys = new Set(b.choiceKeys || []);
  for (const k of keys) if (!sameIds(a.choice[k], b.choice?.[k])) return true;
  return false;
}
// สลับอัตโนมัติตามวัน: ตอนเริ่มวันขายใหม่ ถ้ามีชุดที่ผูกกับวันนั้น → ใช้ชุดนั้น (เฉพาะเครื่องหลัก)
setInterval(() => {
  if (role.role !== 'main') return;
  const S = data.settings, k = dayKey(Date.now());
  if (S.presetDay === k) return;
  S.presetDay = k;
  const dow = new Date(k + 'T00:00:00').getDay(), p = (S.printPresets || []).find(x => (x.days || []).includes(dow));
  if (p) {
    applyPrint(p.snap); S.activePreset = p.id;
    addEvent('preset', `สลับชุดการพิมพ์เป็น "${p.name}" อัตโนมัติ`);
    console.log(`สลับชุดการพิมพ์เป็น "${p.name}" (วัน${TH_DAY[dow]})`);
  }
  save(); broadcast();
}, 60000);

function addEvent(type, text) {
  data.events.push({ id: newId('e'), type, text, at: Date.now() });
  if (data.events.length > 50) data.events = data.events.slice(-50);
}

// ---------- ส่งไปเครื่องพิมพ์ (ESC/POS ผ่าน TCP 9100) ----------
// รับภาพขาวดำจากเบราว์เซอร์ (พิมพ์ไทยเป็นรูป ไม่มีปัญหาสระลอย)
// printer = id ของเครื่องพิมพ์ · copies = พิมพ์กี่ใบ (ตัดกระดาษทีละใบ)
// feed = บรรทัดว่างก่อนตัด (0–10, เดิม 4) · beep = เสียงบี๊บกี่ครั้ง (0–5, เครื่องที่มีลำโพงเท่านั้น)
function printRaster({ printer, widthBytes, height, bitsBase64, copies = 1, feed = 4, beep = 0 }, onSent) {
  const pr = data.settings.printers.find(p => p.id === printer);
  if (!pr) return Promise.reject(new Error('ไม่พบเครื่องพิมพ์นี้ (อาจถูกลบไปแล้ว) ตรวจที่หลังร้าน > เครื่องพิมพ์'));
  const label = 'เครื่องพิมพ์' + (pr.name || '');
  if (!pr.ip) return Promise.reject(new Error(`ยังไม่ได้ใส่ IP ${label}`));
  const bits = Buffer.from(bitsBase64, 'base64');
  const chunks = [Buffer.from([0x1b, 0x40])]; // ESC @ รีเซ็ต
  // แบ่งพิมพ์ทีละ 256 แถว กันเครื่องพิมพ์บางรุ่นบัฟเฟอร์เต็ม
  for (let y = 0; y < height; y += 256) {
    const h = Math.min(256, height - y);
    chunks.push(Buffer.from([0x1d, 0x76, 0x30, 0x00,
      widthBytes & 0xff, (widthBytes >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff]));
    chunks.push(bits.subarray(y * widthBytes, (y + h) * widthBytes));
  }
  const fd = Number.isFinite(Number(feed)) ? Math.min(10, Math.max(0, Math.round(Number(feed)))) : 4;
  chunks.push(Buffer.from([0x1b, 0x64, fd]));          // เลื่อนกระดาษก่อนตัด
  chunks.push(Buffer.from([0x1d, 0x56, 0x42, 0x00])); // ตัดกระดาษ
  const one = Buffer.concat(chunks);
  const bp = Math.min(5, Math.max(0, Math.round(Number(beep)) || 0));
  // ESC B n t = บี๊บ n ครั้ง ครั้งละ t×50ms (เครื่องที่ไม่มีลำโพงจะไม่สนคำสั่งนี้) · บี๊บครั้งเดียวต่องาน ไม่ซ้ำตามสำเนา
  const payload = Buffer.concat([...(bp ? [Buffer.from([0x1b, 0x42, bp, 3])] : []),
    ...Array(Math.min(5, Math.max(1, copies | 0))).fill(one)]);

  return sendWithRetry(pr, payload, label, onSent);
}

// ส่งข้อมูลไปเครื่องพิมพ์ แล้วตัดการเชื่อมต่อเอง
// เครื่องพิมพ์ใบเสร็จหลายรุ่นไม่ยอมปิดการเชื่อมต่อฝั่งตัวเอง และรับได้แค่ 1–2 การเชื่อมต่อพร้อมกัน
// ถ้ารอให้มันปิดเอง การเชื่อมต่อจะค้างสะสมจนเครื่องพิมพ์ไม่รับงานใหม่ (ต้องปิดเปิดเครื่อง)
// จึง: เขียนข้อมูลครบ → end() → รอ 1 วินาทีให้ข้อมูลถึง → destroy() ปิดให้ขาดเสมอ
//  ขั้นตอน: ต่อ → ส่งงาน + คำสั่งถามสถานะ (DLE EOT) → เครื่องพิมพ์ตอบ = งานถึงเครื่องครบแล้ว
//          → ตัดสายแบบบังคับ (RST) ให้เครื่องพิมพ์คืนช่องเชื่อมต่อทันที
//  เครื่องรุ่นที่ไม่ตอบสถานะ: รอเผื่อเวลาตามขนาดงาน (อย่างน้อย 1.5 วินาที) แล้วค่อยตัด
//  ไม่ใช้ end()/FIN เพราะหลังส่ง FIN ระบบจะตัดแบบบังคับไม่ได้ และเครื่องพิมพ์ดื้อจะค้างสาย
//  onSent() = แจ้งหน้าจอว่าพิมพ์แล้ว
const DLE_EOT = Buffer.from([0x10, 0x04, 0x01]);
function sendOnce(pr, payload, label, onSent) {
  return new Promise((resolve, reject) => {
    let done = false, confirmed = false, connected = false, closed = false, timer;
    const sock = net.connect({ host: pr.ip, port: Number(pr.port) || 9100 });
    const finish = err => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (!closed && !sock.destroyed) { if (sock.resetAndDestroy) sock.resetAndDestroy(); else sock.destroy(); }
      if (err) { err.retry = !confirmed; reject(err); } else resolve();
    };
    const delivered = () => {           // งานถึงเครื่องพิมพ์แล้ว → แจ้งหน้าจอ แล้วตัดสาย
      if (confirmed || done) return;
      confirmed = true; onSent?.();
      clearTimeout(timer); timer = setTimeout(() => finish(), 150);
    };
    sock.setNoDelay(true);
    // เชื่อมต่อไม่ติดใน 4 วินาที = เครื่องพิมพ์ไม่ตอบ (ปิดอยู่ / IP ผิด / ไม่ว่าง)
    timer = setTimeout(() => finish(new Error(`${label} (${pr.ip}) ไม่ตอบ ตรวจไฟ/สาย/IP`)), 4000);
    sock.on('connect', () => {
      connected = true;
      clearTimeout(timer);
      // ส่งไม่หมดใน 20 วินาที (กระดาษหมด/ฝาเปิด/บัฟเฟอร์เต็ม) = ล้มเหลว ไม่ลองซ้ำ (อาจพิมพ์ไปบางส่วนแล้ว)
      timer = setTimeout(() => { confirmed = true; finish(new Error(`${label} (${pr.ip}) รับงานไม่หมด ตรวจกระดาษ/ฝาเครื่อง`)); }, 20000);
      sock.write(Buffer.concat([payload, DLE_EOT]), err => {
        if (err || done) return;
        // เครื่องที่ไม่ตอบสถานะ: ไม่ถูกตัดสายภายในเวลานี้ = ถือว่ารับงานแล้ว
        clearTimeout(timer);
        timer = setTimeout(delivered, Math.min(8000, Math.max(1500, payload.length / 25)));
      });
    });
    sock.on('data', delivered);          // เครื่องพิมพ์ตอบสถานะกลับมา
    // เครื่องพิมพ์ปิดหรือตัดสายเอง: หลังรับงานแล้ว = ปกติ · ก่อนรับงาน = ไม่ว่าง/ไม่ได้พิมพ์ → ลองใหม่
    sock.on('close', () => { closed = true; if (confirmed) finish(); else finish(new Error(`${label} (${pr.ip}) ตัดการเชื่อมต่อก่อนรับงาน`)); });
    sock.on('error', e => { if (confirmed) return finish(); finish(new Error(`${label} (${pr.ip}) เชื่อมต่อไม่ได้: ${e.code || e.message}`)); });
  });
}
// เครื่องพิมพ์ยังไม่ว่าง/เพิ่งตื่น → ลองใหม่เองอีก 2 ครั้ง (เฉพาะกรณีที่เครื่องพิมพ์ยังไม่ได้รับงาน จะได้ไม่พิมพ์ซ้ำ)
async function sendWithRetry(pr, payload, label, onSent) {
  let last;
  for (const wait of [0, 800, 2000]) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    try { return await sendOnce(pr, payload, label, onSent); }
    catch (e) { last = e; if (!e.retry) break; }
  }
  throw last;
}

const printQueue = {};
const BACKUP_NAME = /^(data|before-restore)-[\w-]+\.json$/;

// ---------- API ----------
const routes = {
  // ---------- รหัส PIN ----------
  // standby = เครื่องนี้เป็นเครื่องสำรอง (ยังไม่มีรหัส = ยังไม่ได้จับคู่ → หน้าเว็บพาไป standby.html)
  'GET /api/auth': () => ({ setup: !data.auth.admin, staff: !!data.auth.staff, shopName: data.settings.shopName, standby: role.role === 'standby' }),
  // ตั้งรหัสเจ้าของร้านครั้งแรก (ทำได้ครั้งเดียว ตอนยังไม่มีรหัส)
  'POST /api/auth/setup': b => {
    if (data.auth.admin) throw new Error('ตั้งรหัสไปแล้ว ใส่รหัสเพื่อเข้าใช้งาน');
    data.auth.admin = pinHash(cleanPin(b.pin));
    return b.want === 'staff' ? { token: tokenFor('staff', 'owner'), level: 'staff' } : { token: tokenFor('admin'), level: 'admin' };
  },
  // ใส่รหัส → ได้โทเค็นของหน้าที่ขอ (want) · รหัสเจ้าของร้านเข้าหน้าพนักงานได้ แต่ไม่กลับกัน
  'POST /api/login': (b, q, req) => {
    const ip = clientIp(req);
    checkPinLimit(ip);
    if (!data.auth.admin) throw new Error('ยังไม่ได้ตั้งรหัส');
    const want = b.want === 'admin' ? 'admin' : 'staff';
    const h = pinHash(String(b.pin ?? ''));
    const st = want === 'staff' ? data.auth.staffs.find(s => s.hash === h) : null;
    let token = '';
    if (h === data.auth.admin) token = want === 'admin' ? tokenFor('admin') : tokenFor('staff', 'owner');
    else if (st) token = tokenFor('staff', st.id);
    else if (want === 'staff' && data.auth.staff && h === data.auth.staff) token = tokenFor('staff');
    if (!token) pinFailed(ip);
    pinFails.delete(ip);
    return { token, level: want, name: tokenInfo(token).name };
  },
  'GET /api/auth/me': (b, q, req) => { const w = whoOf(req); return { level: ['', 'staff', 'admin'][w.level], name: w.name, lead: w.lead }; },
  // ---------- พนักงานรายคน (หลังร้าน > รหัสผ่าน) ----------
  'GET /api/staff': () => ({ staffs: data.auth.staffs.map(s => ({ id: s.id, name: s.name, lead: !!s.lead })), shared: !!data.auth.staff }),
  'POST /api/staff/save': b => {
    const name = String(b.name || '').trim().slice(0, 30);
    if (!name) throw new Error('ใส่ชื่อพนักงาน');
    let s = b.id ? staffById(b.id) : null;
    if (b.id && !s) throw new Error('ไม่พบพนักงานคนนี้ (อาจถูกลบไปแล้ว)');
    if (data.auth.staffs.some(x => x !== s && x.name === name)) throw new Error(`มีพนักงานชื่อ "${name}" แล้ว`);
    if (!s && (b.pin == null || b.pin === '')) throw new Error('ตั้งรหัส 4 หลักให้พนักงานด้วย');
    if (!s) {
      if (data.auth.staffs.length >= 50) throw new Error('เพิ่มพนักงานได้สูงสุด 50 คน');
      let id; do { id = 's' + crypto.randomBytes(3).toString('hex'); } while (staffById(id));
      s = { id, name, hash: '', lead: false, ver: 1 }; data.auth.staffs.push(s);
    }
    if (b.pin != null && b.pin !== '') {
      const h = pinHash(cleanPin(b.pin)), dup = pinTaken(h, s.id);
      if (dup) { if (!s.hash) data.auth.staffs = data.auth.staffs.filter(x => x !== s); throw new Error(`รหัสนี้ซ้ำกับ ${dup} ตั้งรหัสอื่น`); }
      s.hash = h; s.ver = (s.ver || 1) + 1;   // เครื่องที่คนนี้ใส่รหัสไว้ต้องใส่รหัสใหม่
    }
    s.name = name; s.lead = !!b.lead;
    return { id: s.id };
  },
  'POST /api/staff/delete': b => { data.auth.staffs = data.auth.staffs.filter(s => s.id !== b.id); },
  // เปลี่ยนรหัส (หลังร้าน): staff ใส่ '' = ยกเลิกรหัสพนักงาน (พนักงานใช้รหัสเจ้าของร้านแทน)
  // รหัสเจ้าของร้าน ต้องใส่รหัสเดิมยืนยันก่อน
  'POST /api/auth/pin': (b, q, req) => {
    if (b.which === 'admin') {
      checkPinLimit(clientIp(req));
      if (pinHash(String(b.current ?? '')) !== data.auth.admin) pinFailed(clientIp(req));
      const h = pinHash(cleanPin(b.pin)), dup = pinTaken(h, 'owner');
      if (dup) throw new Error(`รหัสเจ้าของร้านต้องไม่ซ้ำกับรหัสของ ${dup}`);
      data.auth.admin = h;
      data.auth.ver.admin = (data.auth.ver.admin || 1) + 1;
      return { token: tokenFor('admin') };   // เครื่องนี้ใช้ต่อได้เลย เครื่องอื่นต้องใส่รหัสใหม่
    }
    if (b.pin === '' || b.pin == null) data.auth.staff = null;
    else {
      const h = pinHash(cleanPin(b.pin)), dup = pinTaken(h, 'staff');
      if (dup) throw new Error(`รหัสรวมพนักงานต้องไม่ซ้ำกับรหัสของ ${dup}`);
      data.auth.staff = h;
    }
    data.auth.ver.staff = (data.auth.ver.staff || 1) + 1;   // เครื่องพนักงานทุกเครื่องต้องใส่รหัสใหม่
  },
  // ให้ทุกเครื่องที่เข้าหน้าสั่งอาหารอยู่ ต้องใส่รหัสใหม่ (เช่น พนักงานลาออก)
  'POST /api/auth/logout-all': () => { data.auth.ver.staff = (data.auth.ver.staff || 1) + 1; },

  // ---------- เครื่องหลัก / เครื่องสำรอง ----------
  // ตัวเฝ้าในแอป (เครื่องเดียวกัน) ส่งแบตมาด้วย: /api/role?bat=85&chg=1
  // ---------- ชุดการพิมพ์ ----------
  // บันทึกค่าตอนนี้เป็นชุด (id = บันทึกทับชุดเดิม)
  'POST /api/presets/save': b => {
    const S = data.settings, list = S.printPresets || (S.printPresets = []);
    let p = b.id ? presetOf(b.id) : null;
    const name = String(b.name ?? p?.name ?? '').trim().slice(0, 30);
    if (!name) throw new Error('ตั้งชื่อชุดก่อน เช่น ปกติ หรือ วันจันทร์');
    if (!p) {
      if (list.length >= 10) throw new Error('มีได้ไม่เกิน 10 ชุด');
      let n = 1; while (list.some(x => x.id === 'pp' + n)) n++;
      p = { id: 'pp' + n, name, days: [] }; list.push(p);
    }
    p.name = name; p.snap = snapPrint(); p.savedAt = Date.now();
    S.activePreset = p.id;
    return { id: p.id };
  },
  // ผูกวันในสัปดาห์ (0 = อาทิตย์) · วันหนึ่งผูกได้ชุดเดียว · เริ่มสลับอัตโนมัติตั้งแต่วันขายถัดไป
  'POST /api/presets/days': b => {
    const S = data.settings, p = presetOf(b.id); if (!p) throw new Error('ไม่พบชุดนี้');
    const days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number).filter(d => d >= 0 && d <= 6))].sort();
    for (const x of S.printPresets) if (x !== p) x.days = (x.days || []).filter(d => !days.includes(d));
    p.days = days; S.presetDay = dayKey(Date.now());
  },
  'POST /api/presets/apply': (b, q, req) => {
    const S = data.settings, p = presetOf(b.id); if (!p) throw new Error('ไม่พบชุดนี้');
    applyPrint(p.snap); S.activePreset = p.id;
    addEvent('preset', `ใช้ชุดการพิมพ์ "${p.name}" · ${whoOf(req).name}`);
  },
  'POST /api/presets/delete': b => {
    const S = data.settings; S.printPresets = (S.printPresets || []).filter(p => p.id !== b.id);
    if (S.activePreset === b.id) S.activePreset = '';
  },

  'GET /api/role': (b, q, req) => { noteBattery(q, req); return roleInfo(); },
  // สุขภาพระบบ: /api/health?from=&to= (เจ้าของร้าน)
  'GET /api/health': (b, q) => {
    const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
    const to = ok(q.get('to')) ? q.get('to') : dayKey(Date.now()), from = ok(q.get('from')) ? q.get('from') : to;
    return healthReport(from, to);
  },
  'GET /api/sync': (b, q, req) => {
    if (role.role !== 'main') return { role: role.role };
    if (!syncKeyOk(req.headers['x-sync-key'])) {
      repl.pairAsk = Date.now(); repl.pairAskIp = String(req.socket.remoteAddress || '').replace('::ffff:', '');
      return { role: 'main', auth: 'sync' };
    }
    repl.standbySeen = Date.now(); repl.standbyIp = String(req.socket.remoteAddress || '').replace('::ffff:', '');
    if (Number(q.get('rev')) === (data.rev || 0)) return { role: 'main', same: true };
    return { role: 'main', data };
  },
  // จับคู่เครื่องสำรองใหม่: เครื่องสำรองส่งรหัสเจ้าของร้านมา → ได้กุญแจคัดลอกข้อมูล (ใส่ผิดหลายครั้งโดนพักเหมือนหน้าใส่รหัส)
  'POST /api/sync/key': (b, q, req) => {
    if (role.role !== 'main') throw new Error('เครื่องนี้ไม่ใช่เครื่องหลัก');
    const ip = clientIp(req);
    checkPinLimit(ip);
    if (!data.auth.admin || pinHash(String(b.pin ?? '')) !== data.auth.admin) pinFailed(ip);
    pinFails.delete(ip);
    return { key: syncKey() };
  },
  // หน้าเครื่องสำรอง: ใส่รหัสเจ้าของร้านของเครื่องหลัก → ขอกุญแจจากเครื่องหลักแล้วเริ่มคัดลอก
  'POST /api/standby/pair': async b => {
    if (role.role !== 'standby') throw new Error('เครื่องนี้ไม่ใช่เครื่องสำรอง');
    let j;
    try {
      j = await getJSON(`${role.peer}/api/sync/key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: String(b.pin ?? '') }) });
    } catch { throw new Error('ติดต่อเครื่องหลักไม่ได้'); }
    if (!j.key) throw new Error(j.error || 'จับคู่ไม่สำเร็จ');
    role.key = j.key; saveRole();
    await syncTick();
    if (repl.needPair) throw new Error('จับคู่ไม่สำเร็จ ลองใหม่อีกครั้ง');
    return { ok: true };
  },
  // เครื่องสำรอง: เปลี่ยนที่อยู่เครื่องหลัก (เครื่องหลักเปลี่ยน IP) · ต้องติดต่อได้และเป็นเครื่องหลักจริง
  // มีข้อมูลร้านแล้ว → ต้องใส่รหัสเจ้าของร้าน · ยังไม่เคยคัดลอก (ไม่มีรหัส) → เปลี่ยนได้เลย แล้วไปจับคู่ต่อ
  'POST /api/standby/peer': async (b, q, req) => {
    if (role.role !== 'standby') throw new Error('เครื่องนี้ไม่ใช่เครื่องสำรอง');
    if (data.auth.admin) {
      const ip = clientIp(req); checkPinLimit(ip);
      if (pinHash(String(b.pin ?? '')) !== data.auth.admin) pinFailed(ip);
      pinFails.delete(ip);
    }
    const peer = normUrl(b.peer);
    if (!peer) throw new Error('ใส่ IP เครื่องหลัก');
    if (myUrls().includes(peer)) throw new Error('นี่คือ IP ของเครื่องสำรองนี้เอง ใส่ IP ของเครื่องหลัก');
    let j;
    try { j = await getJSON(`${peer}/api/role`); } catch { throw new Error(`ติดต่อ ${peer.replace(/^https?:\/\//, '')} ไม่ได้ · ตรวจ IP และว่าเครื่องหลักเปิดอยู่ ต่อ Wi-Fi เดียวกัน`); }
    if (j.role !== 'main') throw new Error('เครื่องนี้ไม่ได้เป็นเครื่องหลัก');
    role.peer = peer; saveRole();
    repl.syncErr = ''; repl.lastSync = 0;
    await syncTick();
    return { ok: true, peer, needPair: repl.needPair };
  },
  // ให้เครื่องสำรองรับงานแทน (ห้ามถ้ายังติดต่อเครื่องหลักได้ กันข้อมูลแยกเป็นสองชุด)
  'POST /api/promote': b => {
    if (role.role === 'main') return { ok: true, already: true };
    // ยังไม่เคยคัดลอกข้อมูลร้าน (ไม่มีรหัส/บิล) → รับงานแทนจะได้ร้านเปล่า
    if (!data.auth.admin) throw new Error('เครื่องสำรองนี้ยังไม่เคยคัดลอกข้อมูลจากเครื่องหลัก รับงานแทนไม่ได้ · จับคู่ที่หน้าเครื่องสำรอง (standby.html) ก่อน');
    const ago = Date.now() - repl.lastSync;
    if (repl.lastSync && ago < 8000 && !b.force)
      throw new Error(`เครื่องหลักยังทำงานอยู่ (ซิงก์ล่าสุด ${Math.round(ago / 1000)} วินาทีที่แล้ว) ใช้เครื่องหลักต่อได้เลย`);
    data.epoch = (data.epoch || 1) + 1;
    role = { role: 'main', peer: role.peer };   // จำเครื่องเก่าไว้ ถ้ากลับมาจะให้มันเป็นเครื่องสำรอง
    saveRole();
    console.log('เครื่องนี้เป็นเครื่องหลักแล้ว');
    healthEvent('takeover', { peer: role.peer || '' });
    lineAlert('takeover', `🔁 เครื่องสำรองรับงานแทนเครื่องหลักแล้ว\nเครื่องหลักเดิม (${role.peer.replace(/^https?:\/\//, '') || '-'}) ติดต่อไม่ได้ ตรวจดูว่าดับหรือหลุด Wi-Fi\nตอนนี้ร้านใช้งานต่อได้ตามปกติ`);
    return { ok: true };
  },

  // ---------- กู้คืนข้อมูลทั้งร้าน (หลังร้าน > สำรองข้อมูล) ----------
  // ไฟล์สำรองในเครื่องหลัก: สำรองอัตโนมัติรายวัน + ข้อมูลก่อนกู้คืนแต่ละครั้ง
  'GET /api/backups': () => {
    let files = [];
    try { files = fs.readdirSync(BACKUP_DIR).filter(n => BACKUP_NAME.test(n)); } catch {}
    return { files: files.map(n => { const st = fs.statSync(path.join(BACKUP_DIR, n)); return { name: n, size: st.size, at: st.mtimeMs }; })
      .sort((a, b) => b.at - a.at) };
  },
  // b.data = เนื้อไฟล์สำรอง (ที่ดาวน์โหลดไว้) หรือ b.file = ชื่อไฟล์ในโฟลเดอร์ backup · b.pin = รหัสเจ้าของร้าน (ยืนยันอีกครั้ง)
  // เก็บข้อมูลปัจจุบันเป็น backup/before-restore-วันเวลา.json ก่อนเสมอ · รหัส PIN ใช้ของปัจจุบัน (ทุกเครื่องไม่ต้องใส่รหัสใหม่)
  'POST /api/restore': (b, q, req) => {
    const ip = clientIp(req);
    checkPinLimit(ip);
    if (pinHash(String(b.pin ?? '')) !== data.auth.admin) pinFailed(ip);
    pinFails.delete(ip);
    let f = b.data;
    if (b.file) {
      if (!BACKUP_NAME.test(String(b.file))) throw new Error('ชื่อไฟล์ไม่ถูกต้อง');
      try { f = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, String(b.file)), 'utf8')); } catch { throw new Error('เปิดไฟล์สำรองนี้ไม่ได้'); }
    }
    if (f?.edpos === 'menu') throw new Error('ไฟล์นี้เป็นไฟล์เมนู ให้ใช้ หลังร้าน > เมนู > นำเข้าเมนูจากไฟล์');
    if (!f || typeof f !== 'object' || !f.settings || !Array.isArray(f.menu) || !Array.isArray(f.orders) || !Array.isArray(f.items))
      throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของ ED POS');
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    const saved = `before-restore-${today()}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
    fs.writeFileSync(path.join(BACKUP_DIR, saved), JSON.stringify(data));
    // only = 'config': เอาเฉพาะตั้งค่า เมนู หมวด ชุดตัวเลือก (ชื่ออังกฤษอยู่ในตั้งค่า) · บิล ยอดขาย รหัส พนักงาน ของเครื่องนี้อยู่ครบ
    // ใช้ย้ายเมนูจากเครื่องหนึ่งไปอีกเครื่อง เช่น จาก Termux มาแอป หรือแก้เมนูที่เครื่องอื่นแล้วเอามาใช้
    if (b.only === 'config') {
      const lineNow = data.settings.line;
      data.settings = JSON.parse(JSON.stringify(f.settings));
      // แจ้ง LINE: ไฟล์ไม่มีโทเค็น → ใช้ของเครื่องนี้ · วันที่ส่งสรุปล่าสุดใช้ของเครื่องนี้ (กันส่งซ้ำ/ไม่ส่ง)
      if (lineNow || data.settings.line) data.settings.line = { ...(lineNow || {}), ...(data.settings.line || {}),
        token: data.settings.line?.token || lineNow?.token || '', lastSent: lineNow?.lastSent || '', lastErr: '', alertErr: '' };
      data.menu = JSON.parse(JSON.stringify(f.menu));
      if (Array.isArray(f.categories)) data.categories = [...f.categories];
      if (Array.isArray(f.optionSets)) data.optionSets = JSON.parse(JSON.stringify(f.optionSets));
      data.settings = { ...defaultData.settings, ...data.settings };
      migrateData();
      addEvent('restore', 'นำเข้าตั้งค่าและเมนูจากไฟล์สำรอง');
      console.log(`นำเข้าตั้งค่าและเมนูแล้ว · ข้อมูลเดิมเก็บไว้ที่ backup/${saved}`);
      return { ok: true, saved, menu: data.menu.length, only: 'config' };
    }
    const keep = { auth: data.auth, epoch: data.epoch, rev: data.rev, seq: data.seq };
    loadData(JSON.parse(JSON.stringify(f)));
    data.auth = keep.auth;
    data.epoch = Math.max(keep.epoch || 1, data.epoch || 1);   // ไม่ให้เครื่องสำรองเข้าใจผิดว่าใครเป็นเครื่องหลัก
    data.seq = Math.max(keep.seq || 1, data.seq || 1);         // รหัสบิล/จานใหม่ไม่ซ้ำกับที่หน้าจอต่างๆ เคยเห็น
    data.rev = keep.rev;                                       // save() บวกเพิ่ม → เครื่องสำรองดึงข้อมูลชุดนี้ไปเอง
    addEvent('restore', 'กู้คืนข้อมูลจากไฟล์สำรอง');
    console.log(`กู้คืนข้อมูลแล้ว · ข้อมูลเดิมเก็บไว้ที่ backup/${saved}`);
    return { ok: true, saved, menu: data.menu.length, orders: data.orders.length };
  },

  // สรุปยอดเข้า LINE: ดูข้อความ / ส่งทันที (ใช้ค่าที่บันทึกแล้ว)
  // kind = day (วันนี้) | week (สัปดาห์ล่าสุดที่จบแล้ว) | month (เดือนล่าสุดที่จบแล้ว)
  'GET /api/line/preview': (b, q) => ({ text: lineTextOf(q.get('kind'), /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '') ? q.get('date') : dayKey(Date.now())) }),
  'POST /api/line/test-alert': async () => {
    const L = data.settings.line || {};
    if (!L.token) throw new Error('ยังไม่ได้ใส่ Channel access token');
    await linePost(L.token, L.to, `🔔 ทดสอบแจ้งเตือนจาก ${data.settings.shopName || 'ED POS'}\nถ้าเห็นข้อความนี้ แปลว่าการแจ้งเตือนทันทีใช้ได้แล้ว`);
  },
  'POST /api/line/test': async b => {
    const L = data.settings.line || (data.settings.line = cleanLine({}));
    try { await sendLine(dayKey(Date.now()), ['week', 'month'].includes(b.kind) ? b.kind : 'day'); L.lastErr = ''; } catch (e) { L.lastErr = e.message; throw e; }
  },

  // รายงานยอดขาย: /api/report?from=2026-10-01&to=2026-10-12 (ส่งพารามิเตอร์มาใน body ของ GET ไม่ได้ จึงอ่านจาก query)
  'GET /api/report': (b, q) => {
    const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
    const to = ok(q.get('to')) ? q.get('to') : dayKey(Date.now());
    const from = ok(q.get('from')) ? q.get('from') : to;
    if (from > to) throw new Error('วันเริ่มต้องไม่เกินวันสุดท้าย');
    return buildReport(from, to);
  },

  // ประวัติการสั่ง (หน้าสั่งอาหาร): บิลของวันที่เลือก ทั้งจ่ายแล้ว ยกเลิก และที่ยังเปิดอยู่ (วันนี้)
  // บิลละเอียดเก็บไว้ 7 วัน (complete = false → วันนั้นเก่ากว่าที่เก็บ บิลอาจไม่ครบ)
  'GET /api/history': (b, q) => {
    const today = dayKey(Date.now());
    const k = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '') ? q.get('date') : today;
    const orders = data.orders.filter(o => o.status === 'paid' ? dayKey(o.paidAt) === k : o.status === 'void' ? dayKey(o.voidedAt) === k
      : o.status === 'open' && k === today);
    const ids = new Set(orders.map(o => o.id));
    const keepFrom = new Date(bizStart(addDays(today, -KEEP_DAYS)));
    return { date: k, orders, items: data.items.filter(i => ids.has(i.orderId)), complete: k >= dayKey(keepFrom) };
  },

  // เลขรุ่นของข้อมูล (เปลี่ยนทุกครั้งที่บันทึก) · หน้าเว็บถามทุก 15 วินาที ถ้าไม่ตรงกับที่มี → โหลดข้อมูลใหม่
  // กันกรณีสาย /events ตายเงียบๆ (มือถือพักหน้าจอ/สลับ Wi-Fi) แล้วเมนูที่เพิ่งแก้ไม่ขึ้น
  'GET /api/rev': () => ({ rev: data.rev || 0 }),

  'GET /api/state': () => {
    const dayStart = bizStart(dayKey(Date.now()));   // บิลของวันขายนี้ (ตัดรอบตามที่ตั้ง)
    const orders = data.orders.filter(o => o.status === 'open' || o.paidAt >= dayStart || o.voidedAt >= dayStart);
    const ids = new Set(orders.map(o => o.id));
    const rc = data.settings.receipt, imgs = rc.images || {};
    const settings = { ...data.settings, receipt: { ...rc, images: undefined, has: { logo: !!imgs.logo, footer: !!imgs.footer }, imgV: rc.imgV || 0 },
      // โทเค็น LINE ไม่ส่งออกไปหน้าเว็บ (หน้าสั่งอาหารก็อ่าน /api/state ได้)
      line: { ...(data.settings.line || {}), token: undefined, hasToken: !!data.settings.line?.token, counts: lineCountsOf() },
      presetModified: presetModified() };
    return { rev: data.rev || 0, settings, menu: data.menu, categories: data.categories, optionSets: data.optionSets, orders,
             items: data.items.filter(i => ids.has(i.orderId)), events: data.events, now: Date.now() };
  },

  'POST /api/settings': b => {
    const s = { ...data.settings, ...b };
    if (b.nodes) s.nodes = { main: normUrl(b.nodes.main), standby: normUrl(b.nodes.standby) };
    if (b.payments) {
      const p = { ...data.settings.payments, ...b.payments };
      p.cardFeePct = Math.min(20, Math.max(0, Number(p.cardFeePct) || 0));
      if (!p.cash && !p.transfer && !p.card) throw new Error('ต้องเปิดวิธีชำระเงินอย่างน้อย 1 วิธี');
      s.payments = p;
    }
    if (b.layout) s.layout = cleanLayout(b.layout);
    if (b.printers) s.printers = cleanPrinters(b.printers);
    if (b.kdsScreens) s.kdsScreens = cleanScreens(b.kdsScreens);
    if ('receiptCopies' in b) s.receiptCopies = Math.min(5, Math.max(1, Math.round(Number(b.receiptCopies)) || 1));
    if (!s.printers.some(p => p.id === s.receiptPrinter)) s.receiptPrinter = s.printers[0]?.id || '';
    if (b.receipt) {
      const old = data.settings.receipt, imgs = { ...(old.images || {}) };
      const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; };
      const r = { ...old, ...b.receipt };
      for (const k of ['logo', 'footer']) {
        const v = b.receipt.images?.[k];
        if (v === null) delete imgs[k];
        else if (typeof v === 'string') {
          if (!IMG_RE.test(v) || v.length > 700000) throw new Error('รูปไม่ถูกต้องหรือใหญ่เกินไป');
          imgs[k] = v;
        }
      }
      r.images = imgs;
      if (b.receipt.images) r.imgV = Date.now();
      r.logoWidth = num(r.logoWidth, 10, 100, 60); r.footerImgWidth = num(r.footerImgWidth, 10, 100, 50);
      r.nameSize = num(r.nameSize, 24, 60, 36); r.footerSize = num(r.footerSize, 18, 34, 22);
      r.logoMode = r.logoMode === 'threshold' ? 'threshold' : 'dither';
      r.footerImgMode = r.footerImgMode === 'dither' ? 'dither' : 'threshold';
      r.header = String(r.header || '').slice(0, 500);
      for (const k of ['showNo', 'showTime', 'showTable']) r[k] = r[k] !== false;
      r.lang = LANGS.includes(r.lang) ? r.lang : 'th';
      r.headerEn = String(r.headerEn || '').slice(0, 500); r.footerEn = String(r.footerEn || '').slice(0, 500);
      s.receipt = r;
    }
    if (b.i18n) s.i18n = cleanI18n(b.i18n);
    if (b.ticket) s.ticket = cleanTicket(b.ticket);
    if (b.orderUi) s.orderUi = cleanOrderUi(b.orderUi);
    if (b.line) s.line = cleanLine(b.line, data.settings.line || {});
    if ('voidApproval' in b) s.voidApproval = !!b.voidApproval;
    if ('dayCutoff' in b) s.dayCutoff = Math.min(8, Math.max(0, Math.round(Number(b.dayCutoff) || 0)));
    data.settings = s;
    if (b.printers || b.kdsScreens) fixMenuRefs();
    // ตั้งค่าเมนูทั้งร้านพร้อมกันจากหน้าเครื่องพิมพ์/จอครัว: menuPrinters = {menuId: [printerIds]}
    for (const [k, list] of [['menuPrinters', s.printers], ['menuScreens', s.kdsScreens]]) {
      if (!b[k] || typeof b[k] !== 'object') continue;
      for (const m of data.menu) if (Array.isArray(b[k][m.id])) m[k === 'menuPrinters' ? 'printers' : 'screens'] = pickIds(b[k][m.id], list);
    }
  },

  // ---------- เมนู ----------
  'POST /api/menu': b => { data.menu = (b.menu || []).map(cleanMenuItem); },  // แทนทั้งหมด (แบบเดิม)
  // ---------- ชุดตัวเลือกสำเร็จรูป ----------
  'POST /api/optionsets/save': b => {
    const g = cleanGroup(b.set || {});
    if (!g.choices.length) throw new Error('ใส่ตัวเลือกอย่างน้อย 1 อย่าง');
    let id = b.set?.id;
    const i = id ? data.optionSets.findIndex(s => s.id === id) : -1;
    if (i < 0) { do { id = newId('os'); } while (data.optionSets.some(s => s.id === id)); data.optionSets.push({ id, ...g }); }
    else data.optionSets[i] = { id, ...g };
    // ใช้กับเมนูที่เลือก (ถ้าส่ง menuIds มา): เพิ่มให้เมนูที่ติ๊ก เอาออกจากเมนูที่ไม่ติ๊ก
    if (Array.isArray(b.menuIds)) {
      const on = new Set(b.menuIds);
      for (const m of data.menu) {
        const has = (m.groups || []).some(x => x.ref === id);
        if (on.has(m.id) && !has) m.groups = [...(m.groups || []), { ref: id }];
        if (!on.has(m.id) && has) m.groups = m.groups.filter(x => x.ref !== id);
      }
    }
    return { id };
  },
  'POST /api/optionsets/delete': b => {
    data.optionSets = data.optionSets.filter(s => s.id !== b.id);
    for (const m of data.menu) m.groups = (m.groups || []).filter(x => x.ref !== b.id);
  },

  'POST /api/menu/save': b => {
    const item = cleanMenuItem(b.item || {});
    const i = data.menu.findIndex(m => m.id === item.id);
    if (i >= 0) data.menu[i] = item; else data.menu.push(item);
    if (!data.categories.includes(item.category)) data.categories.push(item.category);
    return { id: item.id };
  },
  // นำเข้าเมนูทั้งร้านจากไฟล์ (หลังร้าน > เมนู > นำเข้าเมนูจากไฟล์) → แทนที่เมนูและหมวดเดิมทั้งหมด
  //  file = {edpos:'menu', categories, optionSets:[{id,...}], menu:[{name, category, price, groups:[{ref}|กลุ่ม], grid, route:'kitchen'|'drink'}], i18n}
  //  ชุดตัวเลือกชื่อเดียวกับที่มีอยู่ → แทนที่ (id เดิม) · route kitchen = เครื่องครัว + จอแรก, drink = เครื่องหน้าร้าน ไม่ขึ้นจอ
  //  บิลที่เปิดอยู่ไม่กระทบ (จานเก็บชื่อ/ราคาไว้แล้ว)
  'POST /api/menu/import': b => {
    const f = b.file;
    if (!f || f.edpos !== 'menu' || !Array.isArray(f.menu) || !f.menu.length) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์เมนูของ ED POS');
    if (f.menu.length > 1000) throw new Error('เมนูเยอะเกินไป');
    const sets = JSON.parse(JSON.stringify(data.optionSets)), idMap = {};
    for (const os of f.optionSets || []) {
      const g = cleanGroup(os); if (!g.choices.length) continue;
      let ex = sets.find(s => s.name === g.name);
      if (ex) Object.assign(ex, g);
      else { let id; do { id = newId('os'); } while (sets.some(s => s.id === id)); ex = { id, ...g }; sets.push(ex); }
      idMap[os.id] = ex.id;
    }
    const S0 = data.settings, prn = S0.printers;
    const kp = prn.find(p => p.id === 'kitchen') || prn.find(p => p.id !== S0.receiptPrinter) || prn[0];
    const fp = prn.find(p => p.id === 'front') || prn.find(p => p.id === S0.receiptPrinter) || prn[0];
    const oldSets = data.optionSets; data.optionSets = sets;   // cleanMenuItem ตรวจ ref กับชุดใหม่
    let items;
    try {
      items = f.menu.map((m, i) => {
        try {
          const drink = m.route === 'drink';
          return cleanMenuItem({ ...m, id: '', available: true,
            groups: (m.groups || []).map(g => (g.ref ? (idMap[g.ref] ? { ref: idMap[g.ref] } : null) : g)).filter(Boolean),
            // ไฟล์ที่ส่งออกจาก ED POS มีเครื่องพิมพ์/จอของแต่ละเมนูมาด้วย → ใช้ตามนั้นถ้าร้านนี้มีเครื่องนั้น ไม่มีก็ใช้ตาม route
            printers: Array.isArray(m.printers) && pickIds(m.printers, prn).length ? m.printers : [(drink ? fp : kp)?.id].filter(Boolean),
            screens: Array.isArray(m.screens) && (!m.screens.length || pickIds(m.screens, S0.kdsScreens).length) ? m.screens
              : drink ? [] : [S0.kdsScreens[0].id] });
        } catch (e) { throw new Error(`รายการที่ ${i + 1} (${m.name || '?'}): ${e.message}`); }
      });
    } catch (e) { data.optionSets = oldSets; throw e; }
    data.menu = items;
    data.categories = [...new Set([...(f.categories || []), ...items.map(m => m.category)].map(c => String(c).trim()).filter(Boolean))];
    if (f.i18n?.en) S0.i18n = cleanI18n({ ...S0.i18n, en: { ...(S0.i18n?.en || {}), ...f.i18n.en } });
    if (Array.isArray(f.catGroups)) routes['POST /api/categories']({ groups: f.catGroups });
    return { count: items.length, categories: data.categories.length };
  },
  'POST /api/menu/delete': b => { data.menu = data.menu.filter(m => m.id !== b.id); },
  'POST /api/menu/available': b => {
    const m = data.menu.find(x => x.id === b.id);
    if (!m) throw new Error('ไม่พบเมนู');
    m.available = !!b.available;
  },
  // ลำดับเมนูในหมวด: ids เรียงตามที่ต้องการ
  'POST /api/menu/reorder': b => {
    const pos = new Map((b.ids || []).map((id, i) => [id, i]));
    const moved = data.menu.filter(m => pos.has(m.id)).sort((x, y) => pos.get(x.id) - pos.get(y.id));
    let k = 0;
    data.menu = data.menu.map(m => (pos.has(m.id) ? moved[k++] : m));
  },
  // หมวดหมู่: ตั้งลำดับใหม่ / เปลี่ยนชื่อ / ลบ (ลบได้เมื่อไม่มีเมนูในหมวด)
  'POST /api/categories': b => {
    if (b.rename) {
      const from = b.rename.from, to = String(b.rename.to || '').trim();
      if (!to) throw new Error('ใส่ชื่อหมวด');
      if (from !== to && data.categories.includes(to)) throw new Error('มีหมวดชื่อนี้แล้ว');
      data.categories = data.categories.map(c => (c === from ? to : c));
      data.menu.forEach(m => { if (m.category === from) m.category = to; });
      for (const g of data.settings.catGroups || []) g.cats = g.cats.map(c => (c === from ? to : c));
    }
    // หมวดใหญ่: [{name, cats:[ชื่อหมวด]}] · หมวดหนึ่งอยู่ได้หมวดใหญ่เดียว · หมวดที่ไม่อยู่ในหมวดใหญ่ไหน = "อื่นๆ"
    if (Array.isArray(b.groups)) {
      const seen = new Set(), names = new Set();
      data.settings.catGroups = b.groups.slice(0, 30).map(g => {
        const name = String(g?.name || '').trim().slice(0, 30);
        if (!name || names.has(name)) return null;
        names.add(name);
        const cats = (Array.isArray(g.cats) ? g.cats : []).map(String).filter(c => !seen.has(c) && seen.add(c));
        return { name, cats };
      }).filter(Boolean);
    }
    if (b.add) {
      const n = String(b.add).trim();
      if (!n) throw new Error('ใส่ชื่อหมวด');
      if (data.categories.includes(n)) throw new Error('มีหมวดชื่อนี้แล้ว');
      data.categories.push(n);
    }
    if (b.remove) {
      if (data.menu.some(m => m.category === b.remove)) throw new Error('ย้ายหรือลบเมนูในหมวดนี้ก่อน');
      data.categories = data.categories.filter(c => c !== b.remove);
      for (const g of data.settings.catGroups || []) g.cats = g.cats.filter(c => c !== b.remove);
    }
    if (Array.isArray(b.order)) {
      const rest = data.categories.filter(c => !b.order.includes(c));
      data.categories = [...b.order.filter(c => data.categories.includes(c)), ...rest];
    }
  },

  // สั่งอาหาร: เพิ่มรายการเข้าบิลที่เปิดอยู่ของโต๊ะนั้น หรือเปิดบิลใหม่
  'POST /api/order': (b, q, req) => {
    const by = whoOf(req).name;
    if (!b.table || !Array.isArray(b.items) || !b.items.length) throw new Error('ข้อมูลไม่ครบ');
    // ตรวจทุกรายการก่อน ถ้ามีรายการไหนผิดจะไม่บันทึกเลยสักรายการ
    const lines = b.items.map(it => {
      // เมนูพิเศษ: พนักงานพิมพ์ชื่อและราคาเอง (ไม่อยู่ในรายการเมนู)
      if (it.custom) {
        const name = String(it.custom.name || '').trim().slice(0, 60);
        const price = Number(it.custom.price);
        if (!name) throw new Error('ใส่ชื่อเมนูพิเศษ');
        if (!(price >= 0) || price > 100000) throw new Error(`ราคา ${name} ไม่ถูกต้อง`);
        // เลือกเครื่องพิมพ์/จอเองตอนสั่ง (รองรับแบบเก่า station: 'front'|'kitchen')
        const S0 = data.settings;
        const printers = Array.isArray(it.custom.printers) ? pickIds(it.custom.printers, S0.printers)
          : pickIds([it.custom.station === 'front' ? 'front' : 'kitchen'], S0.printers);
        const screens = Array.isArray(it.custom.screens) ? pickIds(it.custom.screens, S0.kdsScreens)
          : it.custom.kds === false ? [] : [S0.kdsScreens[0].id];
        const m = { id: 'custom', name, price: r2(price), category: 'เมนูพิเศษ', printers, screens, groups: [] };
        return { it, m, ch: { names: [], add: 0, opts: [], alerts: [] } };
      }
      const m = data.menu.find(x => x.id === it.menuId);
      if (!m) throw new Error('ไม่พบเมนู (อาจถูกลบไปแล้ว) ลองโหลดหน้าใหม่');
      if (m.available === false) throw new Error(`${m.name} หมดแล้ว`);
      const thai = !!it.thai && hasThaiPrice(m);
      return { it, m, thai, ch: resolveChoices(m, it.choices ?? it.option, thai) };
    });
    let order = data.orders.find(o => o.table === b.table && o.status === 'open');
    if (!order) {
      order = { id: newId('o'), table: b.table, status: 'open', createdAt: Date.now(), openedBy: by };
      data.orders.push(order);
    }
    order.kdsCleared = false;
    order.kdsDone = false; order.kdsDoneOn = {}; // สั่งเพิ่มหลังกดเสร็จทั้งโต๊ะ → กลับขึ้นจอ
    const added = [];
    for (const { it, m, ch, thai } of lines) {
      const printers = [...(m.printers || [])], screens = [...(m.screens || [])];
      const item = {
        id: newId('i'), orderId: order.id, menuId: m.id, name: m.name,
        option: ch.names.join(' '), opts: ch.opts,
        alerts: ch.alerts.length ? ch.alerts : undefined,  // เช่น แพ้ถั่ว → ครัวเห็นเป็นสีแดง
        splits: ch.split?.length ? ch.split : undefined,   // ตัวเลือกที่พิมพ์ใบแยกไปอีกเครื่อง เช่น ไข่ดาว → หน้าร้าน
        note: String(it.note || '').trim(), qty: Math.max(1, it.qty | 0),
        takeaway: !!it.takeaway || !!it.abroad || String(b.table).startsWith('TA'), // ห่อกลับบ้าน (นั่งโต๊ะก็ห่อได้รายจาน)
        abroad: !!it.abroad || undefined,  // กลับต่างประเทศ (ห่อแบบเดินทางไกล)
        custom: m.id === 'custom' || undefined,
        thai: thai || undefined,   // สั่งด้วยราคาคนไทย (พนักงานเห็นป้าย · ใบเสร็จไม่บอก)
        price: r2((ch.base ?? m.price) + ch.add),
        category: m.category, // เก็บไว้สำหรับรายงาน แม้ภายหลังจะย้ายหมวดเมนู
        printers, screens, by,   // by = ชื่อพนักงานที่สั่ง
        // เมนูที่ไม่ขึ้นจอไหนเลย (เครื่องดื่ม ของหวาน) ถือว่าเสร็จทันที ใช้ใบที่พิมพ์ออกแทน
        status: screens.length ? 'new' : 'done', createdAt: Date.now(),
      };
      data.items.push(item);
      added.push(item.id);
    }
    return { orderId: order.id, added };
  },

  'POST /api/item/status': b => {
    for (const id of [].concat(b.ids || b.id)) {
      const it = data.items.find(x => x.id === id);
      if (it && it.status !== 'cancelled') { it.status = b.status; it.doneAt = b.status === 'done' ? Date.now() : null; }
    }
  },

  'POST /api/item/cancel': (b, q, req) => {
    const it = data.items.find(x => x.id === b.id);
    if (!it || it.status === 'cancelled') return;
    const ord = data.orders.find(o => o.id === it.orderId);
    if (ord && paidQtyOf(ord)[it.id]) throw new Error(`${it.name} จ่ายเงินไปแล้ว ยกเลิกไม่ได้`);
    if (ord?.payments?.some(p => p.kind === 'share')) throw new Error('บิลนี้เริ่มแยกจ่ายแล้ว ยกเลิกรายการไม่ได้');
    const wasCooking = onScreen(it) && it.status === 'new';
    it.status = 'cancelled';
    it.cancelledAt = Date.now(); it.cancelledBy = whoOf(req).name;
    it.kdsCancel = wasCooking; // ให้จอครัวแสดงว่า "ยกเลิก"
    const order = data.orders.find(o => o.id === it.orderId);
    if (wasCooking) addEvent('cancel', `ยกเลิก โต๊ะ ${order.table} ${it.name}${it.option ? ' ' + it.option : ''} x${it.qty}`);
  },

  // ยกเลิกทั้งโต๊ะ / ปิดโต๊ะที่ไม่มียอด (ลูกค้าสั่งแล้วไม่เอา)
  //  - ยังไม่ได้รับเงิน → ยกเลิกทุกจานที่เหลือ แล้วปิดบิลเป็น 'void' (ไม่นับยอดขาย แต่เก็บไว้ดูในรายงาน)
  //  - รับเงินไปบางส่วนแล้ว → ทำได้เมื่อไม่มียอดค้าง (จานที่เหลือถูกยกเลิกหมด) ปิดเป็นบิลที่จ่ายแล้วตามเงินที่รับจริง
  'POST /api/order/void': (b, q, req) => {
    const order = data.orders.find(o => o.id === b.orderId && o.status === 'open');
    if (!order) throw new Error('ไม่พบบิล (อาจปิดไปแล้ว)');
    const me = whoOf(req);
    const now = Date.now();
    const live = data.items.filter(i => i.orderId === order.id && i.status !== 'cancelled');
    const pays = order.payments || [];
    if (pays.length) {
      const subtotal = r2(live.reduce((s, i) => s + i.price * i.qty, 0));
      const left = r2(subtotal - pays.reduce((s, p) => s + p.amount, 0));
      if (left > 0.001) throw new Error(`บิลนี้รับเงินไปแล้วบางส่วน ยังค้างอีก ${left} บาท ยกเลิกทั้งโต๊ะไม่ได้ · ให้ยกเลิกเฉพาะจานที่ยังไม่จ่าย หรือรับเงินส่วนที่เหลือ`);
      const ms = [...new Set(pays.map(x => x.method))];
      Object.assign(order, { status: 'paid', paidAt: now, payMethod: ms.length === 1 ? ms[0] : 'split', subtotal,
        fee: r2(pays.reduce((s, x) => s + x.fee, 0)), total: r2(pays.reduce((s, x) => s + x.total, 0)), received: 0, paidBy: me.name });
      return { closed: true, paid: true };
    }
    // ตั้งให้ต้องอนุมัติ (หลังร้าน > รหัสผ่าน) และคนกดไม่ใช่หัวหน้า → ต้องมีรหัสเจ้าของร้านหรือหัวหน้า
    // บิลที่ไม่มีจานเหลือ (ปิดโต๊ะว่าง) ไม่ต้องอนุมัติ
    let approvedBy = '';
    if (live.length && data.settings.voidApproval && !me.lead) {
      if (b.approvePin == null || b.approvePin === '') { const e = new Error('ยกเลิกทั้งโต๊ะต้องให้หัวหน้าหรือเจ้าของร้านใส่รหัสอนุมัติ'); e.needApprove = true; throw e; }
      const ip = clientIp(req); checkPinLimit(ip);
      const h = pinHash(String(b.approvePin));
      approvedBy = h === data.auth.admin ? 'เจ้าของร้าน' : data.auth.staffs.find(s => s.lead && s.hash === h)?.name || '';
      if (!approvedBy) pinFailed(ip);
      pinFails.delete(ip);
    }
    const reason = String(b.reason || '').trim().slice(0, 100);
    const cooking = live.filter(i => onScreen(i) && i.status === 'new');
    for (const i of live) {
      i.kdsCancel = onScreen(i) && i.status === 'new';   // จอครัวเตือน "ยกเลิก" เฉพาะจานที่ยังไม่ได้ทำ
      i.status = 'cancelled'; i.cancelledAt = now;
    }
    Object.assign(order, { status: 'void', voidedAt: now, voidReason: reason, voidedBy: me.name, ...(approvedBy ? { approvedBy } : {}) });
    if (live.length) {
      addEvent('cancel', `ยกเลิกทั้งโต๊ะ ${order.table}${reason ? ' (' + reason + ')' : ''}`);
      const amt = r2(live.reduce((s, i) => s + i.price * i.qty, 0)), n = live.reduce((s, i) => s + i.qty, 0);
      lineAlert('void', `🚫 ยกเลิกทั้งโต๊ะ ${String(order.table).startsWith('TA') ? 'กลับบ้าน ' + String(order.table).slice(2) : order.table}\n${n} จาน · ${amt.toLocaleString('en-US')} ฿`
        + `\nโดย ${me.name}${approvedBy ? ` · อนุมัติโดย ${approvedBy}` : ''}${reason ? `\nเหตุผล: ${reason}` : ''}`);
    }
    return { closed: true, voided: true, cancelled: live.map(i => i.id), cooking: cooking.length };
  },

  // ภาษาใบแจ้งยอด/ใบเสร็จของบิลนี้ (ลูกค้าต่างชาติ/คนไทย)
  'POST /api/order/lang': b => {
    const o = data.orders.find(x => x.id === b.orderId);
    if (!o) throw new Error('ไม่พบบิล');
    if (!LANGS.includes(b.lang)) throw new Error('ภาษาไม่ถูกต้อง');
    o.lang = b.lang;
  },

  'POST /api/order/move': (b, q, req) => {
    const order = data.orders.find(o => o.id === b.orderId && o.status === 'open');
    if (!order) throw new Error('ไม่พบบิล');
    if (data.orders.some(o => o.table === b.table && o.status === 'open')) {
      // โต๊ะปลายทางมีบิลอยู่แล้ว → รวมบิล
      const target = data.orders.find(o => o.table === b.table && o.status === 'open');
      if (order.payments?.length || target.payments?.length) throw new Error('โต๊ะที่เริ่มแยกจ่ายแล้วรวมกับโต๊ะอื่นไม่ได้ ย้ายไปโต๊ะว่างแทน');
      data.items.filter(i => i.orderId === order.id).forEach(i => (i.orderId = target.id));
      data.orders = data.orders.filter(o => o.id !== order.id);
      addEvent('move', `รวมโต๊ะ ${order.table} ไปโต๊ะ ${b.table} · ${whoOf(req).name}`);
    } else {
      addEvent('move', `ย้ายโต๊ะ ${order.table} ไปโต๊ะ ${b.table} · ${whoOf(req).name}`);
      order.table = b.table;
    }
  },

  // ชำระเงิน
  //  mode ไม่ระบุ / 'full' → จ่ายยอดที่เหลือทั้งหมด
  //  'items' → จ่ายเฉพาะรายการที่เลือก lines: [{id, qty}] (แยกจำนวนได้ เช่น กะเพรา 2 จาน จ่ายจานเดียว)
  //  'share' → หารเท่า จ่าย 1 ส่วน: amount, parts (หารกี่คน)
  // รายการอาหารยังอยู่ในบิลเดิม (จอครัวไม่สะดุด) แต่ละครั้งที่จ่ายเก็บเป็น payments[] มีเลขใบเสร็จของตัวเอง
  'POST /api/order/pay': (b, q, req) => {
    const by = whoOf(req).name;
    const order = data.orders.find(o => o.id === b.orderId && o.status === 'open');
    if (!order) throw new Error('ไม่พบบิล (อาจปิดไปแล้ว)');
    const pay = data.settings.payments;
    const method = ['cash', 'transfer', 'card'].includes(b.method) ? b.method : 'cash';
    if (!pay[method]) throw new Error('วิธีชำระเงินนี้ปิดอยู่');
    const its = data.items.filter(i => i.orderId === order.id && i.status !== 'cancelled');
    const subtotal = r2(its.reduce((s, i) => s + i.price * i.qty, 0));
    const pays = order.payments || [];
    const paidSoFar = r2(pays.reduce((s, p) => s + p.amount, 0));
    const remaining = r2(subtotal - paidSoFar);
    const mode = b.mode || 'full';
    const paidQty = paidQtyOf(order);
    let amount, lines;

    if (mode === 'items') {
      if (pays.some(p => p.kind === 'share')) throw new Error('บิลนี้เริ่มหารเท่าไปแล้ว แยกตามรายการไม่ได้ จ่ายส่วนที่เหลือแทน');
      lines = (b.lines || []).map(l => ({ id: l.id, qty: Math.floor(Number(l.qty) || 0) })).filter(l => l.qty > 0);
      if (!lines.length) throw new Error('เลือกรายการที่จะจ่ายก่อน');
      amount = 0;
      for (const l of lines) {
        const it = its.find(i => i.id === l.id);
        if (!it) throw new Error('รายการนี้ถูกยกเลิกหรือย้ายไปแล้ว ลองเปิดใหม่');
        if (l.qty > it.qty - (paidQty[it.id] || 0)) throw new Error(`${it.name} เหลือให้จ่าย ${it.qty - (paidQty[it.id] || 0)} ที่`);
        amount += it.price * l.qty;
      }
      amount = r2(amount);
    } else if (mode === 'share') {
      amount = r2(Number(b.amount));
      if (!(amount > 0)) throw new Error('ยอดไม่ถูกต้อง');
      if (amount > remaining + 0.001) throw new Error(`ยอดเกินที่ค้างอยู่ (${remaining})`);
      if (b.parts) order.splitN = Math.max(2, Math.min(50, b.parts | 0));
    } else {
      amount = remaining;
      // จ่ายส่วนที่เหลือหลังแยกตามรายการ → บันทึกว่าเหลือจานไหน
      if (pays.length && !pays.some(p => p.kind === 'share'))
        lines = its.map(i => ({ id: i.id, qty: i.qty - (paidQty[i.id] || 0) })).filter(l => l.qty > 0);
    }
    if (amount > remaining + 0.001) throw new Error('ยอดเกินที่ค้างอยู่');

    const feePct = method === 'card' ? Number(pay.cardFeePct) || 0 : 0;
    const fee = r2(amount * feePct / 100), total = r2(amount + fee);
    const received = method === 'cash' ? Number(b.received) || 0 : 0;
    if (received && received < total) throw new Error('รับเงินไม่พอ');
    const now = Date.now();

    // จ่ายครั้งเดียวทั้งบิล (แบบเดิม)
    if (mode === 'full' && !pays.length) {
      Object.assign(order, { status: 'paid', paidAt: now, payMethod: method, subtotal, feePct, fee, total, received,
        receiptNo: nextReceiptNo(), paidBy: by });
      return { receiptNo: order.receiptNo, closed: true };
    }

    const p = { no: pays.length + 1, kind: mode === 'full' ? 'rest' : mode, lines, amount, method, feePct, fee, total,
      received, at: now, receiptNo: nextReceiptNo(), parts: mode === 'share' ? order.splitN : undefined, by };
    order.payments = [...pays, p];
    const left = r2(remaining - amount);
    if (left <= 0.001) {
      const ms = [...new Set(order.payments.map(x => x.method))];
      Object.assign(order, { status: 'paid', paidAt: now, payMethod: ms.length === 1 ? ms[0] : 'split', subtotal,
        fee: r2(order.payments.reduce((s, x) => s + x.fee, 0)), total: r2(order.payments.reduce((s, x) => s + x.total, 0)),
        received: 0 });
    }
    return { receiptNo: p.receiptNo, paymentNo: p.no, closed: left <= 0.001, left: Math.max(0, left) };
  },

  // ปุ่มล้างแท็บ "โต๊ะที่เสร็จแล้ว" บนหน้า KDS
  // ---------- จอ KDS แบบเดิม (ไฟล์ที่เคยใช้กับ OrderPin) ----------
  // ส่งข้อมูลรูปแบบเดียวกับ OrderPin เพื่อให้จอเดิมใช้ได้โดยไม่ต้องแก้
  // จอครัวหลายจอ: /api/orders?screen=<id> (ไม่ใส่ = จอแรก · all = ทุกจอรวมกัน)
  'GET /api/orders': (b, q) => {
    const screen = kdsScreenOf(q.get('screen'));
    const mine = i => (screen === 'all' ? onScreen(i) : itemScreens(i).includes(screen));
    const orders = [];
    for (const o of data.orders) {
      if (o.kdsDone || o.kdsDoneOn?.[screen]) continue;
      const its = data.items.filter(i => i.orderId === o.id && mine(i));
      const pend = its.filter(i => i.status === 'new');
      if (!pend.length) continue; // ทำครบทุกจาน → หลุดจากรายการ จอจะย้ายไปแท็บ "เสร็จแล้ว" เอง
      const dish = i => ({ id: i.id, name: i.name, quantity: i.qty, spec: '', at: i.createdAt, thai: !!i.thai, cat: catOf(i),   // cat = หมวด (จอครัวซ่อนหมวดได้ เช่น ของทอดช่วงยุ่ง)   // thai = ราคาคนไทย   // at = เวลาที่สั่งจานนี้ (จอครัวใช้นับเวลาใหม่เมื่อสั่งเพิ่ม)
        extra_option: i.opts || (i.option ? [i.option] : []),
        // จานที่ห่อกลับทั้งที่นั่งโต๊ะ → ขึ้นเป็นหมายเหตุสีแดง "กลับบ้าน" (ออเดอร์กลับบ้านทั้งบิลมีป้ายที่หัวการ์ดอยู่แล้ว)
        remark: [...(i.alerts || []).map(a => '⚠ ' + a),
          i.abroad ? 'กลับต่างประเทศ' : i.takeaway && !String(o.table).startsWith('TA') ? 'กลับบ้าน' : '', i.note].filter(Boolean).join(' · ') });
      const ta = String(o.table).startsWith('TA');
      const first = Math.min(...its.map(i => i.createdAt));
      orders.push({
        id: o.id,
        table_num: ta ? '' : String(o.table),
        pick_up_code: ta ? String(o.table).slice(2) : '',
        order_type: ta ? 'takeaway' : 'dine_in',
        third_party_platform: '',
        is_urge: false,
        unpaid: ta && o.status !== 'paid', // กลับบ้านที่ยังไม่ได้ชำระเงิน → จอครัวขึ้นป้ายเตือน
        is_add_dish: pend.some(i => i.createdAt - first > 60000),
        is_need_cutlery: false,
        is_cancel: false,
        order_at: o.createdAt,
        pending_dishes: pend.map(dish),
        completed_dishes: its.filter(i => i.status === 'done').map(dish),
        cancelled_dishes: its.filter(i => i.status === 'cancelled' && i.kdsCancel).map(dish),
      });
    }
    orders.sort((a, b) => a.order_at - b.order_at);
    const knownDishes = [...new Set(data.menu.filter(m => (screen === 'all' ? m.screens?.length : m.screens?.includes(screen))).map(m => m.name))];
    // จานที่เพิ่งยกเลิก (15 นาที) ให้จอครัวเตือนได้ แม้ทั้งโต๊ะหายไปจากรายการแล้ว
    const since = Date.now() - 15 * 60000;
    const cancelled = {
      orders: data.orders.filter(o => o.status === 'void' && o.voidedAt >= since).map(o => o.id),
      dishes: data.items.filter(i => i.kdsCancel && i.cancelledAt >= since).map(i => i.id),
    };
    const scr = data.settings.kdsScreens;
    // หมวดที่มีเมนูขึ้นจอนี้ (ให้จอครัวเลือกซ่อน) เรียงตามหลังร้าน
    const myCats = new Set(data.menu.filter(m => (screen === 'all' ? m.screens?.length : m.screens?.includes(screen))).map(m => m.category));
    const categories = [...data.categories.filter(c => myCats.has(c)), ...[...myCats].filter(c => !data.categories.includes(c))];
    return { ok: true, orders, knownDishes, categories, cancelled, screen: { id: screen, name: screen === 'all' ? 'ทุกจอ' : scr.find(k => k.id === screen)?.name },
      screens: scr, shopName: data.settings.shopName };
  },

  'POST /api/dish/complete': b => {
    const it = data.items.find(x => x.id === b.dishes_id && x.orderId === b.order_id);
    if (!it || it.status === 'cancelled') return;
    it.status = b.status === 'pending' ? 'new' : 'done';
    it.doneAt = it.status === 'done' ? Date.now() : null;
  },

  'POST /api/order/complete': b => {
    const o = data.orders.find(x => x.id === b.order_id);
    if (!o) return;
    // กด "เสร็จทั้งโต๊ะ" มีผลเฉพาะจอที่กด (จอบาร์ไม่หาย ถ้าครัวกดเสร็จ)
    const screen = kdsScreenOf(b.screen);
    const mine = i => (screen === 'all' ? onScreen(i) : itemScreens(i).includes(screen));
    if (b.status === 'pending') { o.kdsDone = false; if (o.kdsDoneOn) delete o.kdsDoneOn[screen]; return; } // เรียกกลับ
    o.kdsDoneOn = { ...(o.kdsDoneOn || {}), [screen]: true };
    for (const i of data.items) if (i.orderId === o.id && mine(i) && i.status === 'new') { i.status = 'done'; i.doneAt = Date.now(); }
  },

  'POST /api/kds/clear': b => {
    for (const o of data.orders) if (!b.orderIds || b.orderIds.includes(o.id)) {
      const its = data.items.filter(i => i.orderId === o.id && onScreen(i));
      if (its.every(i => i.status !== 'new')) o.kdsCleared = true;
    }
  },
  'POST /api/events/clear': () => { data.events = []; },

  // เข้าคิวทีละงานต่อเครื่อง (เครื่องพิมพ์ส่วนใหญ่รับได้ทีละการเชื่อมต่อ)
  'POST /api/print': async b => {
    const key = String(b.printer || data.settings.receiptPrinter);
    // คิวต่อเครื่อง: งานถัดไปเริ่มหลังงานก่อนปิดสายเรียบร้อย · ตอบหน้าจอทันทีที่เครื่องพิมพ์รับงาน
    let markSent; const sentP = new Promise(r => (markSent = r));
    const job = (printQueue[key] || Promise.resolve()).catch(() => {}).then(() => printRaster({ ...b, printer: key }, markSent));
    printQueue[key] = job;
    job.then(() => printerResult(key), e => printerResult(key, e));   // แจ้งเข้า LINE ถ้าพิมพ์ไม่ออก
    await Promise.race([sentP, job]);
    return { ok: true };
  },
};

// ใช้ได้โดยไม่ต้องใส่รหัส: จอครัว (KDS) การสลับเครื่องสำรอง และหน้าใส่รหัสเอง
const PUBLIC_ROUTES = new Set(['GET /api/auth', 'POST /api/auth/setup', 'POST /api/login', 'GET /api/auth/me',
  'GET /api/role', 'GET /api/sync', 'POST /api/promote', 'POST /api/sync/key', 'POST /api/standby/pair', 'POST /api/standby/peer',
  'GET /api/orders', 'POST /api/dish/complete', 'POST /api/order/complete', 'POST /api/kds/clear', 'POST /api/events/clear']);
// หน้าสั่งอาหาร (รหัสพนักงาน หรือรหัสเจ้าของร้าน)
const STAFF_ROUTES = new Set(['GET /api/state', 'GET /api/rev', 'GET /api/history', 'POST /api/order', 'POST /api/item/status', 'POST /api/item/cancel',
  'POST /api/order/void', 'POST /api/order/move', 'POST /api/order/lang', 'POST /api/order/pay', 'POST /api/print']);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/api/export') {
    if (tokenLevel(url.searchParams.get('t')) < LEVELS.admin) { res.writeHead(401); return res.end('ต้องใส่รหัสเจ้าของร้าน'); }
    res.writeHead(200, { 'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="ed-pos-${today()}.json"` });
    return res.end(JSON.stringify(data, null, 1));
  }

  // หน้าอื่นที่อยู่คนละเครื่องถามสถานะ/สั่งสลับเครื่องได้ (ใช้ตอนเครื่องหลักพัง)
  if (url.pathname === '/api/role' || url.pathname === '/api/promote') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' });
      return res.end();
    }
  }
  // เครื่องสำรองอ่านได้อย่างเดียว
  if (role.role === 'standby' && req.method === 'POST' && !['/api/promote', '/api/standby/pair', '/api/standby/peer'].includes(url.pathname)) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'เครื่องนี้เป็นเครื่องสำรอง ใช้งานที่เครื่องหลัก', standby: true }));
  }
  // เปิดหน้าแรกของเครื่องสำรอง → หน้าสถานะเครื่องสำรอง
  if (role.role === 'standby' && (url.pathname === '/' || url.pathname === '/index.html')) url.pathname = '/standby.html';

  // รูปบนใบเสร็จ: /receipt-img/logo  /receipt-img/footer
  const im = url.pathname.match(/^\/receipt-img\/(logo|footer)$/);
  if (im && req.method === 'GET') {
    const m = /^data:image\/(png|jpeg);base64,(.*)$/.exec(data.settings.receipt?.images?.[im[1]] || '');
    if (!m) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/' + m[1], 'Cache-Control': 'public, max-age=31536000, immutable' });
    return res.end(Buffer.from(m[2], 'base64'));
  }

  const key = `${req.method} ${url.pathname}`;
  const handler = routes[key];
  if (handler) {
    // ตรวจรหัส: จอครัว/เครื่องสำรอง/หน้าใส่รหัส ไม่ต้องใช้ · หน้าสั่งอาหาร = staff · ที่เหลือ = เจ้าของร้าน
    const need = PUBLIC_ROUTES.has(key) ? 0 : STAFF_ROUTES.has(key) ? LEVELS.staff : LEVELS.admin;
    if (need && tokenLevel(req.headers['x-pin-token']) < need) {
      req.resume();
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: data.auth.admin ? 'ต้องใส่รหัสก่อน' : 'ยังไม่ได้ตั้งรหัส', auth: need === LEVELS.admin ? 'admin' : 'staff' }));
    }
    // เก็บเป็น Buffer แล้วค่อยแปลงทีเดียว (ต่อทีละท่อนแบบข้อความ ตัวอักษรไทยที่ตกรอยต่อจะเพี้ยน · เกิดกับไฟล์ใหญ่ เช่น กู้คืน/นำเข้าเมนู)
    const parts = [];
    req.on('data', c => parts.push(c));
    req.on('end', async () => {
      try {
        const body = Buffer.concat(parts).toString('utf8');
        const result = await handler(body ? JSON.parse(body) : {}, url.searchParams, req);
        // เครื่องสำรองไม่บันทึกเอง (ข้อมูลมาจากเครื่องหลักเท่านั้น) · ขอกุญแจ/ใส่รหัสไม่ได้เปลี่ยนข้อมูล
        if (req.method === 'POST' && role.role === 'main' && !['/api/print', '/api/login', '/api/sync/key'].includes(url.pathname)) { prune(); save(); broadcast(); }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });   // ห้ามแคช ข้อมูลต้องสดเสมอ
        res.end(JSON.stringify(result || { ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message, ...(e.needApprove ? { needApprove: true } : {}) }));
      }
    });
    return;
  }

  // ไฟล์หน้าเว็บ
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(PUBLIC_DIR, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    // ให้เบราว์เซอร์/แอปถามใหม่ทุกครั้ง: อัปเดตโปรแกรมแล้วทุกเครื่องได้หน้าใหม่ทันที ไม่ค้างของเก่า
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

// พอร์ตถูกใช้อยู่ (เช่น เปิด Termux และแอปเป็นเซิร์ฟเวอร์พร้อมกัน) → บอกชัดๆ แล้วปิด ไม่ค้างเงียบ
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.error(`พอร์ต ${PORT} ถูกใช้อยู่ มีโปรแกรม ED POS เปิดอยู่แล้วในเครื่องนี้ (Termux หรือแอป MAMA POS) ปิดอันหนึ่งก่อน`); process.exit(1); }
  logError('server', e);
});
server.listen(PORT, '0.0.0.0', () => {
  if (role.role === 'main') { prune(); save(); } else saveRaw();
  dailyBackup();
  if (startupWarn) {
    addEvent('restore', startupWarn);
    setTimeout(() => lineAlert('system', '⚠ ' + startupWarn), 3000);
  }
  if (pinResetByFlag) setTimeout(() => lineAlert('system', '🔑 มีการล้างรหัสเจ้าของร้านและพนักงานจากแอปที่เครื่องหลัก ต้องตั้งรหัสใหม่ทั้งหมด ถ้าไม่ได้ทำเอง ให้ตรวจดูเครื่องหลัก'), 3000);
  const ips = myIps();
  if (role.role === 'standby') {
    console.log(`ED POS เครื่องสำรอง · คัดลอกข้อมูลจาก ${role.peer}`);
    console.log(`  ถ้าเครื่องหลักพัง เปิด http://${ips[0] || 'localhost'}:${PORT} แล้วกด "ใช้เครื่องนี้เป็นเครื่องหลัก"`);
    syncTick();
    return;
  }
  peerTick();
  console.log('ED POS พร้อมใช้งาน (เครื่องหลัก)');
  for (const ip of ips.length ? ips : ['localhost']) {
    console.log(`  สั่งอาหาร : http://${ip}:${PORT}/order.html`);
    console.log(`  KDS ครัว  : http://${ip}:${PORT}/kds.html`);
    console.log(`  ตั้งค่า    : http://${ip}:${PORT}/admin.html`);
  }
});
