import { ProxyAgent, setGlobalDispatcher } from "undici";

let configured = false;

export function setupProxy() {
  if (configured) return;
  configured = true;
  const url =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;
  if (!url) return;
  try {
    setGlobalDispatcher(new ProxyAgent(url));
    console.log(`[proxy] Node fetch 已接入代理 ${url}`);
  } catch (e) {
    console.warn("[proxy] ProxyAgent 初始化失败", e);
  }
}

setupProxy();
