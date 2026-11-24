// เปิดเซิร์ฟเวอร์ ED POS ตัวจริงในโฟลเดอร์ชั่วคราว (ข้อมูลตั้งต้น = edpos-seed.json) สำหรับเทส
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SRC = process.env.EDPOS_SRC || path.join(__dirname, '../../app/src/main/assets/edpos');
const NODE = process.env.EDPOS_NODE || process.execPath;
function start({ port, mutate } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edpos-'));
  fs.cpSync(SRC, dir, { recursive: true });
  const d = JSON.parse(fs.readFileSync(path.join(SRC, '../edpos-seed.json'), 'utf8'));
  if (mutate) mutate(d);
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(d));
  port = port || 39000 + Math.floor(Math.random() * 900);
  const log = fs.openSync(path.join(dir, 'out.log'), 'a');
  const srv = spawn(NODE, ['server.js'], { cwd: dir, env: { ...process.env, PORT: String(port), TZ: 'Asia/Bangkok' }, stdio: ['ignore', log, log] });
  const B = 'http://127.0.0.1:' + port;
  const S = { dir, port, B, srv, T: '',
    clean() { try { srv.kill(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); },
    async api(p, body) {
      const r = await fetch(B + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-pin-token': S.T }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (r.status !== 200) throw new Error(j.error || String(r.status));
      return j;
    },
    async login(pin = '1234') {
      for (let i = 0; i < 60; i++) { try { await fetch(B + '/api/auth'); break; } catch { await sleep(200); } }
      const a = await S.api('/api/auth'); if (a.setup) await S.api('/api/auth/setup', { pin });
      S.T = (await S.api('/api/login', { pin, want: 'admin' })).token; return S;
    },
  };
  return S;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = { start, sleep };
