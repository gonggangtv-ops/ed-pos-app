// สลับไปเครื่องสำรองอัตโนมัติ — ใช้ทุกหน้า (สั่งอาหาร จอครัว หลังร้าน)
// · ถ้าเปิดหน้านี้อยู่บนเครื่องสำรอง และเครื่องหลักยังทำงาน → ย้ายไปเครื่องหลัก
// · ถ้าเครื่องที่ใช้อยู่ไม่ตอบ และอีกเครื่องเป็นเครื่องหลักแล้ว → ย้ายไปเครื่องนั้น
// · ถ้าเครื่องหลักไม่ตอบ → ค้นหาเครื่องหลักของร้านนี้ในวง Wi-Fi ก่อน (เราเตอร์ดับแล้วแจก IP ใหม่) เจอ → ย้ายไปเอง
// · ค้นไม่เจอ และอีกเครื่องยังเป็นเครื่องสำรอง → ขึ้นปุ่มให้กด "ใช้เครื่องสำรองแทน"
(() => {
  const KEY = 'edpos-nodes';
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
  };
  const here = location.origin;
  let fails = 0, busy = false, bar = null, searching = false, lastFind = 0, notFound = false, foundSb = '';
  const SHOP = 'edpos-shop';
  const shop = { get() { try { return localStorage.getItem(SHOP) || ''; } catch { return ''; } }, set(v) { try { if (v) localStorage.setItem(SHOP, v); } catch {} } };

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

  // ---------- ค้นหาเครื่องหลักในวง Wi-Fi ----------
  // ในแอป: ให้แอปค้น (ตะโกนถาม UDP + ไล่ถามทุกเลข) · เบราว์เซอร์: ไล่ถาม /api/role ทุกเลขในวงเดียวกับที่อยู่เดิม
  // ได้ { main, standby } · เจอเครื่องหลัก = ย้ายไป · เจอแค่เครื่องสำรอง = ขึ้นปุ่มให้เครื่องสำรองรับงานแทน
  function findMain() {
    return new Promise(done => {
      const A = window.EdPosApp;
      if (A && typeof A.findMain === 'function') {
        const t = setTimeout(() => done({}), 20000);
        window.edposFound = (u, sb) => { clearTimeout(t); done({ main: u || '', standby: sb || '' }); };
        try { A.findMain(); } catch { clearTimeout(t); done({}); }
        return;
      }
      scanLan().then(done, () => done({}));
    });
  }
  async function scanLan() {
    // ค้นเฉพาะวงของที่อยู่ที่เปิดอยู่ (วงเดียวกับ Wi-Fi ร้าน) · ไม่ไล่วงเก่าที่จำไว้ ถามเลขที่ไม่มีเครื่องค้างนาน จนเบราว์เซอร์ต่อเครื่องอื่นไม่ได้
    const nets = [(here.match(/^https?:\/\/(\d+\.\d+\.\d+)\.\d+/) || [])[1]].filter(Boolean);
    const port = (here.match(/:(\d+)$/) || [])[1] || '3000', want = shop.get(), hosts = [];
    for (const n of nets) for (let x = 1; x <= 254; x++) hosts.push(`http://${n}.${x}:${port}`);
    let found = '', sb = '', k = 0;
    const one = async u => {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 900);
      try { const j = await (await fetch(u + '/api/role', { signal: c.signal, cache: 'no-store' })).json();
        if (want && j.shop && j.shop !== want) return;
        if (j.role === 'main') found = found || u; else if (j.role === 'standby' && j.hasData !== false) sb = sb || u; } catch {}
      finally { clearTimeout(t); }
    };
    await Promise.all(Array.from({ length: 24 }, async () => { while (!found && k < hosts.length) await one(hosts[k++]); }));
    return { main: found, standby: sb };
  }
  async function search() {
    if (searching) return; searching = true; lastFind = Date.now(); notFound = false;
    showBar('กำลังค้นหาเครื่องหลัก…', 'ติดต่อที่อยู่เดิมไม่ได้ (เราเตอร์อาจแจก IP ใหม่) · ไม่เกิน 10 วินาที');
    const r = await findMain(), u = r.main || '';
    searching = false;
    if (r.standby && r.standby !== here) { foundSb = r.standby; store.set([...new Set([...store.get(), r.standby])]); }
    if (u && u !== here) {
      store.set([...new Set([u, ...store.get()])]);
      showBar('เจอเครื่องหลักแล้ว', `ย้ายไป ${u.replace(/^https?:\/\//, '')}…`, '', 'ok');
      setTimeout(() => go(u), 600);
      return true;
    }
    notFound = true;
    return false;
  }

  async function check() {
    if (busy || searching) return; busy = true;
    try {
      const me = await ask(here);
      fails = 0; notFound = false; shop.set(me.shop);
      // จำที่อยู่ของทั้งสองเครื่องไว้ เผื่อเครื่องนี้ดับ
      const list = [...new Set([...(me.me || []), me.peer, me.standby, me.nodes?.main, me.nodes?.standby].filter(Boolean))];
      if (!list.includes(here)) list.unshift(here);
      store.set(list);
      if (me.role === 'standby') {
        // หน้านี้เปิดอยู่บนเครื่องสำรอง: ถ้าเครื่องหลักทำงาน ย้ายไปที่นั่น
        if (location.pathname.endsWith('standby.html')) return;
        try { const p = await ask(me.peer); if (p.role === 'main') return go(me.peer); } catch {}
        if (me.finding) { showBar('เครื่องนี้เป็นเครื่องสำรอง', 'กำลังค้นหาเครื่องหลักในวง Wi-Fi (IP อาจเปลี่ยน)…'); return; }
        showBar('เครื่องนี้เป็นเครื่องสำรอง', 'ติดต่อเครื่องหลักไม่ได้', 'ใช้เครื่องนี้แทน');
        bar.querySelector('#foPromote').onclick = () => promote(here);
        return;
      }
      hideBar();
    } catch {
      if (++fails < 3) return;          // พลาดครั้งสองครั้งอาจเป็น Wi-Fi สะดุด
      let standby = '';
      for (const o of [...new Set([...others(), foundSb].filter(u => u && u !== here))]) {
        try {
          const p = await ask(o);
          if (p.role === 'main') return go(o);
          standby = standby || o;
        } catch {}
      }
      // ที่อยู่ที่รู้จักไม่มีเครื่องหลัก → ค้นหาในวง Wi-Fi ก่อน (ค้นซ้ำทุก 30 วิ) · อย่าเพิ่งให้เครื่องสำรองรับงาน เครื่องหลักอาจแค่ย้าย IP
      if (!notFound || Date.now() - lastFind > 30000) {
        busy = false; if (await search()) return;
        if (!standby && foundSb) try { if ((await ask(foundSb)).role === 'standby') standby = foundSb; } catch {}
      }
      if (standby) {
        showBar('ไม่เจอเครื่องหลัก', `มีเครื่องสำรองที่ ${standby.replace(/^https?:\/\//, '')}`, 'ใช้เครื่องสำรอง');
        bar.querySelector('#foPromote').onclick = () => promote(standby);
        return;
      }
      showBar(others().length ? 'ติดต่อเครื่องหลักและเครื่องสำรองไม่ได้' : 'ติดต่อเครื่องหลักไม่ได้',
        'ค้นหาในวง Wi-Fi แล้วไม่เจอ · ตรวจ Wi-Fi และไฟเครื่องหลัก', 'ค้นหาอีกครั้ง');
      bar.querySelector('#foPromote').onclick = () => { lastFind = 0; notFound = false; search(); };
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
