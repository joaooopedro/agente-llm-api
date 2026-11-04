// Ferramentas que o modelo pode escolher. Cada uma chama uma API pública real, sem chave e sem simulação.

export class ErroFerramenta extends Error {}

const TIMEOUT_MS = 8000;

async function buscarJson(url, fetcher) {
  let r;
  try {
    r = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  } catch (e) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new ErroFerramenta("A API demorou demais para responder. Tente de novo em instantes.");
    throw new ErroFerramenta("Não consegui acessar a API agora. Verifique a conexão e tente de novo.");
  }
  return r;
}

async function lerJson(r) {
  if (r.status >= 500) throw new ErroFerramenta(`A API respondeu com erro (${r.status}). Tente de novo em instantes.`);
  try {
    return await r.json();
  } catch {
    throw new ErroFerramenta("A API devolveu uma resposta que não consegui ler.");
  }
}

const CONDICOES = {
  0: "Céu limpo", 1: "Predomínio de sol", 2: "Parcialmente nublado", 3: "Nublado",
  45: "Neblina", 48: "Neblina com geada", 51: "Garoa fraca", 53: "Garoa", 55: "Garoa forte",
  61: "Chuva fraca", 63: "Chuva", 65: "Chuva forte", 66: "Chuva congelante fraca", 67: "Chuva congelante forte",
  71: "Neve fraca", 73: "Neve", 75: "Neve forte", 80: "Pancadas de chuva fracas", 81: "Pancadas de chuva", 82: "Pancadas de chuva fortes",
  95: "Tempestade", 96: "Tempestade com granizo fraco", 99: "Tempestade com granizo forte",
};

export const ferramentas = {
  consultar_clima: {
    declaracao: {
      name: "consultar_clima",
      description: "Clima atual e previsão dos próximos 3 dias de uma cidade (temperatura, sensação, umidade, vento e chance de chuva). Use para perguntas sobre tempo, temperatura, chuva ou frio.",
      parameters: {
        type: "OBJECT",
        properties: { cidade: { type: "STRING", description: "Nome da cidade, por exemplo 'Juiz de Fora' ou 'Lisboa'." } },
        required: ["cidade"],
      },
    },
    async executar({ cidade }, fetcher) {
      const nome = String(cidade ?? "").trim();
      if (!nome) throw new ErroFerramenta("Informe o nome da cidade.");
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(nome)}&count=1&language=pt`;
      const geo = await lerJson(await buscarJson(geoUrl, fetcher));
      const lugar = geo.results?.[0];
      if (!lugar) throw new ErroFerramenta(`Não encontrei a cidade "${nome}". Confira o nome e tente de novo.`);
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lugar.latitude}&longitude=${lugar.longitude}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3`;
      const d = await lerJson(await buscarJson(url, fetcher));
      if (!d.current) throw new ErroFerramenta("A API de clima não devolveu dados para essa cidade.");
      return {
        fonte: "Open-Meteo (open-meteo.com)",
        dados: {
          local: [lugar.name, lugar.admin1, lugar.country].filter(Boolean).join(", "),
          agora: {
            temperatura_c: d.current.temperature_2m,
            sensacao_c: d.current.apparent_temperature,
            umidade_pct: d.current.relative_humidity_2m,
            vento_kmh: d.current.wind_speed_10m,
            condicao: CONDICOES[d.current.weather_code] ?? "Condição não classificada",
          },
          previsao: (d.daily?.time ?? []).map((dia, i) => ({
            data: dia,
            min_c: d.daily.temperature_2m_min[i],
            max_c: d.daily.temperature_2m_max[i],
            chuva_pct: d.daily.precipitation_probability_max[i],
          })),
        },
      };
    },
  },

  consultar_cep: {
    declaracao: {
      name: "consultar_cep",
      description: "Endereço (rua, bairro, cidade e estado) a partir de um CEP brasileiro de 8 dígitos. Use para perguntas com CEP, para descobrir a cidade ou o estado de um CEP.",
      parameters: {
        type: "OBJECT",
        properties: { cep: { type: "STRING", description: "CEP com 8 dígitos, com ou sem hífen, por exemplo '36010-011'." } },
        required: ["cep"],
      },
    },
    async executar({ cep }, fetcher) {
      const digitos = String(cep ?? "").replace(/\D/g, "");
      if (digitos.length !== 8) throw new ErroFerramenta("O CEP precisa ter 8 dígitos.");
      const limpo = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));
      // Fonte principal: BrasilAPI (versão 2 do endpoint de CEP).
      const principal = await buscarJson(`https://brasilapi.com.br/api/cep/v2/${digitos}`, fetcher);
      if (principal.ok) {
        const d = await principal.json().catch(() => null);
        if (d?.cep) {
          return {
            fonte: "BrasilAPI (brasilapi.com.br)",
            dados: limpo({ cep: `${d.cep.slice(0, 5)}-${d.cep.slice(5)}`, logradouro: d.street, bairro: d.neighborhood, cidade: d.city, uf: d.state }),
          };
        }
      }
      // Reserva: ViaCEP. Só aqui o CEP é considerado inexistente.
      const reserva = await lerJson(await buscarJson(`https://viacep.com.br/ws/${digitos}/json/`, fetcher));
      if (reserva.erro) throw new ErroFerramenta(`CEP ${digitos.slice(0, 5)}-${digitos.slice(5)} não encontrado.`);
      return {
        fonte: "ViaCEP (viacep.com.br)",
        dados: limpo({ cep: reserva.cep, logradouro: reserva.logradouro, complemento: reserva.complemento, bairro: reserva.bairro, cidade: reserva.localidade, uf: reserva.uf, ddd: reserva.ddd }),
      };
    },
  },

  cotacao_moeda: {
    declaracao: {
      name: "cotacao_moeda",
      description: "Cotação atual de uma moeda ou criptomoeda em reais (compra, venda, variação do dia, máxima e mínima). Use para dólar, euro, bitcoin e similares.",
      parameters: {
        type: "OBJECT",
        properties: { moeda: { type: "STRING", description: "Código de 3 letras: USD, EUR, GBP, BTC, ARS..." } },
        required: ["moeda"],
      },
    },
    async executar({ moeda }, fetcher) {
      const codigo = String(moeda ?? "").trim().toUpperCase();
      if (!/^[A-Z]{3,5}$/.test(codigo)) throw new ErroFerramenta("Use o código de 3 letras da moeda, por exemplo USD ou EUR.");
      const r = await buscarJson(`https://economia.awesomeapi.com.br/json/last/${codigo}-BRL`, fetcher);
      if (r.status === 404) throw new ErroFerramenta(`Moeda ${codigo} não encontrada.`);
      const d = r.ok ? await r.json().catch(() => null) : null;
      const c = d?.[`${codigo}BRL`];
      if (c) {
        return {
          fonte: "AwesomeAPI (economia.awesomeapi.com.br)",
          dados: {
            moeda: c.code, nome: c.name, compra: Number(c.bid), venda: Number(c.ask),
            variacao_pct: Number(c.pctChange), maxima: Number(c.high), minima: Number(c.low), atualizado_em: c.create_date,
          },
        };
      }
      // A AwesomeAPI limita por IP e às vezes recusa servidores na nuvem: cai para o Frankfurter (moedas tradicionais).
      if (codigo.length !== 3) throw new ErroFerramenta("A API de cotação não respondeu agora. Tente de novo em instantes.");
      const f = await buscarJson(`https://api.frankfurter.dev/v1/latest?base=${codigo}&symbols=BRL`, fetcher);
      if (f.status === 404 || f.status === 422) throw new ErroFerramenta(`Moeda ${codigo} não encontrada.`);
      const fd = await lerJson(f);
      const taxa = fd?.rates?.BRL;
      if (typeof taxa !== "number") throw new ErroFerramenta("A API de cotação não respondeu agora. Tente de novo em instantes.");
      return {
        fonte: "Frankfurter (frankfurter.dev), dados do Banco Central Europeu",
        dados: { moeda: codigo, nome: `${codigo}/BRL`, compra: taxa, venda: taxa, variacao_pct: null, maxima: null, minima: null, atualizado_em: `${fd.date} 00:00:00` },
      };
    },
  },

  consultar_feriados: {
    declaracao: {
      name: "consultar_feriados",
      description: "Feriados nacionais do Brasil em um ano, podendo filtrar por mês. Use para perguntas sobre feriados, folgas e datas comemorativas.",
      parameters: {
        type: "OBJECT",
        properties: {
          ano: { type: "INTEGER", description: "Ano com 4 dígitos, por exemplo 2026." },
          mes: { type: "INTEGER", description: "Mês de 1 a 12. Omita para o ano inteiro." },
        },
        required: ["ano"],
      },
    },
    async executar({ ano, mes }, fetcher) {
      const a = Number(ano);
      if (!Number.isInteger(a) || a < 1900 || a > 2199) throw new ErroFerramenta("O ano precisa estar entre 1900 e 2199.");
      const m = mes == null ? null : Number(mes);
      if (m !== null && (!Number.isInteger(m) || m < 1 || m > 12)) throw new ErroFerramenta("O mês precisa estar entre 1 e 12.");
      const lista = await lerJson(await buscarJson(`https://brasilapi.com.br/api/feriados/v1/${a}`, fetcher));
      if (!Array.isArray(lista)) throw new ErroFerramenta("A API de feriados devolveu uma resposta inesperada.");
      const filtrados = lista.filter((f) => m === null || Number(f.date.slice(5, 7)) === m);
      return {
        fonte: "BrasilAPI (brasilapi.com.br)",
        dados: { ano: a, mes: m, feriados: filtrados.map((f) => ({ data: f.date, nome: f.name })) },
      };
    },
  },
};

// O esquema declarado ao modelo também vale como contrato: propriedade fora dele é barrada, obrigatória ausente é cobrada.
function validarArgumentos(declaracao, args) {
  const { properties, required = [] } = declaracao.parameters;
  const extras = Object.keys(args).filter((k) => !(k in properties));
  if (extras.length) throw new ErroFerramenta(`Argumento não previsto: ${extras.join(", ")}.`);
  const faltam = required.filter((k) => args[k] === undefined || args[k] === null || args[k] === "");
  if (faltam.length) throw new ErroFerramenta(`Faltou informar: ${faltam.join(", ")}.`);
  for (const [k, v] of Object.entries(args)) {
    const tipo = properties[k].type;
    if (tipo === "INTEGER" && !Number.isInteger(Number(v))) throw new ErroFerramenta(`O valor de ${k} precisa ser um número inteiro.`);
    if (tipo === "STRING" && typeof v !== "string" && typeof v !== "number") throw new ErroFerramenta(`O valor de ${k} precisa ser um texto.`);
  }
}

export async function executar(nome, args, fetcher = fetch) {
  const f = ferramentas[nome];
  if (!f) throw new ErroFerramenta(`Ferramenta desconhecida: ${nome}.`);
  const argumentos = args && typeof args === "object" ? args : {};
  validarArgumentos(f.declaracao, argumentos);
  return f.executar(argumentos, fetcher);
}
