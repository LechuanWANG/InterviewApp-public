export type LiveAsrStatus = "idle" | "connecting" | "live" | "error" | "closed";

export type LiveAsrSnapshot = {
  status: LiveAsrStatus;
  text: string;
  finalText: string;
  interimText: string;
  error?: string;
};

export type LiveAsrController = {
  stop: () => void;
  close: () => void;
  getSnapshot: () => LiveAsrSnapshot;
};

type StartLiveDoubaoAsrOptions = {
  stream: MediaStream;
  language: "zh" | "en";
  onUpdate: (snapshot: LiveAsrSnapshot) => void;
};

type ServerMessage =
  | { type: "ready" }
  | { type: "result"; text?: string; final?: boolean; error?: string }
  | { type: "error"; error?: string; code?: number }
  | { type: "closed" };

const TARGET_SAMPLE_RATE = 16000;
const TARGET_CHUNK_MS = 180;
const TARGET_CHUNK_SAMPLES = Math.round((TARGET_SAMPLE_RATE * TARGET_CHUNK_MS) / 1000);
const MAX_QUEUED_CHUNKS = 20;

export function startLiveDoubaoAsr({
  stream,
  language,
  onUpdate,
}: StartLiveDoubaoAsrOptions): LiveAsrController {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("当前浏览器不支持实时语音识别所需的 Web Audio。");
  }

  const audioContext = new AudioContextCtor();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const ws = new WebSocket(streamUrl(language));
  ws.binaryType = "arraybuffer";

  let stopped = false;
  let closed = false;
  let pendingSamples = new Int16Array(0);
  let queuedChunks: ArrayBuffer[] = [];
  let snapshot: LiveAsrSnapshot = {
    status: "connecting",
    text: "",
    finalText: "",
    interimText: "",
  };

  const emit = (patch: Partial<LiveAsrSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    onUpdate(snapshot);
  };

  const sendChunk = (chunk: Int16Array) => {
    if (!chunk.byteLength || stopped || closed) return;
    const payload = new ArrayBuffer(chunk.byteLength);
    new Uint8Array(payload).set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      return;
    }
    if (ws.readyState === WebSocket.CONNECTING) {
      queuedChunks.push(payload);
      if (queuedChunks.length > MAX_QUEUED_CHUNKS) queuedChunks.shift();
    }
  };

  const flushPendingAudio = () => {
    if (!pendingSamples.length) return;
    sendChunk(pendingSamples);
    pendingSamples = new Int16Array(0);
  };

  processor.onaudioprocess = (event) => {
    if (stopped || closed) return;
    const input = event.inputBuffer.getChannelData(0);
    const samples = downsampleTo16BitPcm(input, audioContext.sampleRate, TARGET_SAMPLE_RATE);
    if (!samples.length) return;

    const merged = new Int16Array(pendingSamples.length + samples.length);
    merged.set(pendingSamples, 0);
    merged.set(samples, pendingSamples.length);

    let offset = 0;
    while (merged.length - offset >= TARGET_CHUNK_SAMPLES) {
      sendChunk(merged.slice(offset, offset + TARGET_CHUNK_SAMPLES));
      offset += TARGET_CHUNK_SAMPLES;
    }
    pendingSamples = merged.slice(offset);
  };

  ws.onopen = () => {
    emit({ status: "live", error: undefined });
    for (const chunk of queuedChunks) {
      if (ws.readyState !== WebSocket.OPEN) break;
      ws.send(chunk);
    }
    queuedChunks = [];
  };

  ws.onmessage = (event) => {
    const message = parseServerMessage(event.data);
    if (!message) return;
    if (message.type === "ready") {
      emit({ status: "live", error: undefined });
      return;
    }
    if (message.type === "error") {
      const detail = message.error || (message.code ? `ASR ${message.code}` : "实时识别连接失败");
      emit({ status: "error", error: detail });
      return;
    }
    if (message.type === "closed") {
      emit({ status: "closed" });
      return;
    }
    const text = (message.text || "").trim();
    if (!text) return;
    if (message.final) {
      emit({ status: "live", text, finalText: text, interimText: "", error: undefined });
    } else {
      emit({ status: "live", text, interimText: text, error: undefined });
    }
  };

  ws.onerror = () => {
    emit({ status: "error", error: "实时识别连接失败" });
  };

  ws.onclose = () => {
    closed = true;
    cleanupAudio();
    emit({ status: snapshot.status === "error" ? "error" : "closed" });
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
  if (audioContext.state === "suspended") {
    void audioContext.resume().catch(() => {});
  }
  onUpdate(snapshot);

  const finish = () => {
    if (stopped) return;
    stopped = true;
    flushPendingAudio();
    cleanupAudio();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "finish" }));
      window.setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      }, 2500);
    } else if (ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };

  const close = () => {
    stopped = true;
    cleanupAudio();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };

  function cleanupAudio() {
    processor.onaudioprocess = null;
    try {
      processor.disconnect();
    } catch {}
    try {
      source.disconnect();
    } catch {}
    if (audioContext.state !== "closed") {
      void audioContext.close().catch(() => {});
    }
  }

  return {
    stop: finish,
    close,
    getSnapshot: () => snapshot,
  };
}

function streamUrl(language: "zh" | "en"): string {
  const localOverride = process.env.NEXT_PUBLIC_LOCAL_ASR_WS_URL;
  const params = new URLSearchParams({ language });
  if (localOverride) {
    const separator = localOverride.includes("?") ? "&" : "?";
    return `${localOverride}${separator}${params.toString()}`;
  }

  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    const localHost = hostname === "::1" ? "[::1]" : hostname;
    return `ws://${localHost}:3001/asr/stream?${params.toString()}`;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/asr/stream?${params.toString()}`;
}

function parseServerMessage(data: MessageEvent["data"]): ServerMessage | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === "object" ? parsed as ServerMessage : null;
  } catch {
    return null;
  }
}

function downsampleTo16BitPcm(input: Float32Array, inputSampleRate: number, outputSampleRate: number): Int16Array {
  if (!input.length || inputSampleRate <= 0 || outputSampleRate <= 0) return new Int16Array(0);
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(0, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    const count = Math.max(1, end - start);
    for (let j = start; j < end; j += 1) {
      sum += input[j];
    }
    const sample = Math.max(-1, Math.min(1, sum / count));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
