/**
 * FIN-08 — Contas a Receber com agenda efetiva (sem duplicar Pedido × CR).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { buildSalesOrderEffectiveFinancialSchedule } from "./salesOrderEffectiveFinancialSchedule.js";
import type { BuildSalesOrderEffectiveFinancialScheduleInput } from "./salesOrderEffectiveFinancialSchedule.js";
import {
  buildFinanceArEffectiveTitles,
  dedupeFinanceArCrByExternalId,
  filterFinanceArEffectiveTitlesByDashboardFilters,
  FINANCE_AR_EFFECTIVE_LINE_KIND_LABEL,
} from "./financeAccountsReceivableEffectiveTitles.js";

const REF = new Date(2026, 6, 17, 12, 0, 0, 0);
const CUSTOMER_ID = 88001;
const CUSTOMER_NAME = "Cliente Dois Pedidos Ltda";
const CUSTOMER_CNPJ = "11222333000181";

function nomusCr(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">
): FinanceArDashboardRow {
  return {
    companyName: "Empresa A",
    personId: CUSTOMER_ID,
    personName: CUSTOMER_NAME,
    personCnpj: CUSTOMER_CNPJ,
    description: null,
    comments: null,
    dueDate: new Date(2026, 7, 15),
    competenceDate: new Date(2026, 6, 1),
    settlementDate: null,
    amountReceivable: 10000,
    amountReceived: 0,
    balanceReceivable: 10000,
    paymentMethodName: "Boleto",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: REF,
    ...partial,
  };
}

/** Pedido A — CR total da NF-A; previsão integral substituída (sem residual). */
function fixtureOrderAFullyCoveredByCr(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return {
    salesOrderId: "so-fin08-a",
    orderCode: "PD 01001",
    originalInstallments: [
      { installmentNumber: 1, dueDate: "2026-08-01", amount: "5000.00" },
      { installmentNumber: 2, dueDate: "2026-09-01", amount: "5000.00" },
    ],
    items: [
      {
        salesOrderItemId: "item-a",
        plannedNetValue: "10000.00",
        status: 4,
        orderedQuantity: 10,
        fulfilledQuantity: 10,
        documentAllocations: [
          { allocationKey: "doc-a", allocatedByOrderPrice: "10000.00" },
        ],
        crAllocations: [
          {
            allocationKey: "cr-a",
            amountReceivable: "10000.00",
            amountReceived: "2000.00",
            balanceReceivable: "8000.00",
          },
        ],
      },
    ],
    documents: [
      {
        documentKey: "doc-a",
        sourceInvoiceId: 91001,
        allocatedByOrderPrice: "10000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-20", amount: "10000.00" },
        ],
      },
    ],
    realReceivables: [
      {
        externalId: 71001,
        sourceInvoiceId: 91001,
        dueDate: "2026-07-20",
        amountReceivable: "10000.00",
        amountReceived: "2000.00",
        balanceReceivable: "8000.00",
      },
    ],
    referenceDate: REF,
  };
}

/** Pedido B — Doc/NF parcial + residual ativo R$ 1.000. */
function fixtureOrderBPartialResidual(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return {
    salesOrderId: "so-fin08-b",
    orderCode: "PD 01002",
    originalInstallments: [
      { installmentNumber: 1, dueDate: "2026-08-01", amount: "5000.00" },
      { installmentNumber: 2, dueDate: "2026-09-01", amount: "5000.00" },
    ],
    items: [
      {
        salesOrderItemId: "item-b",
        plannedNetValue: "10000.00",
        status: 3,
        orderedQuantity: 10,
        fulfilledQuantity: 9,
        documentAllocations: [
          { allocationKey: "doc-b", allocatedByOrderPrice: "9000.00" },
        ],
        crAllocations: [
          {
            allocationKey: "cr-b",
            amountReceivable: "9000.00",
            amountReceived: "0",
            balanceReceivable: "9000.00",
          },
        ],
      },
    ],
    documents: [
      {
        documentKey: "doc-b",
        sourceInvoiceId: 91002,
        allocatedByOrderPrice: "9000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-25", amount: "9000.00" },
        ],
      },
    ],
    realReceivables: [
      {
        externalId: 71002,
        sourceInvoiceId: 91002,
        dueDate: "2026-07-25",
        amountReceivable: "9000.00",
        amountReceived: "0",
        balanceReceivable: "9000.00",
      },
    ],
    referenceDate: REF,
  };
}

describe("FIN-08 — cliente com dois pedidos / duas NF-es", () => {
  const scheduleA = buildSalesOrderEffectiveFinancialSchedule(
    fixtureOrderAFullyCoveredByCr()
  );
  const scheduleB = buildSalesOrderEffectiveFinancialSchedule(
    fixtureOrderBPartialResidual()
  );

  const nomusRows = [
    nomusCr({
      externalId: 71001,
      sourceInvoiceId: 91001,
      sourceInvoiceNumber: "NF-A",
      description: "Pedido PD 01001",
      amountReceivable: 10000,
      amountReceived: 2000,
      balanceReceivable: 8000,
      dueDate: new Date(2026, 6, 20),
    }),
    nomusCr({
      externalId: 71002,
      sourceInvoiceId: 91002,
      sourceInvoiceNumber: "NF-B",
      description: "Pedido PD 01002",
      amountReceivable: 9000,
      amountReceived: 0,
      balanceReceivable: 9000,
      dueDate: new Date(2026, 6, 25),
    }),
  ];

  const orderContexts = [
    {
      schedule: scheduleA,
      personId: CUSTOMER_ID,
      personName: CUSTOMER_NAME,
      personCnpj: CUSTOMER_CNPJ,
    },
    {
      schedule: scheduleB,
      personId: CUSTOMER_ID,
      personName: CUSTOMER_NAME,
      personCnpj: CUSTOMER_CNPJ,
    },
  ];

  it("filtro por cliente: dois CR reais de NF distintas + residual parcial; sem previsão substituída", () => {
    const { items, summary } = buildFinanceArEffectiveTitles({
      nomusRows,
      orderContexts,
      customerPersonId: CUSTOMER_ID,
      referenceDate: REF,
    });

    const kinds = items.map((i) => i.lineKind);
    assert.ok(kinds.includes("CR_REAL"));
    assert.ok(kinds.includes("ORDER_RESIDUAL_FORECAST"));
    assert.ok(!kinds.includes("DOCUMENT_AWAITING_CR"), "Doc coberto por CR não aparece");

    const crs = items.filter((i) => i.lineKind === "CR_REAL");
    assert.equal(crs.length, 2);
    assert.ok(crs.some((c) => c.externalId === 71001 && c.orderCode === "PD 01001"));
    assert.ok(crs.some((c) => c.externalId === 71002 && c.orderCode === "PD 01002"));

    const residuals = items.filter((i) => i.lineKind === "ORDER_RESIDUAL_FORECAST");
    assert.ok(residuals.length >= 1);
    assert.ok(residuals.every((r) => r.orderCode === "PD 01002"));
    const residualSum = residuals.reduce((s, r) => s + r.balanceReceivable, 0);
    assert.equal(Math.round(residualSum * 100) / 100, 1000);

    // Pedido A: previsão substituída — sem residual ativo.
    assert.ok(!residuals.some((r) => r.orderCode === "PD 01001"));

    assert.equal(summary.totalTitles, items.length);
    assert.equal(summary.totalOriginalValue, 10000 + 9000 + 1000);
    assert.equal(summary.totalReceivedValue, 2000);
    assert.equal(summary.totalOpenValue, 8000 + 9000 + 1000);
  });

  it("filtro por Pedido A: só CR da NF-A; sem residual nem Doc", () => {
    const { items, summary } = buildFinanceArEffectiveTitles({
      nomusRows,
      orderContexts,
      orderCode: "PD 01001",
      referenceDate: REF,
    });

    assert.ok(items.every((i) => i.orderCode === "PD 01001"));
    assert.equal(items.filter((i) => i.lineKind === "CR_REAL").length, 1);
    assert.equal(items.filter((i) => i.lineKind === "ORDER_RESIDUAL_FORECAST").length, 0);
    assert.equal(items.filter((i) => i.lineKind === "DOCUMENT_AWAITING_CR").length, 0);
    assert.equal(summary.totalTitles, 1);
    assert.equal(summary.totalOriginalValue, 10000);
    assert.equal(summary.totalOpenValue, 8000);
  });

  it("filtro por Pedido B: CR + previsão residual; Doc da mesma NF não duplica", () => {
    const { items } = buildFinanceArEffectiveTitles({
      nomusRows,
      orderContexts,
      orderCode: "PD 01002",
      referenceDate: REF,
    });

    assert.ok(items.every((i) => i.orderCode === "PD 01002"));
    assert.equal(items.filter((i) => i.lineKind === "CR_REAL").length, 1);
    assert.ok(items.some((i) => i.lineKind === "ORDER_RESIDUAL_FORECAST"));
    assert.ok(!items.some((i) => i.lineKind === "DOCUMENT_AWAITING_CR"));
  });

  it("rótulos oficiais das linhas", () => {
    const { items } = buildFinanceArEffectiveTitles({
      nomusRows,
      orderContexts,
      customerPersonId: CUSTOMER_ID,
      referenceDate: REF,
    });
    for (const item of items) {
      assert.equal(
        item.lineKindLabel,
        FINANCE_AR_EFFECTIVE_LINE_KIND_LABEL[item.lineKind]
      );
    }
  });

  it("dedup de CR só por externalId — mesmo valor/vencimento com IDs distintos permanece", () => {
    const twin = nomusCr({
      externalId: 71099,
      sourceInvoiceId: 91999,
      sourceInvoiceNumber: "NF-TWIN",
      description: "Outro título mesmo valor",
      amountReceivable: 10000,
      amountReceived: 0,
      balanceReceivable: 10000,
      dueDate: new Date(2026, 6, 20),
      personId: CUSTOMER_ID,
    });
    const deduped = dedupeFinanceArCrByExternalId([...nomusRows, twin, twin]);
    assert.equal(deduped.length, 3);
    assert.ok(deduped.some((r) => r.externalId === 71099));

    const { items } = buildFinanceArEffectiveTitles({
      nomusRows: [...nomusRows, twin],
      orderContexts,
      customerPersonId: CUSTOMER_ID,
      referenceDate: REF,
    });
    assert.ok(items.some((i) => i.externalId === 71099 && i.lineKind === "CR_REAL"));
  });

  it("corte não aparece como título/previsão", () => {
    const cutInput: BuildSalesOrderEffectiveFinancialScheduleInput = {
      salesOrderId: "so-cut",
      orderCode: "PD 01003",
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-08-01", amount: "10000.00" },
      ],
      items: [
        {
          salesOrderItemId: "item-cut",
          plannedNetValue: "10000.00",
          status: 5,
          orderedQuantity: 10,
          fulfilledQuantity: 9,
          documentAllocations: [
            { allocationKey: "d", allocatedByOrderPrice: "9000.00" },
          ],
        },
      ],
      documents: [
        {
          documentKey: "doc-cut",
          sourceInvoiceId: 91003,
          allocatedByOrderPrice: "9000.00",
          provenInstallments: null,
        },
      ],
      realReceivables: [],
      referenceDate: REF,
    };
    const schedule = buildSalesOrderEffectiveFinancialSchedule(cutInput);
    assert.ok(Number(schedule.cutAmount.toFixed(2)) > 0);

    const { items } = buildFinanceArEffectiveTitles({
      nomusRows: [],
      orderContexts: [
        {
          schedule,
          personId: CUSTOMER_ID,
          personName: CUSTOMER_NAME,
          personCnpj: CUSTOMER_CNPJ,
        },
      ],
      orderCode: "PD 01003",
      referenceDate: REF,
    });

    assert.ok(items.every((i) => i.lineKind !== "ORDER_RESIDUAL_FORECAST" || i.balanceReceivable > 0));
    assert.ok(!items.some((i) => /corte/i.test(i.description ?? "")));
    assert.equal(
      items.filter((i) => i.lineKind === "ORDER_RESIDUAL_FORECAST").length,
      0
    );
    assert.ok(items.some((i) => i.lineKind === "DOCUMENT_AWAITING_CR"));
  });
});

describe("FIN-08 — CR só Nomus não duplica previsão do Pedido (PD 02740)", () => {
  it("CR por descrição + agenda sem CR: emite só CR, sem residual/previsão", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so-pd-02740",
      orderCode: "PD 02740",
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-10-20", amount: "175600.00" },
      ],
      items: [
        {
          salesOrderItemId: "item-1",
          plannedNetValue: "175600.00",
          status: 2,
          orderedQuantity: 30,
          fulfilledQuantity: 0,
        },
      ],
      documents: [],
      realReceivables: [],
      referenceDate: REF,
    });
    assert.ok(Number(schedule.coverageSummary.activeOrderResidualTotal.toFixed(2)) > 0);

    const { items, summary } = buildFinanceArEffectiveTitles({
      nomusRows: [
        nomusCr({
          externalId: 17754,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
          description: "Pedido PD 02740 — Depósito Bancário",
          amountReceivable: 175600,
          amountReceived: 0,
          balanceReceivable: 175600,
          dueDate: new Date(2026, 9, 20),
          paymentMethodName: "Depósito Bancário",
        }),
      ],
      orderContexts: [
        {
          schedule,
          personId: CUSTOMER_ID,
          personName: CUSTOMER_NAME,
          personCnpj: CUSTOMER_CNPJ,
        },
      ],
      orderCode: "PD 02740",
      referenceDate: REF,
    });

    assert.equal(items.filter((i) => i.lineKind === "CR_REAL").length, 1);
    assert.equal(
      items.filter(
        (i) =>
          i.lineKind === "ORDER_RESIDUAL_FORECAST" ||
          i.lineKind === "ORDER_PLAN_FORECAST"
      ).length,
      0
    );
    assert.equal(summary.totalOriginalValue, 175600);
    assert.equal(summary.totalOpenValue, 175600);
  });

  it("caso 3 parcelas + 2 CRs com NF + 2 pré-NF textuais: 2 CR + 1 residual final", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so-pd-02719",
      orderCode: "PD 02719",
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-09-10", amount: "155530.00" },
        { installmentNumber: 2, dueDate: "2026-09-20", amount: "155530.00" },
        { installmentNumber: 3, dueDate: "2026-09-30", amount: "155530.00" },
      ],
      items: [
        {
          salesOrderItemId: "item-1",
          plannedNetValue: "466590.00",
          status: 4,
          orderedQuantity: 100,
          fulfilledQuantity: 100,
          documentAllocations: [
            { allocationKey: "doc-7311", allocatedByOrderPrice: "158505.00" },
            { allocationKey: "doc-7382", allocatedByOrderPrice: "146974.00" },
          ],
          crAllocations: [
            {
              allocationKey: "cr-17874",
              amountReceivable: "158505.00",
              amountReceived: "1755.00",
              balanceReceivable: "156750.00",
            },
            {
              allocationKey: "cr-18076",
              amountReceivable: "146974.00",
              amountReceived: "0.00",
              balanceReceivable: "146974.00",
            },
          ],
        },
      ],
      documents: [
        {
          documentKey: "doc-7311",
          sourceInvoiceId: 7311,
          allocatedByOrderPrice: "158505.00",
          provenInstallments: [
            { installmentNumber: 1, dueDate: "2026-09-10", amount: "158505.00" },
          ],
        },
        {
          documentKey: "doc-7382",
          sourceInvoiceId: 7382,
          allocatedByOrderPrice: "146974.00",
          provenInstallments: [
            { installmentNumber: 1, dueDate: "2026-09-20", amount: "146974.00" },
          ],
        },
      ],
      realReceivables: [
        {
          externalId: 17874,
          sourceInvoiceId: 7311,
          dueDate: "2026-09-10",
          amountReceivable: "158505.00",
          amountReceived: "1755.00",
          balanceReceivable: "156750.00",
        },
        {
          externalId: 18076,
          sourceInvoiceId: 7382,
          dueDate: "2026-09-20",
          amountReceivable: "146974.00",
          amountReceived: "0.00",
          balanceReceivable: "146974.00",
        },
      ],
      referenceDate: REF,
    });

    const { items } = buildFinanceArEffectiveTitles({
      nomusRows: [
        nomusCr({
          externalId: 17874,
          sourceInvoiceId: 7311,
          sourceInvoiceNumber: "7311",
          description: "Pedido PD 02719 NF 7311",
          amountReceivable: 158505,
          amountReceived: 1755,
          balanceReceivable: 156750,
          dueDate: new Date(2026, 8, 10),
        }),
        nomusCr({
          externalId: 18077,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
          description: "Pedido PD 02719 — Depósito Bancário",
          amountReceivable: 158505,
          amountReceived: 0,
          balanceReceivable: 158505,
          dueDate: new Date(2026, 8, 10),
        }),
        nomusCr({
          externalId: 18076,
          sourceInvoiceId: 7382,
          sourceInvoiceNumber: "7382",
          description: "Pedido PD 02719 NF 7382",
          amountReceivable: 146974,
          amountReceived: 0,
          balanceReceivable: 146974,
          dueDate: new Date(2026, 8, 20),
        }),
        nomusCr({
          externalId: 18079,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
          description: "Pedido PD 02719 — Depósito Bancário",
          amountReceivable: 161111,
          amountReceived: 0,
          balanceReceivable: 161111,
          dueDate: new Date(2026, 8, 30),
        }),
      ],
      orderContexts: [
        {
          schedule,
          personId: CUSTOMER_ID,
          personName: CUSTOMER_NAME,
          personCnpj: CUSTOMER_CNPJ,
        },
      ],
      orderCode: "PD 02719",
      referenceDate: REF,
    });

    const crIds = items
      .filter((i) => i.lineKind === "CR_REAL")
      .map((i) => i.externalId)
      .sort((a, b) => a - b);
    assert.deepEqual(crIds, [17874, 18076]);
    assert.ok(!items.some((i) => i.externalId === 18077 || i.externalId === 18079));

    const residuals = items.filter((i) => i.lineKind === "ORDER_RESIDUAL_FORECAST");
    assert.equal(residuals.length, 1, "exatamente uma previsão residual final");
    assert.equal(residuals[0]!.amountReceivable, 161111);
    assert.equal(158505 + 146974 + residuals[0]!.amountReceivable, 466590);
    assert.ok(
      residuals[0]!.description?.includes("Parcela 3") ||
        residuals[0]!.dueDate?.startsWith("2026-09-30"),
      "residual ancorado na 3ª parcela"
    );
  });

  it("sem FIN-05 do PD 02719 mas com vínculo NF→Pedido: mantém CR 18079 (portfólio FC)", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so-filler",
      orderCode: "PD 00001",
      originalInstallments: [{ installmentNumber: 1, dueDate: "2026-09-05", amount: "1000.00" }],
      items: [
        {
          salesOrderItemId: "item-filler",
          plannedNetValue: "1000.00",
          status: 2,
          orderedQuantity: 1,
          fulfilledQuantity: 1,
        },
      ],
      documents: [],
      realReceivables: [
        {
          externalId: 99999,
          sourceInvoiceId: 9001,
          dueDate: "2026-09-05",
          amountReceivable: "1000.00",
          amountReceived: "0.00",
          balanceReceivable: "1000.00",
        },
      ],
      referenceDate: REF,
    });

    const { items } = buildFinanceArEffectiveTitles({
      nomusRows: [
        nomusCr({
          externalId: 17874,
          sourceInvoiceId: 7311,
          sourceInvoiceNumber: "7311",
          description: "Pedido PD 02719 NF 7311",
          amountReceivable: 158505,
          amountReceived: 1755,
          balanceReceivable: 156750,
          dueDate: new Date(2026, 8, 10),
        }),
        nomusCr({
          externalId: 18077,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
          description: "Pedido PD 02719 — Depósito Bancário",
          amountReceivable: 158505,
          balanceReceivable: 158505,
          dueDate: new Date(2026, 8, 10),
        }),
        nomusCr({
          externalId: 18076,
          sourceInvoiceId: 7382,
          sourceInvoiceNumber: "7382",
          description: "Pedido PD 02719 NF 7382",
          amountReceivable: 146974,
          balanceReceivable: 146974,
          dueDate: new Date(2026, 8, 20),
        }),
        nomusCr({
          externalId: 18079,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
          description: "Pedido PD 02719 - Parcela 3 de 3",
          amountReceivable: 161111,
          balanceReceivable: 161111,
          dueDate: new Date(2026, 8, 30),
        }),
      ],
      orderContexts: [
        {
          schedule,
          personId: CUSTOMER_ID,
          personName: CUSTOMER_NAME,
          personCnpj: CUSTOMER_CNPJ,
        },
      ],
      nfeOrderLinks: [
        { sourceInvoiceId: 7311, orderCode: "PD 02719", salesOrderId: "so-pd-02719" },
        { sourceInvoiceId: 7382, orderCode: "PD 02719", salesOrderId: "so-pd-02719" },
      ],
      referenceDate: REF,
    });

    const crIds = items
      .filter((i) => i.lineKind === "CR_REAL")
      .map((i) => i.externalId)
      .sort((a, b) => a - b);
    assert.deepEqual(crIds, [17874, 18076, 18079]);
    assert.ok(!items.some((i) => i.externalId === 18077));
  });

  it("sem CR: previsão sem materialização usa ORDER_PLAN_FORECAST", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so-plan",
      orderCode: "PD 02799",
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-10-20", amount: "1000.00" },
      ],
      items: [
        {
          salesOrderItemId: "item-1",
          plannedNetValue: "1000.00",
          status: 2,
          orderedQuantity: 1,
          fulfilledQuantity: 0,
        },
      ],
      documents: [],
      realReceivables: [],
      referenceDate: REF,
    });
    assert.equal(schedule.coverageSummary.materializationMode, "NO_MATERIALIZATION");

    const { items } = buildFinanceArEffectiveTitles({
      nomusRows: [],
      orderContexts: [
        {
          schedule,
          personId: CUSTOMER_ID,
          personName: CUSTOMER_NAME,
          personCnpj: CUSTOMER_CNPJ,
        },
      ],
      orderCode: "PD 02799",
      referenceDate: REF,
    });

    assert.equal(items.length, 1);
    assert.equal(items[0]!.lineKind, "ORDER_PLAN_FORECAST");
    assert.equal(items[0]!.lineKindLabel, "PREVISÃO DO PEDIDO");
  });
});

describe("FIN-08 — filtro Em aberto não reinsere CR liquidado", () => {
  it("CR só na agenda (fora do Nomus filtrado) não volta como título", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixtureOrderAFullyCoveredByCr()
    );
    const { items } = buildFinanceArEffectiveTitles({
      // Simula grid com status=open: CR liquidado já saiu do conjunto Nomus.
      nomusRows: [],
      orderContexts: [
        {
          schedule,
          personId: CUSTOMER_ID,
          personName: CUSTOMER_NAME,
          personCnpj: CUSTOMER_CNPJ,
        },
      ],
      customerPersonId: CUSTOMER_ID,
      referenceDate: REF,
    });

    assert.equal(items.filter((i) => i.lineKind === "CR_REAL").length, 0);
    assert.ok(!items.some((i) => i.externalId === 71001));
  });

  it("pós-filtro status=open remove liquidado e mantém em aberto / residual", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixtureOrderBPartialResidual()
    );
    const openCr = nomusCr({
      externalId: 71002,
      sourceInvoiceId: 91002,
      sourceInvoiceNumber: "NF-B",
      amountReceivable: 9000,
      amountReceived: 0,
      balanceReceivable: 9000,
      dueDate: new Date(2026, 6, 25),
    });
    const settledCr = nomusCr({
      externalId: 71999,
      sourceInvoiceId: 91999,
      sourceInvoiceNumber: "NF-PAID",
      amountReceivable: 5000,
      amountReceived: 5000,
      balanceReceivable: 0,
      settlementDate: new Date(2026, 5, 1),
      dueDate: new Date(2026, 5, 15),
    });

    const { items } = buildFinanceArEffectiveTitles({
      nomusRows: [openCr, settledCr],
      orderContexts: [
        {
          schedule,
          personId: CUSTOMER_ID,
          personName: CUSTOMER_NAME,
          personCnpj: CUSTOMER_CNPJ,
        },
      ],
      customerPersonId: CUSTOMER_ID,
      referenceDate: REF,
    });

    const openOnly = filterFinanceArEffectiveTitlesByDashboardFilters(
      items,
      { status: "open" },
      REF
    );

    assert.ok(openOnly.every((i) => i.balanceReceivable > 0));
    assert.ok(!openOnly.some((i) => i.externalId === 71999));
    assert.ok(openOnly.some((i) => i.externalId === 71002));
    assert.ok(openOnly.some((i) => i.lineKind === "ORDER_RESIDUAL_FORECAST"));
  });
});
