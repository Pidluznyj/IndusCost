/**
 * Cobertura de faturamento quando a NF-e / Documento de Saída contém itens de
 * vários pedidos (caso real PD 02959: pedido 107.508,00 × NF 7863/2 272.238,00).
 *
 * O cabeçalho da NF não é a parcela do pedido. A cobertura passa a vir da
 * quantidade faturada por item do motor operacional
 * (`SalesOrderFlowSnapshot.progressInvoiced`) — sem rateio paralelo.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSalesOrderLinkedNfeContext,
  resolveOperationalInvoicedProgressPercent,
  resolveSharedNfeExternalIds,
} from "./salesOrderLinkedNfe.js";
import {
  resolveSalesOrderBillingStatus,
  type SalesOrderBillingStatus,
} from "./sales/salesOrderListBillingStatus.js";

const REF = new Date(2026, 8, 30);
const NFE_STATUS_AUTHORIZED = 100;
const NFE_STATUS_CANCELED = 7;

type NfeFixture = {
  externalId: number;
  /** Cabeçalho da NF (xmlVNF) — total de todos os pedidos contidos nela. */
  headerValue: number;
  status?: number;
};

function context(input: {
  totalNetValue: number;
  nfes: NfeFixture[];
  sharedNfeExternalIds?: number[];
  /** `SalesOrderFlowSnapshot.progressInvoiced`; undefined = pedido sem snapshot. */
  progressInvoiced?: number | null;
}) {
  const processedAt = new Date(2026, 8, 10);
  return buildSalesOrderLinkedNfeContext({
    links: input.nfes.map((nfe) => ({
      id: `link-${nfe.externalId}`,
      nfeExternalId: nfe.externalId,
      nfeNumber: String(nfe.externalId),
      nfeKey: null,
      nfeStatus: nfe.status ?? NFE_STATUS_AUTHORIZED,
      tipoOperacao: 1,
      dataProcessamento: processedAt,
      presentInLastPayload: true,
      nomusNfeId: null,
    })),
    nomusNfesByExternalId: new Map(
      input.nfes.map((nfe) => [
        nfe.externalId,
        {
          id: `nomus-${nfe.externalId}`,
          externalId: nfe.externalId,
          numero: String(nfe.externalId),
          chave: null,
          status: nfe.status ?? NFE_STATUS_AUTHORIZED,
          tipoOperacao: 1,
          dataProcessamento: processedAt,
          xmlDhEmi: null,
          valorLiquido: nfe.headerValue,
          xmlVNF: nfe.headerValue,
        },
      ])
    ),
    totalNetValue: input.totalNetValue,
    issueDate: new Date(2026, 7, 31),
    expectedDeliveryDate: new Date(2026, 8, 15),
    referenceDate: REF,
    sharedNfeExternalIds: new Set(input.sharedNfeExternalIds ?? []),
    operationalInvoicing:
      input.progressInvoiced === undefined
        ? null
        : { progressInvoicedPercent: input.progressInvoiced },
  });
}

function billingStatus(
  ctx: ReturnType<typeof context>,
  status = "SENT_TO_NOMUS"
): SalesOrderBillingStatus {
  return resolveSalesOrderBillingStatus({
    status,
    hasNfe: ctx.hasNfe,
    isFullyInvoiced: ctx.isFullyInvoiced,
    isPartiallyInvoiced: ctx.isPartiallyInvoiced,
  });
}

describe("faturamento do pedido com NF de vários pedidos", () => {
  it("PD 02959: NF 272.238 de vários pedidos, parcela do pedido 107.508 = INVOICED", () => {
    const ctx = context({
      totalNetValue: 107_508,
      nfes: [{ externalId: 7863, headerValue: 272_238 }],
      sharedNfeExternalIds: [7863],
      progressInvoiced: 100,
    });
    assert.equal(billingStatus(ctx), "INVOICED");
    assert.equal(ctx.isFullyInvoiced, true);
    assert.equal(ctx.isPartiallyInvoiced, false);
    assert.equal(ctx.invoiceCoveragePercent, 100);
    assert.equal(ctx.invoiceCoverageBasis, "operational_item_quantity");
    assert.equal(ctx.hasNfeSharedAcrossOrders, true);
    // Excesso do cabeçalho é esperado em NF compartilhada — não é divergência.
    assert.equal(ctx.hasValueDivergence, false);
    assert.equal(ctx.needsDataReview, false);
    assert.equal(ctx.slaStatus, "on_time");
    // O cabeçalho da NF segue disponível como grandeza fiscal histórica.
    assert.equal(ctx.nfeTotalValue, 272_238);
  });

  it("regra anterior (cabeçalho da NF) classificava o mesmo pedido como parcial", () => {
    const ctx = context({
      totalNetValue: 107_508,
      nfes: [{ externalId: 7863, headerValue: 272_238 }],
    });
    assert.equal(ctx.invoiceCoverageBasis, "nfe_header_value");
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
  });

  it("NF de vários pedidos em que o pedido recebeu só 50% = PARTIALLY_INVOICED", () => {
    const ctx = context({
      totalNetValue: 107_508,
      nfes: [{ externalId: 7863, headerValue: 272_238 }],
      sharedNfeExternalIds: [7863],
      progressInvoiced: 50,
    });
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
    assert.equal(ctx.invoiceCoveragePercent, 50);
    assert.equal(ctx.hasCut, true);
  });

  it("NF compartilhada com cabeçalho igual ao pedido não vira faturado se o pedido recebeu 50%", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 1000 }],
      sharedNfeExternalIds: [1],
      progressInvoiced: 50,
    });
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
  });

  it("uma NF exclusiva do pedido mantém a regra por valor, mesmo com snapshot defasado", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 1000 }],
      progressInvoiced: 40,
    });
    assert.equal(ctx.invoiceCoverageBasis, "nfe_header_value");
    assert.equal(billingStatus(ctx), "INVOICED");
    assert.equal(ctx.invoiceCoveragePercent, 100);
  });

  it("várias NFs exclusivas somam o valor do pedido = INVOICED", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [
        { externalId: 1, headerValue: 600 },
        { externalId: 2, headerValue: 400 },
      ],
    });
    assert.equal(billingStatus(ctx), "INVOICED");
  });

  it("item faturado em mais de uma NF, uma delas compartilhada, usa o motor operacional", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [
        { externalId: 1, headerValue: 400 },
        { externalId: 2, headerValue: 5000 },
      ],
      sharedNfeExternalIds: [2],
      progressInvoiced: 100,
    });
    assert.equal(billingStatus(ctx), "INVOICED");
  });

  it("pedido parcialmente faturado com NF exclusiva segue PARTIALLY_INVOICED", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 400 }],
      progressInvoiced: 40,
    });
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
    assert.equal(ctx.invoiceCoveragePercent, 40);
  });

  it("pedido com corte: obrigação ativa 100% faturada em NF compartilhada = INVOICED", () => {
    // progressInvoiced é ponderado pela obrigação ativa (exclui corte/cancelado).
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 3000 }],
      sharedNfeExternalIds: [1],
      progressInvoiced: 100,
    });
    assert.equal(billingStatus(ctx), "INVOICED");
  });

  it("quantidade faturada maior que a obrigação ativa não passa de 100%", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 1300 }],
      progressInvoiced: 130,
    });
    assert.equal(ctx.invoiceCoveragePercent, 100);
    assert.equal(billingStatus(ctx), "INVOICED");
    // NF exclusiva acima do pedido continua sinalizada para revisão.
    assert.equal(ctx.hasValueDivergence, true);
  });

  it("tolerância: progresso 99,99% conta como faturado; 99,5% não", () => {
    const full = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 3000 }],
      sharedNfeExternalIds: [1],
      progressInvoiced: 99.99,
    });
    const partial = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 3000 }],
      sharedNfeExternalIds: [1],
      progressInvoiced: 99.5,
    });
    assert.equal(billingStatus(full), "INVOICED");
    assert.equal(billingStatus(partial), "PARTIALLY_INVOICED");
  });

  it("NF cancelada compartilhada não fatura, mesmo com snapshot em 100%", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 3000, status: NFE_STATUS_CANCELED }],
      sharedNfeExternalIds: [1],
      progressInvoiced: 100,
    });
    assert.equal(ctx.hasNfe, false);
    assert.equal(ctx.hasNfeSharedAcrossOrders, false);
    assert.equal(billingStatus(ctx), "NOT_INVOICED");
  });

  it("pedido sem NF = NOT_INVOICED; atendido sem NF também", () => {
    const withoutNfe = context({ totalNetValue: 1000, nfes: [] });
    const fulfilledWithoutNfe = context({
      totalNetValue: 1000,
      nfes: [],
      progressInvoiced: 100,
    });
    assert.equal(billingStatus(withoutNfe), "NOT_INVOICED");
    assert.equal(billingStatus(fulfilledWithoutNfe), "NOT_INVOICED");
  });

  it("pedido cancelado = CANCELED, independentemente da NF compartilhada", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 3000 }],
      sharedNfeExternalIds: [1],
      progressInvoiced: 100,
    });
    assert.equal(billingStatus(ctx, "CANCELLED"), "CANCELED");
  });

  it("NF vinculada sem linha atribuível ao pedido mantém a regra do cabeçalho", () => {
    const zeroProgress = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 3000 }],
      sharedNfeExternalIds: [1],
      progressInvoiced: 0,
    });
    const withoutSnapshot = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 3000 }],
      sharedNfeExternalIds: [1],
    });
    for (const ctx of [zeroProgress, withoutSnapshot]) {
      assert.equal(ctx.invoiceCoverageBasis, "nfe_header_value");
      assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
      assert.equal(ctx.hasNfeSharedAcrossOrders, true);
    }
  });
});

describe("resolveSharedNfeExternalIds", () => {
  it("marca apenas NF vinculada a mais de um pedido", () => {
    const shared = resolveSharedNfeExternalIds([
      { salesOrderId: "pd-02959", nfeExternalId: 7863 },
      { salesOrderId: "pd-02920", nfeExternalId: 7863 },
      { salesOrderId: "pd-02918", nfeExternalId: 7863 },
      { salesOrderId: "pd-02959", nfeExternalId: 7900 },
      { salesOrderId: "pd-02959", nfeExternalId: 7900 },
    ]);
    assert.deepEqual([...shared], [7863]);
  });
});

describe("resolveOperationalInvoicedProgressPercent", () => {
  it("só aceita progresso finito e positivo, limitado a 100", () => {
    assert.equal(resolveOperationalInvoicedProgressPercent(null), null);
    assert.equal(resolveOperationalInvoicedProgressPercent({ progressInvoicedPercent: null }), null);
    assert.equal(resolveOperationalInvoicedProgressPercent({ progressInvoicedPercent: 0 }), null);
    assert.equal(resolveOperationalInvoicedProgressPercent({ progressInvoicedPercent: Number.NaN }), null);
    assert.equal(resolveOperationalInvoicedProgressPercent({ progressInvoicedPercent: 62.5 }), 62.5);
    assert.equal(resolveOperationalInvoicedProgressPercent({ progressInvoicedPercent: 140 }), 100);
  });
});
