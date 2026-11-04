import { test } from "node:test";
import assert from "node:assert/strict";
import { executar } from "../lib/ferramentas.js";

const real = process.env.REAL ? test : test.skip;

real("clima real: Juiz de Fora", async () => {
  const r = await executar("consultar_clima", { cidade: "Juiz de Fora" });
  assert.match(r.dados.local, /Juiz de Fora/);
  assert.equal(typeof r.dados.agora.temperatura_c, "number");
  assert.equal(r.dados.previsao.length, 3);
});

real("cep real: 36010-011", async () => {
  const r = await executar("consultar_cep", { cep: "36010-011" });
  assert.equal(r.dados.uf, "MG");
});

real("cep real inexistente", async () => {
  await assert.rejects(executar("consultar_cep", { cep: "00000000" }), /não encontrado/);
});

real("cotação real: USD", async () => {
  const r = await executar("cotacao_moeda", { moeda: "USD" });
  assert.ok(r.dados.compra > 0);
});

real("cotação real inexistente", async () => {
  await assert.rejects(executar("cotacao_moeda", { moeda: "ZZZ" }), /não encontrada/);
});

real("feriados reais: novembro de 2026", async () => {
  const r = await executar("consultar_feriados", { ano: 2026, mes: 11 });
  assert.ok(r.dados.feriados.some((f) => /Finados/.test(f.nome)));
});

real("cidade inexistente real", async () => {
  await assert.rejects(executar("consultar_clima", { cidade: "zzzxxqq" }), /não encontrei/i);
});
