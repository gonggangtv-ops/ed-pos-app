package com.edpos.app;

import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognitionService;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * สั่งอาหารด้วยเสียง: ใช้ตัวแปลงเสียงเป็นข้อความของ Android (ส่วนใหญ่เป็นของ Google ต้องต่อเน็ต)
 * หน้าเว็บในแอปเรียก EdPosApp.voiceStart("th-TH") → ส่งเหตุการณ์กลับทาง window.edposVoice({type, ...})
 * type: start · ready (เริ่มฟัง) · level (ความดังเสียง 0–1) · partial (ข้อความระหว่างพูด) · result (alts = คำที่เป็นไปได้ เรียงจากน่าจะใช่สุด)
 *       · error (code: perm = ไม่อนุญาตไมค์, nomatch = ฟังไม่ออก, net = ไม่มีเน็ต, busy, other) · end
 * Chrome ในมือถือเปิดไมค์ในหน้าเว็บ http:// ของร้านไม่ได้ จึงต้องทำผ่านแอป
 */
class Voice implements RecognitionListener {
    static final int PERM_CODE = 11;
    private final MainActivity act;
    private SpeechRecognizer sr;
    private String pendingLang, pendingBias;
    // เริ่มฟังแล้วพังทันที (ตัวแปลงเสียงไม่รองรับชื่อเมนู/ภาษาไทย) → ลองใหม่ครั้งเดียวแบบไม่ส่งชื่อเมนู + ใช้ตัวแปลงเสียงของเครื่อง แล้วจำไว้
    private static boolean noBias = false, noPrefer = false;
    private String curLang; private boolean curBias, curPrefer, retried;
    private long lastLevel = 0;
    // กำลังฟังรอบนี้อยู่ไหม · บางเครื่องส่ง error ตามหลังผลลัพธ์ (หรือส่งซ้ำ) → ไม่ส่งต่อให้หน้าเว็บ ไม่งั้นไมค์ "เด้ง" ฟังใหม่เอง
    private boolean active = false;

    Voice(MainActivity act) { this.act = act; }

    static boolean available(MainActivity a) {
        try { return SpeechRecognizer.isRecognitionAvailable(a); } catch (Exception e) { return false; }
    }

    /** ตัวแปลงเสียงที่ใช้: ของ Google ก่อน (ภาษาไทยดีสุด) · ไม่มี → ตัวที่เครื่องตั้งไว้ (บางยี่ห้อไม่รองรับภาษาไทย) */
    private static final String[] PREFER = { "com.google.android.googlequicksearchbox", "com.google.android.tts", "com.google.android.as" };
    private ComponentName service() {
        try {
            List<ResolveInfo> l = act.getPackageManager().queryIntentServices(new Intent(RecognitionService.SERVICE_INTERFACE), 0);
            for (String p : PREFER) for (ResolveInfo r : l)
                if (r.serviceInfo != null && p.equals(r.serviceInfo.packageName)) return new ComponentName(r.serviceInfo.packageName, r.serviceInfo.name);
        } catch (Exception ignored) { }
        return null;
    }

    void start(String lang) { start(lang, null); }
    /** จากหน้าเว็บ: เริ่มรอบใหม่ (ล้างการลองซ้ำ) */
    void begin(String lang, String bias) { retried = false; start(lang, bias); }

    /** เรียกบน UI thread เท่านั้น · bias = ชื่อเมนูคั่นบรรทัด (Android 13+ ใช้ช่วยเดาคำ) */
    void start(String lang, String bias) {
        if (act.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingLang = lang; pendingBias = bias;
            act.requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, PERM_CODE);
            return;
        }
        try {
            // สร้างใหม่ทุกครั้ง: ใช้ตัวเดิมเริ่มฟังซ้ำเร็วๆ บางเครื่องค้าง/ตอบ error ทันที
            if (sr != null) { try { sr.destroy(); } catch (Exception ignored) { } }
            ComponentName svc = noPrefer ? null : service();
            sr = svc != null ? SpeechRecognizer.createSpeechRecognizer(act, svc) : SpeechRecognizer.createSpeechRecognizer(act);
            sr.setRecognitionListener(this);
            try { JSONObject o = new JSONObject(); o.put("svc", svc != null ? svc.getPackageName() : "ค่าเริ่มต้นของเครื่อง"); emit("info", o); } catch (Exception ignored) { }
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            // ชื่อเมนูของร้าน → ช่วยให้ตัวแปลงเสียงเลือกคำที่เป็นชื่อเมนู (Android 13+ ตัวที่รองรับ · ไม่รองรับก็ไม่เป็นไร)
            curLang = lang; curPrefer = svc != null; curBias = false;
            if (bias != null && !bias.isEmpty() && Build.VERSION.SDK_INT >= 33 && !noBias) {
                curBias = true;
                pendingBias = bias;
                i.putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, new ArrayList<>(Arrays.asList(bias.split("\n"))));
            }
            i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, act.getPackageName());
            active = true;
            sr.startListening(i);
            emit("start", null);
        } catch (Exception e) { active = false; error("other", e.toString()); }
    }

    void stop() { try { if (sr != null) sr.stopListening(); } catch (Exception ignored) { } }

    void cancel() {
        active = false;
        try { if (sr != null) sr.cancel(); } catch (Exception ignored) { }
        emit("end", null);
    }

    void onPermission(boolean granted) {
        if (granted && pendingLang != null) start(pendingLang, pendingBias);
        else error("perm", "");
        pendingLang = null;
    }

    void destroy() { try { if (sr != null) sr.destroy(); } catch (Exception ignored) { } sr = null; }

    private void emit(String type, JSONObject o) {
        try {
            if (o == null) o = new JSONObject();
            o.put("type", type);
            act.js("window.edposVoice && window.edposVoice(" + o + ")");
        } catch (Exception ignored) { }
    }

    private void error(String code, String msg) { error(code, msg, -1); }
    private void error(String code, String msg, int n) {
        try { JSONObject o = new JSONObject(); o.put("code", code); o.put("msg", msg); if (n >= 0) o.put("n", n); emit("error", o); } catch (Exception ignored) { }
        emit("end", null);
    }

    private JSONObject texts(Bundle b) {
        JSONObject o = new JSONObject();
        try {
            ArrayList<String> l = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            JSONArray a = new JSONArray();
            if (l != null) for (String s : l) a.put(s);
            o.put("alts", a);
            o.put("text", a.length() > 0 ? a.getString(0) : "");
        } catch (Exception ignored) { }
        return o;
    }

    @Override public void onReadyForSpeech(Bundle p) { emit("ready", null); }
    @Override public void onBeginningOfSpeech() { }
    @Override public void onRmsChanged(float db) {
        // ส่งความดังเสียงไม่เกิน 10 ครั้ง/วินาที (ให้วงกลมไมค์ขยับ)
        long now = System.currentTimeMillis();
        if (now - lastLevel < 100) return;
        lastLevel = now;
        try { JSONObject o = new JSONObject(); o.put("v", Math.max(0, Math.min(1, (db + 2) / 12.0))); emit("level", o); } catch (Exception ignored) { }
    }
    @Override public void onBufferReceived(byte[] b) { }
    @Override public void onEndOfSpeech() { }
    @Override public void onError(int e) {
        if (!active) return;
        active = false;
        boolean normal = e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT || e == SpeechRecognizer.ERROR_NETWORK
                || e == SpeechRecognizer.ERROR_NETWORK_TIMEOUT || e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS;
        if (!normal && !retried && (curBias || curPrefer)) {
            retried = true;
            if (curBias) noBias = true; else noPrefer = true;
            Watchdog.log(act, "สั่งด้วยเสียง: error " + e + " → ลองใหม่" + (curBias ? " ไม่ส่งชื่อเมนู" : " ด้วยตัวแปลงเสียงของเครื่อง"));
            start(curLang, curBias ? null : pendingBias);
            return;
        }
        String code = e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "nomatch"
                : e == SpeechRecognizer.ERROR_NETWORK || e == SpeechRecognizer.ERROR_NETWORK_TIMEOUT || e == SpeechRecognizer.ERROR_SERVER ? "net"
                : e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "perm"
                : e == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? "busy" : "other";
        error(code, "error " + e, e);
    }
    @Override public void onResults(Bundle b) {
        if (!active) return;
        active = false;
        emit("result", texts(b)); emit("end", null);
    }
    @Override public void onPartialResults(Bundle b) { if (active) emit("partial", texts(b)); }
    @Override public void onEvent(int t, Bundle b) { }
}
