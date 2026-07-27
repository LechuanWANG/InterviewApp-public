import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase() || "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: "请输入有效邮箱地址" }, { status: 400 });
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      return NextResponse.json({ error: "密码至少需要 8 位" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { sign_in_method: "password" },
    });

    if (error || !data.user) {
      const mapped = mapCreateUserError(error);
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }

    return NextResponse.json(
      {
        user: {
          id: data.user.id,
          email: data.user.email ?? email,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建账户失败，请稍后重试" },
      { status: 500 }
    );
  }
}

function mapCreateUserError(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message : "";
  const status = getErrorStatus(error);

  if (/already|registered|exists|duplicate/i.test(message)) {
    return { status: 409, message: "该邮箱已注册，请直接登录" };
  }
  if (/password/i.test(message)) {
    return { status: 400, message: "密码不符合要求，请至少使用 8 位字符" };
  }
  if (/email/i.test(message)) {
    return { status: 400, message: "请输入有效邮箱地址" };
  }

  return {
    status: status >= 400 && status < 500 ? status : 500,
    message: status >= 500 ? "创建账户失败，请稍后重试" : message || "创建账户失败",
  };
}

function getErrorStatus(error: unknown): number {
  if (typeof error !== "object" || error === null) return 500;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : 500;
}
