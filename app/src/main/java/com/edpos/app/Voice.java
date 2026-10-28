package com.edpos.app;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;

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
    private String pendingLang;
    private long lastLevel = 0;
    // กำลังฟังรอบนี้อยู่ไหม · บางเครื่องส่ง error ตามหลังผลลัพธ์ (หรือส่งซ้ำ) → ไม่ส่งต่อให้หน้าเว็บ ไม่งั้นไมค์ "เด้ง" ฟังใหม่เอง
    private boolean active = false;

    Voice(MainActivity act) { this.act = act; }

    static boolean available(MainActivity a) {
        try { return SpeechRecognizer.isRecognitionAvailable(a); } catch (Exception e) { return false; }
    }

    /** เรียกบน UI thread เท่านั้น */
    void start(String lang) {
        if (act.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingLang = lang;
            act.requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, PERM_CODE);
            return;
        }
        try {
            if (sr == null) {
                sr = SpeechRecognizer.createSpeechRecognizer(act);
                sr.setRecognitionListener(this);
            } else sr.cancel();
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            // สั่งหลายเมนูต่อกัน: เว้นจังหวะได้ ~2 วินาทีก่อนจบ (บางเครื่องไม่สนค่านี้)
            i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L);
            i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L);
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
        if (granted && pendingLang != null) start(pendingLang);
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

    private void error(String code, String msg) {
        try { JSONObject o = new JSONObject(); o.put("code", code); o.put("msg", msg); emit("error", o); } catch (Exception ignored) { }
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
        String code = e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "nomatch"
                : e == SpeechRecognizer.ERROR_NETWORK || e == SpeechRecognizer.ERROR_NETWORK_TIMEOUT || e == SpeechRecognizer.ERROR_SERVER ? "net"
                : e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "perm"
                : e == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? "busy" : "other";
        error(code, "error " + e);
    }
    @Override public void onResults(Bundle b) {
        if (!active) return;
        active = false;
        emit("result", texts(b)); emit("end", null);
    }
    @Override public void onPartialResults(Bundle b) { if (active) emit("partial", texts(b)); }
    @Override public void onEvent(int t, Bundle b) { }
}
