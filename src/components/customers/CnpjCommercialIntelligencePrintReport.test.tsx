import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CnpjCommercialIntelligencePrintReport } from "./CnpjCommercialIntelligencePrintReport";
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
