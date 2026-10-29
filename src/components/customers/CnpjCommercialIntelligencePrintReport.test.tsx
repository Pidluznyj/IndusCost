import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CnpjCommercialIntelligencePrintReport } from "./CnpjCommercialIntelligencePrintReport";
import { buildCommercialCreditIntelligenceView } from "@/src/lib/commercial/commercialCreditIntelligenceView";
import { decideCommercialCredit } from "@/src/lib/commercial/commercialCreditDecision";
import type { CommercialDelinquencyAnalysis } from "@/src/lib/commercial/customerDelinquencyAnalysis";
import {
  canPrintCnpjIntelligenceReport,
  CNPJ_INTELLIGENCE_PRINT_BUTTON_LABEL,
  isCnpjIntelligencePrintButtonDisabled,
  toCnpjIntelligencePrintPayload,
  type CnpjIntelligencePrintPayload,
} from "@/src/lib/customerCnpjIntelligencePrint";
import type { CnpjIntelligencePayload } from "@/src/lib/customerCnpjIntelligenceTypes";

const __dirname = dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(join(__dirname, "CustomerCnpjIntelligencePanel.tsx"), "utf8");

function samplePayload(over: Partial<CnpjIntelligencePayload> = {}): CnpjIntelligencePayload {
  return {
    lookupId: "lk-1",
    cnpj: "11444777000161",
    source: "publica.cnpj.ws",
    fetchedAt: "2026-06-09T14:00:00.000Z",
    expiresAt: "2026-06-10T14:00:00.000Z",
    fromCache: false,
    summary: {
      cnpjFormatted: "11.444.777/0001-61",
      companyName: "EMPRESA TESTE LTDA",
      tradeName: "EMPRESA TESTE",
      registrationStatus: "Ativa",
      openedAt: "2010-05-01",
      companySize: "Demais",
      legalNature: "Sociedade Limitada",
      shareCapital: 250000,
      mainCnae: { code: "2511000", description: "Fabricação de estruturas metálicas" },
      secondaryCnaes: [{ code: "4711302", description: "Comércio varejista" }],
      address: "RUA DAS FLORES, 100",
      city: "Curitiba",
      state: "PR",
      zipCode: "80010-000",
      phone: "(41) 3333-4444",
      email: "contato@empresa.com",
      stateTaxIds: [{ number: "1234567890", state: "PR", status: "Ativa" }],
      partners: [{ name: "João Silva", role: "Sócio" }],
    },
    risk: {
      score: 88,
      verdict: "VENDA LIBERADA",
      riskLevel: "Baixo",
      saleRecommendation: "Liberar venda com monitoramento padrão",
      explanation: ["Empresa ativa com perfil estável."],
      blockedByRegistration: false,
    },
    commercial: {
      insights: [
        {
          code: "IND-1",
          title: "Perfil industrial",
          description: "CNAE indica demanda por estruturas metálicas.",
        },
      ],
      crossSell: [{ category: "Serviços", suggestions: ["Montagem", "Pintura"] }],
      taxAlerts: [{ code: "TAX-1", level: "warning", message: "Verificar IE antes da primeira NF." }],
      disclaimer: "Análise automatizada; não substitui due diligence.",
    },
    comparison: {
      fields: [
        {
          field: "companyName",
          label: "Razão social",
          kind: "OFFICIAL",
          kindLabel: "Oficial",
          erpValue: "EMPRESA TESTE LTDA",
          apiValue: "EMPRESA TESTE LTDA",
          status: "EQUAL",
          suggestedValue: null,
          selectable: false,
        },
      ],
      publicContacts: [],
      erpCommercialFields: [
        { field: "segment", label: "Segmento", erpValue: "Indústria", kindLabel: "Comercial" },
      ],
      equalCount: 1,
      differentCount: 0,
      suggestedUpdates: 0,
    },
    erpCommercialData: { segment: "Indústria" },
    publicContactSuggestion: {
      phone: "(41) 3333-4444",
      email: "contato@empresa.com",
      disclaimer: "Contato público; pode ser do contador.",
    },
    customerDraft: null,
    filledFieldCount: 42,
    rawJson: { secret: "must-not-print" },
    ...over,
  };
}

function samplePrintPayload(over: Partial<CnpjIntelligencePrintPayload> = {}): CnpjIntelligencePrintPayload {
  return {
    ...toCnpjIntelligencePrintPayload(samplePayload(), "2026-06-09T15:00:00.000Z"),
    ...over,
  };
}

describe("Cnpj intelligence print — button state", () => {
  it("habilita impressão quando há relatório carregado", () => {
    const data = samplePayload();
    assert.equal(canPrintCnpjIntelligenceReport(data), true);
    assert.equal(isCnpjIntelligencePrintButtonDisabled(false, data), false);
  });

  it("desabilita impressão sem consulta carregada", () => {
    assert.equal(canPrintCnpjIntelligenceReport(null), false);
    assert.equal(isCnpjIntelligencePrintButtonDisabled(false, null), true);
    assert.equal(isCnpjIntelligencePrintButtonDisabled(true, samplePayload()), true);
  });
});

describe("CnpjCommercialIntelligencePrintReport", () => {
  it("renderiza título, CNPJ, razão social e inteligência comercial", () => {
    const html = renderToStaticMarkup(
      <CnpjCommercialIntelligencePrintReport data={samplePrintPayload()} />
    );
    assert.ok(html.includes("Relatório de Inteligência Comercial"));
    assert.ok(html.includes("IndusCost"));
    assert.ok(html.includes("11.444.777/0001-61"));
    assert.ok(html.includes("EMPRESA TESTE LTDA"));
    assert.ok(html.includes("EMPRESA TESTE"));
    assert.ok(html.includes("Perfil industrial"));
    assert.ok(html.includes("Quadro societário (QSA)"));
    assert.ok(html.includes("João Silva"));
    assert.ok(html.includes("publica.cnpj.ws"));
    assert.ok(html.includes("Situação de crédito não consultada."));
  });

  it("não expõe payload bruto nem valores inválidos", () => {
    const html = renderToStaticMarkup(
      <CnpjCommercialIntelligencePrintReport
        data={samplePrintPayload({
          summary: {
            ...samplePrintPayload().summary,
            shareCapital: Number.NaN,
            tradeName: null,
          },
        })}
      />
    );
    assert.ok(!html.includes("must-not-print"));
    assert.ok(!html.includes("undefined"));
    assert.ok(!html.includes("NaN"));
    assert.ok(html.includes("—"));
  });

  it("imprime score 91 e crédito bloqueado sem estourar a tabela", () => {
    const delinquency: CommercialDelinquencyAnalysis = {
      status: "OVERDUE",
      unknownReason: null,
      overdueTitleCount: 1,
      overdueAmount: 910,
      openAmount: 910,
      maxDaysOverdue: 2,
      lastSyncedAt: "2026-10-19T12:00:00.000Z",
      evidence: {
        source: "NomusAccountsReceivable",
        toleranceDays: 0,
        toleranceUnit: "CALENDAR_DAYS",
        referenceDate: "2026-10-19",
        cnpj: "11444777000161",
        nomusPersonId: 100,
        identity: "RESOLVED",
        syncRunStatus: "SUCCESS",
        payloadComplete: true,
        sourceMaxSyncedAt: null,
        includedTitleIds: [1],
        overdueTitleIds: [1],
        protestedTitleIds: [],
        protestReading: "CLEAR",
        exclusions: [],
      },
    };
    const decision = decideCommercialCredit({
      customerId: "11111111-1111-4111-8111-111111111111",
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency,
      cadastral: { score: 91, verdict: "VENDA LIBERADA" },
      now: new Date(2026, 9, 19, 12, 0, 0),
    });
    const credit = buildCommercialCreditIntelligenceView({
      decision,
      delinquency,
      externalProtest: "ABSENT",
      revealFinancial: true,
    });
    const html = renderToStaticMarkup(
      <CnpjCommercialIntelligencePrintReport
        data={samplePrintPayload({
          risk: { ...samplePrintPayload().risk, score: 91, verdict: "VENDA LIBERADA" },
          credit,
          creditState: "loaded",
        })}
      />
    );
    const css = readFileSync(join(__dirname, "../../cnpj-intelligence-print.css"), "utf8");
    assert.match(html, /Score cadastral: 91\/100/);
    assert.match(html, /CRÉDITO BLOQUEADO/);
    assert.equal(credit.decisionTitle, "CRÉDITO BLOQUEADO");
    assert.match(html, new RegExp(credit.decisionTitle));
    assert.match(html, /Protesto nacional IEPTB/);
    assert.match(html, /Não consultado/);
    assert.match(html, /Dívida de empresa relacionada não é dívida deste CNPJ/);
    assert.match(html, /Não autoriza crédito nem venda a prazo/);
    assert.match(html, /Nenhuma consulta ao Banco Central foi realizada/);
    assert.match(html, /cnpj-intelligence-print-kv-table/);
    assert.match(css, /overflow-wrap:\s*anywhere/);
    assert.match(css, /white-space:\s*normal/);
    assert.equal(html.includes("not_applicable"), false);
  });
});

describe("Relatório impresso — mesmo layout da Ficha (painel de crédito e tipos de consulta)", () => {
  const bureau = {
    boaVista: {
      state: "VALID",
      stateLabel: "Válida",
      simulated: false,
      score: 812,
      scoreRaw: "812",
      scoreClass: "B",
      defaultProbability: "3,2%",
      suggestedLimitCents: 4_500_000,
      consultedAt: "2026-10-28T13:00:00.000Z",
    },
    quod: { state: "NOT_CONSULTED", score: null, consultedAt: null },
    ieptb: { state: "VALID", label: "Ocorrência encontrada", count: 2, totalAmount: 1500.5, consultedAt: "2026-10-28T13:00:00.000Z" },
  };

  it("leva ao PDF o velocímetro com o score do bureau, limite, probabilidade, protestos e as fontes por tipo, na ordem das abas", () => {
    const payload = toCnpjIntelligencePrintPayload(samplePayload(), { generatedAt: "2026-10-29T15:00:00.000Z", bureau });
    assert.deepEqual(payload.bureau, bureau, "o payload de impressão carrega as consultas externas da tela");
    const html = renderToStaticMarkup(<CnpjCommercialIntelligencePrintReport data={payload} />);
    assert.match(html, /data-testid="cnpj-print-credit-panel"/);
    assert.match(html, /data-testid="credit-score-gauge" data-score-band="Risco baixo"/);
    assert.match(html, /data-testid="credit-score-value"[^>]*>812</);
    assert.match(html, /R\$\s?45\.000,00/);
    assert.match(html, /3,2%/);
    assert.match(html, /2 · R\$\s?1\.500,50/);
    assert.match(html, /data-testid="cnpj-print-sources-by-type"/);
    for (const group of ["Interna", "Bureau", "Protestos", "Cadastral"]) assert.match(html, new RegExp(`<td>${group}</td>`));
    const order = ["Painel de crédito", "1 · Crédito interno", "Decisão de crédito", "2 · Consultas externas", "Bureaus de crédito e protestos", "3 · Cadastro oficial", "Qualidade cadastral", "Dados oficiais da empresa"].map((t) => html.indexOf(t));
    assert.ok(order.every((i) => i >= 0), `seções ausentes: ${JSON.stringify(order)}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, "seções na ordem das abas da Ficha");
  });

  it("sem consultas externas (cliente novo, sem cadastro): velocímetro vazio e bureaus 'Não consultado'; crédito sem decisão não sai em caixa vermelha", () => {
    const html = renderToStaticMarkup(<CnpjCommercialIntelligencePrintReport data={toCnpjIntelligencePrintPayload(samplePayload(), "2026-10-29T15:00:00.000Z")} />);
    assert.match(html, /data-score-band="SEM_FAIXA"/);
    assert.match(html, /Sem score externo/);
    assert.match(html, /Boa Vista · LIKE SERASA<\/td><td>Não consultado/);
    assert.match(html, /cnpj-intelligence-print-tone-undetermined/);
    const css = readFileSync(join(__dirname, "..", "..", "cnpj-intelligence-print.css"), "utf8");
    assert.match(css, /\.cnpj-intelligence-print-tone-released \{ border-color: #10b981 !important; color: #065f46; \}/);
    assert.match(css, /print-color-adjust: exact/);
  });
});

describe("CustomerCnpjIntelligencePanel — classes no-print", () => {
  it("marca controles interativos como cnpj-intelligence-no-print", () => {
    assert.ok(panelSource.includes("cnpj-intelligence-no-print"));
    assert.ok(panelSource.includes("CNPJ_INTELLIGENCE_PRINT_BUTTON_LABEL"));
    assert.equal(CNPJ_INTELLIGENCE_PRINT_BUTTON_LABEL, "Imprimir relatório");
    assert.ok(panelSource.includes("handlePrint"));
    assert.ok(panelSource.includes("cnpj-intelligence-print-only"));
    assert.ok(panelSource.includes("cnpj-intelligence-screen-only"));
  });
});
