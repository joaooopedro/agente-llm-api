import { declaracoes, instrucao } from "./agente.js";

export class ErroLLM extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.name = "ErroLLM";
    this.status = status;
  }
}

// Em ordem de preferência. Se um modelo estiver sobrecarregado, sem cota ou fora do ar, o próximo é tentado.
export const MODELOS_PADRAO = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.7-flash"];
const TROCA_DE_MODELO = new Set([404, 429, 500, 502, 503, 504]);

export const hojePorExtenso = () =>
  new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", year: "numeric" });

async function chamar(contents, { chave, modelo, fetcher }) {
  let r;
  try {
    r = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": chave },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instrucao(hojePorExtenso()) }] },
        contents,
        tools: [{ functionDeclarations: declaracoes() }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { temperature: 0.2 },
      }),
    });
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new ErroLLM("O modelo demorou demais.", 504);
    throw new ErroLLM("Não consegui falar com o modelo.", 502);
  }
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroLLM(corpo?.error?.message ?? `Erro ${r.status} do modelo.`, r.status);
  const candidato = corpo.candidates?.[0];
  if (!candidato?.content) throw new ErroLLM(`O modelo não devolveu conteúdo (${corpo.promptFeedback?.blockReason ?? candidato?.finishReason ?? "sem motivo"}).`, 502);
  return candidato.content;
}

export function criarGemini({ chave, modelos = MODELOS_PADRAO, fetcher = fetch }) {
  return async (contents) => {
    let ultimo;
    for (const modelo of modelos) {
      try {
        return await chamar(contents, { chave, modelo, fetcher });
      } catch (e) {
        if (!(e instanceof ErroLLM) || !TROCA_DE_MODELO.has(e.status)) throw e;
        console.error(`[modelo] ${modelo} falhou (${e.status}), tentando o próximo`);
        ultimo = e;
      }
    }
    throw ultimo;
  };
}
