/**
 * End-to-end JSON-RPC smoke against server.mjs (no Zed required).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, "server.mjs");
const demoRoot = path.resolve(__dirname, "..", "demo");
const demoHtml = path.join(demoRoot, "index.html");
const demoCss = path.join(demoRoot, "styles.css");

function encode(msg) {
  const json = JSON.stringify(msg);
  return `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
}

async function main() {
  const child = spawn(process.execPath, [serverPath, "--stdio"], {
    stdio: ["pipe", "pipe", "inherit"],
  });

  let buf = Buffer.alloc(0);
  const waiters = new Map();

  child.stdout.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;
      const header = buf.slice(0, headerEnd).toString("utf8");
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) {
        buf = buf.slice(headerEnd + 4);
        continue;
      }
      const len = Number(m[1]);
      const start = headerEnd + 4;
      if (buf.length < start + len) break;
      const body = JSON.parse(buf.slice(start, start + len).toString("utf8"));
      buf = buf.slice(start + len);
      if (body.id != null && waiters.has(body.id)) {
        waiters.get(body.id)(body);
        waiters.delete(body.id);
      }
    }
  });

  function request(id, method, params) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout ${method}`)), 10000);
      waiters.set(id, (msg) => {
        clearTimeout(t);
        resolve(msg);
      });
      child.stdin.write(encode({ jsonrpc: "2.0", id, method, params }));
    });
  }

  function notify(method, params) {
    child.stdin.write(encode({ jsonrpc: "2.0", method, params }));
  }

  const rootUri = pathToFileURL(demoRoot).href;
  const htmlUri = pathToFileURL(demoHtml).href;
  const htmlText = await import("node:fs").then((fs) =>
    fs.readFileSync(demoHtml, "utf8"),
  );

  const init = await request(1, "initialize", {
    processId: process.pid,
    rootUri,
    capabilities: {},
    initializationOptions: {
      styleSheets: ["**/*.css"],
    },
  });
  if (!init.result?.capabilities?.completionProvider) {
    throw new Error("no completionProvider: " + JSON.stringify(init));
  }
  notify("initialized", {});
  notify("workspace/didChangeConfiguration", {
    settings: { styleSheets: ["**/*.css"] },
  });
  notify("textDocument/didOpen", {
    textDocument: {
      uri: htmlUri,
      languageId: "html",
      version: 1,
      text: htmlText,
    },
  });
  // allow stdio notify to be processed before completion
  await new Promise((r) => setTimeout(r, 100));

  // cursor inside class="" on the button line
  const line = htmlText.split(/\n/).findIndex((l) => l.includes('<button class=""'));
  const character = htmlText.split(/\n/)[line].indexOf('class=""') + 'class="'.length;

  const comp = await request(2, "textDocument/completion", {
    textDocument: { uri: htmlUri },
    position: { line, character },
  });

  const labels = (comp.result?.items || []).map((i) => i.label);
  const need = ["btn", "btn-primary", "card"];
  const missing = need.filter((n) => !labels.includes(n));
  if (missing.length) {
    console.error("FAIL missing completions", { labels, missing, css: demoCss });
    child.kill();
    process.exit(1);
  }

  console.log("LSP smoke OK:", labels.filter((l) => need.includes(l)).join(", "));
  child.kill();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
