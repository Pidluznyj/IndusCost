import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildProposalInternalManagementPdfApiPath,
  buildProposalInternalManagementPdfBuffer,
  buildProposalInternalManagementPdfDocument,
  buildProposalInternalManagementPdfFilename,
  buildProposalInternalManagementPrintPath,
  PROPOSAL_INTERNAL_MANAGEMENT_PDF_BUTTON_LABEL,
  PROPOSAL_INTERNAL_MANAGEMENT_PDF_CONFIDENTIAL_MARK,
  proposalInternalManagementPdfContainsClientOnlyGuard,
  proposalInternalManagementPdfLooksFormatted,
} from "./proposalInternalManagementPdf.js";
import { formatPdfMoneyBr } from "./proposalInternalManagementPdfLayout.js";
import { extractProposalItemCostBreakdown } from "./proposalItemCostBreakdown.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const SAMPLE_PROPOSAL = {
  id: "11111111-1111-1111-1111-111111111111",
  number: 42,
  title: "Proposta Iris",
  status: "SENT",
  responsible: "Ana Comercial",
  companyIssuer: "Lazarios",
  validityDays: 15,
  paymentTerms: "30/60",
  paymentMethod: "Boleto",
  freightCondition: "CIF",
  deliveryLocation: "SP",
  notes: "Obs comercial",
  internalNotes: "Obs interna",
  createdAt: "2026-07-10T12:00:00.000Z",
  customerName: "Cliente Demo",
  customerDocument: "12.345.678/0001-90",
  totalGrossValue: 10000,
  totalDiscount: 0,
  totalNetValue: 10000,
  totalCost: 7000,
  totalMarginValue: 3000,
  totalMarginPerc: 30,
  totalTaxes: 500,
  totalCommission: 200,
  totalFreight: 100,
  items: [
    {
      sku: "P-01",
      name: "Peca A",
      quantity: 10,
      unit: "UN",
      unitCost: 70,
      negotiatedPrice: 100,
      marginValue: 300,
      marginPerc: 30,
      commissionPerc: 2,
      commissionValue: 20,
      taxesValue: 50,
      notes: null,
      pricingSnapshotJson: {
        item: {
          frozenMaterialCost: 40,
          frozenHhCost: 20,
          frozenHmCost: 10,
        },
      },
    },
    {
      sku: "P-02",
      name: "Peca sem custo",
      quantity: 1,
      unit: "UN",
      unitCost: 0,
      negotiatedPrice: 50,
      marginValue: 0,
      marginPerc: 0,
      commissionPerc: 0,
      commissionValue: 0,
      notes: "revisar custo",
    },
  ],
};

describe("proposalInternalManagementPdf", () => {
  it("margem comercial do resumo não usa venda − custo de produção", () => {
    const doc = buildProposalInternalManagementPdfDocument({
      ...SAMPLE_PROPOSAL,
      totalNetValue: 39970,
      totalCost: 12655.89,
      totalMarginValue: 39970,
      totalMarginPerc: 100,
      items: [
        {
          sku: "611.01AA",
          name: "Torneira",
          quantity: 1,
          unit: "UN",
          unitCost: 2000,
          negotiatedPrice: 39970,
          discountValue: 0,
          marginValue: 0,
          marginPerc: 0,
          commissionPerc: 0,
          commissionValue: 0,
          commercialPricingSnapshotJson: {
            schemaVersion: 1,
            calculationSource: "PROPOSAL_PRICE_FORMATION",
            commercialMarginRate: 0.4244,
            commercialMarginValue: 16940.67,
            finalNetLineValue: 39970,
            frozenCostUnit: 100,
            taxRate: 0,
            freightRate: 0,
            freightAbsoluteUnit: 0,
            otherVariablesRate: 0,
            tiers: [],
            warnings: [],
          },
        },
      ],
    });
    const productionFallbackPerc = ((39970 - 12655.89) / 39970) * 100;
    assert.ok(Math.abs(doc.totals.marginPerc - 42.44) < 0.1);
    assert.ok(Math.abs(doc.totals.marginPerc - productionFallbackPerc) > 1);
    assert.notEqual(doc.totals.marginPerc, 100);
    assert.ok(Math.abs(doc.totals.marginValue - 16940.67) < 0.1);
  });

  it("monta documento com custo, margem, comissao e marcador confidencial", () => {
    const doc = buildProposalInternalManagementPdfDocument(SAMPLE_PROPOSAL);
    assert.equal(doc.totals.net, 10000);
    assert.equal(doc.totals.cost, 7000);
    assert.equal(doc.totals.marginValue, 3000);
    assert.equal(doc.totals.commission, 200);
    assert.equal(doc.totals.materialCost, 400);
    assert.equal(doc.totals.fabricationCost, 300);
    assert.ok(doc.totals.markup != null);
    assert.match(doc.confidentialMark, /confidencial/i);
    assert.equal(doc.items.length, 2);
    assert.equal(doc.items[0]?.materialTotal, 400);
    assert.equal(doc.items[0]?.fabricationTotal, 300);
    assert.equal(doc.items[1]?.costIncomplete, true);
    assert.equal(doc.items[1]?.breakdownPending, true);
    assert.ok(doc.pendencies.some((p) => /custo incompleto/i.test(p)));
  });

  it("exibe comissao pendente quando nao informada", () => {
    const doc = buildProposalInternalManagementPdfDocument({
      ...SAMPLE_PROPOSAL,
      totalCommission: 0,
      items: SAMPLE_PROPOSAL.items.map((item) => ({
        ...item,
        commissionPerc: 0,
        commissionValue: 0,
        pricingSnapshotJson: null,
      })),
    });
    assert.match(doc.commissionSummaryLabel, /Pendente/i);
  });

  it("estima comissao do snapshot quando colunas da proposta estao zeradas", () => {
    const doc = buildProposalInternalManagementPdfDocument({
      ...SAMPLE_PROPOSAL,
      totalCommission: 0,
      items: [
        {
          sku: "P-01",
          name: "Peca A",
          quantity: 10,
          unit: "UN",
          unitCost: 70,
          negotiatedPrice: 100,
          marginValue: 300,
          marginPerc: 30,
          commissionPerc: 0,
          commissionValue: 0,
          taxesValue: 50,
          notes: null,
          pricingSnapshotJson: {
            proposalDefaults: { commissionPerc: 2, commissionValue: 2 },
            item: {
              commissionPerc: 0,
              salePrice: 100,
              frozenMaterialCost: 40,
              frozenHhCost: 20,
              frozenHmCost: 10,
            },
          },
        },
      ],
    });
    assert.equal(doc.items[0]?.commissionPerc, 2);
    assert.equal(doc.items[0]?.commissionValue, 20);
    assert.equal(doc.items[0]?.commissionPending, false);
    assert.equal(doc.items[0]?.commissionEstimated, true);
    assert.match(doc.commissionSummaryLabel, /2,00%/);
    assert.match(doc.commissionSummaryLabel, /R\$ 20,00/);
    assert.equal(doc.totals.commission, 20);
    assert.doesNotMatch(doc.commissionSummaryLabel, /^Pendente$/i);
  });

  it("gera PDF formatado (nao texto puro) com marcador interno e sem R$?", () => {
    const doc = buildProposalInternalManagementPdfDocument(SAMPLE_PROPOSAL);
    const buffer = buildProposalInternalManagementPdfBuffer(doc);
    assert.ok(buffer.length > 100);
    assert.equal(buffer.subarray(0, 5).toString("utf8"), "%PDF-");
    assert.equal(proposalInternalManagementPdfContainsClientOnlyGuard(buffer), true);
    assert.equal(proposalInternalManagementPdfLooksFormatted(buffer), true);
    const text = buffer.toString("latin1");
    assert.match(text, /Gerencial Interno/i);
    assert.match(text, /confidencial/i);
    assert.match(text, /Resumo gerencial/i);
    assert.match(text, /visao gerencial|vis[aã]o gerencial|Itens/i);
    assert.match(text, /R\$ 10\.000,00/);
    assert.doesNotMatch(text, /R\$\?/);
    assert.match(text, /WinAnsiEncoding/);
    assert.match(text, /MediaBox \[0 0 842 595\]/);
  });

  it("formata moeda sem NBSP (evita R$?)", () => {
    assert.equal(formatPdfMoneyBr(31.97), "R$ 31,97");
    assert.doesNotMatch(formatPdfMoneyBr(31.97), /\u00a0/);
    assert.doesNotMatch(formatPdfMoneyBr(31.97), /R\$\?/);
  });

  it("breakdown do snapshot separa MP e fabricacao; sem snapshot fica pendente", () => {
    const ok = extractProposalItemCostBreakdown(
      { item: { frozenMaterialCost: 5, frozenHhCost: 2, frozenHmCost: 1 } },
      3
    );
    assert.equal(ok.source, "SNAPSHOT");
    assert.equal(ok.materialTotal, 15);
    assert.equal(ok.fabricationTotal, 9);

    const pending = extractProposalItemCostBreakdown(null, 2);
    assert.equal(pending.source, "UNAVAILABLE");
    assert.equal(pending.materialTotal, null);
    assert.match(pending.pendingReason ?? "", /Breakdown/i);

    const fromProduction = extractProposalItemCostBreakdown(null, 2, {
      productionBreakdown: {
        materialCost: 10,
        laborCost: 3,
        machineCost: 2,
        processCost: 1,
      },
    });
    assert.equal(fromProduction.source, "PRODUCTION");
    assert.equal(fromProduction.materialTotal, 20);
    assert.equal(fromProduction.fabricationTotal, 12);
  });

  it("usa comissao e MP/fabricacao do snapshot comercial + breakdown de producao", () => {
    const doc = buildProposalInternalManagementPdfDocument({
      ...SAMPLE_PROPOSAL,
      totalCommission: 0,
      items: [
        {
          sku: "611.35AA",
          name: "Item",
          quantity: 10,
          unit: "UN",
          unitCost: 100,
          negotiatedPrice: 200,
          discountValue: 0,
          marginValue: 0,
          marginPerc: 0,
          commissionPerc: 0,
          commissionValue: 0,
          pricingSnapshotJson: null,
          commercialPricingSnapshotJson: {
            schemaVersion: 1,
            calculationSource: "PROPOSAL_PRICE_TABLE",
            calculatedCommissionRate: 0.03,
            commercialMarginRate: 0.34,
            commercialMarginValue: 680,
            finalNetLineValue: 2000,
            finalNetUnitPrice: 200,
            frozenCostUnit: 100,
            tiers: [],
            warnings: [],
          },
          productionCostBreakdown: {
            materialCost: 60,
            laborCost: 25,
            machineCost: 15,
            processCost: 0,
          },
        },
      ],
    });
    assert.equal(doc.items[0]?.commissionPending, false);
    assert.equal(doc.items[0]?.commissionPerc, 3);
    assert.equal(doc.items[0]?.commissionValue, 60);
    assert.equal(doc.items[0]?.marginPerc, 34);
    assert.equal(doc.items[0]?.marginValue, 680);
    assert.equal(doc.items[0]?.materialTotal, 600);
    assert.equal(doc.items[0]?.fabricationTotal, 400);
    assert.equal(doc.totals.materialCost, 600);
    assert.equal(doc.totals.fabricationCost, 400);
    assert.doesNotMatch(doc.commissionSummaryLabel, /Pendente/i);
  });

  it("usa margem e comissao ja gravadas no item da proposta quando snapshot nao resolve", () => {
    const doc = buildProposalInternalManagementPdfDocument({
      ...SAMPLE_PROPOSAL,
      totalCommission: 0,
      items: [
        {
          sku: "P-10",
          name: "Item com margem da proposta",
          quantity: 2,
          unit: "UN",
          unitCost: 50,
          negotiatedPrice: 100,
          discountValue: 0,
          marginValue: 70,
          marginPerc: 35,
          commissionPerc: 4.5,
          commissionValue: 9,
          pricingSnapshotJson: null,
          commercialPricingSnapshotJson: null,
        },
      ],
    });
    assert.equal(doc.items[0]?.marginPerc, 35);
    assert.equal(doc.items[0]?.marginValue, 70);
    assert.equal(doc.items[0]?.marginMissing, false);
    assert.equal(doc.items[0]?.commissionPending, false);
    assert.equal(doc.items[0]?.commissionPerc, 4.5);
    assert.equal(doc.items[0]?.commissionValue, 9);
    assert.doesNotMatch(doc.commissionSummaryLabel, /Pendente/i);
  });

  it("filename e paths usam proposalId", () => {
    assert.equal(
      buildProposalInternalManagementPdfApiPath("abc-123"),
      "/api/proposals/abc-123/internal-management-pdf"
    );
    assert.equal(
      buildProposalInternalManagementPrintPath("abc-123"),
      "/proposals/abc-123/internal-management-print"
    );
    assert.match(
      buildProposalInternalManagementPdfFilename({
        proposalNumber: 42,
        customerName: "Cliente Demo",
      }),
      /^proposta-gerencial-interna-CP-42-Cliente-Demo\.pdf$/
    );
  });

  it("UI abre print gerencial formatado e nao altera PDF cliente", () => {
    const mod = read("src/components/ProposalModule.tsx");
    const clientDoc = read("src/components/proposal/ProposalClientDocument.tsx");
    const printView = read("src/components/proposal/ProposalPrintView.tsx");
    const internalPrint = read(
      "src/components/proposal/ProposalInternalManagementPrintView.tsx"
    );
    const internalDoc = read(
      "src/components/proposal/ProposalInternalManagementDocument.tsx"
    );
    const app = read("src/App.tsx");
    const routes = read("src/lib/proposalInternalManagementPdfRoutes.ts");
    const server = read("server.ts");
    const pdfLib = read("src/lib/proposalInternalManagementPdf.ts");

    assert.doesNotMatch(mod, /Gerar PPT Executivo/);
    assert.doesNotMatch(mod, /\/api\/projects\/\$\{proposalId\}\/client-proposal-pptx/);
    assert.match(mod, new RegExp(PROPOSAL_INTERNAL_MANAGEMENT_PDF_BUTTON_LABEL));
    assert.match(mod, /buildProposalInternalManagementPrintPath|internal-management-print/);
    assert.match(app, /internal-management-print/);
    assert.match(internalPrint, /ProposalInternalManagementDocument/);
    assert.match(internalPrint, /internal-management-document/);
    assert.match(routes, /internal-management-document/);
    assert.match(internalDoc, /RELATÓRIO GERENCIAL INTERNO|RELAT.RIO GERENCIAL INTERNO/);
    assert.match(internalDoc, /Resumo gerencial da proposta/);
    assert.match(internalDoc, /matéria-prima|mat.ria-prima|Matéria-prima|Mat.ria-prima/i);
    assert.match(internalDoc, /PrintHeader/);
    assert.match(routes, /internal-management-pdf/);
    assert.match(server, /registerProposalInternalManagementPdfRoutes/);
    assert.match(pdfLib, /buildFormattedLandscapePdf/);
    assert.match(pdfLib, /previewProposalCommercialMargins/);
    assert.doesNotMatch(pdfLib, /buildMinimalPdfDocument/);
    assert.match(mod, /safeNum\(df\.commissionPerc\)/);
    assert.match(internalDoc, /Comissão estimada|Comiss[aã]o estimada/);
    assert.match(internalDoc, /Comissão %|Comiss[aã]o %/);
    assert.doesNotMatch(clientDoc, /totalCost|commissionValue|margem bruta/i);
    assert.doesNotMatch(printView, /internal-management|totalCost|commissionValue/i);
    assert.match(
      pdfLib,
      new RegExp(
        PROPOSAL_INTERNAL_MANAGEMENT_PDF_CONFIDENTIAL_MARK.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        )
      )
    );
  });
});
