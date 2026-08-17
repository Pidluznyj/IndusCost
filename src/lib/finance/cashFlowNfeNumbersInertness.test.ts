/**
 * FASE 2C — `nfeNumbers` é insumo INERTE da primeira projeção.
 *
 * POR QUE ESTE TESTE EXISTE: o `nfeNumbers` do audit nasce de um `nfeMap`
 * composto por quatro fontes distintas (relatedNfes, facts O2C com id, facts
 * O2C só com número — que criam placeholder de externalId negativo — e
 * documentos de saída resolvidos), com complementação posterior por `NomusNfe`.
 * Reproduzir essa composição no loader leve seria caro e arriscado.
 *
 * Antes de pagar esse custo, medimos se o valor sequer é consumido:
 *
 *   projectEffectiveScheduleForOrderAudit
 *     → buildOriginalInstallmentsFromPaymentTerms
 *       → resolveSalesOrderListPaymentSummary({ nfeDocuments })
 *
 * e `nfeDocuments` é declarado em `SalesOrderListPaymentResolveInput`
 * (salesOrderListPaymentSchedule.ts:60) mas **nunca lido** no corpo do módulo.
 *
 * Estes testes congelam isso. Enquanto passarem, o loader leve pode entregar
 * `nfeNumbers` vazio sem mover nenhum número — e a composição do `nfeMap` não
 * precisa ser replicada.
 *
 * Se algum dia falharem, `nfeDocuments` passou a ser consumido: aí a
 * composição vira load-bearing e precisa ser extraída antes de qualquer
 * caminho alternativo.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectEffectiveScheduleForOrderAudit } from "@/src/lib/finance/effectiveScheduleAuditProjection.js";

const REFERENCE_DATE = new Date("2026-08-14T12:00:00.000Z");

function cenario(input: {
  nfeNumbers: string[];
  nomusRawResponse?: unknown;
  receivables?: Array<Record<string, unknown>>;
  stockDocuments?: Array<Record<string, unknown>>;
  statusNormalized?: string;
  fulfilled?: number;
}) {
  return projectEffectiveScheduleForOrderAudit({
    salesOrderId: "SO-1",
    orderCode: "PV-1",
    issueDate: new Date("2026-06-01T00:00:00.000Z"),
    paymentTerms: "30/60",
    paymentMethod: "Boleto",
    nomusRawResponse: input.nomusRawResponse ?? null,
    totalActiveValue: 1000,
    items: [
      {
        salesOrderItemId: "I1",
        quantity: 1,
        unitPrice: 1000,
        totalNetValue: 1000,
        activeValue: 1000,
        nomusItemStatusRaw: "Em aberto",
        nomusItemStatusNormalized: input.statusNormalized ?? "PENDING",
        nomusIsCanceled: false,
        nomusIsCut: false,
        nomusIsStale: false,
        nomusQuantityFulfilled: input.fulfilled ?? 0,
        linkedStockDocumentExternalIds: [],
        linkedNfeExternalIds: [],
        linkedReceivableExternalIds: [],
      },
    ] as never,
    receivables: (input.receivables ?? []) as never,
    stockDocuments: (input.stockDocuments ?? []) as never,
    nfeNumbers: input.nfeNumbers,
    referenceDate: REFERENCE_DATE,
  });
}

/** Tudo o que a fronteira do Fluxo de Caixa consome desta projeção. */
function resultado(r: ReturnType<typeof cenario>) {
  return {
    plannedReceivables: r.plannedReceivables,
    plannedReceivablesTotal: r.plannedReceivablesTotal,
    residual: r.schedule.activeOrderResidualSchedule,
    superseded: r.schedule.supersededOrderSchedule,
    coverage: r.schedule.coverageSummary,
  };
}

/** Parcelas explícitas no payload Nomus — garante agenda materializada. */
const RAW_COM_PARCELAS = {
  parcelas: [
    { numero: 1, dataVencimento: "2026-07-01", valor: 400 },
    { numero: 2, dataVencimento: "2026-09-01", valor: 600 },
  ],
};

const VARIACOES: Array<{ nome: string; numeros: string[] }> = [
  { nome: "nenhum número", numeros: [] },
  { nome: "um número", numeros: ["12345"] },
  { nome: "vários números", numeros: ["12345", "67890", "11111"] },
  { nome: "números repetidos", numeros: ["12345", "12345"] },
  { nome: "número improvável", numeros: ["999999999"] },
];

describe("FASE 2C — nfeNumbers não move o número da primeira projeção", () => {
  it("pedido sem cobertura: variar nfeNumbers não altera nada", () => {
    const base = resultado(cenario({ nfeNumbers: [] }));
    for (const v of VARIACOES) {
      assert.deepEqual(
        JSON.parse(JSON.stringify(resultado(cenario({ nfeNumbers: v.numeros })))),
        JSON.parse(JSON.stringify(base)),
        `nfeNumbers "${v.nome}" alterou o resultado`
      );
    }
  });

  it("com agenda materializada (parcelas no payload Nomus): idem", () => {
    const comParcelas = (numeros: string[]) =>
      resultado(
        cenario({ nfeNumbers: numeros, nomusRawResponse: RAW_COM_PARCELAS })
      );

    const base = comParcelas([]);
    // O cenário precisa exercitar parcelas de verdade, senão não prova nada.
    assert.ok(
      base.plannedReceivables.length > 0,
      "fixture deveria materializar parcelas"
    );

    for (const v of VARIACOES) {
      assert.deepEqual(
        JSON.parse(JSON.stringify(comParcelas(v.numeros))),
        JSON.parse(JSON.stringify(base)),
        `nfeNumbers "${v.nome}" alterou a agenda`
      );
    }
  });

  it("com CR real e documento: idem", () => {
    const completo = (numeros: string[]) =>
      resultado(
        cenario({
          nfeNumbers: numeros,
          nomusRawResponse: RAW_COM_PARCELAS,
          statusNormalized: "INVOICED",
          fulfilled: 1,
          receivables: [
            {
              receivableExternalId: 5001,
              sourceInvoiceId: 900,
              dueDate: "2026-07-01",
              amountReceivable: 400,
              amountReceived: 400,
              balanceReceivable: 0,
            },
          ],
          stockDocuments: [
            {
              stockDocumentExternalId: 7001,
              idNfe: 900,
              status: "Confirmado",
              dataDocumento: "2026-06-15",
              dataMovimentacao: "2026-06-15",
              allocatedValue: 600,
              totalValue: 600,
            },
          ],
        })
      );

    const base = completo([]);
    for (const v of VARIACOES) {
      assert.deepEqual(
        JSON.parse(JSON.stringify(completo(v.numeros))),
        JSON.parse(JSON.stringify(base)),
        `nfeNumbers "${v.nome}" alterou o resultado com CR/documento`
      );
    }
  });

  it("TRAVA: o campo existe no contrato, mas o motor não o lê", () => {
    // Se `nfeDocuments` passar a ser consumido, os testes acima quebram e a
    // composição do nfeMap (placeholder negativo incluído) volta a importar.
    const comTudo = resultado(
      cenario({ nfeNumbers: ["A", "B", "C"], nomusRawResponse: RAW_COM_PARCELAS })
    );
    const semNada = resultado(
      cenario({ nfeNumbers: [], nomusRawResponse: RAW_COM_PARCELAS })
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(comTudo)),
      JSON.parse(JSON.stringify(semNada))
    );
  });
});
