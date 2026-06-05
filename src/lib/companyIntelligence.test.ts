import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countFilledJsonFields,
  formatCnpj,
  isValidCnpj,
  normalizeCnpj,
} from "./companyCnpjFormat.js";
import {
  normalizePublicCnpjPayload,
  parseShareCapital,
} from "./companyCnpjNormalize.js";
import {
  calculateCommercialRiskScore,
  classifyCommercialVerdict,
  simulateCommercialRisk,
} from "./companyCommercialRiskScore.js";
import {
  buildCnaeCrossSellSuggestions,
  buildTaxAlerts,
} from "./companyCommercialInsights.js";
import {
  buildApplyPatch,
  compareCustomerWithCnpjData,
} from "./companyCnpjCompare.js";
import { assertReasonRequired } from "./fleetValidation.js";

const MOCK_PAYLOAD = {
  razao_social: "EMPRESA TESTE LTDA",
  capital_social: "250000.00",
  porte: { descricao: "Demais" },
  natureza_juridica: { descricao: "Sociedade Limitada" },
  socios: [{ nome: "João Silva", qualificacao_socio: { descricao: "Sócio" } }],
  estabelecimento: {
    cnpj: "11444777000161",
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
    atividades_secundarias: [{ id: "4711302", descricao: "Comércio varejista" }],
    cidade: { nome: "Curitiba" },
    estado: { sigla: "PR" },
    inscricoes_estaduais: [{ inscricao_estadual: "1234567890", estado: "PR", situacao: "Ativa" }],
  },
};

describe("company intelligence — CNPJ format", () => {
  it("validates and normalizes CNPJ", () => {
    assert.equal(normalizeCnpj("11.444.777/0001-61"), "11444777000161");
    assert.equal(isValidCnpj("11444777000161"), true);
    assert.equal(isValidCnpj("11222333000180"), false);
    assert.equal(formatCnpj("11444777000161"), "11.444.777/0001-61");
  });
});

describe("company intelligence — risk score", () => {
  it("active company with strong profile scores >= 82", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const risk = calculateCommercialRiskScore(summary);
    assert.ok(risk.score >= 82);
    assert.equal(risk.verdict, "VENDA LIBERADA");
  });

  it("inactive company is blocked", () => {
    const payload = {
      ...MOCK_PAYLOAD,
      estabelecimento: {
        ...MOCK_PAYLOAD.estabelecimento,
        situacao_cadastral: "Baixada",
      },
    };
    const risk = calculateCommercialRiskScore(normalizePublicCnpjPayload(payload));
    assert.equal(risk.verdict, "VENDA BLOQUEADA");
    assert.ok(risk.score <= 1);
  });

  it("recent low-capital company suggests upfront payment", () => {
    const risk = simulateCommercialRisk({
      registrationStatusNormalized: "ATIVA",
      openedAt: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
      shareCapital: 0,
      companySize: "Microempresa",
      isMei: true,
      hasPartners: false,
    });
    assert.ok(risk.score < 55);
    assert.equal(risk.verdict, "APENAS PAGAMENTO ANTECIPADO");
  });

  it("capital social scoring by bands", () => {
    assert.equal(parseShareCapital("0.00"), 0);
    const low = simulateCommercialRisk({
      registrationStatusNormalized: "ATIVA",
      openedAt: "2010-01-01",
      shareCapital: 10_000,
      companySize: "Demais",
      isMei: false,
      hasPartners: true,
      partnersCount: 2,
    });
    const high = simulateCommercialRisk({
      registrationStatusNormalized: "ATIVA",
      openedAt: "2010-01-01",
      shareCapital: 2_000_000,
      companySize: "Demais",
      isMei: false,
      hasPartners: true,
      partnersCount: 2,
    });
    assert.ok(high.score > low.score);
  });

  it("verdict thresholds", () => {
    assert.equal(classifyCommercialVerdict(40, false).verdict, "APENAS PAGAMENTO ANTECIPADO");
    assert.equal(classifyCommercialVerdict(70, false).verdict, "VENDA CONDICIONADA");
    assert.equal(classifyCommercialVerdict(90, false).verdict, "VENDA LIBERADA");
  });
});

describe("company intelligence — insights", () => {
  it("cross-selling by CNAE industry prefix", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const cross = buildCnaeCrossSellSuggestions(summary);
    assert.ok(cross.some((c) => c.category.includes("Indústria")));
    assert.ok(cross.some((c) => c.category.includes("Comércio")));
  });

  it("interstate tax alert when client UF differs from seller", () => {
    const summary = normalizePublicCnpjPayload({
      ...MOCK_PAYLOAD,
      estabelecimento: {
        ...MOCK_PAYLOAD.estabelecimento,
        estado: { sigla: "SP" },
      },
    });
    const alerts = buildTaxAlerts(summary, "PR");
    assert.ok(alerts.some((a) => a.code === "INTERSTATE_ICMS"));
  });
});

describe("company intelligence — compare and apply", () => {
  it("compares ERP vs API and detects differences", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const compare = compareCustomerWithCnpjData(
      {
        companyName: "OUTRA RAZAO",
        taxId: "11444777000161",
        city: "Curitiba",
        email: null,
      },
      summary
    );
    assert.ok(compare.differentCount >= 1);
    assert.ok(compare.fields.some((f) => f.field === "companyName" && f.status === "DIFFERENT"));
    assert.ok(compare.fields.some((f) => f.field === "email" && f.status === "EMPTY_ERP"));
  });

  it("does not apply without selected fields", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const patch = buildApplyPatch({ companyName: "X" }, summary, []);
    assert.deepEqual(patch, {});
  });

  it("apply patch only selected fields", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const patch = buildApplyPatch(
      { companyName: "OUTRA", email: "" },
      summary,
      ["companyName", "email"]
    );
    assert.equal(patch.companyName, summary.companyName);
    assert.equal(patch.email, summary.email);
  });

  it("countFilledJsonFields ignores empty values", () => {
    assert.equal(countFilledJsonFields({ a: "", b: null, c: "ok", d: [1, ""] }), 2);
  });
});

describe("company intelligence — cancel validation reuse", () => {
  it("cancel without reason throws", () => {
    assert.throws(() => assertReasonRequired("  ", "Motivo"));
  });
});
