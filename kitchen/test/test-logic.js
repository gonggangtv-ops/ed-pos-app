// ทดสอบส่วนเข้าใจคำพูด: node kitchen/test/test-logic.js
const L = require('../src/main/assets/logic.js');
const now = Date.parse('2026-10-30T12:00:00Z');
const dish = (id, name, q, opts = [], remark = '') => ({ id, name, quantity: q, extra_option: opts, remark, at: now - 600000 });
const orders = [
  { id: 'o1', table_num: '3', order_type: 'dine_in', pick_up_code: '', order_at: now - 15 * 60000,
    pending_dishes: [dish('i1', 'ผัดกะเพรา', 2, ['หมูสับ', 'ไข่ดาว']), dish('i2', 'ต้มยำกุ้ง', 1, [], '⚠ แพ้ถั่ว · ไม่เผ็ด')] },
  { id: 'o2', table_num: '5', order_type: 'dine_in', pick_up_code: '', order_at: now - 8 * 60000,
    pending_dishes: [dish('i3', 'ผัดกะเพรา', 1, ['ไก่']), dish('i4', 'บะหมี่หมูแดง', 1)] },
  { id: 'o3', table_num: 'A12', order_type: 'dine_in', pick_up_code: '', order_at: now - 5 * 60000,
    pending_dishes: [dish('i5', 'ผัดไทย', 2)] },
  { id: 'o4', table_num: '', order_type: 'takeaway', pick_up_code: '7', order_at: now - 3 * 60000,
    pending_dishes: [dish('i6', 'ผัดกะเพรา', 1, ['หมูกรอบ'])] },
];
const ctx = { now, screen: 'main' };
let fail = 0;
function t(input, kind, check) {
  const w = L.findWake(input);
  const text = w.woke ? w.rest : input;
  const r = L.interpret(text, orders, ctx);
  const ok = r.kind === kind && (!check || check(r));
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${input}] → ${r.kind} | ${r.ask || r.say || ''}${r.calls ? ' | ' + JSON.stringify(r.calls) : ''}`);
}
// ชื่อเรียก
console.log(L.findWake('น้องมาม่า โต๊ะ 3 เสร็จ'), L.findWake('มาม่าต้มยำกุ้ง'), L.findWake('น้อง มา ม่า'));
t('น้องมาม่า', 'wake');
t('น้องมาม่า ค้างอะไรบ้าง', 'pending');
t('น้องมาม่า มีอะไรต้องทำ', 'pending', r => !r.vague);
t('โต๊ะริมหน้าต่างเหลืออะไร', 'pending', r => r.vague);
t('น้องหม่าม้า โต๊ะ 3 สั่งอะไร', 'table', r => /ต้มยำกุ้ง/.test(r.say) && /ระวัง แพ้ถั่ว/.test(r.say));
t('โต๊ะสาม มีอะไรบ้าง', 'table', r => r.highlight.orders[0] === 'o1');
t('โต๊ะ ๕', 'table', r => r.highlight.orders[0] === 'o5' || r.highlight.orders[0] === 'o2');
t('โต๊ะ เอ 12 สั่งอะไร', 'table', r => r.highlight.orders[0] === 'o3');
t('โต๊ะ 12', 'table', r => r.highlight.orders[0] === 'o3');
t('กะเพราค้างกี่จาน', 'count', r => /ค้าง 4 จาน ที่ โต๊ะ 3, 5 และ กลับบ้าน 7/.test(r.say));
t('มีกะเพรากี่จาน', 'count', r => /4 จาน/.test(r.say));
t('กะเพราหมูกี่จาน', 'count', r => /3 จาน/.test(r.say));
t('บะหมี่กี่จาน', 'count', r => /1 จาน/.test(r.say));
t('กระเพรากี่จาน', 'count', r => /4 จาน/.test(r.say));   // สะกดแบบที่ระบบฟังชอบเขียน
t('โต๊ะ 3 เสร็จ', 'done-table', r => r.calls[0].path === '/api/order/complete' && r.calls[0].body.order_id === 'o1' && r.undo.length === 3);
t('โต๊ะสามเสร็จแล้ว', 'done-table');
t('กะเพราโต๊ะ 5 เสร็จ', 'done-dish', r => r.calls.length === 1 && r.calls[0].body.dishes_id === 'i3');
t('โต๊ะ 3 ต้มยำเสร็จแล้ว', 'done-dish', r => r.calls[0].body.dishes_id === 'i2');
t('กะเพราเสร็จ', 'ask', r => /มี 3 ที่/.test(r.say));
t('กะเพราเสร็จทุกโต๊ะ', 'done-dish', r => r.calls.length === 3);
t('ผัดไทยเสร็จ', 'done-dish', r => r.calls[0].body.dishes_id === 'i5');
t('กลับบ้าน 7 เสร็จ', 'done-table', r => r.calls[0].body.order_id === 'o4');
t('คิว 7 สั่งอะไร', 'table', r => r.highlight.orders[0] === 'o4');
t('โต๊ะ 9 เสร็จ', 'notfound');
t('โต๊ะ 3 เสร็จหรือยัง', 'table');
t('โต๊ะไหนรอนานสุด', 'oldest', r => /โต๊ะ 3 รอ 15 นาที/.test(r.say));
t('ต่อไปทำอะไร', 'next', r => r.batch.qty === 4 && /หมูสับ ไข่ดาว 2 โต๊ะ 3, ไก่ 1 โต๊ะ 5, หมูกรอบ 1 กลับบ้าน 7/.test(r.say));
t('ย้อนกลับ', 'undo');
t('หยุด', 'stop');
t('พูดอีกที', 'repeat');
t('ทำอะไรได้บ้าง', 'help');
t('ข้าวผัดปูกี่จาน', 'notfound');
t('วันนี้อากาศดีจัง', 'unknown');
// ทำทีละชุด: "ต่อไป" แล้ว "เสร็จ"
const nb = L.interpret('ต่อไป', orders, { ...ctx, batchMax: 3 });
console.log(nb.batch.qty === 3 ? 'ok   batch max 3: ' + nb.say : (fail++, 'FAIL batch max ' + nb.say));
const bd = L.interpret('เสร็จ', orders, { ...ctx, batch: nb.batch });
console.log(bd.kind === 'done-dish' && bd.calls.length === 2 ? 'ok   batch done: ' + bd.ask : (fail++, 'FAIL batch done ' + JSON.stringify(bd)));
const nob = L.interpret('เสร็จแล้ว', orders, ctx);
console.log(nob.kind === 'ask' ? 'ok   done without batch asks table' : (fail++, 'FAIL done no batch'));
// จับเวลา
for (const [txt, sec, lab] of [['จับเวลา 4 นาที ของทอด', 240, 'ทอด'], ['ตั้งเวลาสามนาที', 180, ''], ['จับเวลา 90 วิ', 90, ''], ['จับเวลานาทีครึ่ง', 90, ''],
  ['จับเวลา 2 นาทีครึ่ง ไข่', 150, 'ไข่'], ['จับเวลาสิบนาที หมูตุ๋น', 600, 'หมูตุ๋น']]) {
  const r = L.interpret(txt, orders, ctx);
  const ok = r.kind === 'timer' && r.sec === sec && (!lab || r.label.includes(lab));
  if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} [${txt}] → ${r.kind} ${r.sec} "${r.label}" | ${r.say}`);
}
for (const [txt, k] of [['ยกเลิกจับเวลา', 'timer-cancel'], ['เหลืออีกกี่นาที', 'timer-status'], ['จับเวลา', 'ask']]) {
  const r = L.interpret(txt, orders, ctx); const ok = r.kind === k; if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} [${txt}] → ${r.kind}`);
}
const ack = L.interpret('รับทราบ', orders, { ...ctx, ringing: true });
console.log(ack.kind === 'ack' ? 'ok   ack timer' : (fail++, 'FAIL ack'));
// คำเฉพาะร้าน
const words = L.parseWords('กพ = กะเพรา\nต้มยำ=ต้มยำกุ้ง');
const w = L.interpret('กพ กี่จาน', orders, { ...ctx, words });
console.log(w.kind === 'count' && /4 จาน/.test(w.say) ? 'ok   shop words' : (fail++, 'FAIL shop words ' + w.say));
const yes = L.interpret('ใช่ค่ะ', orders, { ...ctx, awaitingConfirm: true });
const no = L.interpret('ไม่ใช่', orders, { ...ctx, awaitingConfirm: true });
console.log(yes.kind === 'yes' && no.kind === 'no' ? 'ok   confirm yes/no' : (fail++, 'FAIL confirm'));
console.log(L.groups(orders).map(g => `${g.name} ${g.qty} [${g.tables.join(', ')}] ${[...g.opts].map(([k, n]) => k + '×' + n).join(' ')}`));
console.log(L.interpret('ค้างอะไรบ้าง', [], ctx).say);
console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
