package com.edpos.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** เปิดเครื่อง / อัปเดตแอป → เปิดเซิร์ฟเวอร์ร้านเอง (เฉพาะเครื่องที่ตั้งเป็นเครื่องหลัก/เครื่องสำรอง) */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        String mode = c.getSharedPreferences("edpos", Context.MODE_PRIVATE).getString("server", "off");
        if ("off".equals(mode)) return;
        try { c.startForegroundService(new Intent(c, NodeService.class)); } catch (Exception ignored) { }
    }
}
