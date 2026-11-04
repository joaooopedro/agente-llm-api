import { processar } from "../lib/servico.js";

export default async function handler(req, res) {
  const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "desconhecido";
  const { status, corpo } = await processar({ metodo: req.method, corpo: req.body, ip });
  res.status(status).json(corpo);
}
