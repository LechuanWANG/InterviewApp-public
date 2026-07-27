"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.synthesizeWithDoubao = synthesizeWithDoubao;
const crypto_1 = require("crypto");
const ws_1 = __importDefault(require("ws"));
const DOUBAO_TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts";
const DOUBAO_TTS_WS_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/tts/bidirection";
const EVT_START_CONN = 1;
const EVT_FINISH_CONN = 2;
const EVT_START_SESSION = 100;
const EVT_FINISH_SESSION = 102;
const EVT_TASK_REQUEST = 200;
const EVT_CONN_STARTED = 50;
const EVT_CONN_FAILED = 51;
const EVT_CONN_FINISHED = 52;
const EVT_SESSION_STARTED = 150;
const EVT_SESSION_FINISHED = 152;
const EVT_SESSION_FAILED = 153;
const EVT_TTS_RESPONSE = 352;
const EVT_TTS_ENDED = 359;
async function synthesizeWithDoubao(params) {
    const apiKey = process.env.DOUBAO_TTS_API_KEY;
    const voice = params.voice ||
        process.env.DOUBAO_TTS_VOICE ||
        "zh_female_shuangkuaisisi_moon_bigtts";
    const format = params.format || "mp3";
    const speedRatio = params.speedRatio ?? 1.0;
    const uid = params.uid || "career-consultation";
    if (!apiKey) {
        throw new Error("DOUBAO_TTS_API_KEY 未配置");
    }
    if (params.resourceId || !isClonedVoice(voice)) {
        return synthesizeBuiltInVoiceWithDoubaoWs({
            text: params.text,
            voice,
            resourceId: params.resourceId || process.env.DOUBAO_TTS_RESOURCE_ID || "seed-tts-1.0",
            format,
        });
    }
    return synthesizeWithDoubaoHttpV1({
        text: params.text,
        voice,
        format,
        speedRatio,
        uid,
        apiKey,
    });
}
async function synthesizeWithDoubaoHttpV1(params) {
    const response = await fetch(DOUBAO_TTS_ENDPOINT, {
        method: "POST",
        headers: {
            "x-api-key": params.apiKey,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            app: {
                cluster: process.env.DOUBAO_TTS_CLUSTER || "volcano_icl",
            },
            user: {
                uid: params.uid,
            },
            audio: {
                voice_type: params.voice,
                encoding: params.format,
                speed_ratio: params.speedRatio,
                volume_ratio: 1.0,
                pitch_ratio: 1.0,
            },
            request: {
                reqid: (0, crypto_1.randomUUID)(),
                text: params.text,
                operation: "query",
            },
        }),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Doubao TTS 请求失败 (${response.status})${errorText ? `: ${errorText.slice(0, 300)}` : ""}`);
    }
    if (contentType.includes("application/json") || contentType.includes("text/json")) {
        const json = (await response.json());
        const audioBase64 = extractAudioBase64(json);
        if (!audioBase64) {
            throw new Error(`Doubao TTS 未返回可用音频: ${JSON.stringify(json).slice(0, 300)}`);
        }
        return {
            audio: Buffer.from(audioBase64, "base64"),
            mime: mimeOf(params.format),
        };
    }
    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);
    if (!audio.length) {
        throw new Error("Doubao TTS 返回空音频");
    }
    return {
        audio,
        mime: contentType || mimeOf(params.format),
    };
}
function encodeFrame(event, sessionId, payload) {
    const header = Buffer.from([0x11, 0x14, 0x10, 0x00]);
    const eventBuf = Buffer.alloc(4);
    eventBuf.writeInt32BE(event, 0);
    const parts = [header, eventBuf];
    if (sessionId !== null) {
        const sid = Buffer.from(sessionId, "utf-8");
        const sidSize = Buffer.alloc(4);
        sidSize.writeInt32BE(sid.length, 0);
        parts.push(sidSize, sid);
    }
    const payloadBuf = typeof payload === "string" ? Buffer.from(payload, "utf-8") : payload;
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeInt32BE(payloadBuf.length, 0);
    parts.push(sizeBuf, payloadBuf);
    return Buffer.concat(parts);
}
function decodeFrame(buf) {
    const headerSize = (buf[0] & 0x0f) * 4;
    const msgType = (buf[1] >> 4) & 0x0f;
    const flags = buf[1] & 0x0f;
    let offset = headerSize;
    if (msgType === 0x0f) {
        const errorCode = buf.readInt32BE(offset);
        offset += 4;
        const payloadSize = buf.readInt32BE(offset);
        offset += 4;
        const payload = buf.slice(offset, offset + payloadSize);
        return { msgType, flags, event: 0, sessionId: "", payload, errorCode };
    }
    let event = 0;
    if (flags & 0x04) {
        event = buf.readInt32BE(offset);
        offset += 4;
    }
    let sessionId = "";
    if (msgType === 4 || msgType === 0xb || msgType === 0x9) {
        const sidSize = buf.readInt32BE(offset);
        offset += 4;
        sessionId = buf.slice(offset, offset + sidSize).toString("utf-8");
        offset += sidSize;
    }
    const payloadSize = buf.readInt32BE(offset);
    offset += 4;
    const payload = buf.slice(offset, offset + payloadSize);
    return { msgType, flags, event, sessionId, payload };
}
function synthesizeBuiltInVoiceWithDoubaoWs(params) {
    const apiKey = process.env.DOUBAO_TTS_API_KEY;
    if (!apiKey)
        throw new Error("DOUBAO_TTS_API_KEY 未配置");
    const sessionId = (0, crypto_1.randomUUID)();
    const connectId = (0, crypto_1.randomUUID)();
    return new Promise((resolve, reject) => {
        const audioChunks = [];
        let settled = false;
        const ws = new ws_1.default(DOUBAO_TTS_WS_ENDPOINT, {
            headers: {
                "X-Api-App-Key": apiKey,
                "X-Api-Key": apiKey,
                "X-Api-Resource-Id": params.resourceId,
                "X-Api-Connect-Id": connectId,
            },
        });
        const settle = (err) => {
            if (settled)
                return;
            settled = true;
            try {
                ws.close();
            }
            catch { }
            if (err)
                reject(err);
            else if (audioChunks.length === 0)
                reject(new Error("Doubao TTS 返回空音频"));
            else
                resolve({ audio: Buffer.concat(audioChunks), mime: mimeOf(params.format) });
        };
        const timer = setTimeout(() => settle(new Error("Doubao TTS 超时 (30s)")), 30000);
        ws.on("open", () => {
            ws.send(encodeFrame(EVT_START_CONN, null, "{}"));
        });
        ws.on("message", (data) => {
            try {
                const msg = decodeFrame(data);
                if (msg.msgType === 0x0f) {
                    return settle(new Error(`Doubao TTS 错误 code=${msg.errorCode} msg=${msg.payload.toString("utf-8")}`));
                }
                switch (msg.event) {
                    case EVT_CONN_STARTED: {
                        const payload = JSON.stringify({
                            event: EVT_START_SESSION,
                            namespace: "BidirectionalTTS",
                            req_params: {
                                speaker: params.voice,
                                audio_params: { format: params.format, sample_rate: 24000 },
                            },
                        });
                        ws.send(encodeFrame(EVT_START_SESSION, sessionId, payload));
                        break;
                    }
                    case EVT_SESSION_STARTED: {
                        const taskPayload = JSON.stringify({
                            event: EVT_TASK_REQUEST,
                            namespace: "BidirectionalTTS",
                            req_params: {
                                speaker: params.voice,
                                text: params.text,
                                audio_params: { format: params.format, sample_rate: 24000 },
                                operation: "submit",
                            },
                        });
                        ws.send(encodeFrame(EVT_TASK_REQUEST, sessionId, taskPayload));
                        setTimeout(() => {
                            try {
                                ws.send(encodeFrame(EVT_FINISH_SESSION, sessionId, JSON.stringify({ event: EVT_FINISH_SESSION, namespace: "BidirectionalTTS" })));
                            }
                            catch { }
                        }, 200);
                        break;
                    }
                    case EVT_TTS_RESPONSE: {
                        if (msg.payload.length > 0)
                            audioChunks.push(msg.payload);
                        break;
                    }
                    case EVT_TTS_ENDED:
                    case EVT_SESSION_FINISHED: {
                        ws.send(encodeFrame(EVT_FINISH_CONN, null, "{}"));
                        break;
                    }
                    case EVT_CONN_FINISHED: {
                        clearTimeout(timer);
                        settle();
                        break;
                    }
                    case EVT_SESSION_FAILED:
                    case EVT_CONN_FAILED: {
                        settle(new Error("Doubao TTS 失败: " + msg.payload.toString("utf-8")));
                        break;
                    }
                }
            }
            catch (e) {
                settle(e instanceof Error ? e : new Error(String(e)));
            }
        });
        ws.on("error", (e) => {
            clearTimeout(timer);
            settle(e);
        });
        ws.on("close", () => {
            clearTimeout(timer);
            if (!settled) {
                if (audioChunks.length > 0)
                    settle();
                else
                    settle(new Error("Doubao TTS WebSocket 被关闭但未收到音频"));
            }
        });
    });
}
function isClonedVoice(voice) {
    return voice.startsWith("S_") || voice.startsWith("saturn_");
}
function extractAudioBase64(payload) {
    const direct = typeof payload.data === "string" ? payload.data : null;
    if (direct)
        return stripDataUri(direct);
    const audio = typeof payload.audio === "string" ? payload.audio : null;
    if (audio)
        return stripDataUri(audio);
    const result = payload.result && typeof payload.result === "object"
        ? payload.result
        : null;
    const nestedAudio = result
        ? typeof result.audio === "string"
            ? result.audio
            : typeof result.data === "string"
                ? result.data
                : null
        : null;
    if (nestedAudio)
        return stripDataUri(nestedAudio);
    return null;
}
function stripDataUri(value) {
    const marker = "base64,";
    const index = value.indexOf(marker);
    return index >= 0 ? value.slice(index + marker.length) : value;
}
function mimeOf(format) {
    switch (format) {
        case "wav":
            return "audio/wav";
        case "mp3":
        default:
            return "audio/mpeg";
    }
}
