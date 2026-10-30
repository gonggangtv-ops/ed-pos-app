/* ป้ายยอดให้ลูกค้าดู (test-1.51)
 * เปิดจากหน้าต่างชำระเงิน ปุ่ม "📺 ให้ลูกค้าดู" → เต็มจอ รูปป้าย pay-sign.webp + ตัวเลขแบบไฟ 7 ส่วน
 * · ตัวเลขวางทับช่องว่างในรูป (ตำแหน่งเป็น % ของรูป 1536×1024) ยาวแค่ไหนก็ย่อให้พอดีช่องเอง
 * · จอแนวตั้ง → หมุนป้ายเป็นแนวนอนให้ · ปุ่ม ⟳ พลิกกลับหัว (ยื่นเครื่องข้ามเคาน์เตอร์) จำต่อเครื่อง
 * · ยอดเปลี่ยน (หารเท่า/แยกจ่าย/ค่าธรรมเนียมบัตร/ใส่เงินที่รับมา) ป้ายเปลี่ยนตามทันที
 * window.custShow.open(s) / .update(s) / .close() · s = { amount, note, paid } */
(() => {
  const INK = '#3a1d0c';
  // ช่องตัวเลขในรูป (% ของความกว้าง/สูงรูป)
  const BOX = { l: 52.6, t: 51.6, w: 41.6, h: 18.4 };

  // ---------- ตัวเลขแบบไฟ 7 ส่วน (SVG) ----------
  // ช่องละ 60×100 · ความหนาเส้น 12 · ปลายเส้นตัดเฉียง
  const W = 60, H = 100, T = 12, G = 1.6, ADV = 74;
  const hSeg = y => { const a = T / 2 + G, b = W - T / 2 - G, h = T / 2;
    return `${a},${y} ${a + h},${y - h} ${b - h},${y - h} ${b},${y} ${b - h},${y + h} ${a + h},${y + h}`; };
  const vSeg = (x, y1, y2) => { const a = y1 + G, b = y2 - G, h = T / 2;
    return `${x},${a} ${x + h},${a + h} ${x + h},${b - h} ${x},${b} ${x - h},${b - h} ${x - h},${a + h}`; };
  const SEG = {
    a: () => hSeg(T / 2), g: () => hSeg(H / 2), d: () => hSeg(H - T / 2),
    f: () => vSeg(T / 2, T / 2, H / 2), b: () => vSeg(W - T / 2, T / 2, H / 2),
    e: () => vSeg(T / 2, H / 2, H - T / 2), c: () => vSeg(W - T / 2, H / 2, H - T / 2),
  };
  const DIG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g' };

  function digitsSvg(str) {
    let x = 0, out = '';
    for (const ch of str) {
      if (DIG[ch] != null) {
        // เส้นที่ไม่ติดจางๆ ให้ดูเป็นจอไฟจริง
        out += `<g transform="translate(${x} 0)">${Object.keys(SEG).map(k =>
          `<polygon points="${SEG[k]()}" fill="${INK}" opacity="${DIG[ch].includes(k) ? 1 : 0.06}"/>`).join('')}</g>`;
        x += ADV;
      } else if (ch === '.') {
        out += `<rect x="${x - 6}" y="${H - 14}" width="14" height="14" rx="2" fill="${INK}"/>`; x += 18;
      } else if (ch === ',') {
        out += `<polygon points="${x - 6},${H - 14} ${x + 8},${H - 14} ${x + 4},${H + 6} ${x - 4},${H + 6}" fill="${INK}"/>`; x += 18;
      }
    }
    // ฿ ใช้ตัวอักษร (ตัวหนา) สูงราว 70% ของตัวเลข ชิดฐาน
    out += `<text x="${x + 6}" y="${H}" font-size="74" font-weight="900" fill="${INK}" font-family="system-ui,sans-serif">฿</text>`;
    x += 54;
    return `<svg viewBox="-8 -4 ${x + 16} ${H + 14}" preserveAspectRatio="xMidYMid meet">${out}</svg>`;
  }

  // ---------- หน้าจอ ----------
  function css() {
    if (document.getElementById('csCss')) return;
    const s = document.createElement('style'); s.id = 'csCss';
    s.textContent = `
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
      #custShow .cs-note { flex: 0 0 auto; font: 700 clamp(12px, 2.1vmax, 30px)/1.15 system-ui, sans-serif; color: ${INK};
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
    num.innerHTML = digitsSvg(amt) + (s.note ? `<div class="cs-note${s.paid ? ' paid' : ''}"></div>` : '');
    if (s.note) num.querySelector('.cs-note').textContent = s.note;
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
