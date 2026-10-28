package com.edpos.app;

import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognitionService;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * สั่งอาหารด้วยเสียง: ใช้ตัวแปลงเสียงเป็นข้อความของ Android (ส่วนใหญ่เป็นของ Google ต้องต่อเน็ต)
 * หน้าเว็บในแอปเรียก EdPosApp.voiceStart("th-TH") → ส่งเหตุการณ์กลับทาง window.edposVoice({type, ...})
 * type: start · info (svc = ตัวแปลงเสียงที่ใช้) · ready (เริ่มฟัง) · level (ความดังเสียง 0–1) · partial (ข้อความระหว่างพูด)
 *       · result (alts = คำที่เป็นไปได้ เรียงจากน่าจะใช่สุด)
 *       · error (code: perm = ไม่อนุญาตไมค์, nomatch = ฟังไม่ออก, net = ไม่มีเน็ต, busy, other · n = รหัสของ Android) · end
 * Chrome ในมือถือเปิดไมค์ในหน้าเว็บ http:// ของร้านไม่ได้ จึงต้องทำผ่านแอป
 *
 * ข้อควรระวัง (จากเครื่องจริง):
 * · อย่าทำลายแล้วสร้างตัวแปลงเสียงใหม่ทุกครั้ง → Android 12+ ตอบ error 11 (ตัวแปลงเสียงหลุด) บ่อย · ใช้ตัวเดิม สร้างใหม่เฉพาะตอนหลุด
 * · error 11 / 5 / 8 (หลุด / ค้าง / ไม่ว่าง) → สร้างใหม่แล้วลองซ้ำเองครั้งเดียว ไม่ต้องให้พนักงานกดใหม่
 */
class Voice implements RecognitionListener {
    static final int PERM_CODE = 11;
    private static final int ERR_SERVER_DISCONNECTED = 11;   // SpeechRecognizer.ERROR_SERVER_DISCONNECTED (Android 12+)
    private final MainActivity act;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private SpeechRecognizer sr;
    private boolean rebuild = false;        // ตัวแปลงเสียงหลุด → สร้างใหม่ตอนเริ่มครั้งถัดไป
    private static boolean noPrefer = false; // ใช้ Google ตรงๆ แล้วหลุดซ้ำ → กลับไปใช้ตัวที่เครื่องตั้งไว้
    private String pendingLang, curLang;
    private boolean curPrefer, retried;
    private long lastLevel = 0;
    // กำลังฟังรอบนี้อยู่ไหม · บางเครื่องส่ง error ตามหลังผลลัพธ์ (หรือส่งซ้ำ) → ไม่ส่งต่อให้หน้าเว็บ ไม่งั้นไมค์ "เด้ง" ฟังใหม่เอง
    private boolean active = false;

    Voice(MainActivity act) { this.act = act; }

    static boolean available(MainActivity a) {
        try { return SpeechRecognizer.isRecognitionAvailable(a); } catch (Exception e) { return false; }
    }

    /** ตัวแปลงเสียงที่เครื่องตั้งไว้เป็นของ Google อยู่แล้ว → ใช้ตามเครื่อง (เสถียรสุด)
     *  เป็นของยี่ห้ออื่น (ภาษาไทยมักไม่ดี) และมีของ Google ในเครื่อง → ใช้ของ Google */
    private static final String[] PREFER = { "com.google.android.googlequicksearchbox", "com.google.android.tts" };
    private ComponentName service() {
        if (noPrefer) return null;
        try {
            String def = Settings.Secure.getString(act.getContentResolver(), "voice_recognition_service");
            if (def == null || def.isEmpty() || def.startsWith("com.google.")) return null;
            List<ResolveInfo> l = act.getPackageManager().queryIntentServices(new Intent(RecognitionService.SERVICE_INTERFACE), 0);
            for (String p : PREFER) for (ResolveInfo r : l)
                if (r.serviceInfo != null && p.equals(r.serviceInfo.packageName)) return new ComponentName(r.serviceInfo.packageName, r.serviceInfo.name);
        } catch (Exception ignored) { }
        return null;
    }
    private String serviceName(ComponentName c) {
        if (c != null) return c.getPackageName();
        try {
            String def = Settings.Secure.getString(act.getContentResolver(), "voice_recognition_service");
            if (def != null && !def.isEmpty()) return def.split("/")[0];
        } catch (Exception ignored) { }
        return "ค่าเริ่มต้นของเครื่อง";
    }

    /** จากหน้าเว็บ: เริ่มรอบใหม่ */
    void begin(String lang) { retried = false; start(lang); }

    /** เรียกบน UI thread เท่านั้น */
    void start(String lang) {
        if (act.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingLang = lang;
            act.requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, PERM_CODE);
            return;
        }
        try {
            if (sr == null || rebuild) {
                if (sr != null) { try { sr.destroy(); } catch (Exception ignored) { } }
                ComponentName svc = service();
                sr = svc != null ? SpeechRecognizer.createSpeechRecognizer(act, svc) : SpeechRecognizer.createSpeechRecognizer(act);
                sr.setRecognitionListener(this);
                rebuild = false; curPrefer = svc != null;
                try { JSONObject o = new JSONObject(); o.put("svc", serviceName(svc)); emit("info", o); } catch (Exception ignored) { }
            } else sr.cancel();
            curLang = lang;
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, act.getPackageName());
            active = true;
            sr.startListening(i);
            emit("start", null);
        } catch (Exception e) { active = false; rebuild = true; error("other", e.toString(), -1); }
    }

    // ---------- หน้าต่างฟังของ Google (ทางเลือก) ----------
    // บางเครื่อง ตัวแปลงเสียงเบื้องหลังได้ยินเสียงแต่แปลภาษาไทยไม่ได้ (error 7 ตลอด เช่น ใช้ตัวแปลงในเครื่องที่ไม่มีภาษาไทย)
    // → เปิดหน้าต่างไมค์ของ Google เอง (ใช้ระบบเดียวกับพิมพ์ด้วยเสียง) ได้ผลแล้วส่งกลับหน้าเว็บแบบเดียวกัน
    static final int DIALOG_REQ = 12;
    private boolean dialogOn = false;
    boolean dialogAvailable() {
        try { return new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).resolveActivity(act.getPackageManager()) != null; }
        catch (Exception e) { return false; }
    }
    void dialog(String lang) {
        try {
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            i.putExtra(RecognizerIntent.EXTRA_PROMPT, "พูดชื่อเมนู + ตัวเลือก + จำนวน");
            dialogOn = true;
            act.startActivityForResult(i, DIALOG_REQ);
            emit("start", null);
        } catch (Exception e) { dialogOn = false; error("other", e.toString(), -1); }
    }
    void onDialogResult(boolean ok, Intent data) {
        if (!dialogOn) return;
        dialogOn = false;
        ArrayList<String> l = data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (ok && l != null && !l.isEmpty()) {
            try {
                JSONObject o = new JSONObject(); JSONArray a = new JSONArray();
                for (String x : l) a.put(x);
                o.put("alts", a); o.put("text", l.get(0));
                emit("result", o);
            } catch (Exception ignored) { }
            emit("end", null);
        } else error("cancel", "", -1);   // ปิดหน้าต่าง/ไม่ได้ยิน
    }

    void stop() { try { if (sr != null) sr.stopListening(); } catch (Exception ignored) { } }

    void cancel() {
        active = false;
        try { if (sr != null) sr.cancel(); } catch (Exception ignored) { }
        emit("end", null);
    }

    void onPermission(boolean granted) {
        if (granted && pendingLang != null) begin(pendingLang);
        else error("perm", "", -1);
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

    @Override public void onReadyForSpeech(Bundle p) { if (active) emit("ready", null); }
    @Override public void onBeginningOfSpeech() { }
    @Override public void onRmsChanged(float db) {
        // ส่งความดังเสียงไม่เกิน 10 ครั้ง/วินาที (ให้วงกลมไมค์ขยับ)
        long now = System.currentTimeMillis();
        if (!active || now - lastLevel < 100) return;
        lastLevel = now;
        try { JSONObject o = new JSONObject(); o.put("v", Math.max(0, Math.min(1, (db + 2) / 12.0))); emit("level", o); } catch (Exception ignored) { }
    }
    @Override public void onBufferReceived(byte[] b) { }
    @Override public void onEndOfSpeech() { }
    @Override public void onError(int e) {
        if (!active) return;
        active = false;
        // หลุด / ค้าง / ไม่ว่าง → สร้างตัวแปลงเสียงใหม่แล้วลองเองครั้งเดียว (หน้าเว็บยังเห็นว่ากำลังฟังอยู่)
        boolean flaky = e == ERR_SERVER_DISCONNECTED || e == SpeechRecognizer.ERROR_CLIENT || e == SpeechRecognizer.ERROR_RECOGNIZER_BUSY;
        if (flaky) {
            rebuild = true;
            if (e == ERR_SERVER_DISCONNECTED && curPrefer) noPrefer = true;   // ใช้ Google ตรงๆ แล้วหลุด → ใช้ตามเครื่อง
            if (!retried) {
                retried = true;
                Watchdog.log(act, "สั่งด้วยเสียง: error " + e + " → สร้างตัวแปลงเสียงใหม่แล้วลองอีกครั้ง");
                ui.postDelayed(() -> start(curLang), 400);
                return;
            }
        }
        String code = e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "nomatch"
                : e == SpeechRecognizer.ERROR_NETWORK || e == SpeechRecognizer.ERROR_NETWORK_TIMEOUT || e == SpeechRecognizer.ERROR_SERVER ? "net"
                : e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "perm"
                : e == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? "busy"
                : e == ERR_SERVER_DISCONNECTED ? "lost" : "other";
        error(code, "error " + e, e);
    }
    @Override public void onResults(Bundle b) {
        if (!active) return;
        active = false; retried = false;
        emit("result", texts(b)); emit("end", null);
    }
    @Override public void onPartialResults(Bundle b) { if (active) emit("partial", texts(b)); }
    @Override public void onEvent(int t, Bundle b) { }
}
