import { spawn } from "node:child_process";

const children = [];

const asrProxy = spawn(
  process.execPath,
  ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/local-asr-stream-server.mjs"],
  {
    stdio: "inherit",
    env: process.env,
  }
);
children.push(asrProxy);

const nextDev = spawn("next", ["dev"], {
  stdio: "inherit",
  env: process.env,
});
children.push(nextDev);

let shuttingDown = false;

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") return;
    shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 300).unref();
}
