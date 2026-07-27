import { NextRequest, NextResponse } from "next/server";
import { getLLM } from "@/lib/llm";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      provider?: string;
      model?: string;
      language?: "zh" | "en";
      company?: string;
      jobTitle?: string;
      thinkingEnabled?: boolean;
    };

    const language = body.language === "en" ? "en" : "zh";
    const prompt =
      language === "en"
        ? `You are helping test an interview model. Return JSON with a short preview sentence for a mock interview at ${body.company || "a company"} for ${body.jobTitle || "a role"}.`
        : `你正在帮助测试面试模型。请返回 JSON，其中 preview 是一条简短的模拟面试开场白，场景为 ${body.company || "某公司"} 的 ${body.jobTitle || "某岗位"}。`;

    const result = await getLLM({
      provider: body.provider,
      model: body.model,
      thinkingEnabled: body.thinkingEnabled,
    }).completeJSON<{ preview: string }>({
      system: language === "en" ? "Return only valid JSON." : "严格只返回合法 JSON。",
      messages: [{ role: "user", content: `${prompt}\n\n{"preview":"..."}` }],
      thinkingEnabled: body.thinkingEnabled,
    });

    return NextResponse.json({ ok: true, preview: result.preview });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "model test error" },
      { status: 500 }
    );
  }
}
