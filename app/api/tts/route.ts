import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import "@/lib/proxy";
import { synthesizeWithDoubao } from "@/lib/voice/doubaoTts";
import { findDoubaoVoice, isRandomDoubaoVoice, pickRandomDoubaoVoice } from "@/lib/voice/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      text: string;
      voice?: string;
      provider?: "openai" | "doubao";
      language?: "zh" | "en";
      speedRatio?: number;
    };
    const { text, voice, provider = "openai", language = "zh", speedRatio } = body;

    if (!text?.trim()) {
      return NextResponse.json({ error: "missing text" }, { status: 400 });
    }

    if (provider === "doubao") {
      if (!process.env.DOUBAO_TTS_API_KEY) {
        return NextResponse.json(
          { error: "需要在 .env.local 配置 DOUBAO_TTS_API_KEY" },
          { status: 400 }
        );
      }
      const selectedVoice = isRandomDoubaoVoice(voice)
        ? pickRandomDoubaoVoice(language).id
        : voice;
      const voiceMeta = selectedVoice ? findDoubaoVoice(selectedVoice) : undefined;
      const { audio, mime } = await synthesizeWithDoubao({
        text,
        voice: selectedVoice || undefined,
        resourceId: voiceMeta?.resourceId,
        format: "mp3",
        speedRatio,
      });
      return new Response(new Uint8Array(audio), {
        headers: { "Content-Type": mime, "Cache-Control": "no-store" },
      });
    }

    // OpenAI TTS
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "需要在 .env.local 配置 OPENAI_API_KEY 才能使用 OpenAI TTS" },
        { status: 400 }
      );
    }
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    const res = await client.audio.speech.create({
      model: "tts-1",
      voice: (voice || "alloy") as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
      input: text,
      response_format: "mp3",
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    return new Response(buffer, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "tts error" },
      { status: 500 }
    );
  }
}
