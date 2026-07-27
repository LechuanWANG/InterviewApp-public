"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupabaseBrowserClient = getSupabaseBrowserClient;
const supabase_js_1 = require("@supabase/supabase-js");
let browserClient = null;
function getSupabaseBrowserClient() {
    if (browserClient)
        return browserClient;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
        throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
    browserClient = (0, supabase_js_1.createClient)(url, anonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
        },
    });
    return browserClient;
}
