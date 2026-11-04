# Agente de consultas com LLM e APIs reais

Aplicação da disciplina Integração de Software (UniAcademia). O usuário escreve uma pergunta em português, um modelo de linguagem interpreta a intenção e escolhe uma ferramenta, a aplicação consulta uma API pública real e devolve uma resposta organizada.

Aluno: João Pedro Silva de Almeida.

## O que ele responde

| Ferramenta | API real consultada | Exemplo de pergunta |
|---|---|---|
| `consultar_clima` | Open-Meteo (geocodificação e previsão) | Vai chover em Juiz de Fora amanhã? |
| `consultar_cep` | BrasilAPI (versão 2 do endpoint de CEP), com ViaCEP de reserva | Moro no CEP 36033-270, qual é o meu bairro? |
| `cotacao_moeda` | AwesomeAPI, com Frankfurter de reserva | Quanto está o dólar hoje? |
| `consultar_feriados` | BrasilAPI | Quais são os feriados de novembro de 2026? |

Nenhuma dessas APIs exige chave e nenhuma é simulada. A conversa tem memória: depois de perguntar o CEP, "agora me diga apenas o estado" funciona sem chamar a API de novo. A única chave necessária é a do modelo de linguagem (Gemini).

## Como funciona

1. A interface (`public/index.html`) envia a pergunta para `POST /api/chat`.
2. `lib/servico.js` valida a entrada (inclusive o histórico recebido), limita o uso por IP e trata os erros.
3. `lib/agente.js` envia ao modelo a pergunta e a descrição das 4 ferramentas (function calling).
4. O modelo devolve a ferramenta escolhida e os argumentos. Quem executa é a aplicação, não o modelo.
5. `lib/ferramentas.js` valida os argumentos contra o esquema declarado (propriedade fora do esquema é barrada e obrigatório ausente é cobrado), chama a API real com timeout de 8 segundos, usa a API reserva se a principal falhar e normaliza o retorno. Campos que a API não devolve ficam de fora, sem inventar.
6. O resultado, ou o erro tratado, volta ao modelo, que redige a resposta em português.
7. A interface mostra a resposta, a ferramenta usada, os argumentos, a fonte, o tempo e os dados.

O diagrama está em `docs/diagrama-arquitetura.png` (e `.svg`).

## Segurança e governança

- O modelo só sugere a ferramenta e os argumentos. A chamada à API é feita pelo código da aplicação, e o modelo não tem acesso à internet.
- A chave do modelo fica só no servidor (variável de ambiente), nunca no navegador nem no código.
- Os argumentos são validados antes de qualquer chamada (formato do CEP, ano e mês, código da moeda).
- Contra prompt injection: a instrução do modelo trata o que o usuário escreve e o que as ferramentas devolvem como dados, e manda ignorar ordens que apareçam dentro deles. O modelo só enxerga as quatro ferramentas, todas de leitura, sem nenhuma que altere ou apague algo.
- Custo e abuso: limite de 20 perguntas por minuto por IP, pergunta de no máximo 500 caracteres e histórico limitado a 6 turnos.
- Auditoria: cada chamada de ferramenta gera uma linha JSON no log do servidor, com ferramenta, argumentos, fonte, resultado e tempo.

## Tratamento de erros

- Pergunta vazia, acima de 500 caracteres ou método diferente de POST.
- Limite de 20 perguntas por minuto por IP.
- CEP com menos de 8 dígitos (não chama a API) ou inexistente: pede correção ou informa que não encontrou.
- Pergunta sem o dado necessário (por exemplo, "qual o endereço do meu CEP?"): o modelo pede o CEP em vez de chamar a ferramenta.
- Resposta incompleta da API: mostra só os campos disponíveis.
- API principal fora do ar: usa a reserva (BrasilAPI para ViaCEP, AwesomeAPI para Frankfurter).
- Cidade não encontrada, moeda inexistente, ano ou mês fora do intervalo.
- Timeout e falha de rede nas APIs: mensagem clara, sem derrubar o servidor.
- Erro da ferramenta é devolvido ao modelo, que explica o problema ao usuário.
- Modelo sem resposta, limite de uso do modelo (429), chave recusada e indisponibilidade.
- Pergunta fora do escopo: o modelo informa o que consegue consultar, sem chamar ferramenta.
- O agente para após 4 rodadas, para evitar laço infinito.

## Como rodar

Precisa de Node 22 ou mais novo e de uma chave gratuita do Gemini (https://aistudio.google.com/apikey).

```
cp .env.example .env      # coloque a chave em GEMINI_API_KEY
npm run dev               # abre em http://localhost:3000
```

Variáveis:

- `GEMINI_API_KEY`: obrigatória.
- `GEMINI_MODEL`: opcional. Lista de modelos separados por vírgula, na ordem de preferência. Padrão: `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite` e `gemini-3.7-flash`. A chave gratuita limita cada modelo a poucas chamadas por minuto, então, se um estiver sobrecarregado ou sem cota, o próximo é tentado automaticamente.

## Testes

```
npm test            # 31 testes de unidade, offline
npm run test:real   # 7 testes que chamam as APIs de verdade
```

## Publicar na Vercel

Não precisa de build. A pasta `public/` vira o site e `api/chat.js` vira a função. Cadastre `GEMINI_API_KEY` nas variáveis de ambiente do projeto e publique.

## Estrutura

```
api/chat.js          adaptador da função da Vercel
lib/servico.js       validação, limite de uso, mapeamento de erros
lib/agente.js        laço do agente e instrução do modelo
lib/gemini.js        chamada ao modelo (function calling)
lib/ferramentas.js   as 4 ferramentas e o tratamento de erro de cada API
public/index.html    interface
dev.js               servidor local
test/                testes
docs/                diagrama
```
