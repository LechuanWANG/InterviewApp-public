import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import "@/lib/proxy";
import { transcribeWithDoubao } from "@/lib/voice/doubaoAsr";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const language = (formData.get("language") as string) || "zh";
    const provider = (formData.get("provider") as string) || "whisper";
    const sampleRateRaw = formData.get("sampleRate");
    const sampleRate = sampleRateRaw ? parseInt(sampleRateRaw as string, 10) : 16000;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }

    if (provider === "doubao") {
      if (!process.env.DOUBAO_TTS_API_KEY) {
        return NextResponse.json(
          { error: "需要在 .env.local 配置 DOUBAO_TTS_API_KEY 才能使用豆包 ASR" },
          { status: 400 }
        );
      }
      const buf = Buffer.from(await file.arrayBuffer());
      try {
        const text = await transcribeWithDoubao({ wav: buf, sampleRate });
        return NextResponse.json({ text, provider: "doubao" });
      } catch (error) {
        console.warn("Doubao ASR failed, trying Whisper fallback", error);
        if (!process.env.OPENAI_API_KEY) throw error;
        const fallbackFile = new File([buf], "audio.wav", { type: file.type || "audio/wav" });
        const text = await transcribeWithWhisper(fallbackFile, language);
        return NextResponse.json({ text, provider: "whisper", fallbackFrom: "doubao" });
      }
    }

    // 默认 Whisper
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "需要在 .env.local 配置 OPENAI_API_KEY 才能使用 Whisper" },
        { status: 400 }
      );
    }
    const text = await transcribeWithWhisper(file, language);
    return NextResponse.json({ text, provider: "whisper" });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "transcribe error" },
      { status: 500 }
    );
  }
}

async function transcribeWithWhisper(file: File, language: string): Promise<string> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
  const res = await client.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language,
  });
  return res.text;
}
