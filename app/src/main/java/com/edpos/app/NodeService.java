package com.edpos.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.ServiceInfo;
import android.content.res.AssetManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.Process;
import android.system.Os;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;

/**
 * เซิร์ฟเวอร์ ED POS ในแอป (แทน node server.js ใน Termux)
 * · ทำงานในกระบวนการแยก ":node" แบบ foreground service (มีแถบแจ้งเตือนค้างไว้ Android จึงไม่ปิดทิ้ง)
 * · Node.js (nodejs-mobile) เปิดได้ครั้งเดียวต่อกระบวนการ → ปิด/เปิดใหม่ = ฆ่ากระบวนการนี้แล้วเริ่มใหม่
 * · ไฟล์เซิร์ฟเวอร์อยู่ใน assets/edpos คัดลอกไป files/edpos ทุกครั้งที่ติดตั้งแอปรุ่นใหม่
 *   data.json role.json backup/ อยู่ในโฟลเดอร์เดียวกัน และไม่ถูกทับตอนอัปเดต
 * · ถือ wake lock + Wi-Fi lock ไว้ ปิดจอแล้วเซิร์ฟเวอร์ยังตอบเครื่องอื่นได้
 */
public class NodeService extends Service {
    static final String CHANNEL = "server";
    static final int NOTIF_ID = 1;
    static final int PORT = 3000;

    static {
        System.loadLibrary("node");
        System.loadLibrary("native-lib");
    }

    private static native int startNode(String[] args, String logPath);

    private static volatile boolean started = false;
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    /** โฟลเดอร์เซิร์ฟเวอร์และข้อมูลร้าน */
    static File dir(Context c) { return new File(c.getFilesDir(), "edpos"); }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "เซิร์ฟเวอร์ร้าน", NotificationManager.IMPORTANCE_LOW));
        Notification n = notification();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(NOTIF_ID, n);
        } catch (Exception e) {
            // Android ไม่อนุญาตให้เริ่มจากเบื้องหลังตอนนี้ → เปิดแอปแล้วจะเริ่มใหม่เอง
            log("startForeground ไม่ได้: " + e);
            stopSelf();
        }
    }

    private Notification notification() {
        String mode = getSharedPreferences("edpos", MODE_PRIVATE).getString("server", "main");
        String ip = firstIp();
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher_fg)
                .setContentTitle("เซิร์ฟเวอร์ร้านทำงานอยู่ · " + ("standby".equals(mode) ? "เครื่องสำรอง" : "เครื่องหลัก"))
                .setContentText(ip.isEmpty() ? "ยังไม่ได้ต่อ Wi-Fi" : "เครื่องอื่นเชื่อมต่อที่ " + ip)
                .setOngoing(true)
                .setContentIntent(open)
                .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!started) {
            started = true;
            holdLocks();
            Thread t = new Thread(null, this::runNode, "node", 8L * 1024 * 1024);
            t.start();
        }
        return START_STICKY;   // Android ปิดทิ้ง → เปิดให้ใหม่เอง
    }

    private void runNode() {
        File d = dir(this);
        int code;
        try {
            copyAssetsIfNew(d);
            seedIfEmpty(d);
            File logf = new File(d, "server.log");
            if (logf.length() > 1_000_000) logf.renameTo(new File(d, "server.log.old"));
            Os.setenv("PORT", String.valueOf(PORT), true);
            Os.setenv("EDPOS_APP", "1", true);
            Os.setenv("HOME", d.getAbsolutePath(), true);
            Os.setenv("TMPDIR", getCacheDir().getAbsolutePath(), true);
            log("เริ่มเซิร์ฟเวอร์");
            code = startNode(new String[]{"node", new File(d, "server.js").getAbsolutePath()}, logf.getAbsolutePath());
            log("เซิร์ฟเวอร์ปิด รหัส " + code);
        } catch (Throwable e) {
            log("เปิดเซิร์ฟเวอร์ไม่ได้: " + e);
        }
        // Node เปิดซ้ำในกระบวนการเดิมไม่ได้ → ปิดกระบวนการนี้ ให้ Android เปิด service ใหม่ (START_STICKY)
        // หรือแอปเปิดให้ใหม่ตอนกลับมาหน้าจอ
        stopSelf();
        Process.killProcess(Process.myPid());
    }

    /** คัดลอก assets/edpos → files/edpos เมื่อแอปเพิ่งติดตั้ง/อัปเดต (ไม่แตะ data.json role.json backup/) */
    private void copyAssetsIfNew(File d) throws Exception {
        PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
        String stamp = pi.versionCode + "-" + pi.lastUpdateTime;
        File mark = new File(d, "app-version.txt");
        if (mark.exists() && stamp.equals(new String(Files.readAllBytes(mark.toPath()), StandardCharsets.UTF_8).trim())) return;
        d.mkdirs();
        copyAsset(getAssets(), "edpos", d);
        try (FileWriter w = new FileWriter(mark)) { w.write(stamp); }
        log("คัดลอกไฟล์เซิร์ฟเวอร์รุ่น " + pi.versionName);
    }

    /** เครื่องที่ยังไม่มีข้อมูลร้านเลย → เริ่มด้วยตั้งค่าและเมนูของร้านที่ติดมากับแอป (assets/edpos-seed.json)
     *  ไม่มีบิล รหัส หรือโทเค็น LINE · เครื่องที่มี data.json แล้วไม่แตะเด็ดขาด */
    private void seedIfEmpty(File d) {
        File data = new File(d, "data.json");
        if (data.exists()) return;
        try {
            copyAsset(getAssets(), "edpos-seed.json", data);
            log("เริ่มข้อมูลร้านจากตั้งค่าและเมนูที่ติดมากับแอป");
        } catch (Exception e) {
            data.delete();
            log("ไม่มีข้อมูลเริ่มต้น เริ่มเป็นร้านใหม่: " + e.getMessage());
        }
    }

    private static void copyAsset(AssetManager am, String path, File out) throws Exception {
        String[] kids = am.list(path);
        if (kids != null && kids.length > 0) {
            out.mkdirs();
            for (String k : kids) copyAsset(am, path + "/" + k, new File(out, k));
            return;
        }
        File tmp = new File(out.getPath() + ".tmp");
        try (InputStream in = am.open(path); OutputStream o = new FileOutputStream(tmp)) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
        }
        if (!tmp.renameTo(out)) throw new Exception("คัดลอก " + path + " ไม่ได้");
    }

    @SuppressWarnings("deprecation")
    private void holdLocks() {
        try {
            PowerManager pm = getSystemService(PowerManager.class);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "edpos:server");
            wake.acquire();
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "edpos:server");
            wifi.acquire();
        } catch (Exception e) {
            log("ถือ wake lock ไม่ได้: " + e);
        }
    }

    @Override
    public void onDestroy() {
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Exception ignored) { }
        try { if (wifi != null && wifi.isHeld()) wifi.release(); } catch (Exception ignored) { }
        super.onDestroy();
        // ปิดจากหน้าตั้งค่า (เปลี่ยนโหมด/ล้างรหัส) → ปิดกระบวนการ ให้พอร์ต 3000 ว่างก่อนเปิดใหม่
        if (started) Process.killProcess(Process.myPid());
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    /** IP ในวง Wi-Fi ของเครื่องนี้ เช่น 192.168.1.12:3000 (ให้เครื่องอื่นใส่) */
    static String firstIp() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses()))
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) return a.getHostAddress() + ":" + PORT;
            }
        } catch (Exception ignored) { }
        return "";
    }

    private void log(String msg) {
        try (FileWriter w = new FileWriter(new File(dir(this), "app.log"), true)) {
            w.write(new java.util.Date() + " " + msg + "\n");
        } catch (Exception ignored) { }
    }
}
