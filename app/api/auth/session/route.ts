import { NextRequest, NextResponse } from "next/server";
import { clearAuthCookie, getCurrentUser, setAuthCookie } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  const user = getCurrentUser();
  return NextResponse.json({ user });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { accessToken?: string; remember?: boolean };
    const accessToken = body.accessToken?.trim();
    if (!accessToken) {
      return NextResponse.json({ error: "accessToken is required" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) {
      return NextResponse.json({ error: "登录态无效，请重新登录" }, { status: 401 });
    }

    const response = NextResponse.json({
      user: {
        id: data.user.id,
        email: data.user.email ?? null,
      },
    });
    return setAuthCookie(response, {
      id: data.user.id,
      email: data.user.email ?? null,
    }, { remember: body.remember !== false });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "同步登录态失败" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  return clearAuthCookie(NextResponse.json({ ok: true }));
}
