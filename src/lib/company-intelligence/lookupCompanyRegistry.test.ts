import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { CompanyIntelligenceError } from "./errors.js";
import { lookupCompanyRegistry, resetCompanyIntelligenceCaches } from "./lookupCompanyRegistry.js";
import { CNPJ_SOURCE_BRASIL_API, CNPJ_SOURCE_PUBLICA } from "./registryTypes.js";

const CNPJ = "11444777000161";
const CNPJ_BB = "00000000000191";

const PUBLICA_PAYLOAD = {
  razao_social: "EMPRESA TESTE LTDA",
  capital_social: "250000.00",
  porte: { descricao: "Demais" },
  natureza_juridica: { descricao: "Sociedade Limitada" },
  socios: [{ nome: "João Silva", qualificacao_socio: { descricao: "Sócio" } }],
  estabelecimento: {
    cnpj: CNPJ,
    nome_fantasia: "EMPRESA TESTE",
    situacao_cadastral: "Ativa",
    data_inicio_atividade: "2010-05-01",
    tipo_logradouro: "RUA",
    logradouro: "DAS FLORES",
    numero: "100",
    bairro: "CENTRO",
    cep: "80010000",
    ddd1: "41",
    telefone1: "33334444",
    email: "contato@empresa.com",
    atividade_principal: { id: "2511000", descricao: "Fabricação de estruturas metálicas" },
    atividades_secundarias: [],
    cidade: { nome: "Curitiba" },
    estado: { sigla: "PR" },
    inscricoes_estaduais: [],
  },
};

const BRASIL_API_PAYLOAD = {
  cnpj: CNPJ,
  razao_social: "EMPRESA TESTE LTDA",
  nome_fantasia: "EMPRESA TESTE",
  descricao_situacao_cadastral: "Ativa",
  data_inicio_atividade: "2010-05-01",
  descricao_porte: "Demais",
  natureza_juridica: "Sociedade Limitada",
  capital_social: 250000,
  cnae_fiscal: 2511000,
  cnae_fiscal_descricao: "Fabricação de estruturas metálicas",
  logradouro: "RUA DAS FLORES",
  numero: "100",
  bairro: "CENTRO",
  cep: "80010000",
  municipio: "CURITIBA",
  uf: "PR",
  ddd_telefone_1: "4133334444",
  email: "contato@empresa.com",
  qsa: [{ nome_socio: "João Silva", qualificacao_socio: "Sócio" }],
};

function jsonResponse(status: number, body: unknown = {}): () => Promise<Response> {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

function abortError(): Error {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

type RouteResult = Response | "timeout" | "network" | (() => Promise<Response>);

function mockRegistryFetch(
  spec: { publica?: RouteResult; brasilApi?: RouteResult },
  calls: string[]
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const pick = url.includes("publica.cnpj.ws")
      ? spec.publica
      : url.includes("brasilapi.com.br")
        ? spec.brasilApi
        : undefined;
    if (pick === "timeout") throw abortError();
    if (pick === "network") throw new Error("ECONNRESET");
    if (typeof pick === "function") return pick();
    if (pick instanceof Response) return pick;
    throw new Error(`URL inesperada no teste de registro: ${url}`);
  }) as typeof fetch;
}

describe("lookupCompanyRegistry — agregador multi-fonte", () => {
  beforeEach(() => {
    resetCompanyIntelligenceCaches();
  });
  afterEach(() => {
    resetCompanyIntelligenceCaches();
  });

  it("CNPJ inválido não dispara HTTP", async () => {
    const calls: string[] = [];
    const fetchImpl = mockRegistryFetch(
      {
        publica: jsonResponse(200, PUBLICA_PAYLOAD),
        brasilApi: jsonResponse(200, BRASIL_API_PAYLOAD),
      },
      calls
    );
    await assert.rejects(
      () => lookupCompanyRegistry({ cnpj: "123", fetchImpl }),
      (error: unknown) =>
        error instanceof CompanyIntelligenceError &&
        error.code === "INVALID_CNPJ" &&
        error.httpStatus === 422
    );
    assert.equal(calls.length, 0);
  });

  it("BrasilAPI OK + publica falha → fallback parcial", async () => {
    const calls: string[] = [];
    const result = await lookupCompanyRegistry({
      cnpj: CNPJ,
      fetchImpl: mockRegistryFetch(
        {
          publica: jsonResponse(500, { error: "down" }),
          brasilApi: jsonResponse(200, BRASIL_API_PAYLOAD),
        },
        calls
      ),
    });
    assert.equal(result.winningSource, CNPJ_SOURCE_BRASIL_API);
    assert.equal(result.registryRole, "fallback");
    assert.equal(result.partialResult, true);
    assert.equal(result.summary.companyName, "EMPRESA TESTE LTDA");
    assert.equal(result.primary.status, "ERROR");
    assert.equal(result.secondary.status, "SUCCESS");
    assert.ok(calls.some((url) => url.includes("publica.cnpj.ws")));
    assert.ok(calls.some((url) => url.includes("brasilapi.com.br")));
  });

  it("publica OK + BrasilAPI falha → sucesso parcial com fonte principal", async () => {
    const result = await lookupCompanyRegistry({
      cnpj: CNPJ,
      fetchImpl: mockRegistryFetch({
        publica: jsonResponse(200, PUBLICA_PAYLOAD),
        brasilApi: jsonResponse(503, { error: "down" }),
      }, []),
    });
    assert.equal(result.winningSource, CNPJ_SOURCE_PUBLICA);
    assert.equal(result.registryRole, "primary");
    assert.equal(result.partialResult, true);
    assert.equal(result.summary.companyName, "EMPRESA TESTE LTDA");
    assert.equal(result.secondary.status, "ERROR");
  });

  it("todas as fontes OK", async () => {
    const result = await lookupCompanyRegistry({
      cnpj: CNPJ,
      fetchImpl: mockRegistryFetch({
        publica: jsonResponse(200, PUBLICA_PAYLOAD),
        brasilApi: jsonResponse(200, BRASIL_API_PAYLOAD),
      }, []),
    });
    assert.equal(result.partialResult, false);
    assert.equal(result.winningSource, CNPJ_SOURCE_PUBLICA);
    assert.equal(result.registryRole, "primary");
    assert.equal(result.primary.status, "SUCCESS");
    assert.equal(result.secondary.status, "SUCCESS");
    assert.equal(result.sources.length, 2);
  });

  it("conflito de razão social: precedência da fonte principal, sem misturar no summary", async () => {
    const result = await lookupCompanyRegistry({
      cnpj: CNPJ,
      fetchImpl: mockRegistryFetch({
        publica: jsonResponse(200, PUBLICA_PAYLOAD),
        brasilApi: jsonResponse(200, {
          ...BRASIL_API_PAYLOAD,
          razao_social: "OUTRA RAZAO SOCIAL LTDA",
        }),
      }, []),
    });
    assert.equal(result.summary.companyName, "EMPRESA TESTE LTDA");
    const name = result.provenance.find((row) => row.field === "companyName");
    assert.equal(name?.status, "DIFFERENT");
    assert.equal(name?.chosenValue, "EMPRESA TESTE LTDA");
    assert.equal(name?.chosenSource, CNPJ_SOURCE_PUBLICA);
    assert.ok(result.conflicts.some((row) => row.field === "companyName"));
  });

  it("divergência cosmética de município não vira conflito", async () => {
    const result = await lookupCompanyRegistry({
      cnpj: CNPJ,
      fetchImpl: mockRegistryFetch({
        publica: jsonResponse(200, PUBLICA_PAYLOAD),
        brasilApi: jsonResponse(200, BRASIL_API_PAYLOAD),
      }, []),
    });
    const city = result.provenance.find((row) => row.field === "city");
    assert.equal(city?.status, "MATCH");
    assert.equal(result.conflicts.some((row) => row.field === "city"), false);
  });

  it("404 individual na complementar não derruba a consulta", async () => {
    const result = await lookupCompanyRegistry({
      cnpj: CNPJ,
      fetchImpl: mockRegistryFetch({
        publica: jsonResponse(200, PUBLICA_PAYLOAD),
        brasilApi: jsonResponse(404, { message: "not found" }),
      }, []),
    });
    assert.equal(result.winningSource, CNPJ_SOURCE_PUBLICA);
    assert.equal(result.secondary.status, "NOT_FOUND");
    assert.equal(result.partialResult, true);
  });

  it("429 individual na complementar não derruba a consulta", async () => {
    const result = await lookupCompanyRegistry({
      cnpj: CNPJ,
      fetchImpl: mockRegistryFetch({
        publica: jsonResponse(200, PUBLICA_PAYLOAD),
        brasilApi: jsonResponse(429, { message: "rate" }),
      }, []),
    });
    assert.equal(result.winningSource, CNPJ_SOURCE_PUBLICA);
    assert.equal(result.secondary.status, "RATE_LIMIT");
  });

  it("timeout individual na complementar não derruba a consulta", async () => {
    const result = await lookupCompanyRegistry({
      cnpj: CNPJ,
      fetchImpl: mockRegistryFetch({
        publica: jsonResponse(200, PUBLICA_PAYLOAD),
        brasilApi: "timeout",
      }, []),
    });
    assert.equal(result.winningSource, CNPJ_SOURCE_PUBLICA);
    assert.equal(result.secondary.status, "TIMEOUT");
  });

  it("todas falham → erro geral mapeado da principal", async () => {
    await assert.rejects(
      () =>
        lookupCompanyRegistry({
          cnpj: CNPJ,
          fetchImpl: mockRegistryFetch({
            publica: jsonResponse(500, { error: "down" }),
            brasilApi: "network",
          }, []),
        }),
      (error: unknown) =>
        error instanceof CompanyIntelligenceError &&
        error.code === "UPSTREAM_UNAVAILABLE" &&
        error.httpStatus === 500
    );
  });

  it("ambas 404 → CNPJ_NOT_FOUND", async () => {
    await assert.rejects(
      () =>
        lookupCompanyRegistry({
          cnpj: CNPJ,
          fetchImpl: mockRegistryFetch({
            publica: jsonResponse(404, {}),
            brasilApi: jsonResponse(404, {}),
          }, []),
        }),
      (error: unknown) =>
        error instanceof CompanyIntelligenceError &&
        error.code === "CNPJ_NOT_FOUND" &&
        error.httpStatus === 404
    );
  });

  it("ambas 429 → RATE_LIMIT da principal", async () => {
    await assert.rejects(
      () =>
        lookupCompanyRegistry({
          cnpj: CNPJ,
          fetchImpl: mockRegistryFetch({
            publica: jsonResponse(429, {}),
            brasilApi: jsonResponse(429, {}),
          }, []),
        }),
      (error: unknown) =>
        error instanceof CompanyIntelligenceError &&
        error.code === "RATE_LIMIT" &&
        error.httpStatus === 429
    );
  });

  it("cache válido evita nova ida às fontes", async () => {
    const calls: string[] = [];
    const fetchImpl = mockRegistryFetch(
      {
        publica: jsonResponse(200, PUBLICA_PAYLOAD),
        brasilApi: jsonResponse(200, BRASIL_API_PAYLOAD),
      },
      calls
    );
    const first = await lookupCompanyRegistry({ cnpj: CNPJ, fetchImpl });
    const second = await lookupCompanyRegistry({ cnpj: CNPJ, fetchImpl });
    assert.equal(first.fromCache, false);
    assert.equal(second.fromCache, true);
    assert.equal(second.summary.companyName, first.summary.companyName);
    assert.equal(calls.filter((url) => url.includes("publica.cnpj.ws")).length, 1);
    assert.equal(calls.filter((url) => url.includes("brasilapi.com.br")).length, 1);
  });

  it("refresh ignora cache e consulta de novo", async () => {
    const calls: string[] = [];
    const fetchImpl = mockRegistryFetch(
      {
        publica: jsonResponse(200, PUBLICA_PAYLOAD),
        brasilApi: jsonResponse(200, BRASIL_API_PAYLOAD),
      },
      calls
    );
    await lookupCompanyRegistry({ cnpj: CNPJ, fetchImpl });
    const refreshed = await lookupCompanyRegistry({ cnpj: CNPJ, fetchImpl, forceRefresh: true });
    assert.equal(refreshed.fromCache, false);
    assert.equal(calls.filter((url) => url.includes("publica.cnpj.ws")).length, 2);
    assert.equal(calls.filter((url) => url.includes("brasilapi.com.br")).length, 2);
  });

  it("consultas independentes de CNPJs distintos correm em paralelo", async () => {
    const calls: string[] = [];
    const fetchImpl = mockRegistryFetch(
      {
        publica: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          return jsonResponse(200, PUBLICA_PAYLOAD)();
        },
        brasilApi: jsonResponse(200, BRASIL_API_PAYLOAD),
      },
      calls
    );
    const [a, b] = await Promise.all([
      lookupCompanyRegistry({ cnpj: CNPJ, fetchImpl }),
      lookupCompanyRegistry({ cnpj: CNPJ_BB, fetchImpl }),
    ]);
    assert.equal(a.cnpj, CNPJ);
    assert.equal(b.cnpj, CNPJ_BB);
    assert.equal(calls.filter((url) => url.includes("publica.cnpj.ws")).length, 2);
  });

  it("consultas concorrentes do mesmo CNPJ não disparam burst", async () => {
    const calls: string[] = [];
    const fetchImpl = mockRegistryFetch(
      {
        publica: async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return jsonResponse(200, PUBLICA_PAYLOAD)();
        },
        brasilApi: async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return jsonResponse(200, BRASIL_API_PAYLOAD)();
        },
      },
      calls
    );
    const [a, b] = await Promise.all([
      lookupCompanyRegistry({ cnpj: CNPJ, fetchImpl }),
      lookupCompanyRegistry({ cnpj: CNPJ, fetchImpl }),
    ]);
    assert.equal(a.summary.companyName, b.summary.companyName);
    assert.equal(calls.filter((url) => url.includes("publica.cnpj.ws")).length, 1);
    assert.equal(calls.filter((url) => url.includes("brasilapi.com.br")).length, 1);
  });

  it("payload do agregador preserva campos canônicos backward-compatible", async () => {
    const result = await lookupCompanyRegistry({
      cnpj: CNPJ,
      fetchImpl: mockRegistryFetch({
        publica: jsonResponse(200, PUBLICA_PAYLOAD),
        brasilApi: jsonResponse(200, BRASIL_API_PAYLOAD),
      }, []),
    });
    assert.ok(result.summary.companyName);
    assert.ok(result.rawJson);
    assert.ok(result.winningSource);
    assert.equal(typeof result.partialResult, "boolean");
    assert.ok(Array.isArray(result.sources));
    assert.ok(Array.isArray(result.provenance));
    assert.ok(Array.isArray(result.conflicts));
  });
});
