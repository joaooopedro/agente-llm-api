// Servidor local para testar: serve public/ e encaminha POST /api/chat para o mesmo serviço usado na Vercel.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { processar } from "./lib/servico.js";

const tipos = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
const porta = Number(process.env.PORT) || 3000;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/chat") {
    const texto = await new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)); });
    let corpo;
    try { corpo = JSON.parse(texto); } catch { corpo = undefined; }
    const { status, corpo: saida } = await processar({ metodo: req.method, corpo, ip: req.socket.remoteAddress });
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(saida));
    return;
  }
  const caminho = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
  try {
    const arquivo = await readFile(join("public", caminho));
    res.writeHead(200, { "content-type": tipos[extname(caminho)] ?? "application/octet-stream" }).end(arquivo);
  } catch {
    res.writeHead(404).end("Não encontrado");
  }
}).listen(porta, () => process.stdout.write(`http://localhost:${porta}\n`));
