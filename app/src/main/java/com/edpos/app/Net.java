package com.edpos.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.RouteInfo;

import org.json.JSONObject;

import java.net.ConnectException;
import java.net.Inet4Address;
import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * สถานะ Wi-Fi / เราเตอร์ของเครื่องนี้ (ใช้แยก "เราเตอร์ดับ ให้รอ" ออกจาก "เครื่องหลักดับจริง")
 * · wifi = ต่อ Wi-Fi (หรือสาย LAN) อยู่ไหม
 * · gw = IP เราเตอร์ · gwOk = เราเตอร์ตอบไหม (ต่อพอร์ต 80/53/443 ได้ หรือถูกปฏิเสธทันที = มีเครื่องอยู่)
 */
class Net {
    /** เครือข่าย Wi-Fi/LAN ของเครื่องนี้ (ไม่นับเน็ตมือถือ) หรือ null */
    static Network lan(Context c) {
        try {
            ConnectivityManager cm = c.getSystemService(ConnectivityManager.class);
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities nc = cm.getNetworkCapabilities(n);
                if (nc != null && (nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))) return n;
            }
        } catch (Exception ignored) { }
        return null;
    }

    /** IP เราเตอร์ของวง Wi-Fi ("" = ไม่รู้) */
    static String gateway(Context c) {
        try {
            Network n = lan(c);
            if (n == null) return "";
            LinkProperties lp = c.getSystemService(ConnectivityManager.class).getLinkProperties(n);
            if (lp == null) return "";
            for (RouteInfo r : lp.getRoutes())
                if (r.isDefaultRoute() && r.getGateway() instanceof Inet4Address) return r.getGateway().getHostAddress();
        } catch (Exception ignored) { }
        return "";
    }

    private static String ip(Context c, Network n) {
        try {
            LinkProperties lp = c.getSystemService(ConnectivityManager.class).getLinkProperties(n);
            if (lp != null) for (LinkAddress a : lp.getLinkAddresses())
                if (a.getAddress() instanceof Inet4Address) return a.getAddress().getHostAddress();
        } catch (Exception ignored) { }
        return "";
    }

    /** เครื่องนี้ตอบไหม · ใช้เวลาไม่เกินประมาณ 2 วินาที */
    static boolean alive(Network n, String host) {
        for (int port : new int[]{ 80, 53, 443 }) {
            try (Socket s = n.getSocketFactory().createSocket()) {
                s.connect(new InetSocketAddress(host, port), 700);
                return true;
            } catch (ConnectException e) {
                if (String.valueOf(e.getMessage()).contains("ECONNREFUSED")) return true;   // ปฏิเสธทันที = มีเครื่องอยู่
            } catch (Exception ignored) { }
        }
        return false;
    }

    /** {"wifi":true,"ip":"192.168.1.20","gw":"192.168.1.1","gwOk":true} · gwOk = null ถ้าไม่รู้ IP เราเตอร์ · ห้ามเรียกบน UI thread */
    static String check(Context c) {
        JSONObject o = new JSONObject();
        try {
            Network n = lan(c);
            o.put("wifi", n != null);
            if (n != null) {
                o.put("ip", ip(c, n));
                String gw = gateway(c);
                o.put("gw", gw);
                if (!gw.isEmpty()) o.put("gwOk", alive(n, gw));
            }
        } catch (Exception ignored) { }
        return o.toString();
    }
}
