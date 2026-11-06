// Run with `node serve.mjs`, then open http://127.0.0.1:3030/.
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = await realpath(fileURLToPath(new URL(".", import.meta.url)));
const HOST = "0.0.0.0";
const PORT = 3030;

const TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".otf", "font/otf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xhtml", "application/xhtml+xml; charset=utf-8"],
]);

const ISOLATION_HEADERS = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Document-Isolation-Policy": "isolate-and-require-corp",
  "X-Content-Type-Options": "nosniff",
};

function sendText(response, status, message) {
  response.writeHead(status, {
    ...ISOLATION_HEADERS,
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(message);
}

function getRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return false;

  let start;
  let end;
  if (match[1]) {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  } else {
    const suffixLength = Number(match[2]);
    if (!suffixLength) return false;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
  return { start, end: Math.min(end, size - 1) };
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    return sendText(response, 405, "Method not allowed");
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${HOST}:${PORT}`).pathname);
  } catch {
    return sendText(response, 400, "Invalid URL path");
  }

  if (pathname === "/") pathname = "/webblox.html";
  const requestedPath = resolve(ROOT, `.${pathname}`);
  if (requestedPath !== ROOT && !requestedPath.startsWith(ROOT + sep)) {
    return sendText(response, 403, "Forbidden");
  }

  try {
    let filePath = await realpath(requestedPath);
    const relativePath = relative(ROOT, filePath);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || resolve(ROOT, relativePath) !== filePath) {
      return sendText(response, 403, "Forbidden");
    }

    let fileInfo = await stat(filePath);
    if (fileInfo.isDirectory()) {
      filePath = await realpath(join(filePath, "index.html"));
      fileInfo = await stat(filePath);
      if (!fileInfo.isFile()) return sendText(response, 404, "Not found");
    }
    if (!fileInfo.isFile()) return sendText(response, 404, "Not found");

    const range = getRange(request.headers.range, fileInfo.size);
    if (range === false) {
      response.writeHead(416, {
        ...ISOLATION_HEADERS,
        "Content-Range": `bytes */${fileInfo.size}`,
      });
      return response.end();
    }

    const headers = {
      ...(/[\\/]captcha\.html$/i.test(filePath) ? {} : ISOLATION_HEADERS),
      "Accept-Ranges": "bytes",
      "Cache-Control": /(?:\.html?|\.xhtml|\/sw\.js)$/i.test(filePath) ? "no-cache" : "public, max-age=3600",
      "Content-Length": range ? range.end - range.start + 1 : fileInfo.size,
      "Content-Type": TYPES.get(extname(filePath).toLowerCase()) || "application/octet-stream",
    };
    if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${fileInfo.size}`;
    response.writeHead(range ? 206 : 200, headers);
    if (request.method === "HEAD") return response.end();

    const stream = createReadStream(filePath, range || undefined);
    stream.on("error", error => {
      console.error("File read failed:", error.message);
      if (!response.headersSent) sendText(response, 500, "Could not read file");
      else response.destroy(error);
    });
    stream.pipe(response);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return sendText(response, 404, "Not found");
    console.error("Request failed:", error.message);
    return sendText(response, 500, "Server error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`WebBlox is ready at http://${HOST}:${PORT}/`);
  console.log("Press Ctrl+C to stop the server.");
});
