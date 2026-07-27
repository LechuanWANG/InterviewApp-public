import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const AUTH_COOKIE_NAME = "interview_app_user";
const AUTH_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30;
const AUTH_SESSION_MAX_AGE_SEC = 60 * 60 * 12;

export type AppUser = {
  id: string;
  email?: string | null;
};

type SignedPayload = AppUser & {
  exp: number;
};

export function getCurrentUser(): AppUser | null {
  const value = cookies().get(AUTH_COOKIE_NAME)?.value;
  if (!value) return null;
  return parseSignedUser(value);
}

export function getCurrentUserId(): string | null {
  return getCurrentUser()?.id ?? null;
}

export function requireCurrentUserId(): string {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error("AUTH_REQUIRED");
  }
  return userId;
}

export function setAuthCookie(
  response: NextResponse,
  user: AppUser,
  options: { remember?: boolean } = {}
): NextResponse {
  const remember = options.remember !== false;
  response.cookies.set(AUTH_COOKIE_NAME, signUser(user, remember ? AUTH_COOKIE_MAX_AGE_SEC : AUTH_SESSION_MAX_AGE_SEC), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(remember ? { maxAge: AUTH_COOKIE_MAX_AGE_SEC } : {}),
  });
  return response;
}

export function clearAuthCookie(response: NextResponse): NextResponse {
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export function unauthorizedJson(message = "请先登录后再继续使用"): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function userMemoryProfileId(userId: string): string {
  return `user:${userId}`;
}

function signUser(user: AppUser, maxAgeSec: number): string {
  const payload: SignedPayload = {
    id: user.id,
    email: user.email ?? null,
    exp: Math.floor(Date.now() / 1000) + maxAgeSec,
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  return `${encoded}.${signature(encoded)}`;
}

function parseSignedUser(value: string): AppUser | null {
  const [encoded, sig] = value.split(".");
  if (!encoded || !sig) return null;
  const expected = signature(encoded);
  if (!safeEqual(sig, expected)) return null;

  try {
    const payload = JSON.parse(fromBase64Url(encoded)) as SignedPayload;
    if (!payload.id || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { id: payload.id, email: payload.email ?? null };
  } catch {
    return null;
  }
}

function signature(value: string): string {
  return createHmac("sha256", authSecret()).update(value).digest("base64url");
}

function authSecret(): string {
  const secret = process.env.AUTH_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("Missing AUTH_COOKIE_SECRET or SUPABASE_SERVICE_ROLE_KEY");
  }
  return secret;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
