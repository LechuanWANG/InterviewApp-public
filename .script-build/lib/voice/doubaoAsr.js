"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcribeWithDoubao = transcribeWithDoubao;
const crypto_1 = require("crypto");
const SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit";
const QUERY_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query";
async function transcribeWithDoubao(params) {
    const apiKey = process.env.DOUBAO_TTS_API_KEY;
    const resourceId = process.env.DOUBAO_ASR_RESOURCE_ID || "volc.seedasr.auc";
    if (!apiKey)
        throw new Error("DOUBAO_TTS_API_KEY 未配置");
    const sampleRate = params.sampleRate ?? 16000;
    const channel = params.channel ?? 1;
    const bits = params.bits ?? 16;
    const reqId = (0, crypto_1.randomUUID)();
    const b64 = params.wav.toString("base64");
    const headers = {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
        "X-Api-Resource-Id": resourceId,
        "X-Api-Request-Id": reqId,
        "X-Api-Sequence": "-1",
    };
    // Step 1: Submit
    const submitRes = await fetch(SUBMIT_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
            user: { uid: reqId },
            audio: {
                format: "wav",
                codec: "raw",
                rate: sampleRate,
                bits,
                channel,
                data: b64,
            },
            request: {
                model_name: "bigmodel",
                enable_itn: true,
                enable_punc: true,
                enable_ddc: false,
                show_utterances: false,
            },
        }),
    });
    if (!submitRes.ok) {
        const err = await submitRes.text();
        throw new Error(`Doubao ASR submit 失败: ${submitRes.status} ${err}`);
    }
    const submitData = await submitRes.json();
    if (submitData?.header?.code && submitData.header.code !== 0) {
        throw new Error(`Doubao ASR submit 错误: ${submitData.header.message || JSON.stringify(submitData)}`);
    }
    // Step 2: Poll query until result
    const queryHeaders = {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
        "X-Api-Resource-Id": resourceId,
        "X-Api-Request-Id": reqId,
    };
    const maxWait = 60000;
    const interval = 2000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
        await new Promise((r) => setTimeout(r, interval));
        const queryRes = await fetch(QUERY_URL, {
            method: "POST",
            headers: queryHeaders,
            body: "{}",
        });
        if (!queryRes.ok)
            continue;
        const data = await queryRes.json();
        // 错误码：还在处理中或其他错误
        if (data?.header?.code && data.header.code !== 0) {
            continue;
        }
        // 有 result.text 且非空才算完成
        const text = data?.result?.text;
        if (typeof text === "string" && text.trim().length > 0)
            return text;
        // result 存在但 text 为空，可能还在处理，也可能真的识别为空
        // 检查 audio_info.duration 是否存在——有 duration 说明处理完了
        if (data?.audio_info?.duration !== undefined) {
            return text || "";
        }
    }
    throw new Error("Doubao ASR 查询超时 (60s)");
}
