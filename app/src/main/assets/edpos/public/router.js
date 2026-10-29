// เราเตอร์ / Wi-Fi ดับ → หน้าจอเต็มจอ "รอสักครู่" (ห้ามสลับเครื่อง)
// ก่อนสลับไปเครื่องสำรอง → หน้าจอเต็มจอ "ตรวจเราเตอร์ก่อน"
// ใช้ทุกหน้า: failover.js / standby.html เรียกผ่าน window.edposRouter
//  · check()          ตรวจ Wi-Fi/เราเตอร์ของเครื่องนี้ (ในแอปเท่านั้น · เบราว์เซอร์รู้แค่ว่าออนไลน์ไหม)
//  · down(kind, why)  ขึ้นหน้าจอ "รอ" · kind: client (มือถือ/จอครัว) | main (แท็บเล็ตเครื่องหลัก) | standby | blocked (สลับไม่ได้)
//  · confirmSwitch()  หน้าจอตรวจก่อนสลับ → true = ผู้ใช้ยืนยันว่าเครื่องหลักดับจริง
//  · watch(kind)      หน้าที่เปิดจากเซิร์ฟเวอร์ในเครื่องนี้: ตรวจ Wi-Fi ทุก 20 วินาที
(() => {
  if (window.edposRouter) return;
  const A = window.EdPosApp;
  const inApp = !!(A && typeof A.netCheck === 'function');
  let el = null, pill = null, kind = '', curWhy = '', since = 0, tick = null, loop = null, pending = null;

  // ---------- ตรวจ Wi-Fi / เราเตอร์ ----------
  function check() {
    if (!inApp) return Promise.resolve({ wifi: navigator.onLine !== false, gwOk: null, app: false });
    if (pending) return pending;
    pending = new Promise(done => {
      const fin = r => { clearTimeout(t); pending = null; done(r); };
      const t = setTimeout(() => fin({ wifi: true, gwOk: null, app: true }), 6000);
      window.edposNet = r => fin({ ...(r || {}), app: true });
      try { A.netCheck(); } catch { fin({ wifi: true, gwOk: null, app: true }); }
    });
    return pending;
  }
  const bad = r => !!r && (r.wifi === false || r.gwOk === false);
  const whyOf = r => (r && r.wifi === false ? 'wifi' : 'router');

  // ---------- หน้าตา ----------
  function css() {
    if (document.getElementById('rtCss')) return;
    const s = document.createElement('style'); s.id = 'rtCss';
    s.textContent = `
      #rtScr { position: fixed; inset: 0; z-index: 10000; overflow-y: auto; color: #fff; -webkit-tap-highlight-color: transparent;
        font: 400 17px/1.45 "IBM Plex Sans Thai","Noto Sans Thai",system-ui,sans-serif; animation: rtIn .2s ease-out; }
      #rtScr.down { background: radial-gradient(120% 80% at 50% 0%, #5a1717 0%, #2a0c0c 55%, #160707 100%); }
      #rtScr.check { background: radial-gradient(120% 80% at 50% 0%, #5a3d0c 0%, #2b1d06 55%, #170f03 100%); }
      #rtScr.ok { background: radial-gradient(120% 80% at 50% 0%, #0f5235 0%, #082a1c 60%, #04150e 100%); }
      @keyframes rtIn { from { opacity: 0; } }
      #rtScr .in { min-height: 100%; box-sizing: border-box; padding-bottom: 0 !important; max-width: 620px; margin: 0 auto; padding: max(28px, env(safe-area-inset-top)) 22px max(28px, env(safe-area-inset-bottom));
        display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 14px; }
      #rtScr .ic { width: clamp(120px, 34vw, 190px); aspect-ratio: 1; display: grid; place-items: center; border-radius: 50%; margin-bottom: 4px; }
      #rtScr.down .ic { background: rgba(255,90,80,.14); animation: rtPulse 1.8s infinite; }
      #rtScr.check .ic { background: rgba(255,190,60,.15); }
      #rtScr.ok .ic { background: rgba(62,207,142,.18); }
      #rtScr .ic svg { width: 66%; height: 66%; }
      @keyframes rtPulse { 0% { box-shadow: 0 0 0 0 rgba(255,90,80,.45); } 70%, 100% { box-shadow: 0 0 0 26px rgba(255,90,80,0); } }
      #rtScr h1 { margin: 0; font-size: clamp(30px, 8vw, 50px); line-height: 1.15; font-weight: 700; letter-spacing: -.01em; }
      #rtScr .big { margin: 0; font-size: clamp(21px, 5.2vw, 30px); font-weight: 600; line-height: 1.3; }
      #rtScr.down .big { color: #ffd2cc; } #rtScr.check .big { color: #ffe3a8; }
      #rtScr ul { list-style: none; margin: 8px 0 0; padding: 0; width: 100%; display: grid; gap: 10px; text-align: left; }
      #rtScr li { display: flex; gap: 12px; align-items: flex-start; padding: 13px 15px; border-radius: 14px; background: rgba(255,255,255,.08);
        font-size: clamp(16px, 4vw, 19px); }
      #rtScr li i { font-style: normal; flex: none; width: 1.5em; text-align: center; font-size: 1.15em; line-height: 1.3; }
      #rtScr li b { font-weight: 700; }
      #rtScr .st { font-size: 15px; opacity: .75; min-height: 1.4em; }
      /* ปุ่มติดขอบล่างเสมอ (จอเล็ก/เนื้อหายาว ก็เห็นปุ่มโดยไม่ต้องเลื่อน) */
      #rtScr .btns { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; width: 100%; margin-top: 6px;
        position: sticky; bottom: 0; padding: 14px 0 max(6px, env(safe-area-inset-bottom)); }
      #rtScr.down .btns { background: linear-gradient(to top, #160707 72%, rgba(22,7,7,0)); }
      #rtScr.check .btns { background: linear-gradient(to top, #170f03 72%, rgba(23,15,3,0)); }
      #rtScr button { font: 700 18px/1.2 inherit; font-family: inherit; padding: 16px 22px; border-radius: 14px; border: 0; cursor: pointer; min-height: 56px; flex: 1 1 220px; }
      #rtScr button.pri { background: #fff; color: #1b1d20; }
      #rtScr button.warn { background: #e5483b; color: #fff; }
      #rtScr button.ghost { background: transparent; color: #fff; border: 1.5px solid rgba(255,255,255,.35); }
      #rtScr button:disabled { opacity: .45; cursor: default; }
      #rtScr .link { background: none; border: 0; min-height: 0; padding: 6px; flex: none; font: 400 14px/1.3 inherit; font-family: inherit; color: #fff; opacity: .6; text-decoration: underline; }
      #rtPill { position: fixed; top: calc(8px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 9998; border: 0; cursor: pointer;
        display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; background: #c83a2f; color: #fff;
        font: 600 14px/1.2 "IBM Plex Sans Thai","Noto Sans Thai",system-ui,sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
      #rtPill::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #fff; animation: rtBlink 1.2s infinite; }
      @keyframes rtBlink { 50% { opacity: .3; } }
      @media (max-height: 820px) { #rtScr .in { gap: 10px; padding-top: max(18px, env(safe-area-inset-top)); }
        #rtScr .ic { width: 96px; } #rtScr h1 { font-size: clamp(26px, 7vw, 40px); } #rtScr .big { font-size: clamp(18px, 4.6vw, 24px); }
        #rtScr li { padding: 10px 13px; font-size: 15.5px; } #rtScr button { min-height: 50px; padding: 13px 18px; } }
      @media (prefers-reduced-motion: reduce) { #rtScr, #rtScr .ic, #rtPill::before { animation: none !important; } }`;
    document.head.appendChild(s);
  }
  // ไอคอนเราเตอร์: เสา 2 ต้น + คลื่น Wi-Fi · ดับ = กากบาทแดง · ตรวจ = เครื่องหมายตกใจ · ต่อได้ = ติ๊ก
  function icon(state) {
    const c = state === 'ok' ? '#3ecf8e' : state === 'check' ? '#ffbe3c' : '#ff6a5c';
    const badge = state === 'ok' ? '<path d="M77 92l7 7 13-14" stroke="#fff" stroke-width="5"/>'
      : state === 'check' ? '<path d="M87 83v10M87 100v.5" stroke="#1b1d20" stroke-width="5.5"/>'
      : '<path d="M80 86l14 14M94 86l-14 14" stroke="#fff" stroke-width="5"/>';
    return `<svg viewBox="0 0 120 120" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <g stroke="#fff" stroke-width="5" opacity="${state === 'ok' ? 1 : .92}">
        <path d="M36 44a34 34 0 0 1 48 0" opacity="${state === 'ok' ? 1 : .35}"/><path d="M45 54a20 20 0 0 1 30 0" opacity="${state === 'ok' ? 1 : .55}"/>
        <path d="M30 70l-6-22M90 70l6-22"/><rect x="14" y="70" width="92" height="26" rx="9"/>
        <path d="M30 83h.5M42 83h.5M54 83h.5"/></g>
      <circle cx="87" cy="93" r="17" fill="${c}"/>${badge}</svg>`;
  }
  const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  function screen(cls, html) {
    css();
    if (!el) { el = document.createElement('div'); el.id = 'rtScr'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-live', 'assertive'); document.body.appendChild(el); }
    el.className = cls; el.innerHTML = `<div class="in">${html}</div>`;
    if (pill) { pill.remove(); pill = null; }
    return el;
  }
  function stopTimers() { clearInterval(tick); clearInterval(loop); tick = loop = null; }
  function hide() {
    stopTimers(); kind = ''; curWhy = '';
    if (el) { el.remove(); el = null; }
    if (pill) { pill.remove(); pill = null; }
  }

  // ---------- เราเตอร์ดับ: รอ ----------
  const WAIT3 = '<li><i>⏱</i><span>เกิน 3 นาที: ดูไฟเราเตอร์ · <b>ถอดปลั๊กเราเตอร์ 10 วินาที แล้วเสียบใหม่</b> · รอไฟติดครบประมาณ 2 นาที</span></li>';
  function down(k, why = 'router', opt = {}) {
    if (el && el.className === 'down' && kind === k && curWhy === why) return;   // ขึ้นอยู่แล้ว (failover.js เรียกซ้ำทุก 4 วินาที)
    if (kind === k + ':hidden') return;   // ผู้ใช้กดซ่อนชั่วคราว (1 นาที)
    if (!since) since = Date.now();
    kind = k; curWhy = why;
    const wifi = why === 'wifi';
    const title = wifi ? 'เครื่องนี้ไม่ได้ต่อ Wi-Fi' : 'เราเตอร์ / Wi-Fi ดับ';
    const big = wifi ? 'เปิด Wi-Fi แล้วต่อ Wi-Fi ของร้าน' : k === 'main' ? 'รอเราเตอร์กลับมา เครื่องอื่นจะต่อกลับเอง' : 'รอสักครู่ ระบบจะต่อกลับเอง';
    let list = '';
    if (wifi) list += '<li><i>📶</i><span>ถ้าเครื่องอื่นในร้านก็ต่อไม่ได้เหมือนกัน = <b>เราเตอร์ดับ</b> ให้รอ</span></li>';
    if (k === 'main') list += `
      <li><i>✓</i><span><b>ข้อมูลร้านอยู่ในเครื่องนี้ ไม่หาย</b></span></li>
      <li><i>📱</i><span>มือถือ จอครัว และเครื่องพิมพ์ ต่อเครื่องนี้ไม่ได้ชั่วคราว</span></li>
      <li><i>🧾</i><span>สั่งที่เครื่องนี้ได้ แต่<b>ใบสั่งไม่พิมพ์</b> · ต่อได้แล้วกด "พิมพ์ใบสั่งซ้ำ" ที่โต๊ะนั้น</span></li>`;
    else if (k === 'standby' || k === 'blocked') list += `
      <li><i>✕</i><span><b>ห้ามสลับไปเครื่องสำรองตอนนี้</b> · เครื่องหลักน่าจะยังทำงาน แค่คุยกันไม่ได้</span></li>
      <li><i>✓</i><span>ข้อมูลร้านไม่หาย อยู่ในแท็บเล็ตเครื่องหลัก</span></li>`;
    else list += `
      <li><i>✓</i><span><b>ข้อมูลร้านไม่หาย</b> · รายการที่ยังไม่ส่งครัวยังอยู่ในเครื่องนี้</span></li>
      <li><i>✕</i><span><b>อย่ากดสลับไปเครื่องสำรอง</b></span></li>`;
    if (!wifi) list += WAIT3;
    const btns = k === 'main' ? '<button class="pri" data-a="use">ใช้เครื่องนี้ต่อ</button>'
      : k === 'blocked' ? '<button class="pri" data-a="close">เข้าใจแล้ว รอก่อน</button>'
      : '<button class="ghost" data-a="hide">ซ่อนชั่วคราว</button>';
    screen('down', `<div class="ic">${icon('down')}</div><h1>${title}</h1><p class="big">${big}</p><ul>${list}</ul>
      <div class="st" id="rtSt"></div><div class="btns">${btns}</div>
      ${opt.force ? '<button class="link" data-a="more">ไฟเราเตอร์ปกติดี แต่ยังขึ้นหน้านี้?</button>' : ''}`);
    el.onclick = e => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'use') collapse();
      if (a === 'close') { hide(); opt.onClose?.(); }
      if (a === 'hide') { const k0 = kind; hide(); kind = k0 + ':hidden'; setTimeout(() => { if (kind === k0 + ':hidden') kind = ''; }, 60000); }
      if (a === 'more') {
        e.target.outerHTML = `<p class="st" style="opacity:.9">เราเตอร์ตอบช้า/ไม่ตอบการตรวจ แต่ใช้งานได้จริง และ<b>แน่ใจว่าแท็บเล็ตเครื่องหลักดับ</b></p>
          <div class="btns"><button class="warn" data-a="force">ยืนยัน · สลับไปเครื่องสำรอง</button></div>`;
      }
      if (a === 'force') { hide(); opt.force(); }
    };
    const st = () => { const s = document.getElementById('rtSt'); if (s) s.textContent = `ดับมาแล้ว ${mmss(Date.now() - since)} · ตรวจใหม่ทุก 5 วินาที`; };
    stopTimers(); st(); tick = setInterval(st, 1000);
    // ในแอป: ตรวจเองทุก 5 วินาที · Wi-Fi กลับมา: แท็บเล็ต/เครื่องสำรอง = "ต่อได้แล้ว" · มือถือ/จอครัว = ปิดหน้านี้ ให้ failover.js ต่อเซิร์ฟเวอร์ต่อ (ต่อได้แล้วมันเรียก back())
    if (inApp && k !== 'blocked') loop = setInterval(async () => {
      if (bad(await check())) return;
      if (k === 'client') { stopTimers(); since = 0; if (el) { el.remove(); el = null; } } else back();
    }, 5000);
  }
  function collapse() {
    stopTimers(); if (el) { el.remove(); el = null; }
    css();
    pill = document.createElement('button'); pill.id = 'rtPill'; pill.textContent = 'เราเตอร์ดับ · มือถือ/เครื่องพิมพ์ยังต่อไม่ได้';
    pill.onclick = () => down(kind || 'main');
    document.body.appendChild(pill);
    if (inApp) loop = setInterval(async () => { if (!bad(await check())) back(); }, 5000);
  }
  function back() {
    since = 0;
    if (!el && !pill) return;
    stopTimers(); kind = ''; curWhy = '';
    if (pill) { pill.remove(); pill = null; }
    screen('ok', `<div class="ic">${icon('ok')}</div><h1>ต่อได้แล้ว</h1><p class="big">ใช้งานต่อได้ตามปกติ</p>`);
    setTimeout(hide, 1500);
  }

  // ---------- ก่อนสลับไปเครื่องสำรอง ----------
  function confirmSwitch() {
    return new Promise(async done => {
      stopTimers();
      screen('check', `<div class="ic">${icon('check')}</div><h1>ตรวจเราเตอร์ก่อนสลับเครื่อง</h1>
        <p class="big">กำลังตรวจ Wi-Fi ของเครื่องนี้…</p>`);
      const r = await check();
      if (bad(r)) { down('blocked', whyOf(r), { onClose: () => done(false) }); return; }
      const net = r.app ? `<li><i>✓</i><span>เครื่องนี้ต่อ Wi-Fi อยู่${r.gwOk ? ' · <b>เราเตอร์ตอบปกติ</b>' : ''}</span></li>` : '';
      screen('check', `<div class="ic">${icon('check')}</div><h1>ตรวจเราเตอร์ก่อนสลับเครื่อง</h1>
        <p class="big">สลับเฉพาะตอนแท็บเล็ตเครื่องหลักดับจริง</p>
        <ul>${net}
          <li><i>1</i><span><b>ดูไฟเราเตอร์</b> · ดับหรือกะพริบผิดปกติ = <b>รอ อย่าสลับ</b></span></li>
          <li><i>2</i><span><b>ดูแท็บเล็ตเครื่องหลัก</b> · จอดับ แบตหมด หรือแอปปิดจริงไหม · ถ้ายังเปิดอยู่ ให้ต่อ Wi-Fi ที่เครื่องนั้นใหม่แทน</span></li>
          <li><i>⚠</i><span>สลับตอนเครื่องหลักยังเปิดอยู่ ออเดอร์จะแยกสองเครื่อง (รวมให้ทีหลัง แต่บางบิลต้องตรวจเอง)</span></li></ul>
        <div class="btns"><button class="pri" data-a="wait">รอก่อน</button>
          <button class="warn" data-a="go" disabled>เครื่องหลักดับจริง · ใช้เครื่องสำรอง</button></div>`);
      const go = el.querySelector('[data-a="go"]'), label = go.textContent;
      let n = 3; const cd = () => { go.textContent = n > 0 ? `${label} (${n})` : label; go.disabled = n > 0; n--; };
      cd(); tick = setInterval(() => { cd(); if (n < 0) clearInterval(tick); }, 1000);
      el.onclick = e => {
        const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
        if (a === 'wait') { hide(); done(false); }
        if (a === 'go' && !go.disabled) { hide(); done(true); }
      };
    });
  }

  // ---------- หน้าที่เปิดจากเซิร์ฟเวอร์ในเครื่องนี้ (แท็บเล็ตเครื่องหลัก / เครื่องสำรอง) ----------
  function watch(k) {
    if (!inApp) return;
    const run = async () => {
      if (el || pill || String(kind).endsWith(':hidden')) return;
      const r = await check();
      if (bad(r) && !el && !pill) down(k, whyOf(r));
    };
    setTimeout(run, 3000); setInterval(run, 20000);
  }

  window.edposRouter = { check, bad, whyOf, down, hide, back, confirmSwitch, watch, shown: () => (el || pill ? kind : '') };
})();
