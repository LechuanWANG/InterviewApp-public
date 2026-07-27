import { NextRequest, NextResponse } from "next/server";
import { parsePdfText } from "@/lib/pdf/parsePdf";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "只支持 PDF 文件" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const text = await parsePdfText(buf);
    return NextResponse.json({ text });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "parse error" },
      { status: 500 }
    );
  }
}
