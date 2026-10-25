// ---------- ทำงานเฉพาะในแอป ED POS บน Android (window.EdPosApp) · เปิดใน Chrome ไฟล์นี้ไม่ทำอะไร ----------
// · เสียงอ่าน: WebView ไม่มี speechSynthesis → ส่งให้เครื่องอ่านออกเสียงของ Android (จอครัวอ่านออเดอร์)
// · บันทึกไฟล์: ปุ่มที่สร้างไฟล์ในหน้าเว็บ (ส่งออกเมนู ฯลฯ) → บันทึกลงโฟลเดอร์ Download ผ่านแอป
// · เต็มจอ: แอปเต็มจอและกันจอดับเองอยู่แล้ว (ซ่อนปุ่ม ⛶ ผ่าน kiosk.js)
(() => {
  const A = window.EdPosApp;
  if (!A) return;
  document.documentElement.dataset.app = '1';

  // ----- speechSynthesis → Android TextToSpeech -----
  const queue = new Map(); let seq = 0;
  class Utterance {
    constructor(text) { this.text = text || ''; this.lang = 'th-TH'; this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null; this.onstart = this.onend = this.onerror = null; }
  }
  const fire = (u, k) => { try { u[k]?.({ utterance: u }); } catch (e) {} };
  const synth = {
    get speaking() { return queue.size > 0; },
    get pending() { return queue.size > 1; },
    paused: false, onvoiceschanged: null,
    speak(u) { const id = 'u' + (++seq); queue.set(id, u); A.speak(id, String(u.text || ''), Number(u.rate) || 1); },
    cancel() { A.stopSpeak(); const all = [...queue.values()]; queue.clear(); all.forEach(u => fire(u, 'onend')); },
    getVoices() { return A.ttsStatus() === 'ok' ? [{ name: 'Android ภาษาไทย', lang: 'th-TH', default: true, localService: true, voiceURI: 'android-th' }] : []; },
    pause() {}, resume() {}, addEventListener() {}, removeEventListener() {},
  };
  // แอปเรียกกลับเมื่อเริ่ม/จบการพูด
  window.__edposTts = (id, ev) => {
    const u = queue.get(id); if (!u) return;
    if (ev === 'start') return fire(u, 'onstart');
    queue.delete(id); fire(u, ev === 'error' ? 'onerror' : 'onend');
  };
  try { Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true }); } catch (e) { window.speechSynthesis = synth; }
  window.SpeechSynthesisUtterance = Utterance;
  // เครื่องอ่านออกเสียงของ Android พร้อมช้ากว่าหน้าเว็บ → แจ้งหน้าเว็บให้ตรวจเสียงไทยใหม่
  [800, 2500, 6000].forEach(t => setTimeout(() => { try { synth.onvoiceschanged?.(); } catch (e) {} }, t));

  // ----- <a download href="blob:..."> → บันทึกผ่านแอป -----
  const say = (msg, bad) => (typeof toast === 'function' ? toast(msg, bad) : alert(msg));
  async function save(href, name) {
    try {
      const blob = await (await fetch(href)).blob();
      const r = new FileReader();
      r.onload = () => {
        const res = A.saveFile(name || 'file', blob.type || 'application/octet-stream', String(r.result).split(',')[1] || '');
        say(res.startsWith('ok:') ? 'บันทึกไฟล์แล้ว: ' + res.slice(3) : 'บันทึกไฟล์ไม่ได้: ' + res.slice(4), !res.startsWith('ok:'));
      };
      r.readAsDataURL(blob);
    } catch (e) { say('บันทึกไฟล์ไม่ได้', true); }
  }
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && /^(blob|data):/.test(this.href)) return void save(this.href, this.getAttribute('download'));
    return click.call(this);
  };
})();
