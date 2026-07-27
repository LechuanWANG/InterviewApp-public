"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupabaseClient = getSupabaseClient;
const supabase_js_1 = require("@supabase/supabase-js");
function getSupabase() {
    if (globalThis.__supabase)
        return globalThis.__supabase;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
    }
    globalThis.__supabase = (0, supabase_js_1.createClient)(url, key);
    return globalThis.__supabase;
}
function getSupabaseClient() {
    return getSupabase();
}
