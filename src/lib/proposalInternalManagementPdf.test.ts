import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildProposalInternalManagementPdfApiPath,
  buildProposalInternalManagementPdfBuffer,
  buildProposalInternalManagementPdfDocument,
  buildProposalInternalManagementPdfFilename,
  PROPOSAL_INTERNAL_MANAGEMENT_PDF_BUTTON_LABEL,
  PROPOSAL_INTERNAL_MANAGEMENT_PDF_CONFIDENTIAL_MARK,
  proposalInternalManagementPdfContainsClientOnlyGuard,
} from "./proposalInternalManagementPdf.js";

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
      notes: null,
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
  it("monta documento com custo, margem, comissao e marcador confidencial", () => {
    const doc = buildProposalInternalManagementPdfDocument(SAMPLE_PROPOSAL);
    assert.equal(doc.totals.net, 10000);
    assert.equal(doc.totals.cost, 7000);
    assert.equal(doc.totals.marginValue, 3000);
    assert.equal(doc.totals.commission, 200);
    assert.ok(doc.totals.markup != null);
    assert.match(doc.confidentialMark, /confidencial/i);
    assert.equal(doc.items.length, 2);
    assert.equal(doc.items[1]?.costIncomplete, true);
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
      })),
    });
    assert.match(doc.commissionSummaryLabel, /Pendente/i);
  });

  it("gera PDF com Content-Type util e marcador interno", () => {
    const doc = buildProposalInternalManagementPdfDocument(SAMPLE_PROPOSAL);
    const buffer = buildProposalInternalManagementPdfBuffer(doc);
    assert.ok(buffer.length > 100);
    assert.equal(buffer.subarray(0, 5).toString("utf8"), "%PDF-");
    assert.equal(proposalInternalManagementPdfContainsClientOnlyGuard(buffer), true);
    const text = buffer.toString("latin1");
    assert.match(text, /Gerencial Interno/i);
    assert.match(text, /confidencial/i);
    assert.match(text, /Custo total estimado/i);
    assert.match(text, /Comissao estimada/i);
  });

  it("filename e path usam proposalId", () => {
    assert.equal(
      buildProposalInternalManagementPdfApiPath("abc-123"),
      "/api/proposals/abc-123/internal-management-pdf"
    );
    assert.match(
      buildProposalInternalManagementPdfFilename({
        proposalNumber: 42,
        customerName: "Cliente Demo",
      }),
      /^proposta-gerencial-interna-CP-42-Cliente-Demo\.pdf$/
    );
  });

  it("UI remove PPT executivo e aponta para PDF gerencial", () => {
    const mod = read("src/components/ProposalModule.tsx");
    const clientDoc = read("src/components/proposal/ProposalClientDocument.tsx");
    const printView = read("src/components/proposal/ProposalPrintView.tsx");
    const routes = read("src/lib/proposalInternalManagementPdfRoutes.ts");
    const server = read("server.ts");

    assert.doesNotMatch(mod, /Gerar PPT Executivo/);
    assert.doesNotMatch(mod, /\/api\/projects\/\$\{proposalId\}\/client-proposal-pptx/);
    assert.match(mod, new RegExp(PROPOSAL_INTERNAL_MANAGEMENT_PDF_BUTTON_LABEL));
    assert.match(mod, /internal-management-pdf/);
    assert.match(mod, /parseApiErrorMessage/);
    assert.match(routes, /internal-management-pdf/);
    assert.match(server, /registerProposalInternalManagementPdfRoutes/);
    assert.doesNotMatch(clientDoc, /totalCost|commissionValue|margem bruta/i);
    assert.doesNotMatch(printView, /internal-management-pdf/);
    assert.match(
      read("src/lib/proposalInternalManagementPdf.ts"),
      new RegExp(PROPOSAL_INTERNAL_MANAGEMENT_PDF_CONFIDENTIAL_MARK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  });
});
