// ยิงงานพิมพ์ผ่านเซิร์ฟเวอร์ ED POS ตัวจริง → เครื่องพิมพ์จำลอง (prsim.py) แล้วตรวจกระดาษที่ออกมา
// ใช้: node prt.js <ชื่อชุด> [--jobs 3x3] [--h 300-1800] [--beep 5] -- <ตัวเลือกของ prsim.py>
// เช่น  node tools/printtest/prt.js "ตอบทันที บัฟเฟอร์ 16KB ช้า" -- --eot rt --mcu 16384 --rate 25000
//       EDPOS_SRC=<โฟลเดอร์ edpos รุ่นอื่น> เทียบกับรุ่นก่อน · EDPOS_NODE=<node 18> ให้ตรงกับในแอป
const { spawn } = require('child_process'), net = require('net');
const { start, sleep } = require('./server');
const argv = process.argv.slice(2), name = argv[0], sep = argv.indexOf('--');
const opt = Object.fromEntries((sep > 0 ? argv.slice(1, sep) : argv.slice(1)).join(' ').split('--').filter(Boolean).map(s => s.trim().split(/\s+/)));
const simArgs = sep > 0 ? argv.slice(sep + 1) : [];
const [tabs, per] = (opt.jobs || '3x3').split('x').map(Number);
const [hmin, hmax] = (opt.h || '300-1800').split('-').map(Number);
const beep = +(opt.beep ?? 5), gap = +(opt.gap ?? 0);
let seed = +(opt.seed || 1); const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const ctl = (port, cmd) => new Promise((res, rej) => { const s = net.connect(port, '127.0.0.1', () => s.write(cmd + '\n')); let b = ''; s.on('data', d => (b += d)); s.on('end', () => res(b ? JSON.parse(b) : {})); s.on('error', rej); });
function raster(job, h, wb = 72) {
  const bits = Buffer.alloc(wb * h);
  for (let r = 0; r < h; r++) { const o = r * wb; bits[o] = 0xA5; bits[o + 1] = 0x80 | job; bits[o + 2] = 0x80 | (r & 0x7f); bits[o + 3] = 0x80 | (r >> 7);
    if (r % 40 < 30) for (let x = 8; x < wb - 4; x++) bits[o + x] = ((x * 7 + r * 3) % 11 < 4) ? 0xFF : 0x00;   // ข้อความ/เส้น (มีพื้นดำบางส่วน)
    if (r % 200 < 14) bits.fill(0xFF, o + 6, o + wb - 2); }                                                      // แถบดำ (กลับบ้าน/หมายเหตุ)
  return bits;
}
(async () => {
  const sp = 40000 + Math.floor(Math.random() * 20000), cp = sp + 1;
  const sim = spawn('python3', [__dirname + '/prsim.py', '--port', sp, '--ctl', cp, ...simArgs], { stdio: ['ignore', 'inherit', 'inherit'] });
  await sleep(400);
  const S = await start({ mutate: d => { d.settings.printers = [{ id: 'front', name: 'หน้าร้าน', ip: '127.0.0.1', port: sp, copies: 1, slip: 'grp' }]; d.settings.receiptPrinter = 'front'; } }).login();
  const jobs = []; let n = 0;
  for (let t = 0; t < tabs; t++) for (let k = 0; k < per; k++) { n++; jobs.push({ job: n, tab: t, h: Math.round(hmin + rnd() * (hmax - hmin)), receipt: k === per - 1 && t % 2 === 1 }); }
  const t0 = Date.now(), errs = [];
  await Promise.all(Array.from({ length: tabs }, async (_, t) => {
    await sleep(t * 120);
    for (const j of jobs.filter(x => x.tab === t)) {
      const bits = raster(j.job, j.h);
      try { await S.api('/api/print', { printer: 'front', widthBytes: 72, height: j.h, bitsBase64: bits.toString('base64'), copies: 1, feed: 4, beep: j.receipt ? 0 : beep }); }
      catch (e) { errs.push(`งาน ${j.job}: ${e.message}`); }
      if (gap) await sleep(gap);
    }
  }));
  const tSent = Date.now() - t0;
  // รอจนเครื่องพิมพ์ว่าง
  let D;
  for (let i = 0; i < 600; i++) { await sleep(250); D = await ctl(cp, 'DUMP'); if (D.pending === 0 && D.idle > 2.5 && Date.now() - t0 > 3000) break; }
  await sleep(12000);   // งานที่ยังค้างในคิวเซิร์ฟเวอร์ (รอเครื่องพิมพ์ตอบ/ลองใหม่)
  for (let i = 0; i < 600; i++) { D = await ctl(cp, 'DUMP'); if (D.pending === 0 && D.idle > 2.5) break; await sleep(250); }
  const tDone = Date.now() - t0 - 12000;
  // ตรวจ
  const res = { ok: 0, trunc: [], merged: 0, missing: [], dup: [], garbage: 0, foreign: 0 };
  const pieces = [...D.pieces, ...(D.open.rows.length || D.open.garbage || D.open.foreign ? [{ ...D.open, uncut: true }] : [])];
  for (const p of pieces) { res.garbage += p.garbage; res.foreign += p.foreign; if (new Set(p.rows.map(r => r[0])).size > 1 || p.uncut) res.merged++; }
  for (const j of jobs) {
    const segs = pieces.flatMap(p => p.rows.filter(r => r[0] === j.job).map(r => ({ ...p, r })));
    const full = segs.filter(s => s.r[1] === 0 && s.r[2] === j.h - 1 && s.rows.length === 1 && !s.uncut);
    if (full.length === 1 && segs.length === 1) res.ok++;
    else if (!segs.length) res.missing.push(j.job);
    else if (full.length > 1) res.dup.push(j.job);
    else res.trunc.push(`${j.job}:${segs.map(s => s.r[1] + '-' + s.r[2]).join('+')}/${j.h}`);
  }
  const good = res.ok === jobs.length && !res.merged && !res.garbage && !res.foreign;
  console.log(`${good ? 'ok  ' : 'FAIL'} ${name.padEnd(34)} ครบ ${res.ok}/${jobs.length} · ขาด ${res.trunc.length} · หาย ${res.missing.length} · ซ้ำ ${res.dup.length} · ไม่ตัด/ปน ${res.merged} · ขยะ ${res.garbage + res.foreign} · ส่งเสร็จ ${(tSent / 1000).toFixed(1)}s พิมพ์เสร็จ ${(tDone / 1000).toFixed(1)}s`
    + (res.trunc.length ? `\n       ขาด: ${res.trunc.slice(0, 6).join('  ')}` : '') + (res.missing.length ? `\n       หาย: ${res.missing.join(',')}` : '')
    + (errs.length ? `\n       แจ้งพิมพ์ไม่ออก ${errs.length}: ${errs[0]}` : '') + `\n       เครื่องพิมพ์: ${JSON.stringify(D.stats)}`);
  sim.kill(); S.clean(); process.exit(good ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
