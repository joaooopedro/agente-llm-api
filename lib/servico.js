import { responder, ErroAgente } from "./agente.js";
import { criarGemini } from "./gemini.js";

const MAX_CARACTERES = 500;
const LIMITE_POR_MINUTO = 20;

// ponytail: contador em memória por instância. Se o tráfego crescer, trocar por um store compartilhado.
const acessos = new Map();
function estourouLimite(ip) {
  const agora = Date.now();
  const recentes = (acessos.get(ip) ?? []).filter((t) => agora - t < 60_000);
  recentes.push(agora);
  acessos.set(ip, recentes);
  return recentes.length > LIMITE_POR_MINUTO;
}

const erro = (status, mensagem) => ({ status, corpo: { erro: mensagem } });

// Independe de plataforma: api/chat.js (Vercel) e dev.js (local) só adaptam entrada e saída.
export async function processar({ metodo, corpo, ip = "local" }, { chave = process.env.GEMINI_API_KEY, modelos = process.env.GEMINI_MODEL, llm, fetcher } = {}) {
  if (metodo !== "POST") return erro(405, "Use o método POST.");
  const pergunta = typeof corpo?.pergunta === "string" ? corpo.pergunta.trim() : "";
  if (!pergunta) return erro(400, "Escreva uma pergunta.");
  if (pergunta.length > MAX_CARACTERES) return erro(400, `A pergunta pode ter no máximo ${MAX_CARACTERES} caracteres.`);
  if (!chave && !llm) return erro(500, "O servidor está sem a chave do modelo (GEMINI_API_KEY).");
  if (estourouLimite(ip)) return erro(429, "Muitas perguntas em pouco tempo. Aguarde um minuto.");

  const inicio = Date.now();
  try {
    const r = await responder(pergunta, { llm: llm ?? criarGemini({ chave, modelos: modelos ? modelos.split(",").map((m) => m.trim()) : undefined }), fetcher });
    return { status: 200, corpo: { ...r, ms: Date.now() - inicio } };
  } catch (e) {
    if (e instanceof ErroAgente) return erro(502, e.message);
    if (e?.name === "ErroLLM") {
      console.error("[modelo]", e.status, e.message);
      if (e.status === 429) return erro(429, "O modelo atingiu o limite de uso. Aguarde um minuto e tente de novo.");
      if (e.status === 504) return erro(504, "O modelo demorou demais para responder. Tente de novo.");
      if (e.status === 400 || e.status === 401 || e.status === 403) return erro(502, "O servidor não conseguiu autenticar no modelo. Avise o responsável.");
      return erro(502, "O modelo está indisponível agora. Tente de novo em instantes.");
    }
    console.error("[erro inesperado]", e);
    return erro(500, "Algo deu errado do nosso lado. Tente de novo.");
  }
}
