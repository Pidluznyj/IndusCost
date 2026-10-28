/**
 * Contrato com a Direct Data para "BoaVistaDefineLimitePositivoPJ".
 *
 * Parte 1 (sempre): o OpenAPI v3 publicado (swagger/v3/swagger.json) foi lido em 28/10/2026 e os campos que o
 * parser consome são conferidos aqui contra a fixture sintética, que segue exatamente esse schema.
 *
 * Parte 2 (só com LIKE_SERASA_CONTRACT_SAMPLE=<arquivo JSON>): a PRIMEIRA resposta real autorizada em produção
 * deve ser salva (redigida) e apontada por essa variável; o teste então confirma que o parser a lê sem campos
 * inesperados nas seções essenciais. Sem a variável, a parte 2 é pulada e registrada como pendência.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildBoaVistaDemoResponse } from "./fixtures.js";
import { parseBoaVistaDefineLimite } from "./parse.js";

const DOCUMENTED_TOP_LEVEL = [
  "cnpj", "razaoSocial", "razaoSocialAnterior", "nomeFantasia", "situacao", "situacaoSintegra", "dataSituacao", "dataConsulta", "dataFundacao",
  "dataEncerramento", "dataSituacaoSintegra", "dataConsultaSintegra", "inscricaoEstadual", "inscricaoEstadualUf", "naturezaJuridica",
  "faixaFuncionarios", "quantidadeFiliais", "cidadesFiliais", "nire", "nireUf", "ramoAtividadePrimario", "ramoAtividadeSecundario",
  "cnaePrimario", "cnaeSecundario", "capitalSocial", "email", "tipoSociedade", "opcaoTributaria", "porte", "telefones", "enderecos",
  "decisoes", "score", "indicadores", "restricoes", "governancas", "alertas", "historicoConsulta", "participacoes",
];
const DOCUMENTED_SCORE = ["layout", "tipoScore", "score", "execucao", "descrPlano", "descrScore", "classificacaoABC", "classificacaoNumero", "probabilidadeInadimplencia", "texto", "risco", "modeloScore", "informante"];
const DOCUMENTED_RESTRICTIONS = ["pendenciasFinanceiras", "protestos", "chequesSemFundoBacen", "chequesSemFundoVarejo", "contumacia", "acoesCiveis", "falenciaRecuperacaoJudicial", "limiteCredito", "faturamentoPresumido"];
const DOCUMENTED_LIMIT = ["descricao", "valor", "texto"];

function keysOf(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value as object) : [];
}

describe("contrato Direct Data — Boa Vista Define Limite Positivo PJ", () => {
  it("a fixture sintética usa somente nomes documentados no OpenAPI v3 (retorno, score, restricoes, limiteCredito)", () => {
    const body = buildBoaVistaDemoResponse({ cnpj: "11444777000161" }) as { metaDados: Record<string, unknown>; retorno: Record<string, unknown> };
    for (const key of keysOf(body.retorno)) assert.ok(DOCUMENTED_TOP_LEVEL.includes(key), `retorno.${key} não documentado`);
    for (const key of keysOf(body.retorno.score)) assert.ok(DOCUMENTED_SCORE.includes(key), `score.${key} não documentado`);
    for (const key of keysOf(body.retorno.restricoes)) assert.ok(DOCUMENTED_RESTRICTIONS.includes(key), `restricoes.${key} não documentado`);
    for (const key of keysOf((body.retorno.restricoes as Record<string, unknown>).limiteCredito)) assert.ok(DOCUMENTED_LIMIT.includes(key), `limiteCredito.${key}`);
    for (const key of ["consultaNome", "consultaUid", "chave", "usuario", "mensagem", "ip", "resultadoId", "resultado", "apiVersao", "enviarCallback", "gerarComprovante", "urlComprovante", "assincrono", "data", "tempoExecucaoMs"]) {
      assert.ok(key in body.metaDados || ["ip"].includes(key), `metaDados.${key}`);
    }
  });

  it("endpoint, método e autenticação conferidos na documentação: GET /api/BoaVistaDefineLimitePositivoPJ, CNPJ + GERARCOMPROVANTE, Bearer", async () => {
    const { BOA_VISTA_DEFINE_LIMITE_PATH } = await import("./config.js");
    assert.equal(BOA_VISTA_DEFINE_LIMITE_PATH, "/api/BoaVistaDefineLimitePositivoPJ");
    const source = readFileSync(new URL("./adapter.ts", import.meta.url), "utf8");
    assert.match(source, /method: "GET"/);
    assert.match(source, /searchParams\.set\("CNPJ"/);
    assert.match(source, /searchParams\.set\("GERARCOMPROVANTE"/);
    assert.match(source, /Authorization: `Bearer /);
    assert.doesNotMatch(source, /searchParams\.set\("TOKEN"/, "token nunca na query string");
    assert.doesNotMatch(source, /searchParams\.set\("Async"/i, "consulta síncrona: o modo assíncrono da Direct Data não é usado");
  });

  const sample = process.env.LIKE_SERASA_CONTRACT_SAMPLE?.trim();
  it(
    "primeira resposta real autorizada (LIKE_SERASA_CONTRACT_SAMPLE): parser lê sem ficar insuficiente e com os campos essenciais presentes",
    { skip: sample && existsSync(sample) ? false : "LIKE_SERASA_CONTRACT_SAMPLE ausente: pendente até a primeira consulta real autorizada em produção." },
    () => {
      const body = JSON.parse(readFileSync(sample!, "utf8")) as { retorno?: Record<string, unknown> };
      const parsed = parseBoaVistaDefineLimite(body);
      assert.equal(parsed.insufficient, false);
      const unexpected = keysOf(body.retorno).filter((key) => !DOCUMENTED_TOP_LEVEL.includes(key));
      assert.deepEqual(unexpected, [], `campos não documentados no retorno real: ${unexpected.join(", ")}`);
      assert.ok(parsed.sections.providerMeta.queryId, "consultaUid presente");
      // Escala do score e unidade do limite: registrar o que veio, sem converter.
      assert.ok(parsed.scoreRaw != null || parsed.sections.unavailable.includes("score"));
      assert.ok(parsed.sections.limit.available || parsed.sections.unavailable.includes("limiteCredito"));
    }
  );
});
