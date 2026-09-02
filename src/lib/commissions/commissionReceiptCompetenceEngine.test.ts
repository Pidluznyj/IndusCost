/**
 * Regressão de ponta a ponta da competência por recebimento no motor.
 *
 * CRITÉRIO CENTRAL DE ACEITAÇÃO:
 *   recebimento 31/07 + baixa 03/08 ⇒ comissão de JULHO
 *   recebimento 30/06 + baixa 01/07 ⇒ comissão de JUNHO
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCommissionReceiptPreview,
  filterReceivablesByReceiptCompetence,
  releaseCommissionFromMaterializedSchedule,
  type CommissionReceiptReceivableInput,
  type MaterializedReceivableScheduleInput,
} from "./commissionReceiptEngine.js";
import {
  buildReceiptCompetenceByReceivable,
  type CommissionReceiptEventInput,
} from "./commissionReceiptCompetence.js";
import { loadCommissionCompetenceReceivableIdsForPeriod } from "./commissionReceiptCompetence.server.js";
import { discoverSalesOrderRefsForReceiptMonth } from "./commissionMaterializationOrchestrator.server.js";
import { findAffectedCommissionSalesOrderIds } from "./commissionReprocess.server.js";
import { defaultCommissionReprocessFilters } from "./commissionReprocess.js";
import type { CommissionSellerIdentityContext } from "./commissionSellerIdentity.js";

const IDENTITY: CommissionSellerIdentityContext = { persons: [], aliases: [] };

function prismaDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function receiptEvent(
  receiptExternalId: number,
  receivableExternalId: number,
  receiptDate: string,
  receivedAmount: number
): CommissionReceiptEventInput {
  return {
    receiptExternalId,
    receivableExternalId,
    receiptDate: prismaDate(receiptDate),
    receivedAmount,
  };
}

function schedule(
  partial: Partial<MaterializedReceivableScheduleInput> &
    Pick<MaterializedReceivableScheduleInput, "receivableId" | "scheduledCommissionAmount">
): MaterializedReceivableScheduleInput {
  return {
    id: `sched-${partial.receivableId}`,
    orderSnapshotId: "snap-1",
    receivableCode: null,
    installmentNumber: 1,
    nfeId: 7479,
    salesOrderId: "order-1",
    customerId: "cust-1",
    canonicalSellerId: "person-seller",
    canonicalSellerName: "VENDEDOR",
    rawSellerId: 464,
    rawSellerName: "VENDEDOR",
    orderCode: "PED-1",
    receivableNominalAmount: 10000,
    receivableSharePercent: 100,
    scheduleStatus: "ACTIVE",
    orderSnapshotStatus: "ACTIVE",
    sellerResolutionStatus: "OK_CANONICAL",
    exclusionRuleId: null,
    exclusionReason: null,
    ...partial,
  };
}

function receivableFor(input: {
  receivableId: number;
  settlementDate: Date | null;
  amountReceivable: number;
  amountReceived: number;
  events: CommissionReceiptEventInput[];
  year: number;
  month: number;
  nfeId?: number;
}): CommissionReceiptReceivableInput {
  const competence = buildReceiptCompetenceByReceivable(
    input.events,
    input.year,
    input.month
  ).get(input.receivableId);
  return {
    nomusReceivableId: input.receivableId,
    receivableNumber: String(input.receivableId),
    installmentNumber: 1,
    settlementDate: input.settlementDate,
    receiptCompetence: competence ?? null,
    dueDate: prismaDate("2026-07-15"),
    amountReceivable: input.amountReceivable,
    amountReceived: input.amountReceived,
    nomusNfeId: input.nfeId ?? 7479,
    nfeNumber: String(input.nfeId ?? 7479),
    customerExternalId: 200,
    customerName: "Cliente Teste",
  };
}

function previewFor(input: {
  year: number;
  month: number;
  receivables: CommissionReceiptReceivableInput[];
  schedules: Map<number, MaterializedReceivableScheduleInput[]>;
}) {
  return buildCommissionReceiptPreview({
    year: input.year,
    month: input.month,
    receivables: input.receivables,
    ordersByNfeId: new Map(),
    materializedSchedulesByReceivableId: input.schedules,
    rules: [],
    exclusionRules: [],
    identityCtx: IDENTITY,
  });
}

describe("competência da comissão pela data real do recebimento", () => {
  it("CRITÉRIO CENTRAL — CR 18505: recebimento 30/07, baixa 03/08 ⇒ julho tem a linha, agosto não", () => {
    const events = [receiptEvent(11011, 18505, "2026-07-30", 2775.9)];
    const schedules = new Map([
      [18505, [schedule({ receivableId: 18505, receivableNominalAmount: 2775.9, scheduledCommissionAmount: 83.28 })]],
    ]);

    const julho = previewFor({
      year: 2026,
      month: 7,
      receivables: [
        receivableFor({
          receivableId: 18505,
          settlementDate: prismaDate("2026-08-03"),
          amountReceivable: 2775.9,
          amountReceived: 2775.9,
          events,
          year: 2026,
          month: 7,
        }),
      ],
      schedules,
    });

    const agosto = previewFor({
      year: 2026,
      month: 8,
      receivables: [
        receivableFor({
          receivableId: 18505,
          settlementDate: prismaDate("2026-08-03"),
          amountReceivable: 2775.9,
          amountReceived: 2775.9,
          events,
          year: 2026,
          month: 8,
        }),
      ],
      schedules,
    });

    assert.equal(julho.lines.length, 1);
    assert.equal(julho.lines[0].status, "COMMISSIONABLE");
    assert.equal(julho.lines[0].releasedCommissionAmount, 83.28);
    assert.equal(julho.lines[0].receiptDate, prismaDate("2026-07-30").toISOString());
    // A baixa segue gravada e visível — como informação administrativa.
    assert.equal(julho.lines[0].settlementDate, prismaDate("2026-08-03").toISOString());
    assert.deepEqual(julho.lines[0].receiptIds, [11011]);

    // Agosto não pode receber a linha só porque a baixa saiu lá.
    assert.equal(agosto.lines.length, 0);
    assert.equal(agosto.totalReleasedCommission, 0);
  });

  it("CRITÉRIO CENTRAL — CR 17480: recebimento 30/06, baixa 01/07 ⇒ junho", () => {
    const events = [receiptEvent(10500, 17480, "2026-06-30", 1527.55)];
    const schedules = new Map([
      [17480, [schedule({ receivableId: 17480, receivableNominalAmount: 1527.55, scheduledCommissionAmount: 45.83 })]],
    ]);

    const junho = previewFor({
      year: 2026,
      month: 6,
      receivables: [
        receivableFor({
          receivableId: 17480,
          settlementDate: prismaDate("2026-07-01"),
          amountReceivable: 1527.55,
          amountReceived: 1527.55,
          events,
          year: 2026,
          month: 6,
        }),
      ],
      schedules,
    });
    const julho = previewFor({
      year: 2026,
      month: 7,
      receivables: [
        receivableFor({
          receivableId: 17480,
          settlementDate: prismaDate("2026-07-01"),
          amountReceivable: 1527.55,
          amountReceived: 1527.55,
          events,
          year: 2026,
          month: 7,
        }),
      ],
      schedules,
    });

    assert.equal(junho.lines.length, 1);
    assert.equal(junho.lines[0].releasedCommissionAmount, 45.83);
    assert.equal(julho.lines.length, 0);
  });

  it("TESTE 4 — recebimento e baixa no mesmo mês mantêm o resultado monetário anterior", () => {
    const events = [receiptEvent(1, 500, "2026-07-10", 5000)];
    const sched = schedule({
      receivableId: 500,
      receivableNominalAmount: 10000,
      scheduledCommissionAmount: 300,
    });

    const comCompetencia = releaseCommissionFromMaterializedSchedule({
      schedule: sched,
      receivable: receivableFor({
        receivableId: 500,
        settlementDate: prismaDate("2026-07-10"),
        amountReceivable: 10000,
        amountReceived: 5000,
        events,
        year: 2026,
        month: 7,
      }),
    });

    // Mesmo mês, sem parcial anterior: 50% recebido ⇒ 50% da comissão, como antes.
    assert.equal(comCompetencia.commissionableBaseAmount, 5000);
    assert.equal(comCompetencia.expectedCommissionAmount, 150);
    assert.equal(comCompetencia.receivedSharePercent, 50);
  });

  it("TESTE 5 — recebimento sem baixa registrada libera pela data do recebimento", () => {
    const events = [receiptEvent(1, 600, "2026-07-20", 10000)];
    const preview = previewFor({
      year: 2026,
      month: 7,
      receivables: [
        receivableFor({
          receivableId: 600,
          settlementDate: null,
          amountReceivable: 10000,
          amountReceived: 10000,
          events,
          year: 2026,
          month: 7,
        }),
      ],
      schedules: new Map([
        [600, [schedule({ receivableId: 600, scheduledCommissionAmount: 300 })]],
      ]),
    });

    assert.equal(preview.lines.length, 1);
    assert.equal(preview.lines[0].releasedCommissionAmount, 300);
    assert.equal(preview.lines[0].settlementDate, "");
    assert.equal(preview.lines[0].receiptDate, prismaDate("2026-07-20").toISOString());
  });

  it("TESTE 6 — baixa no mês sem evento de recebimento não entra por fallback", () => {
    const scoped = filterReceivablesByReceiptCompetence(
      [
        receivableFor({
          receivableId: 700,
          settlementDate: prismaDate("2026-07-05"),
          amountReceivable: 1000,
          amountReceived: 1000,
          events: [],
          year: 2026,
          month: 7,
        }),
      ],
      2026,
      7
    );

    assert.deepEqual(scoped, []);
  });

  it("TESTE 7 — parcial 31/07 + 05/08 libera 40%/60% e nunca 100% em cada mês", () => {
    const events = [
      receiptEvent(1, 900, "2026-07-31", 4000),
      receiptEvent(2, 900, "2026-08-05", 6000),
    ];
    const schedules = new Map([
      [900, [schedule({ receivableId: 900, scheduledCommissionAmount: 300 })]],
    ]);

    const julho = previewFor({
      year: 2026,
      month: 7,
      receivables: [
        receivableFor({
          receivableId: 900,
          settlementDate: null,
          amountReceivable: 10000,
          amountReceived: 10000,
          events,
          year: 2026,
          month: 7,
        }),
      ],
      schedules,
    });
    const agosto = previewFor({
      year: 2026,
      month: 8,
      receivables: [
        receivableFor({
          receivableId: 900,
          settlementDate: prismaDate("2026-08-05"),
          amountReceivable: 10000,
          amountReceived: 10000,
          events,
          year: 2026,
          month: 8,
        }),
      ],
      schedules,
    });

    assert.equal(julho.lines[0].releasedCommissionAmount, 120);
    assert.equal(julho.lines[0].commissionableBaseAmount, 4000);
    assert.equal(julho.lines[0].receivedAmount, 4000);
    assert.equal(agosto.lines[0].releasedCommissionAmount, 180);
    assert.equal(agosto.lines[0].commissionableBaseAmount, 6000);
    assert.equal(
      julho.totalReleasedCommission + agosto.totalReleasedCommission,
      300
    );
  });

  it("TESTE 8 — dois recebimentos no mesmo mês geram UMA linha, sem colisão de ledgerLineKey", () => {
    const events = [
      receiptEvent(51, 900, "2026-07-10", 4000),
      receiptEvent(52, 900, "2026-07-25", 6000),
    ];
    const preview = previewFor({
      year: 2026,
      month: 7,
      receivables: [
        receivableFor({
          receivableId: 900,
          settlementDate: null,
          amountReceivable: 10000,
          amountReceived: 10000,
          events,
          year: 2026,
          month: 7,
        }),
      ],
      schedules: new Map([
        [900, [schedule({ receivableId: 900, scheduledCommissionAmount: 300 })]],
      ]),
    });

    assert.equal(preview.lines.length, 1);
    assert.equal(new Set(preview.lines.map((line) => line.ledgerLineKey)).size, 1);
    assert.equal(preview.lines[0].releasedCommissionAmount, 300);
    assert.deepEqual(preview.lines[0].receiptIds, [51, 52]);
  });

  it("TESTE 13/14 — mesma população em duas execuções e settlementDate preservada na linha", () => {
    const events = [receiptEvent(11066, 18674, "2026-07-31", 897)];
    const build = () =>
      previewFor({
        year: 2026,
        month: 7,
        receivables: [
          receivableFor({
            receivableId: 18674,
            settlementDate: prismaDate("2026-08-06"),
            amountReceivable: 897,
            amountReceived: 897,
            events,
            year: 2026,
            month: 7,
            nfeId: 7532,
          }),
        ],
        schedules: new Map([
          [
            18674,
            [
              schedule({
                receivableId: 18674,
                nfeId: 7532,
                receivableNominalAmount: 897,
                scheduledCommissionAmount: 26.91,
              }),
            ],
          ],
        ]),
      });

    const a = build();
    const b = build();

    assert.deepEqual(
      a.lines.map((line) => line.ledgerLineKey),
      b.lines.map((line) => line.ledgerLineKey)
    );
    assert.equal(a.totalReleasedCommission, b.totalReleasedCommission);
    assert.equal(a.lines[0].settlementDate, prismaDate("2026-08-06").toISOString());
    assert.equal(a.lines[0].receiptDate, prismaDate("2026-07-31").toISOString());
  });
});

/* --------------------------------------------------------------------------
 * Camada .server — fakes Prisma mínimos (nenhum acesso a banco real).
 * ------------------------------------------------------------------------ */

type FakeReceipt = {
  externalId: number;
  receivableExternalId: number;
  receiptDate: Date;
  receivedAmount: number;
};

type FakeReceivable = {
  externalId: number;
  sourceInvoiceId: number | null;
  personName: string | null;
  personCnpj: string | null;
  settlementDate: Date | null;
};

function inRange(value: Date, filter: { gte?: Date; lte?: Date; lt?: Date } | undefined): boolean {
  if (!filter) return true;
  const ts = value.getTime();
  if (filter.gte && ts < filter.gte.getTime()) return false;
  if (filter.lte && ts > filter.lte.getTime()) return false;
  if (filter.lt && ts >= filter.lt.getTime()) return false;
  return true;
}

/**
 * Fake que registra quais models foram tocados — usado para provar que a camada
 * de competência NÃO alcança fechamentos/ledger (TESTE 9).
 */
function makeFakeDb(input: {
  receipts: FakeReceipt[];
  receivables: FakeReceivable[];
  nfeLinks?: Array<{ salesOrderId: string; nfeExternalId: number }>;
  touched?: Set<string>;
}) {
  const touched = input.touched ?? new Set<string>();
  const mark = (model: string) => touched.add(model);

  return {
    touched,
    nomusReceivableReceipt: {
      findMany: async (args: {
        where?: { receiptDate?: { gte?: Date; lte?: Date; lt?: Date }; receivableExternalId?: { in: number[] } };
        distinct?: string[];
      }) => {
        mark("nomusReceivableReceipt");
        let rows = input.receipts.filter((row) =>
          inRange(row.receiptDate, args?.where?.receiptDate)
        );
        const idFilter = args?.where?.receivableExternalId?.in;
        if (idFilter) rows = rows.filter((row) => idFilter.includes(row.receivableExternalId));
        if (args?.distinct?.includes("receivableExternalId")) {
          const seen = new Set<number>();
          rows = rows.filter((row) => {
            if (seen.has(row.receivableExternalId)) return false;
            seen.add(row.receivableExternalId);
            return true;
          });
        }
        return rows;
      },
    },
    nomusAccountsReceivable: {
      findMany: async (args: {
        where?: {
          externalId?: { in: number[] };
          sourceInvoiceId?: { not: null } | { in: number[] };
          settlementDate?: { gte?: Date; lte?: Date };
        };
        distinct?: string[];
      }) => {
        mark("nomusAccountsReceivable");
        let rows = input.receivables;
        const idFilter = args?.where?.externalId?.in;
        if (idFilter) rows = rows.filter((row) => idFilter.includes(row.externalId));
        if (args?.where?.settlementDate) {
          rows = rows.filter(
            (row) => row.settlementDate && inRange(row.settlementDate, args.where!.settlementDate)
          );
        }
        if (args?.where?.sourceInvoiceId) rows = rows.filter((row) => row.sourceInvoiceId != null);
        if (args?.distinct?.includes("sourceInvoiceId")) {
          const seen = new Set<number>();
          rows = rows.filter((row) => {
            if (row.sourceInvoiceId == null || seen.has(row.sourceInvoiceId)) return false;
            seen.add(row.sourceInvoiceId);
            return true;
          });
        }
        return rows;
      },
    },
    salesOrderNfeLink: {
      findMany: async (args: { where?: { nfeExternalId?: { in: number[] } } }) => {
        mark("salesOrderNfeLink");
        const ids = args?.where?.nfeExternalId?.in ?? [];
        return (input.nfeLinks ?? []).filter((link) => ids.includes(link.nfeExternalId));
      },
    },
    salesOrder: {
      findMany: async (args: { where?: Record<string, unknown> }) => {
        mark("salesOrder");
        return [{ id: "order-1", where: args?.where }].map((row) => ({ id: row.id }));
      },
    },
    priceTableItem: { findMany: async () => [] },
  };
}

const REAL_CASE = {
  receipts: [
    { externalId: 11011, receivableExternalId: 18505, receiptDate: prismaDate("2026-07-30"), receivedAmount: 2775.9 },
    { externalId: 11066, receivableExternalId: 18674, receiptDate: prismaDate("2026-07-31"), receivedAmount: 897 },
  ] satisfies FakeReceipt[],
  receivables: [
    { externalId: 18505, sourceInvoiceId: 7479, personName: "Cliente A", personCnpj: null, settlementDate: prismaDate("2026-08-03") },
    { externalId: 18674, sourceInvoiceId: 7532, personName: "Cliente B", personCnpj: null, settlementDate: prismaDate("2026-08-06") },
  ] satisfies FakeReceivable[],
  nfeLinks: [
    { salesOrderId: "order-7479", nfeExternalId: 7479 },
    { salesOrderId: "order-7532", nfeExternalId: 7532 },
  ],
};

describe("seleção temporal do módulo (camada .server)", () => {
  it("TESTE 12 — materialização e motor selecionam a MESMA população de julho", async () => {
    const db = makeFakeDb(REAL_CASE);

    const engineIds = await loadCommissionCompetenceReceivableIdsForPeriod(
      db as never,
      2026,
      7
    );
    const materializationRefs = await discoverSalesOrderRefsForReceiptMonth(
      db as never,
      2026,
      7
    );

    assert.deepEqual([...engineIds].sort((a, b) => a - b), [18505, 18674]);
    assert.deepEqual(
      materializationRefs.map((ref) => ref.salesOrderId).sort(),
      ["order-7479", "order-7532"]
    );
  });

  it("agosto não materializa nem seleciona os títulos apenas baixados em agosto", async () => {
    const db = makeFakeDb(REAL_CASE);

    assert.deepEqual(
      await loadCommissionCompetenceReceivableIdsForPeriod(db as never, 2026, 8),
      []
    );
    assert.deepEqual(await discoverSalesOrderRefsForReceiptMonth(db as never, 2026, 8), []);
  });

  it("TESTE 9 — a camada de competência não toca fechamentos, ledger nem CommissionRecord", async () => {
    const touched = new Set<string>();
    const db = makeFakeDb({ ...REAL_CASE, touched });

    await loadCommissionCompetenceReceivableIdsForPeriod(db as never, 2026, 7);
    await discoverSalesOrderRefsForReceiptMonth(db as never, 2026, 7);

    for (const forbidden of [
      "commissionMonthlyClosing",
      "commissionReceiptLedgerLine",
      "commissionRecord",
      "commissionPaymentSchedule",
    ]) {
      assert.equal(touched.has(forbidden), false, `model proibido tocado: ${forbidden}`);
    }
  });

  it("TESTE 10 — reprocesso no eixo settlement usa a data do recebimento", async () => {
    const db = makeFakeDb(REAL_CASE);
    let capturedWhere: Record<string, unknown> | null = null;
    const spyDb = {
      ...db,
      salesOrder: {
        findMany: async (args: { where?: Record<string, unknown> }) => {
          capturedWhere = args?.where ?? {};
          return [{ id: "order-7479" }];
        },
      },
    };

    await findAffectedCommissionSalesOrderIds(
      spyDb as never,
      defaultCommissionReprocessFilters({
        from: "2026-07-01",
        to: "2026-07-31",
        dateAxis: "settlement",
      })
    );

    // Julho alcança as NFs recebidas em julho, mesmo com baixa em agosto.
    const nfeLinks = (capturedWhere as { nfeLinks?: { some?: { nfeExternalId?: { in: number[] } } } })
      ?.nfeLinks;
    assert.deepEqual(nfeLinks?.some?.nfeExternalId?.in?.sort(), [7479, 7532]);
  });

  it("reprocesso de agosto não alcança as NFs cuja única marca em agosto é a baixa", async () => {
    const db = makeFakeDb(REAL_CASE);
    let capturedWhere: Record<string, unknown> | null = null;
    const spyDb = {
      ...db,
      salesOrder: {
        findMany: async (args: { where?: Record<string, unknown> }) => {
          capturedWhere = args?.where ?? {};
          return [];
        },
      },
    };

    await findAffectedCommissionSalesOrderIds(
      spyDb as never,
      defaultCommissionReprocessFilters({
        from: "2026-08-01",
        to: "2026-08-31",
        dateAxis: "settlement",
      })
    );

    const nfeLinks = (capturedWhere as { nfeLinks?: { some?: { nfeExternalId?: { in: number[] } } } })
      ?.nfeLinks;
    assert.deepEqual(nfeLinks?.some?.nfeExternalId?.in, [-1]);
  });
});
