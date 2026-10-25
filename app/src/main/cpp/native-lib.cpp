// สะพานระหว่าง Java กับ Node.js (nodejs-mobile)
// NodeService เรียก startNode(["node", ".../server.js"], ".../server.log") บนเธรดของตัวเอง
// ฟังก์ชันนี้ทำงานจนกว่าเซิร์ฟเวอร์จะปิด (Node เปิดได้ครั้งเดียวต่อกระบวนการ จึงแยกไว้ในกระบวนการ :node)
#include <jni.h>
#include <fcntl.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "node.h"

extern "C" JNIEXPORT jint JNICALL
Java_com_edpos_app_NodeService_startNode(JNIEnv *env, jclass, jobjectArray args, jstring logPath) {
    // console.log / console.error ของเซิร์ฟเวอร์ → server.log (ใน Android ไม่มีหน้าจอ Termux ให้ดู)
    const char *lp = env->GetStringUTFChars(logPath, nullptr);
    int fd = open(lp, O_WRONLY | O_CREAT | O_APPEND, 0644);
    env->ReleaseStringUTFChars(logPath, lp);
    if (fd >= 0) {
        dup2(fd, STDOUT_FILENO);
        dup2(fd, STDERR_FILENO);
        close(fd);
    }

    // Node ต้องการ argv อยู่ในหน่วยความจำก้อนเดียวต่อกัน
    jsize n = env->GetArrayLength(args);
    std::vector<std::string> parts;
    size_t total = 0;
    for (jsize i = 0; i < n; i++) {
        auto s = (jstring) env->GetObjectArrayElement(args, i);
        const char *c = env->GetStringUTFChars(s, nullptr);
        parts.emplace_back(c);
        env->ReleaseStringUTFChars(s, c);
        env->DeleteLocalRef(s);
        total += parts.back().size() + 1;
    }
    char *buf = (char *) calloc(total, 1);
    std::vector<char *> argv;
    char *p = buf;
    for (auto &s : parts) {
        memcpy(p, s.c_str(), s.size() + 1);
        argv.push_back(p);
        p += s.size() + 1;
    }
    argv.push_back(nullptr);
    return (jint) node::Start((int) n, argv.data());
}
