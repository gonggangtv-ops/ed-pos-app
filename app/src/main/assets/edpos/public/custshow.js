/* ป้ายยอดให้ลูกค้าดู (test-1.52)
 * เปิดจากหน้าต่างชำระเงิน ปุ่ม "📺 ขึ้นยอดให้ลูกค้าดู" → เต็มจอ รูปป้าย pay-sign.webp + ยอดเงิน
 * · ตัวเลขฟอนต์กลมมน Fredoka 600 (fredoka-600.woff2 ติดมากับแอป ไม่ต้องใช้เน็ต · SIL OFL)
 *   สตางค์ (.50) ตัวเล็กกว่า · ฿ = ตัว B ของฟอนต์เดียวกัน + ขีดตั้ง
 * · ตัวเลขวางทับช่องว่างในรูป (ตำแหน่งเป็น % ของรูป 1536×1024) ยาวแค่ไหนก็ย่อให้พอดีช่องเอง
 * · จอแนวตั้ง → หมุนป้ายเป็นแนวนอนให้ · ปุ่ม ⟳ พลิกกลับหัว (ยื่นเครื่องข้ามเคาน์เตอร์) จำต่อเครื่อง
 * · ยอดเปลี่ยน (หารเท่า/แยกจ่าย/ค่าธรรมเนียมบัตร/ใส่เงินที่รับมา) ป้ายเปลี่ยนตามทันที
 * window.custShow.open(s) / .update(s) / .close() · s = { amount, note, paid } */
(() => {
  const INK = '#3a1d0c';
  const FONT = 'EdposNum, Fredoka, system-ui, sans-serif';
  // ช่องตัวเลขในรูป (% ของความกว้าง/สูงรูป)
  const BOX = { l: 52.6, t: 51.6, w: 41.6, h: 18.4 };

  // ---------- ยอดเงิน (SVG ตัวอักษร) ----------
  // "1,187.50" → บาท ตัวใหญ่ + ".50" ตัวเล็ก ชิดฐานเดียวกัน · viewBox ตั้งจากขนาดจริงหลังวาด (fit)
  function amountSvg(str) {
    const m = str.match(/^(.*?)([.,]\d{1,2})?$/);
    const main = m[1], dec = m[2] && m[2][0] === '.' ? m[2] : '';
    const whole = dec ? main : str;
    const t = (txt, size, extra = '') => `<tspan font-size="${size}"${extra}>${txt}</tspan>`;
    return `<svg preserveAspectRatio="xMidYMid meet" viewBox="0 -100 400 130">
      <g fill="${INK}" font-family="${FONT}" font-weight="600" letter-spacing="1">
        <text x="0" y="0">${t(whole, 128)}${dec ? t(dec, 84, ' dx="2"') : ''}</text>
      </g>
      <g class="cs-baht" fill="${INK}" font-family="${FONT}" font-weight="600">
        <text y="0" font-size="92">B</text><rect width="11" height="112" rx="5.5"/>
      </g></svg>`;
  }
  // วางตัว ฿ ต่อท้ายตัวเลข แล้วตั้ง viewBox ให้พอดีของที่วาดจริง (ฟอนต์โหลดเสร็จแล้วเรียกซ้ำ)
  function fit(svg) {
    if (!svg || !svg.isConnected) return;
    const num = svg.querySelector('text'), b = svg.querySelector('.cs-baht');
    const nb = num.getBBox();
    const bt = b.querySelector('text'), bar = b.querySelector('rect');
    const x = nb.x + nb.width + 22;
    bt.setAttribute('x', x);
    const bb = bt.getBBox();
    // ตัว B ของฟอนต์มีช่องว่างรอบตัว (bbox ใหญ่กว่าเส้นจริง) → ขีดตั้งยาวพ้นหัว/ท้ายนิดเดียว
    bar.setAttribute('x', bb.x + bb.width * 0.47 - 5.5);
    bar.setAttribute('y', bb.y + bb.height * 0.12 - 9);
    bar.setAttribute('height', bb.height * 0.76 + 18);
    const all = svg.querySelector('g').getBBox(), end = bb.x + bb.width;
    const top = Math.min(all.y, bb.y), bot = Math.max(all.y + all.height, bb.y + bb.height);
    svg.setAttribute('viewBox', `${all.x - 6} ${top - 4} ${end - all.x + 12} ${bot - top + 8}`);
  }

  // ---------- หน้าจอ ----------
  function css() {
    if (document.getElementById('csCss')) return;
    const s = document.createElement('style'); s.id = 'csCss';
    s.textContent = `
      @font-face { font-family: EdposNum; src: url(fredoka-600.woff2) format('woff2'); font-weight: 600; font-display: block; }
      #custShow { position: fixed; inset: 0; z-index: 2147483000; background: #fff; overflow: hidden; touch-action: none;
        user-select: none; -webkit-user-select: none; }
      #custShow .cs-stage { position: absolute; left: 50%; top: 50%; aspect-ratio: 3 / 2;
        width: min(100vw, 150vh); transform: translate(-50%, -50%) rotate(var(--cs-rot, 0deg)); }
      @media (orientation: portrait) {
        #custShow .cs-stage { width: min(100vh, 150vw); transform: translate(-50%, -50%) rotate(calc(90deg + var(--cs-rot, 0deg))); }
      }
      #custShow img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
      #custShow .cs-num { position: absolute; left: ${BOX.l}%; top: ${BOX.t}%; width: ${BOX.w}%; height: ${BOX.h}%;
        display: flex; flex-direction: column; justify-content: center; align-items: center; }
      #custShow .cs-num svg { width: 100%; height: 100%; flex: 1 1 0; min-height: 0; }
      #custShow .cs-num.has-note svg { height: 70%; }
      #custShow .cs-note { flex: 0 0 auto; font: 600 clamp(12px, 2.1vmax, 30px)/1.15 ${FONT}; color: ${INK};
        white-space: nowrap; margin-top: .3em; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
      #custShow .cs-note.paid { color: #1d7a3f; }
      #custShow .cs-tools { position: absolute; top: 10px; right: 10px; display: flex; gap: 8px; }
      #custShow .cs-tools button { width: 48px; height: 48px; border-radius: 50%; border: 0; background: #0000000f;
        color: #00000066; font-size: 22px; line-height: 1; padding: 0; }
      #custShow .cs-tools button:active { background: #0000002a; }
      #custShow.pop .cs-num { animation: csPop .35s ease-out; }
      @keyframes csPop { from { transform: scale(.92); opacity: .4; } to { transform: none; opacity: 1; } }`;
    document.head.appendChild(s);
  }

  let el = null, last = '';
  const flipKey = 'edposCustFlip';
  const getFlip = () => { try { return localStorage.getItem(flipKey) === '1'; } catch { return false; } };
  const setFlip = v => { try { localStorage.setItem(flipKey, v ? '1' : '0'); } catch {} };

  function paint(s) {
    if (!el) return;
    const amt = (typeof baht === 'function' ? baht(s.amount) : String(s.amount)).replace(/\s/g, '');
    const key = amt + '|' + (s.note || '') + '|' + (s.paid ? 1 : 0);
    if (key === last) return;
    const changedAmt = last && last.split('|')[0] !== amt;
    last = key;
    const num = el.querySelector('.cs-num');
    num.classList.toggle('has-note', !!s.note);
    num.innerHTML = amountSvg(amt) + (s.note ? `<div class="cs-note${s.paid ? ' paid' : ''}"></div>` : '');
    if (s.note) num.querySelector('.cs-note').textContent = s.note;
    const svg = num.querySelector('svg'); fit(svg);
    try { document.fonts.load('600 100px EdposNum').then(() => fit(svg), () => {}); } catch {}
    if (changedAmt) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  }

  function open(s) {
    css();
    if (!el) {
      el = document.createElement('div'); el.id = 'custShow';
      el.innerHTML = `<div class="cs-stage"><img src="pay-sign.webp" alt=""><div class="cs-num"></div></div>
        <div class="cs-tools"><button data-flip aria-label="พลิกกลับหัว">⟳</button><button data-close aria-label="ปิด">✕</button></div>`;
      el.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if ('close' in b.dataset) close();
        else if ('flip' in b.dataset) { setFlip(!getFlip()); applyFlip(); }
      });
      document.body.appendChild(el);
      document.body.classList.add('cust-show');
    }
    applyFlip();
    last = '';
    paint(s);
  }
  function applyFlip() { if (el) el.style.setProperty('--cs-rot', getFlip() ? '180deg' : '0deg'); }
  function close() { if (el) { el.remove(); el = null; last = ''; document.body.classList.remove('cust-show');
    window.dispatchEvent(new Event('custshowclose')); } }

  window.custShow = { open, close, update: s => paint(s), isOpen: () => !!el };
})();
