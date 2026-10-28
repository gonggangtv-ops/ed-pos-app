package com.edpos.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.RandomAccessFile;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * ED POS — แอปหน้าจอของร้าน
 * เปิดหน้าเว็บของเซิร์ฟเวอร์ ED POS (node server.js บนแท็บเล็ตเครื่องหลัก) แบบเต็มจอ จอไม่ดับ
 * · ครั้งแรก: หน้าตั้งค่า (assets/app.html) ใส่ IP เครื่องหลัก/เครื่องสำรอง และเลือกหน้าที่จะเปิด
 * · เปิดตั้งค่าอีกครั้ง: แตะมุมซ้ายบนของจอ 5 ครั้งติดกัน (ถามรหัสเจ้าของร้านถ้าเซิร์ฟเวอร์ตอบ)
 * · ต่อเครื่องหลักไม่ได้ → ลองเครื่องสำรอง → ไม่ได้ทั้งคู่ ขึ้นหน้าออฟไลน์และลองใหม่เองทุก 5 วินาที
 * · ส่วนที่หน้าเว็บทำเองไม่ได้ในแอป: เสียงอ่านภาษาไทย (Android TextToSpeech), บันทึกไฟล์ลง Download, เลือกไฟล์
 *   หน้าเว็บเรียกผ่าน window.EdPosApp (ดู public/app-bridge.js ในเซิร์ฟเวอร์ ED POS)
 * · โหมดเซิร์ฟเวอร์ (prefs "server" = main | standby): เครื่องนี้รันเซิร์ฟเวอร์ ED POS เองใน NodeService ไม่ต้องมี Termux
 *   main = เครื่องหลัก เปิดหน้าเว็บจาก 127.0.0.1 · standby = เครื่องสำรอง คัดลอกข้อมูลจากเครื่องหลักที่ใส่ IP ไว้
 */
public class MainActivity extends Activity {
    private static final String PREFS = "edpos";
    private static final int REQ_FILE = 7;
    private static final String SETUP_URL = "file:///android_asset/app.html";
    static final String LOCAL = "http://127.0.0.1:" + NodeService.PORT;   // เซิร์ฟเวอร์ในเครื่องนี้

    private WebView web;
    private SharedPreferences prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private final Voice voice = new Voice(this);   // สั่งอาหารด้วยเสียง
    private volatile boolean ttsReady = false;
    private ValueCallback<Uri[]> fileCb;
    private String base = "";          // เครื่องที่เปิดอยู่ เช่น http://192.168.1.34:3000
    private boolean onServer = false;  // กำลังแสดงหน้าเว็บของเซิร์ฟเวอร์ (ไม่ใช่หน้าตั้งค่า/ออฟไลน์)
    private int cornerTaps = 0;
    private long cornerFirst = 0;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // เสียงกริ่งจอครัวดังได้โดยไม่ต้องแตะจอก่อน
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " EdPosApp/" + version());
        CookieManager.getInstance().setAcceptCookie(true);
        web.addJavascriptInterface(new Bridge(), "EdPosApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, ua, disposition, mime, length) -> download(url, disposition, mime));

        tts = new TextToSpeech(this, st -> {
            ttsReady = st == TextToSpeech.SUCCESS;
            if (ttsReady) tts.setLanguage(new Locale("th", "TH"));
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { js("window.__edposTts&&__edposTts('" + id + "','start')"); }
            @Override public void onDone(String id) { js("window.__edposTts&&__edposTts('" + id + "','end')"); }
            @Override public void onError(String id) { js("window.__edposTts&&__edposTts('" + id + "','error')"); }
        });

        hideBars();
        if (serverOn()) { ensureServer(); askNotifications(); }
        if (!hasTarget()) showPage("setup");
        else openServer();
    }

    // ---------- ตั้งค่า ----------
    private String main() { return prefs.getString("main", ""); }
    private String standby() { return prefs.getString("standby", ""); }
    private String screen() { return prefs.getString("page", "order"); }
    private boolean lockApp() { return prefs.getBoolean("lock", false); }
    private String serverMode() { return prefs.getString("server", "off"); }
    private boolean serverOn() { return !"off".equals(serverMode()); }
    /** มีที่ให้เปิดหน้าร้านแล้ว (ใส่ IP เครื่องหลัก หรือเครื่องนี้เป็นเครื่องหลักเอง) */
    private boolean hasTarget() { return "main".equals(serverMode()) || !main().isEmpty(); }

    // ---------- เซิร์ฟเวอร์ในเครื่องนี้ ----------
    private void ensureServer() {
        if (!serverOn()) return;
        try { startForegroundService(new Intent(this, NodeService.class)); }
        catch (Exception e) { toast("เปิดเซิร์ฟเวอร์ไม่ได้: " + e.getMessage()); }
        Watchdog.schedule(this);   // ตัวเฝ้าเซิร์ฟเวอร์ทำงานต่อแม้ปิดแอป/ปิดจอ
    }

    /** เครื่องหลัก/สำรองที่ยังไม่ได้ "อนุญาตให้ทำงานตลอด" → เปิดหน้าขออนุญาตของ Android ให้เอง
     *  (ไม่อนุญาต = Android ปิดเซิร์ฟเวอร์ตอนปิดจอนานๆ และตัวเฝ้าเปิดใหม่จากเบื้องหลังไม่ได้)
     *  ถามซ้ำได้ทุก 12 ชม. ถ้ากดไม่อนุญาตไว้ (เพิ่งตั้งโหมดเซิร์ฟเวอร์ = ล้าง batAsk ให้ถามเลย) */
    private void askBattery() {
        if (!serverOn() || batteryOk()) return;
        long last = prefs.getLong("batAsk", 0), now = System.currentTimeMillis();
        if (now - last < 12 * 3600_000L) return;
        prefs.edit().putLong("batAsk", now).apply();
        ui.postDelayed(this::openBatteryRequest, 1200);
    }

    private void openBatteryRequest() {
        try { startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()))); }
        catch (Exception e) {
            try { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); }
            catch (Exception e2) { toast("เปิดหน้าตั้งค่าแบตเตอรี่ไม่ได้"); }
        }
    }

    /** ปิดแล้วเปิดใหม่ (Node เปิดซ้ำในกระบวนการเดิมไม่ได้ ต้องรอกระบวนการเก่าปิดและพอร์ตว่าง) */
    private void restartServer() {
        stopService(new Intent(this, NodeService.class));
        ui.postDelayed(this::ensureServer, 1500);
    }

    /** role.json ของเซิร์ฟเวอร์: เขียนเฉพาะตอนเปลี่ยนโหมดในหน้าตั้งค่า
     *  (ถ้าเขียนทุกครั้งที่เปิด เครื่องสำรองที่รับงานแทนไปแล้วจะกลับเป็นเครื่องสำรองเอง ร้านไม่มีเครื่องหลัก) */
    private void writeRole(String mode, String peer) {
        File d = NodeService.dir(this);
        d.mkdirs();
        try (FileWriter w = new FileWriter(new File(d, "role.json"))) {
            JSONObject o = new JSONObject();
            o.put("role", "standby".equals(mode) ? "standby" : "main");
            o.put("peer", peer == null ? "" : peer);
            w.write(o.toString());
        } catch (Exception e) { toast("บันทึกโหมดเซิร์ฟเวอร์ไม่ได้: " + e.getMessage()); }
    }

    /** ขออนุญาตแจ้งเตือน (Android 13+) ก่อน แล้วค่อยขออนุญาตแบต ไม่ให้หน้าขออนุญาตซ้อนกัน */
    private void askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 9);
        else askBattery();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == 9) askBattery();
        if (code == Voice.PERM_CODE) voice.onPermission(results.length > 0 && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED);
    }

    private boolean batteryOk() {
        try { return ((PowerManager) getSystemService(POWER_SERVICE)).isIgnoringBatteryOptimizations(getPackageName()); }
        catch (Exception e) { return false; }
    }

    /** ท้ายไฟล์ log ของเซิร์ฟเวอร์ (ไว้ดูตอนเปิดไม่ขึ้น) */
    private String tail(String name, int max) {
        File f = new File(NodeService.dir(this), name);
        if (!f.exists()) return "";
        try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
            long start = Math.max(0, r.length() - max);
            r.seek(start);
            byte[] b = new byte[(int) (r.length() - start)];
            r.readFully(b);
            return new String(b, StandardCharsets.UTF_8);
        } catch (Exception e) { return ""; }
    }

    private String pagePath() {
        switch (screen()) {
            case "kds": return "/kds.html";
            case "admin": return "/admin.html";
            default: return "/order.html";
        }
    }

    /** "192.168.1.34" → "http://192.168.1.34:3000" */
    static String normalize(String a) {
        a = a == null ? "" : a.trim();
        while (a.endsWith("/")) a = a.substring(0, a.length() - 1);
        if (a.isEmpty()) return "";
        if (!a.startsWith("http://") && !a.startsWith("https://")) a = "http://" + a;
        String host = a.replaceFirst("^https?://", "");
        if (!host.matches(".*:\\d+$")) a = a + ":3000";
        return a;
    }

    private String version() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (Exception e) { return "1"; }
    }

    // ---------- เปิดเซิร์ฟเวอร์: เครื่องหลัก → เครื่องสำรอง → หน้าออฟไลน์ ----------
    // โหมดเซิร์ฟเวอร์: เครื่องหลักเปิดจากเครื่องนี้เลย (รอเซิร์ฟเวอร์ในเครื่องพร้อมได้ถึง 40 วินาที)
    //                เครื่องสำรองลองเครื่องหลักก่อน ไม่ได้ค่อยใช้เครื่องนี้
    private void openServer() {
        final String mode = serverMode();
        final List<String> tryList = new ArrayList<>();
        if ("main".equals(mode)) tryList.add(LOCAL);
        else {
            if (!main().isEmpty()) tryList.add(main());
            if ("standby".equals(mode)) tryList.add(LOCAL);
            else if (!standby().isEmpty()) tryList.add(standby());
        }
        if ("main".equals(mode)) showPage("starting");
        new Thread(() -> {
            String ok = null;
            for (String b : tryList) {
                // เครื่องอื่น: ลองซ้ำ (เครื่องสำรอง 3 ครั้ง · หน้าจออย่างเดียว 2 ครั้ง) เผื่อ Wi-Fi เพิ่งต่อ/เครื่องหลักกำลังเปิด
                boolean local = LOCAL.equals(b);
                int tries = local ? 80 : "standby".equals(mode) ? 3 : 2;
                for (int t = 0; t < tries && ok == null; t++) {
                    if (httpGet(b + "/api/role", 3000) != null) ok = b;
                    else if (local) { ensureServerFromThread(); try { Thread.sleep(500); } catch (InterruptedException ignored) { } }
                    else if (t < tries - 1) { try { Thread.sleep(1500); } catch (InterruptedException ignored) { } }
                }
                if (ok != null) break;
            }
            final String found = ok;
            ui.post(() -> {
                if (found == null) { showPage("offline"); return; }
                base = found;
                onServer = true;
                web.loadUrl(found + pagePath());
                applyLock(true);
            });
        }).start();
    }

    private long lastEnsure = 0;
    private void ensureServerFromThread() {
        if (System.currentTimeMillis() - lastEnsure < 10000) return;
        lastEnsure = System.currentTimeMillis();
        ui.post(this::ensureServer);
    }

    private void showPage(String mode) {
        onServer = false;
        if (!"offline".equals(mode)) applyLock(false);
        web.loadUrl(SETUP_URL + "?t=" + System.currentTimeMillis() + "#" + mode);   // ?t= ให้โหลดใหม่ทุกครั้ง
    }

    /** ล็อกแอป (ปักหมุดหน้าจอ) · ออกจากหน้าตั้งค่าแล้วล็อกใหม่ */
    private void applyLock(boolean on) {
        try {
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            boolean pinned = am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
            if (on && lockApp() && !pinned) startLockTask();
            if ((!on || !lockApp()) && pinned) stopLockTask();
        } catch (Exception ignored) { }
    }

    // ---------- เต็มจอ ----------
    @SuppressWarnings("deprecation")
    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    // แตะมุมซ้ายบน 5 ครั้งภายใน 3 วินาที → หน้าตั้งค่า
    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        if (ev.getActionMasked() == MotionEvent.ACTION_DOWN) {
            float zone = 72 * getResources().getDisplayMetrics().density;
            long now = System.currentTimeMillis();
            if (ev.getX() < zone && ev.getY() < zone) {
                if (now - cornerFirst > 3000) { cornerFirst = now; cornerTaps = 0; }
                if (++cornerTaps >= 5) { cornerTaps = 0; if (onServer) showPage("locked"); }
            } else cornerTaps = 0;
        }
        return super.dispatchTouchEvent(ev);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (onServer && web.canGoBack()) { web.goBack(); return; }
        if (!onServer && hasTarget()) { openServer(); return; }   // ออกจากหน้าตั้งค่า = กลับไปหน้าร้าน
        // หน้าหลักของร้าน: ไม่ปิดแอปเมื่อพนักงานกดย้อนกลับ
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideBars();
        ensureServer();   // เซิร์ฟเวอร์ถูกปิดไป (เช่น Android ปิดทิ้ง) → เปิดใหม่ตอนกลับมาที่แอป
        askBattery();     // แอปเปิดค้างเป็นวันๆ (onCreate ไม่เกิดอีก) → เตือนซ้ำทุก 12 ชม. ถ้ายังไม่อนุญาต
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        voice.destroy();
        web.destroy();
        super.onDestroy();
    }

    void js(String code) {
        ui.post(() -> web.evaluateJavascript(code, null));
    }

    private void toast(String msg) {
        ui.post(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
    }

    // ---------- เครือข่าย ----------
    /** GET → เนื้อหา หรือ null ถ้าติดต่อไม่ได้/ไม่ใช่ 200 */
    static String httpGet(String url, int timeout) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(timeout);
            c.setReadTimeout(timeout);
            c.setUseCaches(false);
            if (c.getResponseCode() != 200) return null;
            return readAll(c.getInputStream());
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    // ---------- บันทึกไฟล์ลงโฟลเดอร์ Download ----------
    private String saveBytes(String name, String mime, byte[] data) {
        try {
            name = name.replaceAll("[\\\\/:*?\"<>|]", "-");
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                v.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (u == null) return "err:สร้างไฟล์ไม่ได้";
                try (OutputStream o = getContentResolver().openOutputStream(u)) { o.write(data); }
                v.clear();
                v.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(u, v, null, null);
                return "ok:Download/" + name;
            }
            File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            File f = new File(dir, name);
            try (FileOutputStream o = new FileOutputStream(f)) { o.write(data); }
            return "ok:" + f.getAbsolutePath();
        } catch (Exception e) {
            return "err:" + e.getMessage();
        }
    }

    /** ลิงก์ดาวน์โหลดธรรมดา (เช่น หลังร้าน > สำรองข้อมูล > ดาวน์โหลด) */
    private void download(String url, String disposition, String mime) {
        if (url.startsWith("blob:") || url.startsWith("data:")) return;   // จัดการใน app-bridge.js
        toast("กำลังดาวน์โหลด…");
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(5000);
                c.setReadTimeout(30000);
                InputStream in = c.getInputStream();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                in.close();
                String cd = c.getHeaderField("Content-Disposition");
                String name = URLUtil.guessFileName(url, cd != null ? cd : disposition, mime);
                String r = saveBytes(name, c.getContentType(), out.toByteArray());
                toast(r.startsWith("ok:") ? "บันทึกแล้ว: " + r.substring(3) : "บันทึกไม่ได้: " + r.substring(4));
            } catch (Exception e) {
                toast("ดาวน์โหลดไม่ได้: " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    // ---------- เลือกไฟล์ (นำเข้าเมนู / กู้คืน / รูปใบเสร็จ) ----------
    @SuppressWarnings("deprecation")
    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_FILE && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCb = null;
        }
    }

    private class Chrome extends WebChromeClient {
        @SuppressWarnings("deprecation")
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = cb;
            String type = "*/*";
            for (String t : p.getAcceptTypes()) if (t != null && t.startsWith("image/")) type = "image/*";
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(type);
            try {
                startActivityForResult(Intent.createChooser(i, "เลือกไฟล์"), REQ_FILE);
                return true;
            } catch (Exception e) {
                fileCb = null;
                toast("เปิดหน้าเลือกไฟล์ไม่ได้ (ถ้าล็อกแอปอยู่ ให้ปลดล็อกในหน้าตั้งค่าก่อน)");
                return false;
            }
        }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            String s = r.getUrl().getScheme();
            if ("http".equals(s) || "https".equals(s) || "file".equals(s)) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); } catch (Exception ignored) { }
            return true;
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            if (url.startsWith("http")) {
                onServer = true;
                // จำเครื่องที่ใช้อยู่ (failover.js อาจพาไปเครื่องสำรองที่ไม่ได้ใส่ไว้ในแอป)
                try { Uri u = Uri.parse(url); base = u.getScheme() + "://" + u.getAuthority(); } catch (Exception ignored) { }
            }
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            // หน้าหลักโหลดไม่ขึ้น (เซิร์ฟเวอร์ดับ/Wi-Fi หลุด) → หน้าออฟไลน์ ลองใหม่เอง
            if (r.isForMainFrame() && r.getUrl().toString().startsWith("http")) showPage("offline");
        }
    }

    // ---------- ช่องทางให้หน้าเว็บเรียกแอป: window.EdPosApp ----------
    private class Bridge {
        @JavascriptInterface
        public String getConfig() {
            try {
                JSONObject o = new JSONObject();
                o.put("main", main());
                o.put("standby", standby());
                o.put("page", screen());
                o.put("lock", lockApp());
                o.put("version", version());
                o.put("current", base);
                o.put("server", serverMode());
                o.put("ip", NodeService.firstIp());
                o.put("battery", batteryOk());
                return o.toString();
            } catch (Exception e) { return "{}"; }
        }

        @JavascriptInterface
        public void saveConfig(String json) {
            try {
                JSONObject o = new JSONObject(json);
                String oldMode = serverMode(), oldMain = main();
                String mode = o.optString("server", "off");
                if (!mode.equals("main") && !mode.equals("standby")) mode = "off";
                String newMain = "main".equals(mode) ? "" : normalize(o.optString("main"));
                String newStandby = normalize(o.optString("standby"));
                prefs.edit()
                        .putString("server", mode)
                        .putString("main", newMain)
                        .putString("standby", newStandby)
                        .putString("page", o.optString("page", "order"))
                        .putBoolean("lock", o.optBoolean("lock", false))
                        .commit();
                // เปลี่ยนโหมดเซิร์ฟเวอร์ / เปลี่ยนเครื่องหลักของเครื่องสำรอง → ตั้ง role.json แล้วเปิดเซิร์ฟเวอร์ใหม่
                if (!mode.equals(oldMode) || ("standby".equals(mode) && !newMain.equals(oldMain))) {
                    if ("off".equals(mode)) ui.post(() -> stopService(new Intent(MainActivity.this, NodeService.class)));
                    else {
                        writeRole(mode, "standby".equals(mode) ? newMain : newStandby);
                        ui.post(() -> { MainActivity.this.restartServer(); prefs.edit().putLong("batAsk", 0).apply(); askNotifications(); });
                    }
                }
            } catch (Exception ignored) { }
            ui.postDelayed(MainActivity.this::openServer, 300);
        }

        /** ทดสอบเครื่อง → {"ok":true,"role":"main","shop":"..."} หรือ {"ok":false} */
        @JavascriptInterface
        public String testServer(String addr) {
            String b = normalize(addr);
            try {
                JSONObject o = new JSONObject();
                o.put("url", b);
                String r = b.isEmpty() ? null : httpGet(b + "/api/role", 3000);
                o.put("ok", r != null);
                if (r != null) {
                    JSONObject role = new JSONObject(r);
                    o.put("role", role.optString("role"));
                    String a = httpGet(b + "/api/auth", 3000);
                    if (a != null) o.put("shop", new JSONObject(a).optString("shopName"));
                }
                return o.toString();
            } catch (Exception e) { return "{\"ok\":false}"; }
        }

        /** หน้าเครื่องสำรองเปลี่ยน IP เครื่องหลักแล้ว → จำไว้ เปิดหน้าครั้งต่อไปไปที่เครื่องหลักใหม่ตรงๆ */
        @JavascriptInterface
        public void setMain(String addr) {
            String m = normalize(addr);
            if (!m.isEmpty() && "standby".equals(serverMode())) prefs.edit().putString("main", m).apply();
        }

        /** ยืนยันรหัสเจ้าของร้านกับเซิร์ฟเวอร์ → "ok" | "bad:ข้อความ" | "offline" */
        @JavascriptInterface
        public String checkAdminPin(String pin) {
            String b = base.isEmpty() ? main() : base;
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(b + "/api/login").openConnection();
                c.setConnectTimeout(3000);
                c.setReadTimeout(3000);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                JSONObject o = new JSONObject();
                o.put("pin", pin);
                o.put("want", "admin");
                try (OutputStream out = c.getOutputStream()) { out.write(o.toString().getBytes(StandardCharsets.UTF_8)); }
                int code = c.getResponseCode();
                if (code == 200) return "ok";
                InputStream es = c.getErrorStream();
                String msg = es != null ? new JSONObject(readAll(es)).optString("error", "รหัสไม่ถูกต้อง") : "รหัสไม่ถูกต้อง";
                // เซิร์ฟเวอร์ที่ยังไม่มีรหัส (เช่น เครื่องสำรองที่ยังไม่เคยคัดลอกข้อมูล) → ให้เข้าตั้งค่าแก้ IP ได้
                if (msg.contains("ยังไม่ได้ตั้งรหัส")) return "ok";
                return "bad:" + msg;
            } catch (Exception e) {
                return "offline";
            } finally {
                if (c != null) c.disconnect();
            }
        }

        @JavascriptInterface
        public void retry() { ui.post(MainActivity.this::openServer); }

        // ----- สั่งอาหารด้วยเสียง (ดู Voice.java) -----
        @JavascriptInterface
        public boolean voiceAvailable() { return Voice.available(MainActivity.this); }
        @JavascriptInterface
        public void voiceStart(String lang) { ui.post(() -> voice.begin(lang == null || lang.isEmpty() ? "th-TH" : lang, null)); }
        @JavascriptInterface
        public void voiceStartBias(String lang, String bias) { ui.post(() -> voice.begin(lang == null || lang.isEmpty() ? "th-TH" : lang, bias)); }
        @JavascriptInterface
        public void voiceStop() { ui.post(voice::stop); }
        @JavascriptInterface
        public void voiceCancel() { ui.post(voice::cancel); }

        // ----- โหมดเซิร์ฟเวอร์ -----
        /** ขอให้ Android ไม่ปิดแอปเพื่อประหยัดแบต (สำคัญมากกับเครื่องหลัก) */
        @JavascriptInterface
        public void requestBattery() { ui.post(MainActivity.this::openBatteryRequest); }

        /** สถานะเซิร์ฟเวอร์ในเครื่องนี้ (หน้าตั้งค่า): ทำงานไหม · เขตเวลาตรงกับมือถือไหม · ตัวเฝ้าช่วยเปิดกี่ครั้ง */
        @JavascriptInterface
        public String serverStatus() {
            try {
                JSONObject o = new JSONObject();
                String r = httpGet(LOCAL + "/api/role", 2000);
                o.put("up", r != null);
                if (r != null) {
                    JSONObject role = new JSONObject(r);
                    if (role.has("tz")) o.put("tz", role.optInt("tz"));
                    o.put("role", role.optString("role"));
                }
                o.put("restarts", prefs.getInt("wdRestarts", 0));
                o.put("last", prefs.getLong("wdLast", 0));
                return o.toString();
            } catch (Exception e) { return "{\"up\":false}"; }
        }

        @JavascriptInterface
        public void restartServer() { ui.post(() -> { MainActivity.this.restartServer(); ui.postDelayed(MainActivity.this::openServer, 500); }); }

        /** ลืมรหัสเจ้าของร้าน: ทำได้จากเครื่องหลักเท่านั้น · เซิร์ฟเวอร์ล้างรหัสทั้งหมดแล้วแจ้งเข้า LINE */
        @JavascriptInterface
        public String resetPins() {
            if (!"main".equals(serverMode())) return "เครื่องนี้ไม่ใช่เครื่องหลัก";
            try { new File(NodeService.dir(MainActivity.this), "reset-pin.flag").createNewFile(); }
            catch (Exception e) { return "ล้างรหัสไม่ได้: " + e.getMessage(); }
            ui.post(() -> { MainActivity.this.restartServer(); ui.postDelayed(MainActivity.this::openServer, 500); });
            return "ok";
        }

        @JavascriptInterface
        public String serverLog() { return tail("error.log", 2000) + tail("app.log", 1500) + tail("server.log", 3000); }

        @JavascriptInterface
        public void openSetup() { ui.post(() -> showPage("setup")); }

        // ----- เสียงอ่าน (แทน speechSynthesis ที่ WebView ไม่มี) -----
        @JavascriptInterface
        public void speak(String id, String text, float rate) {
            if (!ttsReady) { js("window.__edposTts&&__edposTts('" + id + "','error')"); return; }
            tts.setSpeechRate(rate > 0 ? rate : 1f);
            tts.speak(text, TextToSpeech.QUEUE_ADD, null, id);
        }

        @JavascriptInterface
        public void stopSpeak() { if (ttsReady) tts.stop(); }

        /** "ok" = มีเสียงไทย · "nothai" = มีเครื่องอ่านแต่ไม่มีภาษาไทย · "none" = ไม่มีเครื่องอ่าน */
        @JavascriptInterface
        public String ttsStatus() {
            if (!ttsReady) return "none";
            int r = tts.isLanguageAvailable(new Locale("th", "TH"));
            return r >= TextToSpeech.LANG_AVAILABLE ? "ok" : "nothai";
        }

        @JavascriptInterface
        public void openTtsSettings() {
            ui.post(() -> {
                try { startActivity(new Intent("com.android.settings.TTS_SETTINGS")); }
                catch (Exception e) { toast("เปิดหน้าตั้งค่าเสียงอ่านไม่ได้"); }
            });
        }

        // ----- บันทึกไฟล์ (ปุ่มส่งออกเมนู ฯลฯ) -----
        @JavascriptInterface
        public String saveFile(String name, String mime, String base64) {
            try { return saveBytes(name, mime, Base64.decode(base64, Base64.DEFAULT)); }
            catch (Exception e) { return "err:" + e.getMessage(); }
        }

        @JavascriptInterface
        public String appVersion() { return version(); }
    }
}
