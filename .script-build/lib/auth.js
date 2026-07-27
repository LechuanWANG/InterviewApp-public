"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTH_COOKIE_NAME = void 0;
exports.getCurrentUser = getCurrentUser;
exports.getCurrentUserId = getCurrentUserId;
exports.requireCurrentUserId = requireCurrentUserId;
exports.setAuthCookie = setAuthCookie;
exports.clearAuthCookie = clearAuthCookie;
exports.unauthorizedJson = unauthorizedJson;
exports.userMemoryProfileId = userMemoryProfileId;
const crypto_1 = require("crypto");
const headers_1 = require("next/headers");
const server_1 = require("next/server");
exports.AUTH_COOKIE_NAME = "interview_app_user";
const AUTH_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30;
const AUTH_SESSION_MAX_AGE_SEC = 60 * 60 * 12;
function getCurrentUser() {
    const value = (0, headers_1.cookies)().get(exports.AUTH_COOKIE_NAME)?.value;
    if (!value)
        return null;
    return parseSignedUser(value);
}
function getCurrentUserId() {
    return getCurrentUser()?.id ?? null;
}
function requireCurrentUserId() {
    const userId = getCurrentUserId();
    if (!userId) {
        throw new Error("AUTH_REQUIRED");
    }
    return userId;
}
function setAuthCookie(response, user, options = {}) {
    const remember = options.remember !== false;
    response.cookies.set(exports.AUTH_COOKIE_NAME, signUser(user, remember ? AUTH_COOKIE_MAX_AGE_SEC : AUTH_SESSION_MAX_AGE_SEC), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        ...(remember ? { maxAge: AUTH_COOKIE_MAX_AGE_SEC } : {}),
    });
    return response;
}
function clearAuthCookie(response) {
    response.cookies.set(exports.AUTH_COOKIE_NAME, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
    });
    return response;
}
function unauthorizedJson(message = "请先登录后再继续使用") {
    return server_1.NextResponse.json({ error: message }, { status: 401 });
}
function userMemoryProfileId(userId) {
    return `user:${userId}`;
}
function signUser(user, maxAgeSec) {
    const payload = {
        id: user.id,
        email: user.email ?? null,
        exp: Math.floor(Date.now() / 1000) + maxAgeSec,
    };
    const encoded = toBase64Url(JSON.stringify(payload));
    return `${encoded}.${signature(encoded)}`;
}
function parseSignedUser(value) {
    const [encoded, sig] = value.split(".");
    if (!encoded || !sig)
        return null;
    const expected = signature(encoded);
    if (!safeEqual(sig, expected))
        return null;
    try {
        const payload = JSON.parse(fromBase64Url(encoded));
        if (!payload.id || payload.exp < Math.floor(Date.now() / 1000))
            return null;
        return { id: payload.id, email: payload.email ?? null };
    }
    catch {
        return null;
    }
}
function signature(value) {
    return (0, crypto_1.createHmac)("sha256", authSecret()).update(value).digest("base64url");
}
function authSecret() {
    const secret = process.env.AUTH_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) {
        throw new Error("Missing AUTH_COOKIE_SECRET or SUPABASE_SERVICE_ROLE_KEY");
    }
    return secret;
}
function toBase64Url(value) {
    return Buffer.from(value, "utf8").toString("base64url");
}
function fromBase64Url(value) {
    return Buffer.from(value, "base64url").toString("utf8");
}
function safeEqual(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length)
        return false;
    return (0, crypto_1.timingSafeEqual)(leftBuffer, rightBuffer);
}
