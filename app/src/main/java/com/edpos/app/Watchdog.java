package com.edpos.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.BatteryManager;
import android.os.SystemClock;

import java.io.File;
import java.io.FileWriter;

/**
 * ตัวเฝ้าเซิร์ฟเวอร์ร้าน: ปลุกทุก 2 นาที (ปิดจอ/ปิดแอปอยู่ก็ปลุก) แล้วถาม 127.0.0.1:3000/api/role
 * · ตอบ → ปกติ ลบแจ้งเตือน "เซิร์ฟเวอร์ดับ" ถ้ามี
 * · ไม่ตอบครั้งแรก → สั่งเปิด NodeService (ถ้าดับไปแล้วจะเปิดใหม่ ถ้ายังเปิดอยู่จะไม่มีผล)
 * · ไม่ตอบ 2 ครั้งติด (Node ค้าง) → ปิดกระบวนการเซิร์ฟเวอร์ แล้วเปิดใหม่ใน 10 วินาที
 * · Android ไม่ยอมให้เปิดจากเบื้องหลัง (ยังไม่ได้อนุญาตแบต) → แจ้งเตือนให้แตะเปิดแอป
 * ทำงานเฉพาะเครื่องที่ตั้งเป็นเครื่องหลัก/เครื่องสำรอง · บันทึกลง app.log
 */
public class Watchdog extends BroadcastReceiver {
    static final long EVERY = 2 * 60 * 1000L;
    static final String ALERT_CHANNEL = "server-alert";
    static final int ALERT_ID = 2;

    /** ตั้งปลุกครั้งถัดไป (เรียกซ้ำได้ แทนที่ของเดิม) */
    static void schedule(Context c, long delay) {
        try {
            AlarmManager am = c.getSystemService(AlarmManager.class);
            PendingIntent pi = PendingIntent.getBroadcast(c, 0, new Intent(c, Watchdog.class),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            // allowWhileIdle: ปลุกได้แม้มือถืออยู่ในโหมดพักเครื่อง (Doze)
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + delay, pi);
        } catch (Exception e) {
            log(c, "ตั้งตัวเฝ้าเซิร์ฟเวอร์ไม่ได้: " + e);
        }
    }

    static void schedule(Context c) { schedule(c, EVERY); }

    static boolean serverOn(Context c) {
        return !"off".equals(prefs(c).getString("server", "off"));
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("edpos", Context.MODE_PRIVATE);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        Context c = ctx.getApplicationContext();
        if (!serverOn(c)) return;   // เครื่องนี้เป็นหน้าจออย่างเดียว → หยุดเฝ้า (ไม่ตั้งปลุกต่อ)
        PendingResult pr = goAsync();
        new Thread(() -> {
            try { check(c); }
            finally { pr.finish(); }
        }, "watchdog").start();
    }

    private static void check(Context c) {
        SharedPreferences p = prefs(c);
        boolean ok = MainActivity.httpGet(MainActivity.LOCAL + "/api/role" + battery(c), 4000) != null;
        int fails = p.getInt("wdFails", 0);
        if (ok) {
            if (fails > 0) {
                // นับครั้งที่ตัวเฝ้าช่วยเปิดเซิร์ฟเวอร์กลับมา (โชว์ในหน้าตั้งค่าแอป)
                p.edit().putInt("wdFails", 0)
                        .putInt("wdRestarts", p.getInt("wdRestarts", 0) + 1)
                        .putLong("wdLast", System.currentTimeMillis()).apply();
                log(c, "ตัวเฝ้า: เซิร์ฟเวอร์กลับมาทำงานแล้ว");
            }
            c.getSystemService(NotificationManager.class).cancel(ALERT_ID);
            schedule(c);
            return;
        }
        fails++;
        p.edit().putInt("wdFails", fails).apply();
        Intent svc = new Intent(c, NodeService.class);
        if (fails >= 2) svc.setAction(NodeService.ACTION_RESTART);   // ค้าง → ปิดแล้วเปิดใหม่
        try {
            c.startForegroundService(svc);
            log(c, fails >= 2 ? "ตัวเฝ้า: เซิร์ฟเวอร์ไม่ตอบ " + fails + " ครั้งติด → ปิดแล้วเปิดใหม่"
                              : "ตัวเฝ้า: เซิร์ฟเวอร์ไม่ตอบ → สั่งเปิด");
            // ตรวจซ้ำเร็วขึ้น (เปิดใหม่หลังปิดกระบวนการที่ค้าง / ดูว่ากลับมาหรือยัง)
            schedule(c, fails >= 2 ? 10_000 : 30_000);
        } catch (Exception e) {
            // Android 12+ ห้ามเปิด service จากเบื้องหลัง ถ้ายังไม่ได้ "อนุญาตให้ทำงานตลอด"
            log(c, "ตัวเฝ้า: เปิดเซิร์ฟเวอร์จากเบื้องหลังไม่ได้ (" + e.getClass().getSimpleName() + ") → แจ้งเตือนให้เปิดแอป");
            alert(c);
            schedule(c);
        }
    }

    /** แบตเครื่องนี้ส่งไปกับการเช็ก → หน้ายอดขาย > ระบบ เห็นแบตเครื่องหลัก และเตือนเมื่อถอดสายชาร์จ/แบตต่ำ */
    private static String battery(Context c) {
        try {
            BatteryManager bm = c.getSystemService(BatteryManager.class);
            int pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            if (pct < 0 || pct > 100) return "";
            return "?bat=" + pct + "&chg=" + (bm.isCharging() ? 1 : 0);
        } catch (Exception e) { return ""; }
    }

    /** แจ้งเตือนเสียงดัง: เซิร์ฟเวอร์ดับ แตะเพื่อเปิด (เปิดแอปแล้วเซิร์ฟเวอร์จะเปิดเอง) */
    private static void alert(Context c) {
        try {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            nm.createNotificationChannel(new NotificationChannel(ALERT_CHANNEL, "เซิร์ฟเวอร์ร้านดับ", NotificationManager.IMPORTANCE_HIGH));
            PendingIntent open = PendingIntent.getActivity(c, 0,
                    new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification n = new Notification.Builder(c, ALERT_CHANNEL)
                    .setSmallIcon(R.mipmap.ic_launcher_fg)
                    .setContentTitle("⚠ เซิร์ฟเวอร์ร้านดับ")
                    .setContentText("แตะเพื่อเปิดใหม่ · เครื่องอื่นสั่งอาหารไม่ได้จนกว่าจะเปิด")
                    .setContentIntent(open)
                    .setAutoCancel(true)
                    .build();
            nm.notify(ALERT_ID, n);
        } catch (Exception ignored) { }
    }

    static void log(Context c, String msg) {
        try (FileWriter w = new FileWriter(new File(NodeService.dir(c), "app.log"), true)) {
            w.write(new java.util.Date() + " " + msg + "\n");
        } catch (Exception ignored) { }
    }
}
