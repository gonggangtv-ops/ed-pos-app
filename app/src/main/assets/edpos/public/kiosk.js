// ---------- ล็อกเต็มจอ (หน้าสั่งอาหาร / จอครัว) ----------
// เบราว์เซอร์ไม่ยอมให้หน้าเว็บเข้าเต็มจอเองตอนเปิด ต้องมีการแตะก่อน
// โหมดล็อก (จำไว้ในเครื่องนี้): แตะตรงไหนก็ได้ครั้งแรก = เข้าเต็มจอ · หลุดออก (ปัดกลับ/กดย้อน) แตะครั้งต่อไปก็กลับเต็มจอ
// ติดตั้งเป็นแอป (⋮ → เพิ่มไปยังหน้าจอหลัก) = เปิดเต็มจอเองทุกครั้ง ไม่ต้องแตะ
// ใช้: Kiosk.bind(ปุ่ม, {label(on, locked)})
const Kiosk = (() => {
  const KEY = 'edpos-fslock', de = document.documentElement;
  const req = de.requestFullscreen || de.webkitRequestFullscreen;
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const isApp = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  let locked = false;
  try { locked = localStorage.getItem(KEY) === '1'; } catch {}
  const enter = () => { if (isFs() || isApp() || !req || window.EdPosApp) return; try { const r = req.call(de, { navigationUI: 'hide' }); r?.catch?.(() => {}); } catch {} };
  const exit = () => { if (isFs()) try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch {} };
  const save = v => { locked = v; try { localStorage.setItem(KEY, v ? '1' : '0'); } catch {} };
  // ล็อกอยู่: แตะ/กดปุ่มใดๆ ขณะไม่เต็มจอ → เข้าเต็มจอ (ต้องเรียกในจังหวะที่ผู้ใช้แตะ)
  const nudge = e => { if (locked && !isFs() && !e.target.closest?.('[data-kiosk]')) enter(); };
  document.addEventListener('pointerdown', nudge, true);
  document.addEventListener('keydown', nudge, true);
  const subs = [];
  const notify = () => subs.forEach(f => f());
  document.addEventListener('fullscreenchange', notify); document.addEventListener('webkitfullscreenchange', notify);
  return {
    supported: !!req, isApp, isFs, get locked() { return locked; },
    // ปุ่มบนแถบด้านบน: แตะ = สลับ ล็อกเต็มจอ ↔ ปลดล็อก
    bind(btn, { label }) {
      if (!btn) return;
      btn.dataset.kiosk = '1';
      if (!req || isApp() || window.EdPosApp) { btn.hidden = true; return; }   // iPhone / เปิดเป็นแอปแล้ว / แอป ED POS (เต็มจอเอง)
      const upd = () => { const l = label(isFs(), locked); btn.textContent = l.text; btn.title = btn.ariaLabel = l.title; btn.classList.toggle('on', locked); };
      btn.addEventListener('click', () => {
        if (locked) { save(false); exit(); toast?.('ปลดล็อกเต็มจอแล้ว'); }
        else { save(true); enter(); toast?.('ล็อกเต็มจอแล้ว · เปิดหน้านี้ครั้งต่อไป แตะหน้าจอครั้งเดียวก็เต็มจอ'); }
        upd();
      });
      subs.push(upd); upd();
    },
  };
})();
