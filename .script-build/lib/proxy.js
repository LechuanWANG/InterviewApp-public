"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupProxy = setupProxy;
const undici_1 = require("undici");
let configured = false;
function setupProxy() {
    if (configured)
        return;
    configured = true;
    const url = process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy ||
        process.env.ALL_PROXY ||
        process.env.all_proxy;
    if (!url)
        return;
    try {
        (0, undici_1.setGlobalDispatcher)(new undici_1.ProxyAgent(url));
        console.log(`[proxy] Node fetch 已接入代理 ${url}`);
    }
    catch (e) {
        console.warn("[proxy] ProxyAgent 初始化失败", e);
    }
}
setupProxy();
