package com.edpos.app;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * ค้นหาเครื่องหลักในวง Wi-Fi เดียวกัน (เราเตอร์ดับแล้วแจก IP ใหม่ / ย้ายร้าน)
 * 1) ตะโกนถาม (UDP broadcast "EDPOS?" พอร์ต 3000) → เซิร์ฟเวอร์ร้านทุกเครื่องตอบว่าเป็นเครื่องหลัก/สำรอง ของร้านไหน
 * 2) ไม่มีใครตอบ (บางเราเตอร์/บางเครื่องทิ้ง broadcast) → ไล่ถาม http://x.x.x.1–254:3000/api/role ทีละหลายเครื่องพร้อมกัน
 * รับเฉพาะเครื่องหลัก (role = main) ของร้านเดียวกัน (shop = รหัสร้านจาก /api/role ที่จำไว้ตอนต่อได้ครั้งก่อน · ยังไม่เคยจำ = รับร้านแรกที่เจอ)
 */
class Discovery {
    static final int PORT = 3000;

    /** คืน "http://192.168.1.50:3000" หรือ null · ใช้เวลาไม่เกินประมาณ 10 วินาที · ห้ามเรียกบน UI thread */
    static String findMain(String shop) { return find(shop)[0]; }

    /** คืน { เครื่องหลัก, เครื่องสำรอง } (ไม่เจอ = null) · เจอเครื่องหลักแล้วหยุดค้น · เครื่องสำรองที่เจอระหว่างทางเก็บไว้ (ใช้ขึ้นปุ่มให้รับงานแทน) */
    static String[] find(String shop) {
        AtomicReference<String> sb = new AtomicReference<>();
        String u = udp(shop, sb);
        if (u == null) u = scan(shop, sb);
        return new String[]{ u, sb.get() };
    }

    private static boolean sameShop(JSONObject j, String shop) {
        return j != null && (shop == null || shop.isEmpty() || shop.equals(j.optString("shop")));
    }
    private static boolean match(JSONObject j, String shop) {
        return sameShop(j, shop) && "main".equals(j.optString("role"));
    }
    private static void noteStandby(JSONObject j, String shop, String url, AtomicReference<String> sb) {
        if (sameShop(j, shop) && "standby".equals(j.optString("role")) && j.optBoolean("hasData", true)) sb.compareAndSet(null, url);
    }

    /** IPv4 ของเครื่องนี้ใน Wi-Fi/LAN พร้อม broadcast address */
    private static List<InterfaceAddress> lan() {
        List<InterfaceAddress> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress a : ni.getInterfaceAddresses())
                    if (a.getAddress() instanceof Inet4Address && a.getAddress().isSiteLocalAddress()) out.add(a);
            }
        } catch (Exception ignored) { }
        return out;
    }

    private static String udp(String shop, AtomicReference<String> sb) {
        try (DatagramSocket s = new DatagramSocket()) {
            s.setBroadcast(true);
            s.setSoTimeout(400);
            byte[] q = "EDPOS?".getBytes(StandardCharsets.UTF_8);
            List<InetAddress> targets = new ArrayList<>();
            targets.add(InetAddress.getByName("255.255.255.255"));
            for (InterfaceAddress a : lan()) if (a.getBroadcast() != null) targets.add(a.getBroadcast());
            long end = System.currentTimeMillis() + 1800;
            int round = 0;
            byte[] buf = new byte[2048];
            while (System.currentTimeMillis() < end) {
                if (round++ % 3 == 0) for (InetAddress t : targets) {   // ส่งซ้ำทุก ~1.2 วินาที เผื่อแพ็กเก็ตหาย
                    try { s.send(new DatagramPacket(q, q.length, t, PORT)); } catch (Exception ignored) { }
                }
                try {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    s.receive(p);
                    JSONObject j = new JSONObject(new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8));
                    String url = "http://" + p.getAddress().getHostAddress() + ":" + j.optInt("port", PORT);
                    if (match(j, shop)) return url;
                    noteStandby(j, shop, url, sb);
                } catch (SocketTimeoutException ignored) {
                } catch (Exception ignored) { }
            }
        } catch (Exception ignored) { }
        return null;
    }

    private static String scan(String shop, AtomicReference<String> sb) {
        List<String> hosts = new ArrayList<>();
        List<String> mine = new ArrayList<>();
        for (InterfaceAddress a : lan()) {
            byte[] ip = a.getAddress().getAddress();
            mine.add(a.getAddress().getHostAddress());
            String pre = (ip[0] & 255) + "." + (ip[1] & 255) + "." + (ip[2] & 255) + ".";
            // ไล่จากเลขใกล้เครื่องนี้ก่อน (DHCP มักแจกเลขติดๆ กัน)
            int me = ip[3] & 255;
            for (int d = 1; d < 255; d++) for (int x : new int[]{ me - d, me + d })
                if (x >= 1 && x <= 254 && !hosts.contains(pre + x)) hosts.add(pre + x);
        }
        hosts.removeAll(mine);
        if (hosts.isEmpty()) return null;
        AtomicReference<String> found = new AtomicReference<>();
        ExecutorService pool = Executors.newFixedThreadPool(48);
        for (String h : hosts) pool.execute(() -> {
            if (found.get() != null) return;
            String base = "http://" + h + ":" + PORT;
            String r = MainActivity.httpGet(base + "/api/role", 700);
            if (r == null) return;
            try {
                JSONObject j = new JSONObject(r);
                if (match(j, shop)) found.compareAndSet(null, base); else noteStandby(j, shop, base, sb);
            } catch (Exception ignored) { }
        });
        pool.shutdown();
        try {
            long end = System.currentTimeMillis() + 9000;
            while (found.get() == null && !pool.awaitTermination(100, TimeUnit.MILLISECONDS) && System.currentTimeMillis() < end) { }
        } catch (InterruptedException ignored) { }
        pool.shutdownNow();
        return found.get();
    }

    /** รหัสร้านจากคำตอบ /api/role (ไว้จำ) */
    static String shopOf(String roleJson) {
        try { return new JSONObject(roleJson).optString("shop", ""); } catch (Exception e) { return ""; }
    }
}
