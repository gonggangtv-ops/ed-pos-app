// test-1.97 ฝากค่าตั้งจอ (จอครัวเดิม · จอครัว 2.0 · จอคนเสิร์ฟ) ไว้ที่เครื่องหลัก
// ปัญหาเดิม: หน้าเว็บเก็บค่าตั้งตาม "ที่อยู่" (http://IP:พอร์ต) · ที่อยู่เปลี่ยน (อัปเดตแอปแล้วเครื่องหลักได้ IP ใหม่ / สลับเครื่องสำรอง)
//   = หน้าเว็บเห็นเป็นเครื่องใหม่ ค่าหายหมด ต้องตั้งใหม่
// ทำงาน: แท็บเล็ตมีรหัสประจำเครื่อง (แอป MAMA POS ให้มา ไม่เปลี่ยนแม้อัปเดต) · เปลี่ยนค่าเมื่อไหร่ ฝากไว้ที่เครื่องหลักภายในไม่กี่วินาที
//   ที่อยู่นี้ยังไม่เคยมีค่าตั้ง แต่เครื่องหลักมีของแท็บเล็ตนี้ → คืนค่าให้แล้วเปิดหน้าใหม่ 1 ครั้ง
(() => {
  const KEYS = /^(kds_(view|snd|tts|hide|nobatch|wait|screen|v2|tools|pop|popgeo|size|call)|kds2_(cfg|railhide)|serve_cfg)$/;
  const MARK = 'edpos-devcfg';                 // ที่อยู่นี้ตรวจกับเครื่องหลักแล้ว (ค่าในเครื่องนี้ใช้ได้)
  const A = window.EdPosApp;
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  };
  let id = '';
  try { if (A && typeof A.deviceId === 'function') id = String(A.deviceId() || ''); } catch {}
  if (!id) { id = ls.get('edpos-devid') || ''; if (!id) { id = 'b-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); ls.set('edpos-devid', id); } }
  let name = '';
  try { name = A && typeof A.deviceName === 'function' ? String(A.deviceName()) : ''; } catch {}
  if (!name) name = (navigator.userAgent.match(/\(([^)]+)\)/) || [])[1] || 'เบราว์เซอร์';
  const snap = () => {
    const o = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (KEYS.test(k)) o[k] = localStorage.getItem(k); } } catch {}
    return o;
  };

  function toast(msg) {
    const t = document.createElement('div');
    t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9999;max-width:min(560px,calc(100% - 24px));padding:12px 18px;border-radius:14px;background:rgba(24,26,30,.95);color:#fff;font:600 15px/1.4 "IBM Plex Sans Thai","Noto Sans Thai",system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 8000);
  }
  // คืนค่ารอบก่อนแล้วเปิดหน้าใหม่ → บอกให้รู้
  try {
    const r = JSON.parse(sessionStorage.getItem('edpos-devcfg-r') || 'null');
    if (r && Date.now() - r.at < 30000) {
      sessionStorage.removeItem('edpos-devcfg-r');
      const from = String(r.from || '').replace(/^https?:\/\//, ''), to = location.host;
      setTimeout(() => toast(`คืนค่าตั้งจอของแท็บเล็ตนี้แล้ว${from && from !== to ? ` (ที่อยู่เครื่องหลักเปลี่ยน ${from} → ${to})` : ''}`), 600);
    }
  } catch {}

  let ready = !!ls.get(MARK), last = '', busy = false;
  async function check() {
    if (ready) return true;
    try {
      const j = await (await fetch('/api/devcfg?id=' + encodeURIComponent(id), { cache: 'no-store' })).json();
      const c = j && j.cfg, keys = c && c.keys ? Object.entries(c.keys).filter(([k, v]) => KEYS.test(k) && typeof v === 'string') : [];
      if (keys.length) {
        let again = false;
        try { const r = JSON.parse(sessionStorage.getItem('edpos-devcfg-r') || 'null'); again = r && Date.now() - r.at < 15000; } catch {}
        for (const [k, v] of keys) ls.set(k, v);
        ls.set(MARK, String(Date.now()));
        ready = true;
        if (!again) {
          try { sessionStorage.setItem('edpos-devcfg-r', JSON.stringify({ at: Date.now(), from: c.origin || '' })); } catch {}
          last = JSON.stringify(snap());
          location.reload();
          return false;
        }
        return true;
      }
      ls.set(MARK, String(Date.now()));   // เครื่องหลักยังไม่มีของแท็บเล็ตนี้ → ใช้ค่าในเครื่องแล้วฝากไว้
      ready = true;
      return true;
    } catch { return false; }            // ติดต่อไม่ได้ → ลองใหม่รอบหน้า (ยังไม่ทับค่าที่ฝากไว้)
  }
  async function sync() {
    if (busy) return; busy = true;
    try {
      if (!(await check())) return;
      const keys = snap(), s = JSON.stringify(keys);
      if (s === last || !Object.keys(keys).length) return;
      const r = await fetch('/api/devcfg', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, origin: location.origin, page: location.pathname, keys }) });
      if (r.ok) last = s;                // เครื่องสำรองไม่รับ (ไม่ใช่เครื่องหลัก) → ลองใหม่เมื่อกลับมาเครื่องหลัก
    } catch {} finally { busy = false; }
  }
  window.edposDevCfg = { id, sync };
  setTimeout(sync, 1500);
  setInterval(sync, 5000);
})();
