package com.edpos.kitchen;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognitionService;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * ผู้ช่วยครัว (น้องมาม่า) — มือถือในครัวที่ฟังคำสั่งเสียงแล้วตอบ/กดเสร็จบนจอครัว ED POS
 * · หน้าจอและการเข้าใจคำพูดอยู่ใน assets/kitchen.html + assets/logic.js (ไม่ใช้ AI ทำงานในเครื่อง)
 * · ไฟล์นี้ทำส่วนที่หน้าเว็บทำเองไม่ได้: ฟังเสียงต่อเนื่อง (SpeechRecognizer), พูดภาษาไทย (TextToSpeech),
 *   ส่งคำขอไปเครื่อง ED POS (ไม่ติด CORS), ปุ่มเพิ่ม/ลดเสียง = แตะแล้วพูด
 * · ข้อมูลออเดอร์ใช้ API เดียวกับจอครัว: GET /api/orders, POST /api/order/complete, POST /api/dish/complete
 */
public class MainActivity extends Activity {
    private static final String PREFS = "kitchen";
    private static final int REQ_MIC = 3;
    private static final String DEFAULT_WAKE = "น้องมาม่า, น้องมามา, น้องม่าม้า, น้องหม่าม้า, น้องมาม๊า, น้องมะม่า, น้องมาร์ม่า, น้องหมาม่า";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService net = Executors.newFixedThreadPool(4);
    private SharedPreferences prefs;
    private WebView web;
    private AudioManager audio;

    // ----- เสียงพูด -----
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private boolean speaking = false;
    private String speakId = "";
    private int speakSeq = 0;

    // ----- ฟังเสียง -----
    private SpeechRecognizer rec;
    private boolean wantLoop = false;   // หน้าเว็บสั่งให้ฟังตลอด
    private boolean active = false;     // ระบบฟังกำลังทำงาน
    private boolean onceMode = false;   // รอบนี้คือ "แตะแล้วพูด" (ไม่ต้องเรียกชื่อ)
    private boolean resumed = false;
    private boolean muted = false;
    private boolean rebuild = false;    // ระบบฟังหลุด → สร้างใหม่ตอนเริ่มรอบถัดไป
    private boolean noOffline = false;  // เครื่องไม่มีภาษาไทยออฟไลน์ → ไม่ขอออฟไลน์อีก
    private int quickErrors = 0;
    private long startedAt = 0;
    private final Runnable loop = () -> startRec(false);

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(), "Kit");

        tts = new TextToSpeech(this, st -> {
            ttsReady = st == TextToSpeech.SUCCESS;
            if (ttsReady) { tts.setLanguage(new Locale("th", "TH")); applyTtsStream(); }
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { }
            @Override public void onDone(String id) { ui.post(() -> spokeEnd(id)); }
            @Override public void onError(String id) { ui.post(() -> spokeEnd(id)); }
            @Override public void onStop(String id, boolean interrupted) { ui.post(() -> spokeEnd(id)); }
        });

        if (!hasMic()) requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
        hideBars();
        web.loadUrl("file:///android_asset/kitchen.html");
    }

    // ---------- ตั้งค่า ----------
    private String str(String k, String d) { return prefs.getString(k, d); }
    private boolean muteOn() { return prefs.getBoolean("mute", true); }

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

    // ---------- เสียงพูด ----------
    /** ปิดเสียงปิ๊บของระบบฟัง = ปิดเสียงสื่อ → ให้ผู้ช่วยพูดผ่านช่องเสียงนาฬิกาปลุกแทน (ยังได้ยิน) */
    private int outStream() { return muteOn() ? AudioManager.STREAM_ALARM : AudioManager.STREAM_MUSIC; }

    private void applyTtsStream() {
        if (!ttsReady) return;
        tts.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(muteOn() ? AudioAttributes.USAGE_ALARM : AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
    }

    private void speak(String text, float rate) {
        if (!ttsReady) { js("__kit.tts&&__kit.tts('end')"); return; }
        speaking = true;
        ui.removeCallbacks(loop);
        if (active) { try { rec.cancel(); } catch (Exception ignored) { } active = false; }   // ไม่ฟังเสียงตัวเอง
        speakId = "s" + (++speakSeq);
        Bundle p = new Bundle();
        p.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, outStream());
        tts.setSpeechRate(rate > 0 ? rate : 1f);
        float pitch = 1f;
        try { pitch = (float) new JSONObject(str("extra", "{}")).optDouble("pitch", 1); } catch (Exception ignored) { }
        tts.setPitch(pitch > 0.3f ? pitch : 1f);
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, p, speakId);
        js("__kit.tts&&__kit.tts('start')");
    }

    private void spokeEnd(String id) {
        if (!id.equals(speakId) || !speaking) return;
        speaking = false;
        js("__kit.tts&&__kit.tts('end')");
        next(450);
    }

    private void ding(String kind) {
        try {
            ToneGenerator t = new ToneGenerator(outStream(), 85);
            int tone = "ok".equals(kind) ? ToneGenerator.TONE_PROP_ACK
                    : "err".equals(kind) ? ToneGenerator.TONE_PROP_NACK : ToneGenerator.TONE_PROP_BEEP;
            t.startTone(tone, 160);
            ui.postDelayed(t::release, 600);
        } catch (Exception ignored) { }
    }

    // ---------- ฟังเสียง ----------
    private boolean hasMic() { return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED; }

    private void mic(String state, String msg) {
        js("__kit.mic&&__kit.mic(" + JSONObject.quote(state) + "," + JSONObject.quote(msg == null ? "" : msg) + ")");
    }

    /** ฟังรอบถัดไป (ฟังตลอด) */
    private void next(long ms) {
        ui.removeCallbacks(loop);
        if (wantLoop && resumed && !speaking) ui.postDelayed(loop, ms);
        else if (!active) mic(wantLoop ? "waiting" : "idle", "");
    }

    /** ระบบฟังที่เครื่องตั้งไว้เป็นของ Google อยู่แล้ว → ใช้ตามเครื่อง (เสถียรสุด)
     *  เป็นของยี่ห้ออื่น (ภาษาไทยมักไม่ดี) และมีของ Google ในเครื่อง → ใช้ของ Google (บทเรียนจาก MAMA POS สั่งด้วยเสียง) */
    private static final String[] PREFER = { "com.google.android.googlequicksearchbox", "com.google.android.tts" };
    private ComponentName service() {
        try {
            String def = Settings.Secure.getString(getContentResolver(), "voice_recognition_service");
            if (def == null || def.isEmpty() || def.startsWith("com.google.")) return null;
            List<ResolveInfo> l = getPackageManager().queryIntentServices(new Intent(RecognitionService.SERVICE_INTERFACE), 0);
            for (String p : PREFER) for (ResolveInfo r : l)
                if (r.serviceInfo != null && p.equals(r.serviceInfo.packageName)) return new ComponentName(r.serviceInfo.packageName, r.serviceInfo.name);
        } catch (Exception ignored) { }
        return null;
    }

    private void startRec(boolean once) {
        if (!resumed || speaking) return;
        if (!hasMic()) { mic("noperm", "ยังไม่ได้อนุญาตไมค์ · แตะ ⚙ หรือเปิดแอปใหม่"); requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC); return; }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { mic("error", "เครื่องนี้ไม่มีระบบฟังเสียง (ติดตั้งแอป Google)"); return; }
        try {
            // ใช้ตัวเดิมซ้ำ (cancel ก่อนเริ่ม) · สร้างใหม่ทุกรอบทำให้ Android 12+ ขึ้น error 11 บ่อย
            if (rec == null || rebuild) {
                if (rec != null) { try { rec.destroy(); } catch (Exception ignored) { } }
                ComponentName svc = service();
                rec = svc != null ? SpeechRecognizer.createSpeechRecognizer(this, svc) : SpeechRecognizer.createSpeechRecognizer(this);
                rec.setRecognitionListener(new Listener());
                rebuild = false;
            } else rec.cancel();
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "th-TH");
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "th-TH");
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            if (!noOffline) i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);   // ใช้ภาษาไทยออฟไลน์ถ้าโหลดไว้
            i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
            if (once) {   // แตะแล้วพูด: รอให้พูดจบก่อนตัด
                i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L);
                i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L);
            }
            onceMode = once;
            active = true;
            startedAt = System.currentTimeMillis();
            rec.startListening(i);
            mic(once ? "once" : "listening", "");
        } catch (Exception e) {
            active = false;
            rebuild = true;
            next(1000);
        }
    }

    private void resetRec() {
        if (rec != null) { try { rec.destroy(); } catch (Exception ignored) { } rec = null; }
        active = false;
    }

    private void stopRec() {
        ui.removeCallbacks(loop);
        if (active && rec != null) { try { rec.cancel(); } catch (Exception ignored) { } }
        active = false;
    }

    private void hear(Bundle b, boolean partial) {
        ArrayList<String> list = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (list == null || list.isEmpty()) return;
        try {
            JSONObject o = new JSONObject();
            o.put("partial", partial);
            o.put("once", onceMode);
            o.put("texts", new JSONArray(list));
            js("__kit.hear&&__kit.hear(" + JSONObject.quote(o.toString()) + ")");
        } catch (Exception ignored) { }
    }

    private class Listener implements RecognitionListener {
        @Override public void onReadyForSpeech(Bundle p) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float v) { }
        @Override public void onBufferReceived(byte[] b) { }
        @Override public void onEndOfSpeech() { }
        @Override public void onEvent(int t, Bundle p) { }
        @Override public void onPartialResults(Bundle b) { if (active) hear(b, true); }

        // บางเครื่องส่ง error ตามหลังผลลัพธ์ (หรือส่งซ้ำ) → ไม่สนเหตุการณ์หลังจบรอบ
        @Override public void onResults(Bundle b) {
            if (!active) return;
            active = false;
            quickErrors = 0;
            hear(b, false);
            onceMode = false;
            next(150);
        }

        @Override public void onError(int err) {
            if (!active) return;
            boolean wasOnce = onceMode;
            active = false;
            onceMode = false;
            // ระบบฟังบางเครื่องพังวนเร็วๆ → ค่อยๆ เว้นช่วงนานขึ้น
            if (System.currentTimeMillis() - startedAt < 700) quickErrors++; else quickErrors = 0;
            long back = Math.min(8000, 300L * (1L << Math.min(quickErrors, 5)));
            switch (err) {
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                    if (wasOnce) mic("idle", "ไม่ได้ยินค่ะ");
                    next(Math.max(100, quickErrors > 2 ? back : 100));
                    break;
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                    mic("noperm", "ยังไม่ได้อนุญาตไมค์");
                    break;
                case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                case SpeechRecognizer.ERROR_CLIENT:
                case 11: /* SERVER_DISCONNECTED (Android 12+) → สร้างใหม่ */
                    rebuild = true;
                    next(Math.max(400, back));
                    break;
                case 12: /* LANGUAGE_NOT_SUPPORTED */
                case 13: /* LANGUAGE_UNAVAILABLE: ไม่มีภาษาไทยออฟไลน์ → ใช้แบบออนไลน์ */
                    if (!noOffline) { noOffline = true; next(200); break; }
                    mic("error", "ระบบฟังของเครื่องนี้ไม่มีภาษาไทย (ดูวิธีโหลดในหน้าตั้งค่า)");
                    next(Math.max(5000, back));
                    break;
                case SpeechRecognizer.ERROR_NETWORK:
                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                case SpeechRecognizer.ERROR_SERVER:
                    mic("error", "ระบบฟังต้องใช้เน็ต หรือโหลดภาษาไทยแบบออฟไลน์ (ดูในหน้าตั้งค่า)");
                    next(Math.max(3000, back));
                    break;
                case 10: /* TOO_MANY_REQUESTS */
                    mic("error", "ระบบฟังขอพักสักครู่");
                    next(8000);
                    break;
                default:
                    next(Math.max(1000, back));
            }
        }
    }

    /** ปิดเสียงสื่อ/แจ้งเตือน/ระบบระหว่างฟังตลอด (เสียงปิ๊บของระบบฟังทุกรอบ) */
    private void setMuted(boolean on) {
        if (on == muted) return;
        muted = on;
        int dir = on ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE;
        for (int st : new int[]{AudioManager.STREAM_MUSIC, AudioManager.STREAM_NOTIFICATION, AudioManager.STREAM_SYSTEM}) {
            try { audio.adjustStreamVolume(st, dir, 0); } catch (Exception ignored) { }
        }
    }

    private void applyListening() {
        boolean run = wantLoop && resumed;
        setMuted(run && muteOn());
        if (run) next(200);
        else { stopRec(); mic(wantLoop ? "waiting" : "paused", ""); }
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req == REQ_MIC && hasMic()) applyListening();
    }

    // ---------- วงจรชีวิตแอป ----------
    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        hideBars();
        web.onResume();
        applyListening();
    }

    @Override
    protected void onPause() {
        resumed = false;
        stopRec();
        setMuted(false);   // ออกจากแอป → คืนเสียงมือถือ
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        stopRec();
        resetRec();
        setMuted(false);
        if (tts != null) tts.shutdown();
        net.shutdownNow();
        web.destroy();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        js("(function(){var s=document.querySelector('.sheet.open');if(s)s.classList.remove('open');})()");
        // ไม่ปิดแอปเมื่อกดย้อนกลับ (มือถือประจำครัว)
    }

    // ปุ่มเพิ่ม/ลดเสียง (และปุ่มรีโมตบลูทูธ) = แตะแล้วพูด
    private boolean isTalkKey(int code) {
        return prefs.getBoolean("volKey", true) && (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN
                || code == KeyEvent.KEYCODE_HEADSETHOOK || code == KeyEvent.KEYCODE_CAMERA);
    }

    @Override
    public boolean onKeyDown(int code, KeyEvent e) {
        if (isTalkKey(code)) {
            if (e.getRepeatCount() == 0) js("__kit.key&&__kit.key('ptt')");
            return true;
        }
        return super.onKeyDown(code, e);
    }

    @Override
    public boolean onKeyUp(int code, KeyEvent e) {
        return isTalkKey(code) || super.onKeyUp(code, e);
    }

    private void js(String code) { ui.post(() -> web.evaluateJavascript(code, null)); }

    // ---------- เครือข่าย ----------
    static String readAll(InputStream in) throws Exception {
        if (in == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    /** → {code, text} · code 0 = ติดต่อไม่ได้ */
    static String[] request(String method, String url, String body, int timeout) { return request(method, url, body, timeout, null, null); }

    static String[] request(String method, String url, String body, int timeout, String aiKey) { return request(method, url, body, timeout, aiKey, null); }

    static String[] request(String method, String url, String body, int timeout, String aiKey, String pinToken) {
        HttpURLConnection c = null;
        try {
            if (!url.startsWith("http://") && !url.startsWith("https://")) return new String[]{"0", ""};
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(timeout);
            c.setReadTimeout(timeout);
            c.setUseCaches(false);
            c.setRequestMethod(method);
            if (aiKey != null) c.setRequestProperty("x-goog-api-key", aiKey);
            if (pinToken != null) c.setRequestProperty("x-pin-token", pinToken);
            if ("POST".equals(method)) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream o = c.getOutputStream()) { o.write((body == null ? "" : body).getBytes(StandardCharsets.UTF_8)); }
            }
            int code = c.getResponseCode();
            String text = readAll(code < 400 ? c.getInputStream() : c.getErrorStream());
            return new String[]{String.valueOf(code), text};
        } catch (Exception e) {
            return new String[]{"0", ""};
        } finally {
            if (c != null) c.disconnect();
        }
    }

    // ---------- ช่องทางให้หน้าเว็บเรียกแอป: window.Kit ----------
    private class Bridge {
        /** ค่าทั้งหมดของหน้าตั้งค่า (เก็บเป็น JSON ก้อนเดียว "extra" เพิ่มค่าใหม่ได้โดยไม่ต้องแก้ส่วนนี้)
         *  คีย์ AI ไม่ส่งกลับให้หน้าเว็บ บอกแค่ว่าตั้งแล้วหรือยัง + 4 ตัวท้าย */
        @JavascriptInterface
        public String getConfig() {
            try {
                JSONObject o;
                try { o = new JSONObject(str("extra", "{}")); } catch (Exception e) { o = new JSONObject(); }
                o.put("main", str("main", ""));
                o.put("standby", str("standby", ""));
                o.put("screen", str("screen", ""));
                o.put("mode", str("mode", "wake"));
                o.put("wake", str("wake", DEFAULT_WAKE));
                o.put("confirm", prefs.getBoolean("confirm", true));
                o.put("volKey", prefs.getBoolean("volKey", true));
                o.put("mute", muteOn());
                o.put("rate", prefs.getFloat("rate", 1f));
                String k = str("aiKey", "");
                o.put("aiKeySet", !k.isEmpty());
                o.put("aiKeyHint", k.length() > 4 ? k.substring(k.length() - 4) : "");
                o.put("mgrSet", !str("ownerToken", "").isEmpty());
                o.put("version", version());
                return o.toString();
            } catch (Exception e) { return "{}"; }
        }

        @JavascriptInterface
        public void saveConfig(String json) {
            try {
                JSONObject o = new JSONObject(json);
                SharedPreferences.Editor e = prefs.edit();
                String key = o.optString("aiKey", "").trim();
                if (key.equals("-")) e.remove("aiKey"); else if (!key.isEmpty()) e.putString("aiKey", key);
                for (String drop : new String[]{"aiKey", "aiKeySet", "aiKeyHint", "version"}) o.remove(drop);
                e.putString("main", normalize(o.optString("main")))
                        .putString("standby", normalize(o.optString("standby")))
                        .putString("screen", o.optString("screen", ""))
                        .putString("mode", "ptt".equals(o.optString("mode")) ? "ptt" : "wake")
                        .putString("wake", o.optString("wake", DEFAULT_WAKE))
                        .putBoolean("confirm", o.optBoolean("confirm", true))
                        .putBoolean("volKey", o.optBoolean("volKey", true))
                        .putBoolean("mute", o.optBoolean("mute", true))
                        .putFloat("rate", (float) o.optDouble("rate", 1))
                        .putString("extra", o.toString())
                        .commit();
            } catch (Exception ignored) { }
            ui.post(() -> { setMuted(false); applyTtsStream(); applyListening(); });
        }

        /** ถาม Gemini · ใส่คีย์ที่นี่ (หน้าเว็บไม่เห็นคีย์) · ผลกลับทาง __kit.http(id, code, text) */
        @JavascriptInterface
        public void ai(String id, String model, String body, String keyOverride) {
            net.execute(() -> {
                String key = keyOverride != null && !keyOverride.trim().isEmpty() ? keyOverride.trim() : str("aiKey", "");
                String m = model == null ? "" : model.replaceAll("[^A-Za-z0-9._-]", "");
                String[] r = key.isEmpty() ? new String[]{"401", "{\"error\":{\"message\":\"no key\"}}"}
                        : request("POST", "https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent", body, 20000, key);
                js("__kit.http&&__kit.http(" + JSONObject.quote(id) + "," + r[0] + "," + JSONObject.quote(r[1]) + ")");
            });
        }

        @JavascriptInterface
        public void http(String id, String method, String url, String body, int timeout) {
            net.execute(() -> {
                // โหมดผู้จัดการ: แนบโทเค็นเจ้าของร้านไปกับคำขอถึงเครื่อง ED POS (http:// ในร้านเท่านั้น ไม่ส่งออกอินเทอร์เน็ต)
                String tok = str("ownerToken", "");
                String[] r = request(method, url, body, timeout, null, url != null && url.startsWith("http://") && !tok.isEmpty() ? tok : null);
                js("__kit.http&&__kit.http(" + JSONObject.quote(id) + "," + r[0] + "," + JSONObject.quote(r[1]) + ")");
            });
        }

        /** ทดสอบเครื่อง → {"ok":true,"role":"main","shop":"..."} */
        @JavascriptInterface
        public String testServer(String addr) {
            String b = normalize(addr);
            try {
                JSONObject o = new JSONObject();
                String[] r = b.isEmpty() ? new String[]{"0", ""} : request("GET", b + "/api/role", null, 3000);
                o.put("ok", "200".equals(r[0]));
                if ("200".equals(r[0])) {
                    o.put("role", new JSONObject(r[1]).optString("role"));
                    String[] a = request("GET", b + "/api/auth", null, 3000);
                    if ("200".equals(a[0])) o.put("shop", new JSONObject(a[1]).optString("shopName"));
                }
                return o.toString();
            } catch (Exception e) { return "{\"ok\":false}"; }
        }

        /** รหัสเจ้าของร้าน → "ok" | "bad:ข้อความ" | "offline" */
        @JavascriptInterface
        public String checkAdminPin(String base, String pin) {
            try {
                JSONObject o = new JSONObject();
                o.put("pin", pin);
                o.put("want", "admin");
                String[] r = request("POST", (base == null || base.isEmpty() ? str("main", "") : base) + "/api/login", o.toString(), 3000);
                if ("200".equals(r[0])) return "ok";
                if ("0".equals(r[0])) return "offline";
                String msg = "รหัสไม่ถูกต้อง";
                try { msg = new JSONObject(r[1]).optString("error", msg); } catch (Exception ignored) { }
                return "bad:" + msg;
            } catch (Exception e) { return "offline"; }
        }

        /** เปิดโหมดผู้จัดการ: ใส่รหัสเจ้าของร้าน → เก็บโทเค็นไว้ในแอป (หน้าเว็บไม่เห็น) · "ok" | "bad:ข้อความ" | "offline" */
        @JavascriptInterface
        public String ownerLogin(String base, String pin) {
            try {
                JSONObject o = new JSONObject();
                o.put("pin", pin);
                o.put("want", "admin");
                String[] r = request("POST", (base == null || base.isEmpty() ? str("main", "") : base) + "/api/login", o.toString(), 4000);
                if ("200".equals(r[0])) {
                    String t = new JSONObject(r[1]).optString("token", "");
                    if (t.isEmpty()) return "bad:เซิร์ฟเวอร์ไม่ส่งโทเค็น";
                    prefs.edit().putString("ownerToken", t).commit();
                    return "ok";
                }
                if ("0".equals(r[0])) return "offline";
                String msg = "รหัสไม่ถูกต้อง";
                try { msg = new JSONObject(r[1]).optString("error", msg); } catch (Exception ignored) { }
                return "bad:" + msg;
            } catch (Exception e) { return "offline"; }
        }

        @JavascriptInterface
        public void ownerLogout() { prefs.edit().remove("ownerToken").commit(); }

        @JavascriptInterface
        public void setListening(boolean on) { ui.post(() -> { wantLoop = on; applyListening(); }); }

        @JavascriptInterface
        public void listenOnce() {
            ui.post(() -> {
                ui.removeCallbacks(loop);
                if (speaking) {   // แตะพูดแทรกตอนผู้ช่วยกำลังพูด → หยุดพูดแล้วฟังทันที
                    speaking = false;
                    speakId = "";
                    if (ttsReady) tts.stop();
                    js("__kit.tts&&__kit.tts('end')");
                }
                startRec(true);
            });
        }

        @JavascriptInterface
        public void speak(String text, float rate) { ui.post(() -> MainActivity.this.speak(text, rate)); }

        @JavascriptInterface
        public void stopSpeak() { ui.post(() -> { if (ttsReady) tts.stop(); }); }

        @JavascriptInterface
        public void ding(String kind) { ui.post(() -> MainActivity.this.ding(kind)); }

        @JavascriptInterface
        public String ttsStatus() {
            if (!ttsReady) return "none";
            return tts.isLanguageAvailable(new Locale("th", "TH")) >= TextToSpeech.LANG_AVAILABLE ? "ok" : "nothai";
        }

        @JavascriptInterface
        public void openTtsSettings() {
            ui.post(() -> {
                try { startActivity(new Intent("com.android.settings.TTS_SETTINGS")); } catch (Exception ignored) { }
            });
        }
    }
}
