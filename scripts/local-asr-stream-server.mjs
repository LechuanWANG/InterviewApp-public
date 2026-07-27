import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";

const {
  buildAsrAudioFrame,
  buildAsrFullClientJsonFrame,
  isAsrErrorFrame,
  isAsrFinalFrame,
  isAsrResultFrame,
  parseAsrServerFrame,
} = await import("../lib/voice/doubaoAsrStreamProtocol.ts");

const DEFAULT_PORT = 3001;
const DEFAULT_DOUBAO_ASR_STREAM_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";

loadLocalEnv();

const port = Number(process.env.LOCAL_ASR_STREAM_PORT || DEFAULT_PORT);
const server = createServer((req, res) => {
  if (req.url?.startsWith("/asr/stream")) {
    res.writeHead(426, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Expected WebSocket upgrade");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `localhost:${port}`}`);
  if (url.pathname !== "/asr/stream") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (clientWs) => {
    wss.emit("connection", clientWs, req, url);
  });
});

wss.on("connection", (clientWs, _req, url) => {
  void bridgeClientToDoubao(clientWs, url).catch((error) => {
    sendClientJson(clientWs, {
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    safeClose(clientWs);
  });
});

server.listen(port, () => {
  console.log(`[ASR] Local stream proxy listening on ws://localhost:${port}/asr/stream`);
});

server.on("error", (error) => {
  console.error(`[ASR] Local stream proxy failed: ${error.message}`);
  process.exitCode = 1;
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function bridgeClientToDoubao(clientWs, url) {
  const apiKey = process.env.DOUBAO_ASR_API_KEY || process.env.DOUBAO_TTS_API_KEY;
  if (!apiKey) {
    throw new Error("DOUBAO_ASR_API_KEY or DOUBAO_TTS_API_KEY is not configured");
  }

  const language = normalizeLanguage(url.searchParams.get("language"));
  const reqId = crypto.randomUUID();
  const endpoint = process.env.DOUBAO_ASR_STREAM_ENDPOINT || DEFAULT_DOUBAO_ASR_STREAM_ENDPOINT;
  const resourceId =
    process.env.DOUBAO_ASR_STREAM_RESOURCE_ID ||
    process.env.DOUBAO_ASR_RESOURCE_ID ||
    "volc.bigasr.sauc.duration";

  const doubaoWs = new WebSocket(endpoint, {
    headers: {
      "X-Api-Key": apiKey,
      "X-Api-Resource-Id": resourceId,
      "X-Api-Request-Id": reqId,
      "X-Api-Connect-Id": reqId,
      "X-Api-Sequence": "-1",
    },
  });
  doubaoWs.binaryType = "arraybuffer";

  let finished = false;
  let doubaoReady = false;
  const pendingFrames = [];

  const closeBoth = () => {
    safeClose(doubaoWs);
    safeClose(clientWs);
  };

  doubaoWs.on("open", () => {
    doubaoReady = true;
    doubaoWs.send(buildStartFrame({ reqId, language }));
    for (const frame of pendingFrames.splice(0)) {
      if (doubaoWs.readyState !== WebSocket.OPEN) break;
      doubaoWs.send(frame);
    }
    sendClientJson(clientWs, { type: "ready" });
  });

  doubaoWs.on("message", (data) => {
    try {
      const frame = parseAsrServerFrame(toArrayBufferView(data));
      if (isAsrErrorFrame(frame)) {
        sendClientJson(clientWs, {
          type: "error",
          code: frame.errorCode,
          error: new TextDecoder().decode(frame.payload),
        });
        closeBoth();
        return;
      }
      if (!isAsrResultFrame(frame)) return;

      const payload = parseAsrPayload(frame.payload);
      if (!payload) return;
      if (payload.code && payload.code !== 0 && payload.code !== 1000 && payload.code !== 20000000) {
        sendClientJson(clientWs, {
          type: "error",
          code: payload.code,
          error: payload.message || "Doubao ASR stream error",
          logid: payload.log_id || payload.logid,
        });
        return;
      }

      const text = payload.result?.text || latestUtteranceText(payload) || "";
      if (!text) return;
      sendClientJson(clientWs, {
        type: "result",
        text,
        final: isAsrFinalFrame(frame) || Boolean(payload.result?.utterances?.some((item) => item.definite)),
        duration: payload.audio_info?.duration,
        logid: payload.log_id || payload.logid,
        reqid: payload.reqid,
        connectId: payload.connect_id,
      });
    } catch (error) {
      sendClientJson(clientWs, {
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  doubaoWs.on("close", () => {
    sendClientJson(clientWs, { type: "closed" });
    safeClose(clientWs);
  });

  doubaoWs.on("error", (error) => {
    sendClientJson(clientWs, {
      type: "error",
      error: error instanceof Error ? error.message : "Doubao ASR stream connection error",
    });
    closeBoth();
  });

  clientWs.on("message", (data, isBinary) => {
    try {
      if (!isBinary) {
        const message = parseClientMessage(data.toString("utf8"));
        if (message?.type === "finish" && !finished) {
          finished = true;
          sendDoubaoFrame(buildAsrAudioFrame(new Uint8Array(), true));
        }
        return;
      }

      if (!finished) {
        sendDoubaoFrame(buildAsrAudioFrame(toArrayBufferView(data), false));
      }
    } catch (error) {
      sendClientJson(clientWs, {
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  clientWs.on("close", () => {
    if (!finished) {
      try {
        sendDoubaoFrame(buildAsrAudioFrame(new Uint8Array(), true));
      } catch {}
    }
    safeClose(doubaoWs);
  });
  clientWs.on("error", closeBoth);

  function sendDoubaoFrame(frame) {
    if (doubaoReady && doubaoWs.readyState === WebSocket.OPEN) {
      doubaoWs.send(frame);
    } else {
      pendingFrames.push(frame);
    }
  }
}

function buildStartFrame({ reqId, language }) {
  return buildAsrFullClientJsonFrame({
    user: { uid: "interview-local-stream" },
    audio: {
      format: "pcm",
      sample_rate: 16000,
      channel: 1,
      bits: 16,
    },
    request: {
      reqid: reqId,
      sequence: 1,
      show_utterances: true,
      result_type: "full",
      enable_itn: true,
      enable_punc: true,
      language,
    },
  });
}

function sendClientJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function safeClose(ws) {
  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  } catch {}
}

function parseClientMessage(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parseAsrPayload(payload) {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function latestUtteranceText(payload) {
  const utterances = payload.result?.utterances ?? [];
  return utterances.map((item) => item.text || "").filter(Boolean).join("");
}

function normalizeLanguage(value) {
  if (value === "en") return "en-US";
  return "zh-CN";
}

function toArrayBufferView(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data;
  return new Uint8Array(data);
}

function loadLocalEnv() {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      if (process.env[key] !== undefined) continue;
      process.env[key] = parseEnvValue(trimmed.slice(eqIndex + 1).trim());
    }
  }
}

function parseEnvValue(value) {
  const quote = value[0];
  if ((quote === "\"" || quote === "'") && value[value.length - 1] === quote) {
    return value.slice(1, -1);
  }
  const commentIndex = value.indexOf(" #");
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trim();
}

function shutdown() {
  wss.clients.forEach((client) => safeClose(client));
  server.close(() => process.exit(0));
}
