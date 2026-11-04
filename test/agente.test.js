import { test } from "node:test";
import assert from "node:assert/strict";
import { responder, ErroAgente } from "../lib/agente.js";
import { processar } from "../lib/servico.js";
import { criarGemini } from "../lib/gemini.js";

const resp = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo });
const texto = (t) => ({ role: "model", parts: [{ text: t }] });
const chamada = (name, args) => ({ role: "model", parts: [{ functionCall: { name, args } }] });

// LLM roteirizado: devolve as respostas em ordem e guarda o que recebeu.
const llmDe = (...respostas) => {
  const recebido = [];
  const fn = async (contents) => { recebido.push(structuredClone(contents)); return respostas.shift(); };
  fn.recebido = recebido;
  return fn;
};

test("pergunta com ferramenta: escolhe, executa, devolve resposta e passo", async () => {
  const fetcher = async () => resp({ cep: "36010011", street: "Av. Barão do Rio Branco", neighborhood: "Centro", city: "Juiz de Fora", state: "MG" });
  const llm = llmDe(chamada("consultar_cep", { cep: "36010011" }), texto("É no Centro de Juiz de Fora, MG."));
  const r = await responder("Onde fica o CEP 36010-011?", { llm, fetcher });
  assert.equal(r.resposta, "É no Centro de Juiz de Fora, MG.");
  assert.equal(r.passos.length, 1);
  assert.equal(r.passos[0].ferramenta, "consultar_cep");
  assert.equal(r.passos[0].ok, true);
  assert.equal(r.passos[0].dados.uf, "MG");
  // o resultado real da API foi devolvido ao modelo na 2ª rodada
  const ultima = llm.recebido[1].at(-1);
  assert.equal(ultima.parts[0].functionResponse.name, "consultar_cep");
  assert.equal(ultima.parts[0].functionResponse.response.resultado.cidade, "Juiz de Fora");
});

test("erro da ferramenta volta ao modelo como erro e aparece no passo", async () => {
  const fetcher = async (url) => (url.includes("brasilapi") ? resp({}, 404) : resp({ erro: "true" }));
  const llm = llmDe(chamada("consultar_cep", { cep: "00000000" }), texto("Esse CEP não existe."));
  const r = await responder("CEP 00000000", { llm, fetcher });
  assert.equal(r.passos[0].ok, false);
  assert.match(r.passos[0].erro, /não encontrado/);
  assert.match(llm.recebido[1].at(-1).parts[0].functionResponse.response.erro, /não encontrado/);
  assert.equal(r.resposta, "Esse CEP não existe.");
});

test("pergunta fora do escopo: sem ferramenta, sem passos", async () => {
  const r = await responder("Quem ganhou a copa?", { llm: llmDe(texto("Só consulto clima, CEP, cotação e feriados.")), fetcher: async () => { throw new Error("não devia chamar"); } });
  assert.deepEqual(r.passos, []);
});

test("duas ferramentas na mesma pergunta", async () => {
  const fetcher = async (url) => url.includes("awesomeapi")
    ? resp({ USDBRL: { code: "USD", name: "Dólar", bid: "5.5", ask: "5.6", pctChange: "0.1", high: "5.7", low: "5.4", create_date: "x" } })
    : resp([{ date: "2026-11-15", name: "Proclamação da República" }]);
  const llm = llmDe(
    { role: "model", parts: [{ functionCall: { name: "cotacao_moeda", args: { moeda: "USD" } } }, { functionCall: { name: "consultar_feriados", args: { ano: 2026, mes: 11 } } }] },
    texto("Dólar a R$ 5,50 e feriado dia 15."),
  );
  const r = await responder("dólar e feriados de novembro", { llm, fetcher });
  assert.deepEqual(r.passos.map((p) => p.ferramenta), ["cotacao_moeda", "consultar_feriados"]);
});

test("modelo que não para de chamar ferramenta é interrompido", async () => {
  const fetcher = async () => resp({ erro: "true" });
  const llm = async () => chamada("consultar_cep", { cep: "00000000" });
  await assert.rejects(responder("x", { llm, fetcher }), ErroAgente);
});

test("modelo sem texto nem ferramenta", async () => {
  await assert.rejects(responder("x", { llm: llmDe({ role: "model", parts: [] }), fetcher: async () => {} }), ErroAgente);
});

test("serviço: valida entrada antes de gastar o modelo", async () => {
  const chave = { chave: "k" };
  assert.equal((await processar({ metodo: "GET" }, chave)).status, 405);
  assert.equal((await processar({ metodo: "POST", corpo: {} }, chave)).status, 400);
  assert.equal((await processar({ metodo: "POST", corpo: { pergunta: "   " } }, chave)).status, 400);
  assert.equal((await processar({ metodo: "POST", corpo: { pergunta: "a".repeat(501) } }, chave)).status, 400);
  assert.equal((await processar({ metodo: "POST", corpo: { pergunta: "oi" } }, {})).status, 500);
});

test("serviço: erros do modelo viram mensagens claras", async () => {
  const mk = (status) => async () => { const e = new Error("x"); e.name = "ErroLLM"; e.status = status; throw e; };
  const base = { metodo: "POST", corpo: { pergunta: "oi" }, ip: "1.1.1.1" };
  assert.equal((await processar(base, { chave: "k", llm: mk(429) })).status, 429);
  assert.equal((await processar(base, { chave: "k", llm: mk(403) })).status, 502);
  assert.equal((await processar(base, { chave: "k", llm: mk(503) })).status, 502);
});

test("serviço: limite de uso por IP", async () => {
  const llm = async () => texto("ok");
  let ultimo;
  for (let i = 0; i < 22; i++) ultimo = await processar({ metodo: "POST", corpo: { pergunta: "oi" }, ip: "9.9.9.9" }, { chave: "k", llm });
  assert.equal(ultimo.status, 429);
});

test("serviço: caminho feliz devolve resposta e passos", async () => {
  const r = await processar({ metodo: "POST", corpo: { pergunta: "oi" }, ip: "2.2.2.2" }, { chave: "k", llm: async () => texto("Olá!") });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.resposta, "Olá!");
  assert.deepEqual(r.corpo.passos, []);
});

test("modelo: se o primeiro falha por sobrecarga, usa o próximo; erro de chave não troca", async () => {
  const usados = [];
  const fetcher = async (url) => {
    const modelo = url.match(/models\/([^:]+):/)[1];
    usados.push(modelo);
    return modelo === "a" ? resp({ error: { message: "high demand" } }, 503) : resp({ candidates: [{ content: texto("ok") }] });
  };
  const r = await criarGemini({ chave: "k", modelos: ["a", "b"], fetcher })([{ role: "user", parts: [{ text: "oi" }] }]);
  assert.deepEqual(usados, ["a", "b"]);
  assert.equal(r.parts[0].text, "ok");

  const recusa = async () => resp({ error: { message: "API key not valid" } }, 403);
  await assert.rejects(criarGemini({ chave: "k", modelos: ["a", "b"], fetcher: recusa })([]), (e) => e.status === 403);
});

test("histórico: a conversa anterior vai ao modelo e o estado é reaproveitado", async () => {
  const llm = llmDe(texto("É MG."));
  const historico = [{ pergunta: "CEP 36010011", resposta: "Juiz de Fora, MG." }];
  await responder("Agora diga só o estado.", { llm, fetcher: async () => {}, historico });
  const enviado = llm.recebido[0];
  assert.deepEqual(enviado.map((c) => c.role), ["user", "model", "user"]);
  assert.equal(enviado[1].parts[0].text, "Juiz de Fora, MG.");
  assert.equal(enviado[2].parts[0].text, "Agora diga só o estado.");
});

test("auditoria: cada chamada de ferramenta é registrada com argumentos, resultado e tempo", async () => {
  const registros = [];
  const fetcher = async () => resp({ cep: "36010011", state: "MG", city: "Juiz de Fora" });
  const llm = llmDe(chamada("consultar_cep", { cep: "36010011" }), texto("ok"));
  await responder("cep", { llm, fetcher, log: (r) => registros.push(r) });
  assert.equal(registros.length, 1);
  assert.equal(registros[0].evento, "ferramenta");
  assert.equal(registros[0].ferramenta, "consultar_cep");
  assert.equal(registros[0].ok, true);
  assert.equal(typeof registros[0].ms, "number");
});

test("instrução trata dados das APIs como dados e nunca como ordem (prompt injection)", async () => {
  const { instrucao } = await import("../lib/agente.js");
  assert.match(instrucao("hoje"), /injeção|instruções que apareçam/i);
});

test("serviço: histórico inválido é descartado e o tamanho é limitado", async () => {
  let recebido;
  const llm = async (contents) => { recebido = contents; return texto("ok"); };
  const historico = [
    { pergunta: "a", resposta: "b" }, { pergunta: 1, resposta: "x" }, { pergunta: "c", resposta: "d".repeat(5000) },
    ...Array.from({ length: 10 }, (_, i) => ({ pergunta: "p" + i, resposta: "r" + i })),
  ];
  const r = await processar({ metodo: "POST", corpo: { pergunta: "oi", historico }, ip: "h1" }, { chave: "k", llm });
  assert.equal(r.status, 200);
  assert.ok(recebido.length <= 1 + 2 * 6);
  assert.ok(recebido.every((c) => c.parts[0].text.length <= 1000));
  assert.equal(recebido.at(-1).parts[0].text, "oi");
});
