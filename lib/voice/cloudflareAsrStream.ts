import {
  buildAsrAudioFrame,
  buildAsrFullClientJsonFrame,
  isAsrErrorFrame,
  isAsrFinalFrame,
  isAsrResultFrame,
  parseAsrServerFrame,
} from "./doubaoAsrStreamProtocol";

const DEFAULT_DOUBAO_ASR_STREAM_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
const DEFAULT_DOUBAO_ASR_STREAM_RESOURCE_ID = "volc.bigasr.sauc.duration";

type CloudflareAsrStreamEnv = Record<string, unknown>;

type WebSocketPairConstructor = new () => {
  0: WebSocket;
  1: WebSocket;
};

type RuntimeWebSocket = WebSocket & {
  accept?: () => void;
};

type HandleCloudflareAsrStreamOptions = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

type AsrResultPayload = {
  code?: number;
  message?: string;
  reqid?: string;
  trace_id?: string;
  log_id?: string;
  logid?: string;
  connect_id?: string;
  audio_info?: {
    duration?: number;
  };
  result?: {
    text?: string;
    utterances?: {
      text?: string;
      definite?: boolean;
    }[];
  };
};

export type AsrStreamSettings = {
  apiKey: string | null;
  endpoint: string;
  resourceId: string;
};

export function resolveAsrStreamSettings(env: CloudflareAsrStreamEnv): AsrStreamSettings {
  return {
    apiKey:
      getStringEnv(env, "DOUBAO_ASR_API_KEY") ||
      getStringEnv(env, "DOUBAO_TTS_API_KEY") ||
      null,
    endpoint:
      getStringEnv(env, "DOUBAO_ASR_STREAM_ENDPOINT") ||
      DEFAULT_DOUBAO_ASR_STREAM_ENDPOINT,
    resourceId:
      getStringEnv(env, "DOUBAO_ASR_STREAM_RESOURCE_ID") ||
      getStringEnv(env, "DOUBAO_ASR_RESOURCE_ID") ||
      DEFAULT_DOUBAO_ASR_STREAM_RESOURCE_ID,
  };
}

export async function handleCloudflareAsrStream(
  request: Request,
  env: CloudflareAsrStreamEnv,
  options: HandleCloudflareAsrStreamOptions = {}
): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  const WebSocketPairCtor = (globalThis as { WebSocketPair?: WebSocketPairConstructor }).WebSocketPair;
  if (!WebSocketPairCtor) {
    return new Response("Streaming ASR is only available on a WebSocket-capable runtime.", { status: 501 });
  }

  const pair = new WebSocketPairCtor();
  const client = pair[0] as RuntimeWebSocket;
  const server = pair[1] as RuntimeWebSocket;
  server.accept?.();
  server.binaryType = "arraybuffer";

  const settings = resolveAsrStreamSettings(env);
  const url = new URL(request.url);
  const language = normalizeLanguage(url.searchParams.get("language"));
  const reqId = crypto.randomUUID();

  let closed = false;
  let finishRequested = false;
  let doubaoReady = false;
  let doubaoWs: RuntimeWebSocket | null = null;
  let upstreamAbort = new AbortController();
  let queuedFrames: ArrayBuffer[] = [];

  const sendClientJson = (payload: unknown) => {
    if (closed || server.readyState !== WebSocket.OPEN) return;
    server.send(JSON.stringify(payload));
  };

  const closeBoth = () => {
    if (closed) return;
    closed = true;
    upstreamAbort.abort();
    try {
      if (doubaoWs && (doubaoWs.readyState === WebSocket.OPEN || doubaoWs.readyState === WebSocket.CONNECTING)) {
        doubaoWs.close();
      }
    } catch {}
    try {
      if (server.readyState === WebSocket.OPEN || server.readyState === WebSocket.CONNECTING) {
        server.close();
      }
    } catch {}
  };

  const queueDoubaoFrame = (frame: ArrayBuffer | ArrayBufferView) => {
    if (closed) return;
    const payload = toArrayBuffer(frame);
    if (doubaoReady && doubaoWs?.readyState === WebSocket.OPEN) {
      doubaoWs.send(payload);
      return;
    }
    queuedFrames.push(payload);
  };

  const flushQueuedFrames = () => {
    if (!doubaoWs || doubaoWs.readyState !== WebSocket.OPEN) return;
    for (const frame of queuedFrames) {
      if (closed || doubaoWs.readyState !== WebSocket.OPEN) break;
      doubaoWs.send(frame);
    }
    queuedFrames = [];
  };

  const startDoubaoConnection = async () => {
    if (!settings.apiKey) {
      sendClientJson({
        type: "error",
        error: "DOUBAO_ASR_API_KEY or DOUBAO_TTS_API_KEY is not configured",
      });
      closeBoth();
      return;
    }

    try {
      const response = await fetch(settings.endpoint.replace(/^wss:/, "https:"), {
        signal: upstreamAbort.signal,
        headers: {
          Upgrade: "websocket",
          "X-Api-Key": settings.apiKey,
          "X-Api-Resource-Id": settings.resourceId,
          "X-Api-Request-Id": reqId,
          "X-Api-Connect-Id": reqId,
          "X-Api-Sequence": "-1",
        },
      });
      const ws = (response as Response & { webSocket?: RuntimeWebSocket | null }).webSocket;
      if (!ws) {
        const body = await response.text().catch(() => "");
        sendClientJson({
          type: "error",
          error: `Doubao ASR stream handshake failed (${response.status})${body ? `: ${body.slice(0, 300)}` : ""}`,
        });
        closeBoth();
        return;
      }

      doubaoWs = ws;
      doubaoReady = true;
      doubaoWs.accept?.();
      doubaoWs.binaryType = "arraybuffer";

      doubaoWs.send(
        buildAsrFullClientJsonFrame({
          user: {
            uid: "interview-stream",
          },
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
        })
      );
      sendClientJson({ type: "ready" });
      flushQueuedFrames();

      doubaoWs.addEventListener("message", (event) => {
        void (async () => {
          try {
            const frame = parseAsrServerFrame(await websocketDataToArrayBuffer(event.data));
            if (isAsrErrorFrame(frame)) {
              sendClientJson({
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
              sendClientJson({
                type: "error",
                code: payload.code,
                error: payload.message || "Doubao ASR stream error",
                logid: payload.log_id || payload.logid,
              });
              return;
            }

            const text = payload.result?.text || latestUtteranceText(payload) || "";
            if (!text) return;
            const final = isAsrFinalFrame(frame) || Boolean(payload.result?.utterances?.some((item) => item.definite));
            sendClientJson({
              type: "result",
              text,
              final,
              duration: payload.audio_info?.duration,
              logid: payload.log_id || payload.logid,
              reqid: payload.reqid,
              connectId: payload.connect_id,
            });
          } catch (error) {
            sendClientJson({
              type: "error",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })();
      });
      doubaoWs.addEventListener("close", () => {
        if (!closed) {
          sendClientJson({ type: "closed" });
        }
        closeBoth();
      });
      doubaoWs.addEventListener("error", () => {
        if (!closed) {
          sendClientJson({ type: "error", error: "Doubao ASR stream connection error" });
        }
        closeBoth();
      });
    } catch (error) {
      if (!closed) {
        sendClientJson({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      closeBoth();
    }
  };

  server.addEventListener("message", (event) => {
    try {
      if (typeof event.data === "string") {
        const message = parseClientMessage(event.data);
        if (message?.type === "finish" && !finishRequested) {
          finishRequested = true;
          queueDoubaoFrame(buildAsrAudioFrame(new Uint8Array(), true));
        }
        return;
      }

      if (!finishRequested) {
        queueDoubaoFrame(buildAsrAudioFrame(event.data as ArrayBuffer | ArrayBufferView, false));
      }
    } catch (error) {
      sendClientJson({
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.addEventListener("close", () => {
    if (!finishRequested && doubaoReady && doubaoWs?.readyState === WebSocket.OPEN) {
      try {
        doubaoWs.send(buildAsrAudioFrame(new Uint8Array(), true));
      } catch {}
    }
    closeBoth();
  });
  server.addEventListener("error", closeBoth);

  const connectionPromise = startDoubaoConnection();
  options.waitUntil?.(connectionPromise.catch(() => {}));

  return new Response(null, {
    status: 101,
    webSocket: client,
  } as ResponseInit & { webSocket: WebSocket });
}

function getStringEnv(env: CloudflareAsrStreamEnv, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeLanguage(value: string | null): string {
  if (value === "en") return "en-US";
  return "zh-CN";
}

function parseClientMessage(value: string): { type?: string } | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as { type?: string }) : null;
  } catch {
    return null;
  }
}

function parseAsrPayload(payload: Uint8Array): AsrResultPayload | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as AsrResultPayload) : null;
  } catch {
    return null;
  }
}

function latestUtteranceText(payload: AsrResultPayload): string {
  const utterances = payload.result?.utterances ?? [];
  return utterances.map((item) => item.text || "").filter(Boolean).join("");
}

async function websocketDataToArrayBuffer(data: unknown): Promise<ArrayBuffer | ArrayBufferView> {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data;
  if (data instanceof Blob) return data.arrayBuffer();
  if (typeof data === "string") return new TextEncoder().encode(data);
  throw new Error("Unknown Doubao ASR stream message type");
}

function toArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data.slice(0);
  if (ArrayBuffer.isView(data)) {
    const copy = new ArrayBuffer(data.byteLength);
    new Uint8Array(copy).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return copy;
  }
  throw new Error("Unsupported ASR frame payload");
}
