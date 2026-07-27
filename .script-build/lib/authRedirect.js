"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeAuthNext = sanitizeAuthNext;
const DEFAULT_AUTH_NEXT = "/?expanded=1";
function sanitizeAuthNext(value) {
    if (!value)
        return DEFAULT_AUTH_NEXT;
    const trimmed = value.trim();
    if (!trimmed.startsWith("/") || trimmed.startsWith("//"))
        return DEFAULT_AUTH_NEXT;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed))
        return DEFAULT_AUTH_NEXT;
    return trimmed;
}
