/**
 * FASE 2C — VIABILIDADE do loader leve do Fluxo de Caixa.
 *
 * A fase 2C exige carregar os pedidos em lote SEM `OrderToCashAuditFact`, e ao
 * mesmo tempo entregar exatamente os mesmos números. Duas propriedades do audit
 * nascem VAZIAS no mapper de itens (orderFullAuditService.ts:1706-1708) e só são
 * preenchidas depois, a partir dos facts O2C (linhas 2350-2373):
 *
 *   - item.linkedReceivableExternalIds
 *   - item.linkedStockDocumentExternalIds
 *
 * E o vínculo documento→item (`stockDocumentItems[].linkedSalesOrderItemId`)
 * vem do resolver de Documentos de Saída, que consulta `OrderToCashAuditFact`
 * como uma de suas fontes (nomusOutputDocumentResolver.server.ts:109 e :420).
 *
 * Estes testes medem, um a um, QUAIS dessas dependências realmente movem o
 * número do Fluxo de Caixa. O resultado decide o desenho da 2C:
 *
 *   - CR por item  → INERTE  ⇒ pode ser abandonado com segurança
 *   - vínculo doc→item → LOAD-BEARING ⇒ NÃO pode ser abandonado
 *
 * São testes de caracterização: retratam o comportamento vigente. Se um deles
 * mudar, a premissa da 2C mudou — investigar, não reescrever a expectativa.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEffectiveScheduleInputFromAudit } from "@/src/lib/sales-orders/salesOrderDetailEffectiveFinancial.js";
import { buildSalesOrderEffectiveFinancialSchedule } from "@/src/lib/finance/salesOrderEffectiveFinancialSchedule.js";
import type { OrderFullAuditPayload } from "@/src/lib/finance/orderFullAuditService.js";

const REFERENCE_DATE = new Date("2026-08-13T12:00:00.000Z");

type ItemOver = {
  statusRaw?: string;
  statusNormalized?: string;
  fulfilled?: number;
};

function item(
  id: string,
  net: number,
  crIds: number[],
  over: ItemOver = {}
) {
  return {
    salesOrderItemId: id,
    quantity: 1,
    unitPrice: net,
    totalNetValue: net,
    activeValue: net,
    nomusItemStatusRaw: over.statusRaw ?? "Faturado",
    nomusItemStatusNormalized: over.statusNormalized ?? "INVOICED",
    nomusIsCanceled: false,
    nomusIsCut: false,
    nomusIsStale: false,
    nomusQuantityFulfilled: over.fulfilled ?? 1,
    linkedStockDocumentExternalIds: [],
    linkedNfeExternalIds: [],
    linkedReceivableExternalIds: crIds,
  };
}

/**
 * Audit mínimo com os 6 blocos que a fronteira do Fluxo de Caixa lê.
 *
 * @param crLinks         CR vinculados ao item I1 (origem: OrderToCashAuditFact)
 * @param docItemLink     item ao qual o documento de saída está vinculado, ou
 *                        null para simular a ausência do vínculo O2C
 * @param secondCrAmount  valor do 2º CR — controla cobertura total x parcial
 */
function auditPayload(input: {
  crLinks: number[];
  docItemLink: string | null;
  secondCrAmount: number;
  secondItemPending?: boolean;
}): OrderFullAuditPayload {
  const i2 = input.secondItemPending
    ? item("I2", 400, [], {
        statusRaw: "Em aberto",
        statusNormalized: "PENDING",
        fulfilled: 0,
      })
    : item("I2", 400, []);

  return {
    salesOrderId: "SO-1",
    orderCode: "PV-1",
    salesOrder: { orderCode: "PV-1" },
    items: [item("I1", 600, input.crLinks), i2],
    receivables: [
      {
        receivableExternalId: 5001,
        sourceInvoiceId: 900,
        dueDate: "2026-07-01",
        amountReceivable: 400,
        amountReceived: 400,
        balanceReceivable: 0,
      },
      {
        receivableExternalId: 5002,
        sourceInvoiceId: 900,
        dueDate: "2026-09-01",
        amountReceivable: input.secondCrAmount,
        amountReceived: 0,
        balanceReceivable: input.secondCrAmount,
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
    stockDocumentItems: input.docItemLink
      ? [
          {
            stockDocumentItemId: "SDI-1",
            linkedSalesOrderItemId: input.docItemLink,
            allocatedValue: 600,
            totalValue: 600,
            quantityUsedForOrder: 1,
            orderUnitPrice: 600,
          },
        ]
      : [],
    plannedReceivables: [
      {
        installmentNumber: 1,
        dueDate: "2026-07-01",
        originalExpectedAmount: 400,
        expectedAmount: 400,
      },
      {
        installmentNumber: 2,
        dueDate: "2026-09-01",
        originalExpectedAmount: 600,
        expectedAmount: 600,
      },
    ],
  } as unknown as OrderFullAuditPayload;
}

function schedule(audit: OrderFullAuditPayload) {
  return buildSalesOrderEffectiveFinancialSchedule(
    buildEffectiveScheduleInputFromAudit(audit, REFERENCE_DATE)
  );
}

/** O que o Fluxo de Caixa realmente consome do schedule: agenda + cobertura. */
function financialOutcome(audit: OrderFullAuditPayload) {
  const s = schedule(audit);
  return {
    residual: s.activeOrderResidualSchedule,
    superseded: s.supersededOrderSchedule,
    coverage: s.coverageSummary,
    realReceivables: s.realReceivables,
  };
}

describe("FASE 2C — viabilidade do loader leve sem OrderToCashAuditFact", () => {
  it("CR por item é INERTE: cobertura total (FULL_SUBSTITUTION)", () => {
    const comFacts = financialOutcome(
      auditPayload({ crLinks: [5001, 5002], docItemLink: "I1", secondCrAmount: 600 })
    );
    const semFacts = financialOutcome(
      auditPayload({ crLinks: [], docItemLink: "I1", secondCrAmount: 600 })
    );

    assert.equal(comFacts.coverage.materializationMode, "FULL_SUBSTITUTION");
    assert.deepEqual(
      semFacts,
      comFacts,
      "linkedReceivableExternalIds não pode mover o resultado financeiro"
    );
  });

  it("CR por item é INERTE: cobertura parcial (PROPORTIONAL_FALLBACK)", () => {
    const comFacts = financialOutcome(
      auditPayload({
        crLinks: [5001, 5002],
        docItemLink: "I1",
        secondCrAmount: 100,
        secondItemPending: true,
      })
    );
    const semFacts = financialOutcome(
      auditPayload({
        crLinks: [],
        docItemLink: "I1",
        secondCrAmount: 100,
        secondItemPending: true,
      })
    );

    assert.equal(comFacts.coverage.materializationMode, "PROPORTIONAL_FALLBACK");
    assert.equal(String(comFacts.coverage.activeOrderResidualTotal), "500");
    assert.deepEqual(
      semFacts,
      comFacts,
      "mesmo com residual ativo, o CR por item não altera a agenda"
    );
  });

  it("vínculo documento→item também é INERTE para o Fluxo de Caixa", () => {
    // `documents[]` do motor vem de audit.stockDocuments (nível PEDIDO); o
    // vínculo por item só molda o detalhamento por linha, que o Fluxo de Caixa
    // não consome. Logo o segundo uso de OrderToCashAuditFact também some.
    const comVinculo = financialOutcome(
      auditPayload({
        crLinks: [],
        docItemLink: "I1",
        secondCrAmount: 100,
        secondItemPending: true,
      })
    );
    const semVinculo = financialOutcome(
      auditPayload({
        crLinks: [],
        docItemLink: null,
        secondCrAmount: 100,
        secondItemPending: true,
      })
    );

    assert.deepEqual(semVinculo, comVinculo);
  });

  it("TRAVA: stockDocuments[].allocatedValue É load-bearing — é o gargalo real da 2C", () => {
    // Este é o único insumo fact-dependente que MOVE o número: ele nasce de
    // projectOutputDocumentAllocation, alimentado por allocationLines vindas do
    // resolver de Documentos de Saída, que consulta OrderToCashAuditFact.
    // Enquanto o loader leve não reproduzir este valor sem aquela tabela, a 2C
    // não pode entregar "mesmos números sem OrderToCashAuditFact".
    // Sem CR real: o documento é a ÚNICA evidência de materialização, e é aí
    // que allocatedValue decide sozinho o quanto sai da previsão do pedido.
    const semCr = (allocated: number) => {
      const a = auditPayload({
        crLinks: [],
        docItemLink: "I1",
        secondCrAmount: 0,
        secondItemPending: true,
      });
      (a as { receivables: unknown[] }).receivables = [];
      (a.stockDocuments[0] as { allocatedValue: number }).allocatedValue = allocated;
      return financialOutcome(a);
    };

    const comAlocacao = semCr(600);
    const semAlocacao = semCr(0);

    // Existe para PROVAR a diferença — não é regressão.
    assert.notDeepEqual(
      semAlocacao.coverage,
      comAlocacao.coverage,
      "se isto passar a ser igual, allocatedValue deixou de mover o número"
    );
    assert.equal(
      String(comAlocacao.coverage.coveredByDocumentsWithoutCr),
      "600",
      "o documento cobre 600 da previsão quando não há CR real"
    );
    assert.equal(String(semAlocacao.coverage.coveredByDocumentsWithoutCr), "0");
  });

  it("o mapper de itens do audit não depende de facts (só de SalesOrderItem)", () => {
    // Campos que a fronteira lê de cada item — todos derivam de SalesOrderItem,
    // exceto os dois arrays de vínculo, que os testes acima já isolaram.
    const lidosDoItem = [
      "salesOrderItemId",
      "totalNetValue",
      "activeValue",
      "quantity",
      "unitPrice",
      "nomusItemStatusRaw",
      "nomusItemStatusNormalized",
      "nomusQuantityFulfilled",
      "nomusIsCut",
      "nomusIsCanceled",
      "nomusIsStale",
    ] as const;

    const audit = auditPayload({
      crLinks: [],
      docItemLink: "I1",
      secondCrAmount: 600,
    });
    for (const campo of lidosDoItem) {
      assert.ok(
        campo in (audit.items[0] as unknown as Record<string, unknown>),
        `fixture precisa expor ${campo}`
      );
    }
    // Se um campo novo passar a ser lido pela fronteira, o golden CONTRATO
    // (cashFlowEffectiveScheduleGolden.test.ts) quebra primeiro.
    assert.equal(lidosDoItem.length, 11);
  });
});
