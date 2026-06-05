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
  assertApplyFieldSelectionAllowed,
  ApplyFieldSelectionError,
} from "./companyCnpjCompare.js";
import {
  buildPublicContactNote,
  summaryToCustomerDraft,
} from "./companyCnpjNormalize.js";
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

  it("score does not depend on phone or email from API", () => {
    const withContacts = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const withoutContacts = normalizePublicCnpjPayload({
      ...MOCK_PAYLOAD,
      estabelecimento: {
        ...MOCK_PAYLOAD.estabelecimento,
        telefone1: null,
        email: null,
        ddd1: null,
      },
    });
    const a = calculateCommercialRiskScore(withContacts);
    const b = calculateCommercialRiskScore(withoutContacts);
    assert.equal(a.score, b.score);
    assert.equal(a.verdict, b.verdict);
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
  const customerBase = {
    companyName: "OUTRA RAZAO",
    taxId: "11444777000161",
    city: "Curitiba",
    email: "compras@cliente.com",
    phone: "(41) 99999-0000",
    contactName: "João Comprador",
  };

  it("compares ERP vs API and detects differences on official fields", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const compare = compareCustomerWithCnpjData(
      { ...customerBase, email: null },
      summary
    );
    assert.ok(compare.differentCount >= 1);
    assert.ok(compare.fields.some((f) => f.field === "companyName" && f.status === "DIFFERENT"));
    assert.ok(!compare.fields.some((f) => f.field === "phone"));
    assert.ok(!compare.fields.some((f) => f.field === "email"));
  });

  it("classifies companyName as OFFICIAL_SAFE_TO_APPLY", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const row = compareCustomerWithCnpjData(customerBase, summary).fields.find(
      (f) => f.field === "companyName"
    );
    assert.equal(row?.kind, "OFFICIAL_SAFE_TO_APPLY");
  });

  it("classifies address fields as ADDRESS_SAFE_TO_APPLY", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const compare = compareCustomerWithCnpjData(customerBase, summary);
    assert.equal(
      compare.fields.find((f) => f.field === "address")?.kind,
      "ADDRESS_SAFE_TO_APPLY"
    );
    assert.equal(compare.fields.find((f) => f.field === "city")?.kind, "ADDRESS_SAFE_TO_APPLY");
  });

  it("classifies API phone as PUBLIC_CONTACT_REVIEW_ONLY", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const phone = compareCustomerWithCnpjData(customerBase, summary).publicContacts.find(
      (c) => c.field === "phone"
    );
    assert.equal(phone?.kind, "PUBLIC_CONTACT_REVIEW_ONLY");
    assert.equal(phone?.apiValue, summary.phone);
  });

  it("classifies API email as PUBLIC_CONTACT_REVIEW_ONLY", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const email = compareCustomerWithCnpjData(customerBase, summary).publicContacts.find(
      (c) => c.field === "email"
    );
    assert.equal(email?.kind, "PUBLIC_CONTACT_REVIEW_ONLY");
    assert.equal(email?.apiValue, summary.email);
  });

  it("does not apply commercial phone by default", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    assert.throws(
      () => buildApplyPatch(customerBase, summary, ["phone"]),
      (e: unknown) => e instanceof ApplyFieldSelectionError
    );
  });

  it("does not apply commercial email by default", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    assert.throws(
      () => buildApplyPatch(customerBase, summary, ["email"]),
      (e: unknown) => e instanceof ApplyFieldSelectionError
    );
  });

  it("allows public contact apply only with explicit confirmation", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const patch = buildApplyPatch(customerBase, summary, ["email"], {
      confirmPublicContactOverwrite: true,
    });
    assert.equal(patch.email, summary.email);
  });

  it("does not apply without selected fields", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const patch = buildApplyPatch({ companyName: "X" }, summary, []);
    assert.deepEqual(patch, {});
  });

  it("apply patch only selected official fields", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const patch = buildApplyPatch(
      { companyName: "OUTRA", email: "comercial@erp.com" },
      summary,
      ["companyName"]
    );
    assert.equal(patch.companyName, summary.companyName);
    assert.equal(patch.email, undefined);
  });

  it("new customer draft excludes public phone/email by default", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const draft = summaryToCustomerDraft(summary);
    assert.equal(draft.phone, "");
    assert.equal(draft.email, "");
    assert.match(draft.notes, /Contato público retornado pela API CNPJ/);
  });

  it("new customer draft can use public contact with explicit flag", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const draft = summaryToCustomerDraft(summary, { usePublicContactAsPrimary: true });
    assert.equal(draft.phone, summary.phone);
    assert.equal(draft.email, summary.email);
  });

  it("buildPublicContactNote stores suggestion text", () => {
    const summary = normalizePublicCnpjPayload(MOCK_PAYLOAD);
    const note = buildPublicContactNote(summary, new Date("2026-06-05"));
    assert.match(note, /Validar antes de uso comercial/);
    assert.match(note, /contato@empresa.com/);
  });

  it("assertApplyFieldSelectionAllowed blocks protected contacts", () => {
    assert.throws(() => assertApplyFieldSelectionAllowed(["phone", "companyName"], false));
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
