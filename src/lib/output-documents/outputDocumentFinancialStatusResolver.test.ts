/**
 * DS-03.9 — testes do resolver financeiro de Documento de Saída.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateDocumentFinancialStatusFromTitles,
  resolveOutputDocumentFinancialStatus,
} from "./outputDocumentFinancialStatusResolver.js";
import { loadOutputDocumentFinancialStatus } from "./outputDocumentFinancialStatusResolver.server.js";

const REF = new Date("2026-07-17T12:00:00.000Z");

describe("resolveOutputDocumentFinancialStatus", () => {
  it("documento sem NF → sem_informacao_financeira", () => {
    const result = resolveOutputDocumentFinancialStatus({
      stockDocumentExternalId: 8451,
      idNfe: null,
      referenceDate: REF,
    });
    assert.equal(result.status, "sem_informacao_financeira");
    assert.equal(result.installmentCount, 0);
    assert.equal(result.receivableTotal, 0);
    assert.ok(result.alerts.includes("DOCUMENT_WITHOUT_NFE"));
    assert.ok(result.alerts.includes("FINANCIAL_LINK_UNRESOLVED"));
    assert.equal(result.financialOrigin, "NONE");
  });

  it("NF sem CR → aguardando_cr", () => {
    const result = resolveOutputDocumentFinancialStatus({
      stockDocumentExternalId: 8451,
      idNfe: 7208,
      nfeStatus: 1,
      nfeValue: "100.00",
      receivables: [],
      referenceDate: REF,
    });
    assert.equal(result.status, "aguardando_cr");
    assert.equal(result.nfeExternalId, 7208);
    assert.equal(result.installmentCount, 0);
    assert.ok(result.alerts.includes("NFE_WITHOUT_RECEIVABLES"));
    assert.equal(result.nextDueDate, null);
  });

  it("CR em aberto", () => {
    const result = resolveOutputDocumentFinancialStatus({
      stockDocumentExternalId: 1,
      idNfe: 100,
      nfeStatus: 1,
      nfeValue: "100.00",
      receivables: [
        {
          externalId: 55,
          sourceInvoiceId: 100,
          amountReceivable: "100.00",
          amountReceived: "0",
          balanceReceivable: "100.00",
          dueDate: "2026-08-01T00:00:00.000Z",
        },
      ],
      referenceDate: REF,
    });
    assert.equal(result.status, "cr_em_aberto");
    assert.equal(result.receivableTotal, 100);
    assert.equal(result.open, 100);
    assert.equal(result.received, 0);
    assert.equal(result.installmentCount, 1);
    assert.ok(result.nextDueDate?.startsWith("2026-08-01"));
    assert.equal(result.financialOrigin, "REAL_RECEIVABLE");
    assert.equal(result.titles[0]!.settlement, "aberto");
  });

  it("parcialmente recebido", () => {
    const result = resolveOutputDocumentFinancialStatus({
      stockDocumentExternalId: 2,
      idNfe: 200,
      nfeValue: "100.00",
      receivables: [
        {
          externalId: 1,
          amountReceivable: "100.00",
          amountReceived: "40.00",
          balanceReceivable: "60.00",
          dueDate: "2026-08-10T00:00:00.000Z",
        },
      ],
      referenceDate: REF,
    });
    assert.equal(result.status, "parcialmente_recebido");
    assert.equal(result.open, 60);
    assert.equal(result.received, 40);
    assert.equal(result.titles[0]!.settlement, "parcial");
  });

  it("recebido", () => {
    const result = resolveOutputDocumentFinancialStatus({
      stockDocumentExternalId: 3,
      idNfe: 300,
      nfeValue: "100.00",
      receivables: [
        {
          externalId: 1,
          amountReceivable: "100.00",
          amountReceived: "100.00",
          balanceReceivable: "0",
          settlementDate: "2026-07-01T00:00:00.000Z",
        },
      ],
      referenceDate: REF,
    });
    assert.equal(result.status, "recebido");
    assert.equal(result.open, 0);
    assert.equal(result.received, 100);
    assert.equal(result.nextDueDate, null);
    assert.equal(result.titles[0]!.dueStatus, "nao_aplicavel");
  });

  it("vencido (título aberto com dueDate passado)", () => {
    const result = resolveOutputDocumentFinancialStatus({
      stockDocumentExternalId: 4,
      idNfe: 400,
      nfeValue: "50.00",
      receivables: [
        {
          externalId: 9,
          amountReceivable: "50.00",
          amountReceived: "0",
          balanceReceivable: "50.00",
          dueDate: "2026-06-01T00:00:00.000Z",
        },
      ],
      referenceDate: REF,
    });
    assert.equal(result.status, "vencido");
    assert.ok(result.alerts.includes("RECEIVABLE_OVERDUE"));
    assert.equal(result.titles[0]!.dueStatus, "vencido");
  });

  it("vários títulos: agrega totais, parcelas e próximo vencimento", () => {
    const result = resolveOutputDocumentFinancialStatus({
      stockDocumentExternalId: 5,
      idNfe: 500,
      nfeValue: "150.00",
      receivables: [
        {
          externalId: 1,
          amountReceivable: "50.00",
          amountReceived: "50.00",
          balanceReceivable: "0",
        },
        {
          externalId: 2,
          amountReceivable: "50.00",
          amountReceived: "0",
          balanceReceivable: "50.00",
          dueDate: "2026-09-01T00:00:00.000Z",
        },
        {
          externalId: 3,
          amountReceivable: "50.00",
          amountReceived: "0",
          balanceReceivable: "50.00",
          dueDate: "2026-08-15T00:00:00.000Z",
        },
        // duplicata — dedupe
        {
          externalId: 2,
          amountReceivable: "50.00",
          amountReceived: "0",
          balanceReceivable: "50.00",
          dueDate: "2026-09-01T00:00:00.000Z",
        },
      ],
      referenceDate: REF,
    });
    assert.equal(result.installmentCount, 3);
    assert.equal(result.receivableTotal, 150);
    assert.equal(result.received, 50);
    assert.equal(result.open, 100);
    assert.equal(result.status, "parcialmente_recebido");
    assert.ok(result.nextDueDate?.startsWith("2026-08-15"));
    assert.equal(result.nfeVsReceivables, "ok");
  });

  it("NF cancelada → cancelado", () => {
    const result = resolveOutputDocumentFinancialStatus({
      stockDocumentExternalId: 6,
      idNfe: 600,
      nfeStatus: 7,
      nfeValue: "100.00",
      receivables: [
        {
          externalId: 1,
          amountReceivable: "100.00",
          amountReceived: "0",
          balanceReceivable: "100.00",
          dueDate: "2026-08-01T00:00:00.000Z",
        },
      ],
      referenceDate: REF,
    });
    assert.equal(result.status, "cancelado");
    assert.equal(result.nfeCancelled, true);
    assert.ok(result.alerts.includes("NFE_CANCELLED"));
    // Títulos ainda retornados para auditoria, mas status do doc é cancelado.
    assert.equal(result.installmentCount, 1);
  });

  it("documento cancelado no stage → cancelado", () => {
    const result = resolveOutputDocumentFinancialStatus({
      stockDocumentExternalId: 7,
      idNfe: 700,
      isCancelled: true,
      receivables: [],
      referenceDate: REF,
    });
    assert.equal(result.status, "cancelado");
    assert.equal(result.documentCancelled, true);
    assert.ok(result.alerts.includes("DOCUMENT_CANCELLED"));
  });

  it("precedência: CR real prevalece; não inventa parcelas da condição", () => {
    const result = resolveOutputDocumentFinancialStatus({
      stockDocumentExternalId: 8,
      idNfe: 800,
      paymentTermsRaw: "28 DDL",
      documentTotalValue: "100.00",
      orderForecastValue: "100.00",
      receivables: [
        {
          externalId: 1,
          amountReceivable: "100.00",
          amountReceived: "0",
          balanceReceivable: "100.00",
          dueDate: "2026-08-20T00:00:00.000Z",
        },
      ],
      referenceDate: REF,
    });
    assert.equal(result.financialOrigin, "REAL_RECEIVABLE");
    assert.equal(result.hasDocumentPaymentTermsEvidence, true);
    assert.equal(result.documentPaymentTermsRaw, "28 DDL");
    // Parcelas = só títulos CR, não parse de "28 DDL".
    assert.equal(result.installmentCount, 1);
    assert.equal(result.status, "cr_em_aberto");
  });

  it("sem CR: condição do documento não inventa vencimentos", () => {
    const result = resolveOutputDocumentFinancialStatus({
      stockDocumentExternalId: 9,
      idNfe: 900,
      paymentTermsRaw: "3x 30 DDL",
      documentTotalValue: "300.00",
      orderForecastValue: "300.00",
      receivables: [],
      referenceDate: REF,
    });
    assert.equal(result.status, "aguardando_cr");
    assert.equal(result.installmentCount, 0);
    assert.equal(result.nextDueDate, null);
    assert.ok(
      result.financialOrigin === "OUTPUT_DOCUMENT" ||
        result.financialOrigin === "MIXED" ||
        result.financialOrigin === "ORDER_PLAN"
    );
  });
});

describe("aggregateDocumentFinancialStatusFromTitles", () => {
  it("prioriza vencido sobre parcial", () => {
    const agg = aggregateDocumentFinancialStatusFromTitles([
      { settlement: "parcial", dueStatus: "vencido" },
      { settlement: "recebido", dueStatus: "nao_aplicavel" },
    ]);
    assert.equal(agg.status, "vencido");
  });
});

describe("loadOutputDocumentFinancialStatus (memory)", () => {
  it("carrega CR pela NF e não escreve", async () => {
    const updates: unknown[] = [];
    const prisma = {
      nomusStockDocument: {
        findFirst: async () => ({
          externalId: 8451,
          idNfe: 7208,
          isCancelled: false,
          paymentTermsRaw: "28 DDL",
          totalValue: "100.00",
        }),
      },
      nomusNfe: {
        findUnique: async () => ({
          externalId: 7208,
          status: 1,
          valorLiquido: "100.00",
          xmlVNF: "100.00",
        }),
      },
      nomusAccountsReceivable: {
        findMany: async () => [
          {
            id: "ar-1",
            externalId: 55,
            sourceInvoiceId: 7208,
            amountReceivable: "100.00",
            amountReceived: "0",
            balanceReceivable: "100.00",
            dueDate: new Date("2026-08-01T00:00:00.000Z"),
            settlementDate: null,
            status: true,
          },
        ],
        update: async (args: unknown) => {
          updates.push(args);
          return {};
        },
      },
    };

    const result = await loadOutputDocumentFinancialStatus(
      prisma as never,
      8451,
      { referenceDate: REF }
    );
    assert.ok(result);
    assert.equal(result!.status, "cr_em_aberto");
    assert.equal(result!.installmentCount, 1);
    assert.equal(updates.length, 0);
  });
});
