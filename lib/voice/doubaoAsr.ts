import { randomUUID } from "crypto";

const SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit";
const QUERY_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query";
const FLASH_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const FLASH_TIMEOUT_MS = 25000;
const STANDARD_SUBMIT_TIMEOUT_MS = 15000;
const STANDARD_QUERY_REQUEST_TIMEOUT_MS = 10000;
const STANDARD_QUERY_TIMEOUT_MS = 45000;
const STANDARD_QUERY_INTERVAL_MS = 2000;

type DoubaoAsrJson = {
  header?: {
    code?: number;
    message?: string;
  };
  result?: {
    text?: string;
  };
  audio_info?: {
    duration?: number;
  };
};

export async function transcribeWithDoubao(params: {
  wav: Buffer;
  sampleRate?: number;
  channel?: number;
  bits?: number;
}): Promise<string> {
  const apiKey = process.env.DOUBAO_ASR_API_KEY || process.env.DOUBAO_TTS_API_KEY;
  if (!apiKey) throw new Error("DOUBAO_ASR_API_KEY 或 DOUBAO_TTS_API_KEY 未配置");

  const sampleRate = params.sampleRate ?? 16000;
  const channel = params.channel ?? 1;
  const bits = params.bits ?? 16;

  try {
    return await transcribeWithDoubaoFlash({
      wav: params.wav,
      sampleRate,
      channel,
      bits,
      apiKey,
    });
  } catch (error) {
    console.warn("Doubao ASR flash failed, falling back to standard submit/query", error);
    return transcribeWithDoubaoStandard({
      wav: params.wav,
      sampleRate,
      channel,
      bits,
      apiKey,
    });
  }
}

async function transcribeWithDoubaoFlash(params: {
  wav: Buffer;
  sampleRate: number;
  channel: number;
  bits: number;
  apiKey: string;
}): Promise<string> {
  const resourceId = process.env.DOUBAO_ASR_FLASH_RESOURCE_ID || "volc.bigasr.auc_turbo";
  const reqId = randomUUID();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": params.apiKey,
    "X-Api-Resource-Id": resourceId,
    "X-Api-Request-Id": reqId,
    "X-Api-Sequence": "-1",
  };

  const response = await fetchWithTimeout(FLASH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      user: { uid: reqId },
      audio: {
        format: "wav",
        codec: "raw",
        rate: params.sampleRate,
        bits: params.bits,
        channel: params.channel,
        data: params.wav.toString("base64"),
      },
      request: requestOptions(),
    }),
  }, FLASH_TIMEOUT_MS);

  const text = await parseDoubaoAsrResponse(response, "flash");
  return text;
}

async function transcribeWithDoubaoStandard(params: {
  wav: Buffer;
  sampleRate: number;
  channel: number;
  bits: number;
  apiKey: string;
}): Promise<string> {
  const resourceId = process.env.DOUBAO_ASR_RESOURCE_ID || "volc.seedasr.auc";
  const reqId = randomUUID();
  const b64 = params.wav.toString("base64");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": params.apiKey,
    "X-Api-Resource-Id": resourceId,
    "X-Api-Request-Id": reqId,
    "X-Api-Sequence": "-1",
  };

  const submitRes = await fetchWithTimeout(SUBMIT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      user: { uid: reqId },
      audio: {
        format: "wav",
        codec: "raw",
        rate: params.sampleRate,
        bits: params.bits,
        channel: params.channel,
        data: b64,
      },
      request: requestOptions(),
    }),
  }, STANDARD_SUBMIT_TIMEOUT_MS);

  if (!submitRes.ok) {
    const err = await submitRes.text();
    throw new Error(`Doubao ASR submit 失败: ${submitRes.status} ${err}`);
  }

  const submitData = await submitRes.json();
  if (submitData?.header?.code && submitData.header.code !== 0) {
    throw new Error(`Doubao ASR submit 错误: ${submitData.header.message || JSON.stringify(submitData)}`);
  }

  // Step 2: Poll query until result
  const queryHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Key": params.apiKey,
    "X-Api-Resource-Id": resourceId,
    "X-Api-Request-Id": reqId,
  };

  const start = Date.now();

  while (Date.now() - start < STANDARD_QUERY_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, STANDARD_QUERY_INTERVAL_MS));

    const queryRes = await fetchWithTimeout(QUERY_URL, {
      method: "POST",
      headers: queryHeaders,
      body: "{}",
    }, STANDARD_QUERY_REQUEST_TIMEOUT_MS);

    if (!queryRes.ok) continue;

    const data = await queryRes.json();

    // 错误码：还在处理中或其他错误
    if (data?.header?.code && data.header.code !== 0) {
      continue;
    }

    // 有 result.text 且非空才算完成
    const text = data?.result?.text;
    if (typeof text === "string" && text.trim().length > 0) return text;

    // result 存在但 text 为空，可能还在处理，也可能真的识别为空
    // 检查 audio_info.duration 是否存在——有 duration 说明处理完了
    if (data?.audio_info?.duration !== undefined) {
      return text || "";
    }
  }

  throw new Error(`Doubao ASR 查询超时 (${Math.round(STANDARD_QUERY_TIMEOUT_MS / 1000)}s)`);
}

function requestOptions() {
  return {
    model_name: "bigmodel",
    enable_itn: true,
    enable_punc: true,
    enable_ddc: false,
    show_utterances: false,
  };
}

async function parseDoubaoAsrResponse(response: Response, label: string): Promise<string> {
  const statusCode = response.headers.get("x-api-status-code") || "";
  const statusMessage = response.headers.get("x-api-message") || "";
  const textBody = await response.text();

  if (!response.ok) {
    throw new Error(`Doubao ASR ${label} 失败: ${response.status} ${textBody.slice(0, 300)}`);
  }
  if (statusCode && statusCode !== "20000000") {
    throw new Error(`Doubao ASR ${label} 状态异常: ${statusCode}${statusMessage ? ` ${statusMessage}` : ""}`);
  }

  const data = parseJson(textBody);
  if (data?.header?.code && data.header.code !== 0) {
    throw new Error(`Doubao ASR ${label} 错误: ${data.header.message || textBody.slice(0, 300)}`);
  }

  const text = data?.result?.text;
  return typeof text === "string" ? text : "";
}

function parseJson(value: string): DoubaoAsrJson | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as DoubaoAsrJson : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
