import { executar, ferramentas, ErroFerramenta } from "./ferramentas.js";

export class ErroAgente extends Error {}

const MAX_RODADAS = 4;

export const declaracoes = () => Object.values(ferramentas).map((f) => f.declaracao);

export function instrucao(hoje) {
  return [
    "Você é um assistente de consultas em português do Brasil.",
    `Hoje é ${hoje}.`,
    "Você tem ferramentas para: clima e previsão de uma cidade, endereço a partir de CEP, cotação de moedas em reais e feriados nacionais do Brasil.",
    "Para qualquer pergunta que essas ferramentas cobrem, escolha a ferramenta certa e use os dados que ela devolver. Nunca invente números, datas ou endereços.",
    "Se faltar um dado obrigatório (por exemplo a cidade ou o CEP), pergunte ao usuário em vez de chamar a ferramenta.",
    "Se a ferramenta devolver erro, explique o problema com clareza e diga o que o usuário pode fazer.",
    "Se a pergunta estiver fora do que as ferramentas cobrem, não responda de memória: diga em uma frase o que você consegue consultar e dê um exemplo.",
    "Responda curto, em texto simples, sem markdown, sem tabelas e sem emojis. Use unidades (°C, km/h, R$) e datas no formato dia/mês/ano.",
  ].join("\n");
}

async function rodarFerramenta(chamada, fetcher) {
  const { name, args } = chamada;
  const inicio = Date.now();
  try {
    const r = await executar(name, args, fetcher);
    return { ferramenta: name, argumentos: args ?? {}, ok: true, ms: Date.now() - inicio, fonte: r.fonte, dados: r.dados };
  } catch (e) {
    if (!(e instanceof ErroFerramenta)) throw e;
    return { ferramenta: name, argumentos: args ?? {}, ok: false, ms: Date.now() - inicio, erro: e.message };
  }
}

// llm(contents) devolve o conteúdo do modelo: { role: "model", parts: [...] }
export async function responder(pergunta, { llm, fetcher = fetch }) {
  const contents = [{ role: "user", parts: [{ text: pergunta }] }];
  const passos = [];
  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const modelo = await llm(contents);
    const parts = modelo?.parts ?? [];
    const chamadas = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
    if (chamadas.length === 0) {
      const resposta = parts.map((p) => p.text ?? "").join("").trim();
      if (!resposta) throw new ErroAgente("O modelo não devolveu resposta.");
      return { resposta, passos };
    }
    contents.push(modelo);
    const feitos = await Promise.all(chamadas.map((c) => rodarFerramenta(c, fetcher)));
    passos.push(...feitos);
    contents.push({
      role: "user",
      parts: feitos.map((p) => ({ functionResponse: { name: p.ferramenta, response: p.ok ? { resultado: p.dados } : { erro: p.erro } } })),
    });
  }
  throw new ErroAgente("Não consegui concluir a consulta. Tente reformular a pergunta.");
}
