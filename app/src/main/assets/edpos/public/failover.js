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

  function showBar(html, tone) {
    if (!bar) {
      bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:14px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;'
        + 'font:600 16px/1.4 "IBM Plex Sans Thai","Noto Sans Thai",system-ui,sans-serif;color:#fff;box-shadow:0 -6px 24px #0006';
      document.body.appendChild(bar);
    }
    bar.style.background = tone === 'ok' ? '#1E6B58' : '#B03A27';
    bar.innerHTML = html;
    return bar;
  }
  const hideBar = () => { if (bar) { bar.remove(); bar = null; } };
  const btn = 'style="margin-left:auto;font:inherit;padding:10px 18px;border-radius:10px;border:0;background:#fff;color:#18221E;cursor:pointer"';

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
        showBar(`เครื่องนี้เป็นเครื่องสำรอง และติดต่อเครื่องหลักไม่ได้
          <button ${btn} id="foPromote">ใช้เครื่องนี้เป็นเครื่องหลัก</button>`);
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
          showBar(`เครื่องหลักไม่ตอบ · มีเครื่องสำรองที่ ${o.replace(/^https?:\/\//, '')}
            <button ${btn} id="foPromote">ใช้เครื่องสำรองแทน</button>`);
          bar.querySelector('#foPromote').onclick = () => promote(o);
          return;
        } catch {}
      }
      showBar(others().length ? 'ติดต่อทั้งเครื่องหลักและเครื่องสำรองไม่ได้ ตรวจ Wi-Fi และไฟของทั้งสองเครื่อง'
        : 'ติดต่อเครื่องหลักไม่ได้ ตรวจว่าแท็บเล็ตเปิดอยู่และ Termux ยังรันอยู่');
    } finally { busy = false; }
  }

  async function promote(base) {
    const b = bar.querySelector('#foPromote');
    b.disabled = true; b.textContent = 'กำลังสลับ…';
    try {
      await ask(base, '/api/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      showBar('สลับเครื่องเรียบร้อย กำลังเปิดหน้าใหม่…', 'ok');
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
