// สลับไปเครื่องสำรองอัตโนมัติ — ใช้ทุกหน้า (สั่งอาหาร จอครัว หลังร้าน)
// · ถ้าเปิดหน้านี้อยู่บนเครื่องสำรอง และเครื่องหลักยังทำงาน → ย้ายไปเครื่องหลัก
// · ถ้าเครื่องที่ใช้อยู่ไม่ตอบ และอีกเครื่องเป็นเครื่องหลักแล้ว → ย้ายไปเครื่องนั้น
// · ถ้าเครื่องหลักไม่ตอบ และอีกเครื่องยังเป็นเครื่องสำรอง → ขึ้นปุ่มให้กด "ใช้เครื่องสำรองแทน"
(() => {
  const KEY = 'edpos-nodes';
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
  };
  const here = location.origin;
  let fails = 0, busy = false, bar = null;

  const ask = async (base, path = '/api/role', opt = {}) => {
    const r = await fetch(base + path, { ...opt, signal: AbortSignal.timeout(2500), cache: 'no-store' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'ผิดพลาด');
    return j;
  };
  const go = base => {
    if (!base || base === here) return;
    const carry = window.edposCarry ? window.edposCarry() : '';   // เช่น รายการที่ยังไม่ส่ง
    location.href = base + location.pathname + location.search + (carry ? '#carry=' + encodeURIComponent(carry) : '');
  };
  const others = () => store.get().filter(u => u && u !== here);

  // การ์ดเล็กลอยกลางจอด้านล่าง (อยู่เหนือแถบยอด/ส่งออเดอร์ของมือถือ ไม่บังหัวหน้าจอ): จุดสี + หัวข้อ + คำอธิบาย + ปุ่ม (ถ้ามี) · ไม่ใช้แถบสีเต็มจอ
  function css() {
    if (document.getElementById('foCss')) return;
    const s = document.createElement('style'); s.id = 'foCss';
    s.textContent = `
      #foBar { position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 9999; width: max-content; max-width: min(560px, calc(100% - 24px));
        display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 14px; border-radius: 14px;
        background: rgba(24,26,30,.94); color: #fff; border: 1px solid rgba(255,255,255,.08); box-shadow: 0 10px 30px rgba(0,0,0,.3);
        -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); font: 400 14px/1.4 "IBM Plex Sans Thai","Noto Sans Thai",system-ui,sans-serif;
        animation: foIn .25s ease-out; }
      @keyframes foIn { from { opacity: 0; transform: translate(-50%, 8px); } }
      #foBar .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: #ff5d4d; animation: foPulse 1.6s infinite; }
      #foBar.ok .dot { background: #3ecf8e; animation: none; }
      @keyframes foPulse { 0% { box-shadow: 0 0 0 0 rgba(255,93,77,.55); } 70%, 100% { box-shadow: 0 0 0 8px rgba(255,93,77,0); } }
      #foBar .tx { min-width: 0; padding-right: 4px; } #foBar b { display: block; font-weight: 600; font-size: 14.5px; }
      #foBar small { display: block; font-size: 12.5px; opacity: .7; }
      #foBar button { flex: none; font: 600 13.5px/1 inherit; font-family: inherit; padding: 9px 14px; border-radius: 10px; border: 0; background: #fff; color: #18221E; cursor: pointer; }
      #foBar button:disabled { opacity: .6; }
      @media (prefers-reduced-motion: reduce) { #foBar, #foBar .dot { animation: none; } }`;
    document.head.appendChild(s);
  }
  function showBar(title, sub, button, tone) {
    css();
    if (!bar) { bar = document.createElement('div'); bar.id = 'foBar'; bar.setAttribute('role', 'status'); document.body.appendChild(bar); }
    document.body.classList.add('fo-on');
    bar.className = tone === 'ok' ? 'ok' : '';
    lift(bar);
    bar.innerHTML = `<span class="dot"></span><span class="tx"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>${button ? `<button id="foPromote">${button}</button>` : ''}`;
    return bar;
  }
  // หน้าสั่งอาหารบนมือถือมีแถบล่าง → ยกการ์ดขึ้นเหนือแถบนั้น
  function lift(el) {
    const m = document.querySelector('.mbar'), h = m && getComputedStyle(m).display !== 'none' ? m.getBoundingClientRect().height : 0;
    el.style.bottom = `calc(${Math.round(h) + 12}px + env(safe-area-inset-bottom, 0px))`;
  }
  window.edposLift = lift;
  const hideBar = () => { if (bar) { bar.remove(); bar = null; } document.body.classList.remove('fo-on'); };

  async function check() {
    if (busy) return; busy = true;
    try {
      const me = await ask(here);
      fails = 0;
      // จำที่อยู่ของทั้งสองเครื่องไว้ เผื่อเครื่องนี้ดับ
      const list = [...new Set([...(me.me || []), me.peer, me.nodes?.main, me.nodes?.standby].filter(Boolean))];
      if (!list.includes(here)) list.unshift(here);
      store.set(list);
      if (me.role === 'standby') {
        // หน้านี้เปิดอยู่บนเครื่องสำรอง: ถ้าเครื่องหลักทำงาน ย้ายไปที่นั่น
        if (location.pathname.endsWith('standby.html')) return;
        try { const p = await ask(me.peer); if (p.role === 'main') return go(me.peer); } catch {}
        showBar('เครื่องนี้เป็นเครื่องสำรอง', 'ติดต่อเครื่องหลักไม่ได้', 'ใช้เครื่องนี้แทน');
        bar.querySelector('#foPromote').onclick = () => promote(here);
        return;
      }
      hideBar();
    } catch {
      if (++fails < 3) return;          // พลาดครั้งสองครั้งอาจเป็น Wi-Fi สะดุด
      for (const o of others()) {
        try {
          const p = await ask(o);
          if (p.role === 'main') return go(o);
          showBar('เครื่องหลักไม่ตอบ', `มีเครื่องสำรองที่ ${o.replace(/^https?:\/\//, '')}`, 'ใช้เครื่องสำรอง');
          bar.querySelector('#foPromote').onclick = () => promote(o);
          return;
        } catch {}
      }
      showBar(others().length ? 'ติดต่อเครื่องหลักและเครื่องสำรองไม่ได้' : 'ติดต่อเครื่องหลักไม่ได้',
        others().length ? 'ตรวจ Wi-Fi และไฟของทั้งสองเครื่อง · ลองใหม่อัตโนมัติ' : 'ตรวจ Wi-Fi และไฟเครื่องหลัก · ลองใหม่อัตโนมัติ');
    } finally { busy = false; }
  }

  async function promote(base) {
    const b = bar.querySelector('#foPromote');
    b.disabled = true; b.textContent = 'กำลังสลับ…';
    try {
      await ask(base, '/api/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      showBar('สลับเครื่องเรียบร้อย', 'กำลังเปิดหน้าใหม่…', '', 'ok');
      setTimeout(() => (base === here ? location.reload() : go(base)), 800);
    } catch (e) {
      b.disabled = false; b.textContent = 'ลองอีกครั้ง';
      alert(e.message);
    }
  }

  window.edposFailover = { check, promote };
  setTimeout(check, 500);
  setInterval(check, 4000);
})();
