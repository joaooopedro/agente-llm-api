import { test } from "node:test";
import assert from "node:assert/strict";
import { ferramentas, executar, ErroFerramenta } from "../lib/ferramentas.js";

// Resposta falsa só nestes testes de unidade (offline). A prova de integração real está em real.test.js.
const resp = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo });
const fetcherDe = (mapa) => async (url) => {
  const chave = Object.keys(mapa).find((k) => url.includes(k));
  if (!chave) throw new Error("url inesperada: " + url);
  const v = mapa[chave];
  return typeof v === "function" ? v(url) : v;
};

test("declara as 4 ferramentas com nome, descrição e parâmetros", () => {
  assert.deepEqual(Object.keys(ferramentas).sort(), ["consultar_cep", "consultar_clima", "consultar_feriados", "cotacao_moeda"]);
  for (const f of Object.values(ferramentas)) {
    assert.ok(f.declaracao.description.length > 20);
    assert.equal(f.declaracao.parameters.type, "OBJECT");
  }
});

test("cep: normaliza e devolve endereço", async () => {
  const fetcher = fetcherDe({ "brasilapi": resp({}, 404), "viacep.com.br/ws/36010011/json": resp({ cep: "36010-011", logradouro: "Avenida Barão do Rio Branco", bairro: "Centro", localidade: "Juiz de Fora", uf: "MG", ddd: "32" }) });
  const r = await executar("consultar_cep", { cep: "36010-011" }, fetcher);
  assert.equal(r.dados.cidade, "Juiz de Fora");
  assert.equal(r.dados.uf, "MG");
  assert.match(r.fonte, /ViaCEP/);
});

test("cep: formato inválido não chama a API", async () => {
  const fetcher = async () => { throw new Error("não devia chamar"); };
  await assert.rejects(executar("consultar_cep", { cep: "123" }, fetcher), (e) => e instanceof ErroFerramenta && /8 dígitos/.test(e.message));
});

test("cep: inexistente vira erro claro", async () => {
  const fetcher = fetcherDe({ "brasilapi": resp({}, 404), "viacep": resp({ erro: "true" }) });
  await assert.rejects(executar("consultar_cep", { cep: "00000000" }, fetcher), (e) => e instanceof ErroFerramenta && /não encontrado/i.test(e.message));
});

test("cotação: devolve compra, venda e variação", async () => {
  const fetcher = fetcherDe({ "awesomeapi": resp({ USDBRL: { code: "USD", name: "Dólar Americano/Real Brasileiro", bid: "5.4871", ask: "5.4885", pctChange: "-0.02", high: "5.49", low: "5.45", create_date: "2026-11-04 13:20:31" } }) });
  const r = await executar("cotacao_moeda", { moeda: "usd" }, fetcher);
  assert.equal(r.dados.compra, 5.4871);
  assert.equal(r.dados.moeda, "USD");
});

test("cotação: código inválido e moeda inexistente", async () => {
  const f404 = fetcherDe({ "awesomeapi": resp({ code: "CoinNotExists" }, 404) });
  await assert.rejects(executar("cotacao_moeda", { moeda: "dólar" }, f404), /código de 3 letras/);
  await assert.rejects(executar("cotacao_moeda", { moeda: "ZZZ" }, f404), /não encontrada/i);
});

test("clima: cidade inexistente", async () => {
  const fetcher = fetcherDe({ "geocoding-api": resp({ generationtime_ms: 0.1 }) });
  await assert.rejects(executar("consultar_clima", { cidade: "zzzxx" }, fetcher), /não encontrei a cidade/i);
});

test("clima: junta geocodificação e previsão", async () => {
  const fetcher = fetcherDe({
    "geocoding-api": resp({ results: [{ name: "Juiz de Fora", country: "Brasil", admin1: "Minas Gerais", latitude: -21.76, longitude: -43.35 }] }),
    "api.open-meteo": resp({
      current: { temperature_2m: 24.1, apparent_temperature: 25, relative_humidity_2m: 60, wind_speed_10m: 8, weather_code: 3 },
      daily: { time: ["2026-11-04", "2026-11-05"], temperature_2m_max: [28, 27], temperature_2m_min: [17, 16], precipitation_probability_max: [10, 70] },
    }),
  });
  const r = await executar("consultar_clima", { cidade: "Juiz de Fora" }, fetcher);
  assert.equal(r.dados.agora.condicao, "Nublado");
  assert.equal(r.dados.previsao.length, 2);
  assert.equal(r.dados.previsao[1].chuva_pct, 70);
});

test("feriados: filtra por mês e valida ano", async () => {
  const fetcher = fetcherDe({ "brasilapi.com.br/api/feriados": resp([
    { date: "2026-10-12", name: "Nossa Senhora Aparecida", type: "national" },
    { date: "2026-11-02", name: "Finados", type: "national" },
    { date: "2026-11-15", name: "Proclamação da República", type: "national" },
  ]) });
  const r = await executar("consultar_feriados", { ano: 2026, mes: 11 }, fetcher);
  assert.deepEqual(r.dados.feriados.map((f) => f.nome), ["Finados", "Proclamação da República"]);
  await assert.rejects(executar("consultar_feriados", { ano: 1800 }, fetcher), /entre 1900 e 2199/);
});

test("ferramenta desconhecida", async () => {
  await assert.rejects(executar("apagar_tudo", {}, async () => {}), /desconhecida/);
});

test("timeout e erro de rede viram mensagem amigável", async () => {
  const lento = async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; };
  await assert.rejects(executar("consultar_cep", { cep: "36010011" }, lento), /demorou/);
  const cai = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(executar("consultar_cep", { cep: "36010011" }, cai), /não consegui acessar/i);
  const f500 = async () => resp({}, 500);
  await assert.rejects(executar("consultar_cep", { cep: "36010011" }, f500), /respondeu com erro/);
});

test("cotação: se a AwesomeAPI recusar, usa o Frankfurter", async () => {
  const fetcher = fetcherDe({
    "awesomeapi": resp({}, 429),
    "frankfurter": resp({ date: "2026-11-04", rates: { BRL: 5.4654 } }),
  });
  const r = await executar("cotacao_moeda", { moeda: "USD" }, fetcher);
  assert.equal(r.dados.compra, 5.4654);
  assert.match(r.fonte, /Frankfurter/);
  const sem = fetcherDe({ "awesomeapi": resp({}, 429), "frankfurter": resp({}, 404) });
  await assert.rejects(executar("cotacao_moeda", { moeda: "USD" }, sem), /não encontrada/i);
});

test("argumentos: propriedade fora do esquema é barrada e obrigatório ausente é cobrado", async () => {
  const fetcher = async () => { throw new Error("não devia chamar"); };
  await assert.rejects(executar("consultar_cep", { cep: "36010011", extra: "x" }, fetcher), /não previsto/i);
  await assert.rejects(executar("consultar_cep", {}, fetcher), /Faltou informar: cep/);
  await assert.rejects(executar("consultar_feriados", { ano: "dois mil" }, fetcher), /ano/);
});

test("cep: BrasilAPI é a fonte principal", async () => {
  const fetcher = fetcherDe({ "brasilapi.com.br/api/cep/v2/36010011": resp({ cep: "36010011", state: "MG", city: "Juiz de Fora", neighborhood: "Centro", street: "Avenida Barão do Rio Branco", service: "open-cep" }) });
  const r = await executar("consultar_cep", { cep: "36010-011" }, fetcher);
  assert.equal(r.dados.cidade, "Juiz de Fora");
  assert.equal(r.dados.logradouro, "Avenida Barão do Rio Branco");
  assert.match(r.fonte, /BrasilAPI/);
});

test("cep: se a BrasilAPI falhar, usa o ViaCEP; se ambos negarem, não encontrado", async () => {
  const reserva = fetcherDe({
    "brasilapi": resp({ message: "erro" }, 404),
    "viacep": resp({ cep: "36010-011", logradouro: "Av. X", bairro: "Centro", localidade: "Juiz de Fora", uf: "MG", ddd: "32" }),
  });
  const r = await executar("consultar_cep", { cep: "36010011" }, reserva);
  assert.match(r.fonte, /ViaCEP/);
  const nenhum = fetcherDe({ "brasilapi": resp({}, 404), "viacep": resp({ erro: "true" }) });
  await assert.rejects(executar("consultar_cep", { cep: "00000000" }, nenhum), /não encontrado/i);
});

test("resposta incompleta: campos vazios ficam de fora, sem inventar", async () => {
  const fetcher = fetcherDe({ "brasilapi": resp({ cep: "36010011", state: "MG", city: "Juiz de Fora", neighborhood: "", street: "" }) });
  const r = await executar("consultar_cep", { cep: "36010011" }, fetcher);
  assert.equal(r.dados.logradouro, undefined);
  assert.equal(r.dados.bairro, undefined);
  assert.equal(r.dados.uf, "MG");
});
