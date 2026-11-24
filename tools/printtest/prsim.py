#!/usr/bin/env python3
"""เครื่องพิมพ์ใบเสร็จจำลอง (ESC/POS ผ่าน TCP 9100) สำหรับทดสอบการส่งงานของ ED POS

จำลองสิ่งที่เครื่องจริงทำ:
  - รับได้ทีละการเชื่อมต่อ (เครื่องอื่นต่อเข้ามาตอนไม่ว่าง: รอคิว / ถูกตัดทิ้ง)
  - บัฟเฟอร์ของชิปเครือข่ายเล็ก (SO_RCVBUF) + บัฟเฟอร์ในเครื่อง (mcu) จำกัด → TCP ถูกชะลอตามความเร็วพิมพ์จริง
  - พิมพ์ภาพด้วยความเร็วจำกัด (ไบต์/วินาที) · บี๊บ · ตัดกระดาษ
  - ตอบสถานะ DLE EOT ทันทีที่รับ (rt) / ตอบเมื่อพิมพ์ถึง (inorder) / ไม่ตอบเลย (none)
  - GS r 1 ตอบเมื่อพิมพ์ถึง (ถ้า gsr=1)
  - ถูกตัดสายแบบบังคับ (RST): ข้อมูลที่ยังค้างในชิปเครือข่ายหาย · (drop=1: ข้อมูลในเครื่องที่ยังไม่พิมพ์หายด้วย)
บันทึกผลเป็นแผ่นกระดาษ (ตัดหนึ่งครั้ง = หนึ่งแผ่น) พร้อมแถวภาพของแต่ละงาน (อ่านจากไบต์ระบุตัวในแต่ละแถว)
ควบคุมผ่านพอร์ตควบคุม: ส่ง "DUMP\n" ได้ผลเป็น JSON · "RESET\n" ล้างผล
"""
import socket, threading, time, json, sys, struct, argparse, collections

ap = argparse.ArgumentParser()
ap.add_argument('--port', type=int, required=True)
ap.add_argument('--ctl', type=int, required=True)
ap.add_argument('--eot', default='rt', choices=['rt', 'inorder', 'none'])   # ตอบ DLE EOT เมื่อไร
ap.add_argument('--gsr', type=int, default=0)        # ตอบ GS r 1 (ตามลำดับ) ไหม
ap.add_argument('--mcu', type=int, default=16384)    # บัฟเฟอร์ในเครื่อง (ไบต์)
ap.add_argument('--rcvbuf', type=int, default=4096)  # บัฟเฟอร์ชิปเครือข่าย (SO_RCVBUF, Linux คูณ 2)
ap.add_argument('--rate', type=int, default=60000)   # ความเร็วพิมพ์ภาพ (ไบต์/วินาที)
ap.add_argument('--drop', type=int, default=0)       # ถูก RST แล้วทิ้งข้อมูลในเครื่องที่ยังไม่พิมพ์ด้วย
ap.add_argument('--busy', default='queue', choices=['queue', 'refuse', 'fin'])   # มีเครื่องต่อค้างอยู่ → คิว / ตัดทิ้ง (RST) / ปิดแบบปกติ (FIN)
ap.add_argument('--fin', type=int, default=1)        # ได้ FIN แล้วปิดฝั่งตัวเองไหม
ap.add_argument('--beep', type=float, default=0.15)  # เวลาบี๊บต่อครั้ง (วินาที) · พิมพ์หยุดระหว่างบี๊บ
ap.add_argument('--asb', type=int, default=0)        # ส่งสถานะเองทันทีที่ต่อเข้ามา (Auto Status Back)
A = ap.parse_args()

lock = threading.Condition()
buf = collections.deque()      # [(conn_id, bytearray)] ข้อมูลในเครื่องที่ยังไม่พิมพ์
buffered = 0
conns = {}                     # conn_id → socket (ยังเปิดอยู่)
stats = {'conns': 0, 'refused': 0, 'rst': 0, 'fin': 0, 'eot_replies': 0, 'gsr_replies': 0, 'dropped_bytes': 0, 'rx': 0}
pieces = []                    # แผ่นที่ตัดแล้ว
cur = None
def new_piece():
    return {'rows': [], 'garbage': 0, 'foreign': 0, 'beeps': 0, 'feed': 0}
cur = new_piece()
last_activity = time.time()

def reply(cid, b, kind):
    s = conns.get(cid)
    if not s: return
    try:
        s.sendall(bytes([b])); stats[kind] += 1
    except OSError:
        pass

def add_row(row):
    # แถวภาพ: ไบต์ 0 = 0xA5 ระบุงาน · ไบต์ 1 = งาน (|0x80) · ไบต์ 2-3 = แถว (7 บิต |0x80)
    if len(row) >= 4 and row[0] == 0xA5:
        job = row[1] & 0x7F; r = (row[2] & 0x7F) | ((row[3] & 0x7F) << 7)
        rr = cur['rows']
        if rr and rr[-1][0] == job and rr[-1][2] == r - 1: rr[-1][2] = r
        else: rr.append([job, r, r])
    elif any(row): cur['foreign'] += 1      # แถวที่ไม่ใช่ของงานไหน (ข้อมูลเลื่อน/ปนกัน)

# ---------- เครื่องพิมพ์ (อ่านคำสั่งจากบัฟเฟอร์ในเครื่องตามลำดับ) ----------
def engine():
    global buffered, cur, last_activity
    st = 'normal'; need = 0; hdr = bytearray(); raster_wb = 0; rowbuf = bytearray(); cmd = bytearray()
    while True:
        with lock:
            while not buf: lock.wait()
            cid, seg = buf[0]
            n = min(len(seg), 512)
            chunk = bytes(seg[:n]); del seg[:n]
            if not seg: buf.popleft()
            buffered -= n
            lock.notify_all()
        last_activity = time.time()
        i = 0
        while i < len(chunk):
            b = chunk[i]
            if st == 'raster':
                take = min(need, len(chunk) - i)
                part = chunk[i:i + take]; i += take; need -= take
                rowbuf += part
                while len(rowbuf) >= raster_wb:
                    add_row(rowbuf[:raster_wb]); del rowbuf[:raster_wb]
                time.sleep(take / A.rate)
                if need == 0: st = 'normal'; rowbuf = bytearray()
                continue
            if st == 'cmd':
                cmd.append(b); i += 1
                c = bytes(cmd)
                if c[:1] == b'\x1b':
                    if len(c) >= 2 and c[1] == 0x40: st = 'normal'
                    elif len(c) >= 2 and c[1] == 0x64:
                        if len(c) == 3: cur['feed'] += c[2]; time.sleep(c[2] * 0.004); st = 'normal'
                    elif len(c) >= 2 and c[1] == 0x42:
                        if len(c) == 4:
                            cur['beeps'] += c[2]; time.sleep(c[2] * (A.beep + 0.05)); st = 'normal'
                    elif len(c) >= 2: st = 'normal'; cur['garbage'] += 1
                elif c[:1] == b'\x1d':
                    if len(c) >= 2 and c[1] == 0x56:      # GS V m [n]
                        m = c[2] if len(c) >= 3 else None
                        if m is not None and (m in (0, 1, 48, 49) or (m in (65, 66) and len(c) == 4)):
                            time.sleep(0.25); pieces.append(cur); cur = new_piece(); st = 'normal'
                    elif len(c) >= 2 and c[1] == 0x76:    # GS v 0 m xL xH yL yH
                        if len(c) == 8:
                            raster_wb = c[4] | (c[5] << 8); h = c[6] | (c[7] << 8)
                            need = raster_wb * h; st = 'raster' if need else 'normal'; rowbuf = bytearray()
                    elif len(c) >= 2 and c[1] == 0x72:    # GS r n (ตามลำดับ)
                        if len(c) == 3:
                            if A.gsr: reply(cid, 0x00, 'gsr_replies')
                            st = 'normal'
                    elif len(c) >= 2: st = 'normal'; cur['garbage'] += 1
                elif c[:1] == b'\x10':
                    if len(c) == 3:
                        if c[1] == 0x04 and A.eot == 'inorder': reply(cid, 0x16, 'eot_replies')
                        st = 'normal'
                continue
            # normal
            i += 1
            if b in (0x1b, 0x1d, 0x10): st = 'cmd'; cmd = bytearray([b])
            elif b == 0x0a: cur['feed'] += 1
            elif b == 0x00: pass
            else: cur['garbage'] += 1

threading.Thread(target=engine, daemon=True).start()

# ---------- เครือข่าย ----------
def serve_conn(s, cid):
    global buffered, last_activity
    rt_tail = b''
    if A.asb:   # Auto Status Back: 4 ไบต์ (ไบต์แรก bit4=1 bit0,1=0) ส่งเองทันทีที่ต่อ
        try: s.sendall(bytes([0x10, 0x00, 0x00, 0x00]))
        except OSError: pass
    reset = False
    while True:
        with lock:
            while buffered >= A.mcu: lock.wait(0.05)
            space = A.mcu - buffered
        try:
            d = s.recv(min(space, 2048))
        except ConnectionResetError:
            reset = True; break
        except OSError:
            reset = True; break
        if not d:
            break
        stats['rx'] += len(d); last_activity = time.time()
        if A.eot == 'rt':
            w = rt_tail + d
            for k in range(len(w) - 2):
                if w[k] == 0x10 and w[k + 1] == 0x04 and 1 <= w[k + 2] <= 4 and k + 2 >= len(rt_tail):
                    reply(cid, 0x16, 'eot_replies')
            rt_tail = w[-2:]
        with lock:
            buf.append((cid, bytearray(d))); buffered += len(d); lock.notify_all()
    conns.pop(cid, None)
    if reset:
        stats['rst'] += 1
        if A.drop:
            with lock:
                keep = collections.deque()
                for c, seg in buf:
                    if c == cid: stats['dropped_bytes'] += len(seg); buffered -= len(seg)
                    else: keep.append((c, seg))
                buf.clear(); buf.extend(keep); lock.notify_all()
    else:
        stats['fin'] += 1
        if A.fin:
            try: s.shutdown(socket.SHUT_WR)
            except OSError: pass
        else:
            # เครื่องดื้อ: ได้ FIN แล้วไม่ปิดฝั่งตัวเอง (ช่องเชื่อมต่อค้าง) จนกว่าจะถูกตัดสายแบบบังคับ (RST) หรือครบ 30 วิ
            t1 = time.time() + 30
            while time.time() < t1:
                time.sleep(0.05)
                try:
                    s.recv(1)                       # หลัง FIN ได้ b'' เรื่อย ๆ · โดน RST → error
                except OSError:
                    stats['rst'] += 1; break
            else:
                stats['stuck'] = stats.get('stuck', 0) + 1
    try: s.close()
    except OSError: pass

def acceptor():
    L = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    L.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    L.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, A.rcvbuf)
    L.bind(('127.0.0.1', A.port)); L.listen(8)
    active = threading.Event()
    nid = 0
    while True:
        s, _ = L.accept()
        if active.is_set():
            if A.busy == 'refuse':
                stats['refused'] += 1
                s.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0)); s.close(); continue
            if A.busy == 'fin':
                stats['refused'] += 1
                def finclose(s=s):
                    try:
                        s.shutdown(socket.SHUT_WR); s.settimeout(0.2)
                        t1 = time.time() + 0.3
                        while time.time() < t1:
                            if not s.recv(65536): break
                    except OSError: pass
                    s.close()
                threading.Thread(target=finclose, daemon=True).start(); continue
            # คิว: รอจนการเชื่อมต่อก่อนหน้าจบ (ระหว่างนี้ข้อมูลค้างในชิปเครือข่าย)
            while active.is_set(): time.sleep(0.01)
        nid += 1; stats['conns'] += 1
        conns[nid] = s; active.set()
        def run(s=s, cid=nid):
            try: serve_conn(s, cid)
            finally: active.clear()
        threading.Thread(target=run, daemon=True).start()

threading.Thread(target=acceptor, daemon=True).start()

C = socket.socket(); C.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); C.bind(('127.0.0.1', A.ctl)); C.listen(4)
while True:
    s, _ = C.accept()
    cmdl = s.recv(64).decode().strip()
    if cmdl == 'DUMP':
        with lock: pend = buffered
        out = {'stats': stats, 'pieces': pieces, 'open': cur, 'pending': pend, 'idle': time.time() - last_activity}
        s.sendall(json.dumps(out).encode())
    elif cmdl == 'RESET':
        pieces.clear(); cur.update(new_piece())
        for k in stats: stats[k] = 0
        s.sendall(b'{}')
    s.close()
