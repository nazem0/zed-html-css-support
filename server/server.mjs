#!/usr/bin/env node
/**
 * Minimal LSP remake of ecmel.vscode-html-css for Zed.
 * Completions + go-to-definition for HTML class/id from workspace CSS.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const SELECTOR_RE =
  /([.#])(-?[_a-zA-Z]+[\\!+_a-zA-Z0-9-]*)(?=[#.,()\s\[\]\^:*"'>=_a-zA-Z0-9-]*{[^}]*})/g;
const CAN_COMPLETE =
  /(id|class|className|[.#])\s*[=:]?\s*(["'])(?:.(?!\2))*$/is;
const WORD_RE = /[_a-zA-Z0-9-]+/;

/** @type {Map<string, string>} */
const docs = new Map();
/** @type {{ styleSheets: string[] }} */
let settings = { styleSheets: ["**/*.css"] };
let rootUri = null;
let rootPath = null;

function parseSelectors(text) {
  const out = [];
  const lines = text.split(/\n/);
  let index = 0;
  const lineStarts = lines.map((line) => {
    const start = index;
    index += line.length + 1;
    return start;
  });
  let m;
  SELECTOR_RE.lastIndex = 0;
  while ((m = SELECTOR_RE.exec(text))) {
    const i = m.index;
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= i) line++;
    const col = i - lineStarts[line] + 1;
    out.push({
      type: m[1],
      selector: m[2].replaceAll("\\", ""),
      line,
      col,
    });
  }
  return out;
}

function walkCssFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "node_modules" || name.name === ".git") continue;
    const full = path.join(dir, name.name);
    if (name.isDirectory()) walkCssFiles(full, acc);
    else if (/\.(css|scss|less)$/i.test(name.name)) acc.push(full);
  }
  return acc;
}

function matchGlob(pattern, filePath, base) {
  const rel = path.relative(base, filePath).replace(/\\/g, "/");
  // Convert globs without destroying regex quantifiers (the old `?` pass broke `(.+/)?`).
  let i = 0;
  let out = "^";
  while (i < pattern.length) {
    if (pattern.startsWith("**/", i)) {
      out += "(?:.+/)?";
      i += 3;
      continue;
    }
    if (pattern.startsWith("**", i)) {
      out += ".*";
      i += 2;
      continue;
    }
    const ch = pattern[i];
    if (ch === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if (".+^${}()|[]\\".includes(ch)) out += "\\" + ch;
    else out += ch;
    i += 1;
  }
  out += "$";
  return new RegExp(out, "i").test(rel);
}

async function fetchRemote(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.statusText);
    return await res.text();
  } catch {
    return "";
  }
}

async function collectStyles(docUri, docText) {
  /** @type {Map<string, ReturnType<typeof parseSelectors>>} */
  const map = new Map();
  map.set(docUri, parseSelectors(docText));

  const sheets = settings.styleSheets?.length ? settings.styleSheets : ["**/*.css"];
  for (const sheet of sheets) {
    if (/^https?:\/\//i.test(sheet)) {
      const text = await fetchRemote(sheet);
      if (text) map.set(sheet, parseSelectors(text));
      continue;
    }
    if (!rootPath) continue;
    const all = walkCssFiles(rootPath);
    for (const file of all) {
      if (!matchGlob(sheet, file, rootPath)) continue;
      try {
        const text = fs.readFileSync(file, "utf8");
        map.set(pathToFileURL(file).href, parseSelectors(text));
      } catch {
        /* skip */
      }
    }
  }
  return map;
}

function prefixText(doc, position) {
  const lines = doc.split(/\n/);
  const slice = lines.slice(0, position.line + 1);
  slice[slice.length - 1] = slice[slice.length - 1].slice(0, position.character);
  return slice.join("\n");
}

function wordRange(doc, position) {
  const line = doc.split(/\n/)[position.line] ?? "";
  let start = position.character;
  let end = position.character;
  while (start > 0 && WORD_RE.test(line[start - 1])) start--;
  while (end < line.length && WORD_RE.test(line[end])) end++;
  return {
    start: { line: position.line, character: start },
    end: { line: position.line, character: end },
  };
}

async function completions(uri, position) {
  const doc = docs.get(uri);
  if (doc == null) return [];
  const before = prefixText(doc, position);
  const m = CAN_COMPLETE.exec(before);
  if (!m) return [];
  const wantId = m[1] === "id";
  const type = wantId ? "#" : ".";
  const styles = await collectStyles(uri, doc);
  const seen = new Set();
  const items = [];
  const range = wordRange(doc, position);
  for (const sels of styles.values()) {
    for (const s of sels) {
      if (s.type !== type || seen.has(s.selector)) continue;
      seen.add(s.selector);
      items.push({
        label: s.selector,
        kind: wantId ? 12 : 13, // Value / Enum
        textEdit: { range, newText: s.selector },
      });
    }
  }
  return items;
}

async function definitions(uri, position) {
  const doc = docs.get(uri);
  if (doc == null) return [];
  const before = prefixText(doc, position);
  if (!CAN_COMPLETE.exec(before)) return [];
  const range = wordRange(doc, position);
  const line = doc.split(/\n/)[position.line] ?? "";
  const word = line.slice(range.start.character, range.end.character);
  if (!word) return [];
  const styles = await collectStyles(uri, doc);
  const locs = [];
  for (const [src, sels] of styles) {
    if (/^https?:\/\//i.test(src)) continue;
    for (const s of sels) {
      if (s.selector !== word) continue;
      locs.push({
        uri: src,
        range: {
          start: { line: s.line, character: Math.max(0, s.col - 1) },
          end: { line: s.line, character: s.col - 1 + s.selector.length + 1 },
        },
      });
    }
  }
  return locs;
}

// --- JSON-RPC stdio ---
let buffer = Buffer.alloc(0);

function send(msg) {
  const json = JSON.stringify(msg);
  const payload = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
  process.stdout.write(payload);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, message) {
  send({ jsonrpc: "2.0", id, error: { code: -32603, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      rootUri = params.rootUri || params.workspaceFolders?.[0]?.uri || null;
      if (rootUri?.startsWith("file:")) {
        rootPath = fileURLToPath(rootUri);
      }
      const initOpts = params.initializationOptions || {};
      if (Array.isArray(initOpts.styleSheets) && initOpts.styleSheets.length) {
        settings.styleSheets = initOpts.styleSheets;
      }
      respond(id, {
        capabilities: {
          textDocumentSync: 1,
          completionProvider: {
            triggerCharacters: [" ", '"', "'", ".", "#"],
            resolveProvider: false,
          },
          definitionProvider: true,
          workspace: {
            workspaceFolders: { supported: true },
            configuration: true,
          },
        },
        serverInfo: { name: "html-css-support", version: "0.1.0" },
      });
      return;
    }
    if (method === "initialized") return;
    if (method === "shutdown") {
      respond(id, null);
      return;
    }
    if (method === "exit") {
      process.exit(0);
    }
    if (method === "workspace/didChangeConfiguration") {
      const cfg =
        params?.settings?.["html-css-support"] ??
        params?.settings?.css ??
        params?.settings;
      if (cfg?.styleSheets) settings.styleSheets = cfg.styleSheets;
      return;
    }
    if (method === "workspace/configuration") {
      const items = params?.items || [];
      respond(
        id,
        items.map(() => ({ styleSheets: settings.styleSheets })),
      );
      return;
    }
    if (method === "textDocument/didOpen") {
      docs.set(params.textDocument.uri, params.textDocument.text);
      return;
    }
    if (method === "textDocument/didChange") {
      const uri = params.textDocument.uri;
      const changes = params.contentChanges;
      if (changes?.length) {
        // full sync
        docs.set(uri, changes[changes.length - 1].text ?? docs.get(uri) ?? "");
      }
      return;
    }
    if (method === "textDocument/didClose") {
      docs.delete(params.textDocument.uri);
      return;
    }
    if (method === "textDocument/completion") {
      const items = await completions(params.textDocument.uri, params.position);
      respond(id, { isIncomplete: false, items });
      return;
    }
    if (method === "textDocument/definition") {
      const locs = await definitions(params.textDocument.uri, params.position);
      respond(id, locs);
      return;
    }
    if (id != null) respond(id, null);
  } catch (e) {
    if (id != null) respondError(id, String(e?.message || e));
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const len = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + len) break;
    const body = buffer.slice(bodyStart, bodyStart + len).toString("utf8");
    buffer = buffer.slice(bodyStart + len);
    try {
      void handle(JSON.parse(body));
    } catch {
      /* ignore bad frame */
    }
  }
});
