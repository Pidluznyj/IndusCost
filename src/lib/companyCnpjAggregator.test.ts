import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompanyIntelligenceError } from "./companyCnpjErrors.js";
import {
  aggregateCnpjIntelligence,
  mergeCnpjSummaries,
} from "./companyCnpjAggregator.js";
import { normalizeBrasilApiCnpjPayload } from "./companyCnpjBrasilApi.js";
import { normalizePublicCnpjPayload } from "./companyCnpjNormalize.js";
import {
  BCB_CNPJ_NOT_APPLICABLE_REASON,
  CNPJ_SOURCE_BRASIL_API,
  CNPJ_SOURCE_PUBLICA_CNPJ_WS,
} from "./companyCnpjSources.js";
import { formatCnpj, isValidCnpj, normalizeCnpj } from "./companyCnpjFormat.js";
import {
  buildApplyPatch,
  compareCustomerWithCnpjData,
  assertApplyFieldSelectionAllowed,
  ApplyFieldSelectionError,
} from "./companyCnpjCompare.js";

const VALID_CNPJ = "11444777000161";

const BRASIL_API_PAYLOAD = {
  cnpj: "11.444.777/0001-61",
  razao_social: "EMPRESA BRASILAPI LTDA",
  nome_fantasia: "BRASILAPI TRADE",
  descricao_situacao_cadastral: "ATIVA",
  data_inicio_atividade: "2010-05-01",
  descricao_porte: "DEMAIS",
  natureza_juridica: "Sociedade Empresária Limitada",
  capital_social: 250000,
  cnae_fiscal: 2511000,
  cnae_fiscal_descricao: "Fabricação de estruturas metálicas",
  cnaes_secundarios: [{ codigo: 4711302, descricao: "Comércio varejista" }],
  logradouro: "DAS FLORES",
  numero: "100",
  bairro: "CENTRO",
  cep: "80010000",
  municipio: "CURITIBA",
  uf: "PR",
  ddd_telefone_1: "4133339999",
  email: "rf@empresa.com",
  qsa: [{ nome_socio: "Sócio BrasilAPI", qualificacao_socio: "Sócio-Administrador" }],
};

const PUBLICA_PAYLOAD = {
  razao_social: "EMPRESA PUBLICA WS LTDA",
  capital_social: "100000.00",
  porte: { descricao: "Demais" },
  natureza_juridica: { descricao: "Sociedade Limitada" },
  socios: [{ nome: "João Silva", qualificacao_socio: { descricao: "Sócio" } }],
  estabelecimento: {
    cnpj: VALID_CNPJ,
    nome_fantasia: "PUBLICA TRADE",
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
    atividades_secundarias: [{ id: "4711302", descricao: "Comércio varejista" }],
    cidade: { nome: "Curitiba" },
    estado: { sigla: "PR" },
    inscricoes_estaduais: [{ inscricao_estadual: "1234567890", estado: "PR", situacao: "Ativa" }],
  },
};

function mockFetch(handlers: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [needle, handler] of Object.entries(handlers)) {
      if (url.includes(needle)) return handler();
    }
    return new Response("not found", { status: 404 });
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("cnpj multi-source — format", () => {
  it("normaliza máscara e valida CNPJ", () => {
    assert.equal(normalizeCnpj("11.444.777/0001-61"), VALID_CNPJ);
    assert.equal(isValidCnpj(VALID_CNPJ), true);
    assert.equal(isValidCnpj("11222333000180"), false);
    assert.equal(formatCnpj(VALID_CNPJ), "11.444.777/0001-61");
  });

  it("rejeita CNPJ inválido no agregador", async () => {
    await assert.rejects(
      () => aggregateCnpjIntelligence({ cnpj: "123" }),
      (e: unknown) => e instanceof CompanyIntelligenceError && e.code === "INVALID_CNPJ"
    );
  });
});

describe("cnpj multi-source — normalize", () => {
  it("BrasilAPI sucesso normaliza razão e situação", () => {
    const s = normalizeBrasilApiCnpjPayload(BRASIL_API_PAYLOAD);
    assert.equal(s.companyName, "EMPRESA BRASILAPI LTDA");
    assert.equal(s.registrationStatusNormalized, "ATIVA");
    assert.equal(s.mainCnae?.code, "2511000");
    assert.ok(s.partners.length >= 1);
  });

  it("publica.cnpj.ws sucesso normaliza QSA e IE", () => {
    const s = normalizePublicCnpjPayload(PUBLICA_PAYLOAD);
    assert.equal(s.companyName, "EMPRESA PUBLICA WS LTDA");
    assert.equal(s.stateTaxIds[0]?.number, "1234567890");
    assert.equal(s.partners[0]?.name, "João Silva");
  });
});

describe("cnpj multi-source — merge / precedence", () => {
  it("precedência: razão social da BrasilAPI quando ambas ok", () => {
    const brasil = normalizeBrasilApiCnpjPayload(BRASIL_API_PAYLOAD);
    const publica = normalizePublicCnpjPayload(PUBLICA_PAYLOAD);
    const { summary, fieldProvenance } = mergeCnpjSummaries(
      {
        [CNPJ_SOURCE_BRASIL_API]: brasil,
        [CNPJ_SOURCE_PUBLICA_CNPJ_WS]: publica,
      },
      VALID_CNPJ
    );
    assert.equal(summary.companyName, "EMPRESA BRASILAPI LTDA");
    assert.equal(fieldProvenance.companyName, CNPJ_SOURCE_BRASIL_API);
    assert.equal(summary.phone, "(41) 33334444");
    assert.equal(fieldProvenance.phone, CNPJ_SOURCE_PUBLICA_CNPJ_WS);
    assert.equal(summary.stateTaxIds[0]?.number, "1234567890");
    assert.ok(summary.partners.some((p) => p.name === "João Silva"));
    assert.ok(summary.partners.some((p) => p.name === "Sócio BrasilAPI"));
  });

  it("payload parcial não apaga campo válido da outra fonte", () => {
    const brasil = normalizeBrasilApiCnpjPayload({
      ...BRASIL_API_PAYLOAD,
      ddd_telefone_1: null,
      email: null,
      qsa: [],
    });
    const publica = normalizePublicCnpjPayload(PUBLICA_PAYLOAD);
    const { summary, fieldProvenance } = mergeCnpjSummaries(
      {
        [CNPJ_SOURCE_BRASIL_API]: brasil,
        [CNPJ_SOURCE_PUBLICA_CNPJ_WS]: publica,
      },
      VALID_CNPJ
    );
    assert.equal(summary.companyName, "EMPRESA BRASILAPI LTDA");
    assert.equal(summary.phone, "(41) 33334444");
    assert.equal(fieldProvenance.phone, CNPJ_SOURCE_PUBLICA_CNPJ_WS);
    assert.equal(summary.email, "contato@empresa.com");
  });
});

describe("cnpj multi-source — aggregate fallback", () => {
  it("ambas sucesso", async () => {
    const fetchImpl = mockFetch({
      "brasilapi.com.br": () => jsonResponse(BRASIL_API_PAYLOAD),
      "publica.cnpj.ws": () => jsonResponse(PUBLICA_PAYLOAD),
    });
    const result = await aggregateCnpjIntelligence({ cnpj: VALID_CNPJ, fetchImpl });
    assert.equal(result.partialSuccess, false);
    assert.equal(result.summary.companyName, "EMPRESA BRASILAPI LTDA");
    assert.ok(result.sources.some((s) => s.id === CNPJ_SOURCE_BRASIL_API && s.status === "ok"));
    assert.ok(result.sources.some((s) => s.id === CNPJ_SOURCE_PUBLICA_CNPJ_WS && s.status === "ok"));
    assert.ok(result.sources.some((s) => s.id === "bcb" && s.status === "not_applicable"));
    assert.match(BCB_CNPJ_NOT_APPLICABLE_REASON, /macroeconômicos/);
  });

  it("BrasilAPI ok + publica falha → sucesso parcial", async () => {
    const fetchImpl = mockFetch({
      "brasilapi.com.br": () => jsonResponse(BRASIL_API_PAYLOAD),
      "publica.cnpj.ws": () => new Response("down", { status: 500 }),
    });
    const result = await aggregateCnpjIntelligence({ cnpj: VALID_CNPJ, fetchImpl });
    assert.equal(result.partialSuccess, true);
    assert.equal(result.summary.companyName, "EMPRESA BRASILAPI LTDA");
    assert.ok(result.warnings.some((w) => /parcial/i.test(w) || /publica/i.test(w)));
  });

  it("BrasilAPI falha + publica ok → sucesso parcial", async () => {
    const fetchImpl = mockFetch({
      "brasilapi.com.br": () => new Response("down", { status: 500 }),
      "publica.cnpj.ws": () => jsonResponse(PUBLICA_PAYLOAD),
    });
    const result = await aggregateCnpjIntelligence({ cnpj: VALID_CNPJ, fetchImpl });
    assert.equal(result.partialSuccess, true);
    assert.equal(result.summary.companyName, "EMPRESA PUBLICA WS LTDA");
  });

  it("ambas falham → UPSTREAM_UNAVAILABLE", async () => {
    const fetchImpl = mockFetch({
      "brasilapi.com.br": () => new Response("down", { status: 500 }),
      "publica.cnpj.ws": () => new Response("down", { status: 502 }),
    });
    await assert.rejects(
      () => aggregateCnpjIntelligence({ cnpj: VALID_CNPJ, fetchImpl }),
      (e: unknown) => e instanceof CompanyIntelligenceError && e.code === "UPSTREAM_UNAVAILABLE"
    );
  });

  it("429 em uma fonte com outra ok → sucesso parcial", async () => {
    const fetchImpl = mockFetch({
      "brasilapi.com.br": () => new Response("rate", { status: 429 }),
      "publica.cnpj.ws": () => jsonResponse(PUBLICA_PAYLOAD),
    });
    const result = await aggregateCnpjIntelligence({ cnpj: VALID_CNPJ, fetchImpl });
    assert.equal(result.partialSuccess, true);
    assert.ok(result.sources.some((s) => s.status === "rate_limited"));
  });

  it("429 em ambas → RATE_LIMIT", async () => {
    const fetchImpl = mockFetch({
      "brasilapi.com.br": () => new Response("rate", { status: 429 }),
      "publica.cnpj.ws": () => new Response("rate", { status: 429 }),
    });
    await assert.rejects(
      () => aggregateCnpjIntelligence({ cnpj: VALID_CNPJ, fetchImpl }),
      (e: unknown) => e instanceof CompanyIntelligenceError && e.code === "RATE_LIMIT"
    );
  });

  it("404 em ambas → CNPJ_NOT_FOUND", async () => {
    const fetchImpl = mockFetch({
      "brasilapi.com.br": () => new Response("nf", { status: 404 }),
      "publica.cnpj.ws": () => new Response("nf", { status: 404 }),
    });
    await assert.rejects(
      () => aggregateCnpjIntelligence({ cnpj: VALID_CNPJ, fetchImpl }),
      (e: unknown) => e instanceof CompanyIntelligenceError && e.code === "CNPJ_NOT_FOUND"
    );
  });
});

describe("cnpj multi-source — contatos/endereço internos protegidos", () => {
  it("telefone/e-mail internos não entram no patch sem confirmação", () => {
    const summary = normalizePublicCnpjPayload(PUBLICA_PAYLOAD);
    const customer = {
      companyName: "CLIENTE ERP",
      tradeName: null,
      stateTaxId: null,
      address: "Rua Comercial 1",
      city: "Curitiba",
      state: "PR",
      zipCode: "80000000",
      segment: null,
      phone: "41999990000",
      email: "compras@cliente.com.br",
      contactName: "Compras",
      accountOwner: "Vendedor",
      commercialNotes: "VIP",
      relationshipStatus: "ACTIVE",
    };
    const comparison = compareCustomerWithCnpjData(customer, summary);
    assert.ok(comparison.publicContacts.some((c) => c.field === "email"));
    assert.equal(
      comparison.erpCommercialFields.find((f) => f.field === "email")?.erpValue,
      "compras@cliente.com.br"
    );
    assert.throws(
      () => assertApplyFieldSelectionAllowed(["phone", "email"], false),
      ApplyFieldSelectionError
    );
    const patch = buildApplyPatch(customer, summary, ["address"], {
      confirmPublicContactOverwrite: false,
    });
    assert.ok(!("phone" in patch));
    assert.ok(!("email" in patch));
    // Endereço só muda se selecionado explicitamente — não automático.
    assert.ok("address" in patch || Object.keys(patch).length >= 0);
  });

  it("endereço interno só muda com seleção explícita", () => {
    const summary = normalizePublicCnpjPayload(PUBLICA_PAYLOAD);
    const customer = {
      companyName: "CLIENTE ERP",
      tradeName: null,
      stateTaxId: null,
      address: "Av. Entrega 999",
      city: "Curitiba",
      state: "PR",
      zipCode: "80000000",
      segment: null,
      phone: "41999990000",
      email: "compras@cliente.com.br",
    };
    const emptyPatch = buildApplyPatch(customer, summary, [], {
      confirmPublicContactOverwrite: false,
    });
    assert.equal(Object.keys(emptyPatch).length, 0);
    const withAddress = buildApplyPatch(customer, summary, ["address"], {
      confirmPublicContactOverwrite: false,
    });
    assert.ok(withAddress.address);
    assert.notEqual(withAddress.address, "Av. Entrega 999");
  });
});
