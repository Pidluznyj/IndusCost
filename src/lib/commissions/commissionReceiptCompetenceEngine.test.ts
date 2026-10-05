/**
 * Regressão de ponta a ponta da competência por recebimento no motor.
 *
 * CRITÉRIO CENTRAL DE ACEITAÇÃO:
 *   recebimento 31/07 + baixa 03/08 ⇒ comissão de JULHO
 *   recebimento 30/06 + baixa 01/07 ⇒ comissão de JUNHO
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import {
  loadCommissionCompetenceReceivableIdsForPeriod,
  loadSettledReceivablesAuditForPeriod,
  loadSettledWithoutReceiptInconsistencies,
  summarizeSettledReceivablesAudit,
} from "./commissionReceiptCompetence.server.js";
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
  /** NomusNfe: só o que a auditoria lê (externalId + status). */
  nfes?: Array<{ externalId: number; status: number | null }>;
  touched?: Set<string>;
}) {
  const touched = input.touched ?? new Set<string>();
  const mark = (model: string) => touched.add(model);
  const queries: Array<{ model: string; args: unknown }> = [];

  return {
    touched,
    queries,
    nomusNfe: {
      findMany: async (args: { where?: { externalId?: { in: number[] }; status?: number } }) => {
        mark("nomusNfe");
        queries.push({ model: "nomusNfe", args });
        let rows = input.nfes ?? [];
        const idFilter = args?.where?.externalId?.in;
        if (idFilter) rows = rows.filter((row) => idFilter.includes(row.externalId));
        if (args?.where?.status !== undefined) rows = rows.filter((row) => row.status === args.where!.status);
        return rows.map((row) => ({ externalId: row.externalId }));
      },
    },
    nomusReceivableReceipt: {
      findMany: async (args: {
        where?: { receiptDate?: { gte?: Date; lte?: Date; lt?: Date }; receivableExternalId?: { in: number[] } };
        distinct?: string[];
      }) => {
        mark("nomusReceivableReceipt");
        queries.push({ model: "nomusReceivableReceipt", args });
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
        queries.push({ model: "nomusAccountsReceivable", args });
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

  it("TESTE 7 — julho encontra o receipt de junho e NÃO reporta baixa sem movimentação", async () => {
    // Cenário real: recebimento em 30/06, baixa em 01/07.
    // Processando JULHO, o título aparece como baixado no mês, mas possui
    // receipt histórico em junho — logo teve movimentação financeira real.
    const db = makeFakeDb({
      receipts: [
        {
          externalId: 10500,
          receivableExternalId: 17480,
          receiptDate: prismaDate("2026-06-30"),
          receivedAmount: 1527.55,
        },
      ],
      receivables: [
        {
          externalId: 17480,
          sourceInvoiceId: 7100,
          personName: "Cliente A",
          personCnpj: null,
          settlementDate: prismaDate("2026-07-01"),
        },
      ],
    });

    // A competência de julho não contém o título — correto, o caixa foi em junho.
    assert.deepEqual(
      await loadCommissionCompetenceReceivableIdsForPeriod(db as never, 2026, 7),
      []
    );

    // E mesmo assim ele NÃO é reportado como baixa sem movimentação financeira.
    assert.deepEqual(
      await loadSettledWithoutReceiptInconsistencies(db as never, 2026, 7),
      []
    );
  });

  it("TESTE 4 — baixado em julho sem NENHUM receipt é reportado como baixa sem movimentação", async () => {
    const db = makeFakeDb({
      receipts: [],
      receivables: [
        {
          externalId: 90001,
          sourceInvoiceId: 7200,
          personName: "Cliente B",
          personCnpj: null,
          settlementDate: prismaDate("2026-07-15"),
        },
      ],
    });

    const inconsistencies = await loadSettledWithoutReceiptInconsistencies(db as never, 2026, 7);

    assert.equal(inconsistencies.length, 1);
    assert.equal(inconsistencies[0].receivableExternalId, 90001);
    assert.equal(inconsistencies[0].code, "SETTLED_WITHOUT_RECEIPT");
    // A baixa não criou competência de comissão em julho.
    assert.deepEqual(
      await loadCommissionCompetenceReceivableIdsForPeriod(db as never, 2026, 7),
      []
    );
  });

  it("TESTE 5 — título aberto sem receipt não é baixa sem movimentação", async () => {
    const db = makeFakeDb({
      receipts: [],
      receivables: [
        {
          externalId: 90002,
          sourceInvoiceId: 7300,
          personName: "Cliente C",
          personCnpj: null,
          settlementDate: null,
        },
      ],
    });

    assert.deepEqual(
      await loadSettledWithoutReceiptInconsistencies(db as never, 2026, 7),
      []
    );
  });

  it("a verificação de receipt não depende da janela consultada (sem filtro temporal)", async () => {
    const receiptQueries: Array<Record<string, unknown>> = [];
    const base = makeFakeDb({
      receipts: [
        {
          externalId: 10500,
          receivableExternalId: 17480,
          receiptDate: prismaDate("2026-06-30"),
          receivedAmount: 1527.55,
        },
      ],
      receivables: [
        {
          externalId: 17480,
          sourceInvoiceId: 7100,
          personName: "Cliente A",
          personCnpj: null,
          settlementDate: prismaDate("2026-07-01"),
        },
      ],
    });
    const spyDb = {
      ...base,
      nomusReceivableReceipt: {
        findMany: async (args: Record<string, unknown>) => {
          receiptQueries.push(args);
          return base.nomusReceivableReceipt.findMany(args as never);
        },
      },
    };

    await loadSettledWithoutReceiptInconsistencies(spyDb as never, 2026, 7);

    // Uma única consulta de receipts, em lote, e sem recorte por receiptDate.
    assert.equal(receiptQueries.length, 1);
    const where = receiptQueries[0].where as Record<string, unknown>;
    assert.equal("receiptDate" in where, false);
    assert.ok(where.receivableExternalId, "consulta deve filtrar por lote de ids");
  });

  /* ---------------------------------------------------------------------- *
   * Baixa de CR de NF-e cancelada não é SETTLED_WITHOUT_RECEIPT.
   * Caso real: NF 7872 (externalId 8218, status 7) cancelada e substituída
   * pela NF 7873 (externalId 8219, status 4). Os CRs 19851–19855 da 7872
   * foram baixados em 21/09 sem recebimento — baixa administrativa.
   * ---------------------------------------------------------------------- */
  const CANCELLED = 7;
  const AUTHORIZED = 4;
  const settledSept = (externalId: number, sourceInvoiceId: number | null): FakeReceivable => ({
    externalId,
    sourceInvoiceId,
    personName: "Cliente NF",
    personCnpj: null,
    settlementDate: prismaDate("2026-09-21"),
  });

  it("TESTE A — baixado sem receipt com NF-e cancelada NÃO é SETTLED_WITHOUT_RECEIPT", async () => {
    const db = makeFakeDb({
      receipts: [],
      receivables: [settledSept(30001, 9001)],
      nfes: [{ externalId: 9001, status: CANCELLED }],
    });

    assert.deepEqual(await loadSettledWithoutReceiptInconsistencies(db as never, 2026, 9), []);
    const audit = await loadSettledReceivablesAuditForPeriod(db as never, 2026, 9);
    assert.deepEqual(audit.cancelledInvoiceSettlementIds, [30001]);
    assert.deepEqual(audit.financialReceiptIds, []);
    // Não virou recebimento nem competência.
    assert.deepEqual(await loadCommissionCompetenceReceivableIdsForPeriod(db as never, 2026, 9), []);
  });

  it("TESTE B — baixado sem receipt com NF-e válida CONTINUA SETTLED_WITHOUT_RECEIPT", async () => {
    const db = makeFakeDb({
      receipts: [],
      receivables: [settledSept(30002, 9002)],
      nfes: [{ externalId: 9002, status: AUTHORIZED }],
    });

    const inconsistencies = await loadSettledWithoutReceiptInconsistencies(db as never, 2026, 9);
    assert.deepEqual(
      inconsistencies.map((row) => [row.code, row.receivableExternalId]),
      [["SETTLED_WITHOUT_RECEIPT", 30002]]
    );
    const audit = await loadSettledReceivablesAuditForPeriod(db as never, 2026, 9);
    assert.deepEqual(audit.cancelledInvoiceSettlementIds, []);
  });

  it("TESTE B2 — NF vinculada ausente da base local ou com status nulo não é tratada como cancelada", async () => {
    const db = makeFakeDb({
      receipts: [],
      receivables: [settledSept(30010, 9010), settledSept(30011, 9011)],
      nfes: [{ externalId: 9011, status: null }],
    });

    assert.deepEqual(
      (await loadSettledWithoutReceiptInconsistencies(db as never, 2026, 9)).map((row) => row.receivableExternalId),
      [30010, 30011]
    );
  });

  it("TESTE C — receipt histórico vence: recebimento real mesmo se a NF estiver cancelada", async () => {
    const db = makeFakeDb({
      receipts: [
        { externalId: 500, receivableExternalId: 30003, receiptDate: prismaDate("2026-08-30"), receivedAmount: 450 },
      ],
      receivables: [settledSept(30003, 9003)],
      nfes: [{ externalId: 9003, status: CANCELLED }],
    });

    const audit = await loadSettledReceivablesAuditForPeriod(db as never, 2026, 9);
    assert.deepEqual(audit.financialReceiptIds, [30003]);
    assert.deepEqual(audit.cancelledInvoiceSettlementIds, []);
    assert.deepEqual(audit.settledWithoutReceipt, []);
    // Tem receipt: nem consulta a NF-e.
    assert.equal(db.queries.filter((q) => q.model === "nomusNfe").length, 0);
  });

  it("TESTE D — baixado sem receipt e SEM NF vinculada continua sinalizado", async () => {
    const db = makeFakeDb({
      receipts: [],
      receivables: [settledSept(30004, null)],
      nfes: [{ externalId: 9004, status: CANCELLED }],
    });

    assert.deepEqual(
      (await loadSettledWithoutReceiptInconsistencies(db as never, 2026, 9)).map((row) => row.receivableExternalId),
      [30004]
    );
    // Sem sourceInvoiceId não há o que consultar em NomusNfe.
    assert.equal(db.queries.filter((q) => q.model === "nomusNfe").length, 0);
  });

  it("TESTE E — 200 CRs baixados: 3 queries em lote, uma única em NomusNfe (sem N+1)", async () => {
    const receivables = Array.from({ length: 200 }, (_, index) => settledSept(40000 + index, 8000 + (index % 50)));
    const db = makeFakeDb({
      receipts: [],
      receivables,
      // NF-es 8000–8024 canceladas, 8025–8049 válidas.
      nfes: Array.from({ length: 50 }, (_, index) => ({
        externalId: 8000 + index,
        status: index < 25 ? CANCELLED : AUTHORIZED,
      })),
    });

    const audit = await loadSettledReceivablesAuditForPeriod(db as never, 2026, 9);

    assert.deepEqual(
      db.queries.map((q) => q.model),
      ["nomusAccountsReceivable", "nomusReceivableReceipt", "nomusNfe"]
    );
    const nfeWhere = (db.queries[2]!.args as { where: { externalId: { in: number[] }; status: number } }).where;
    assert.equal(nfeWhere.status, CANCELLED);
    assert.equal(nfeWhere.externalId.in.length, 50, "ids de NF deduplicados e enviados em um único lote");
    assert.equal(audit.cancelledInvoiceSettlementIds.length, 100);
    assert.equal(audit.settledWithoutReceipt.length, 100);
  });

  const REAL_7872 = {
    receipts: [
      // Recebimento real de setembro em um CR da NF substituta.
      { externalId: 12001, receivableExternalId: 19865, receiptDate: prismaDate("2026-09-25"), receivedAmount: 2292.6 },
    ] satisfies FakeReceipt[],
    receivables: [
      ...[19851, 19852, 19853, 19854, 19855].map((id) => settledSept(id, 8218)),
      { ...settledSept(19865, 8219), settlementDate: prismaDate("2026-09-25") },
      // Outro CR da NF válida, baixado sem receipt: inconsistência genuína.
      { ...settledSept(19866, 8219), settlementDate: prismaDate("2026-09-26") },
    ] satisfies FakeReceivable[],
    nfes: [
      { externalId: 8218, status: CANCELLED },
      { externalId: 8219, status: AUTHORIZED },
    ],
  };

  it("TESTE F — caso real NF 7872: CRs 19851–19855 não geram SETTLED_WITHOUT_RECEIPT", async () => {
    const db = makeFakeDb(REAL_7872);

    const flagged = (await loadSettledWithoutReceiptInconsistencies(db as never, 2026, 9)).map(
      (row) => row.receivableExternalId
    );
    for (const id of [19851, 19852, 19853, 19854, 19855]) {
      assert.equal(flagged.includes(id), false, `CR ${id} não pode ser inconsistência`);
    }
    const audit = await loadSettledReceivablesAuditForPeriod(db as never, 2026, 9);
    assert.deepEqual(audit.cancelledInvoiceSettlementIds, [19851, 19852, 19853, 19854, 19855]);
    // Nenhum deles entra na competência de setembro.
    const competenceIds = await loadCommissionCompetenceReceivableIdsForPeriod(db as never, 2026, 9);
    assert.deepEqual(competenceIds, [19865]);
  });

  it("TESTE G — NF substituta válida (7873) não é afetada pela cancelada, nem o contrário", async () => {
    const db = makeFakeDb(REAL_7872);

    const audit = await loadSettledReceivablesAuditForPeriod(db as never, 2026, 9);
    // 19865 (NF 7873) tem receipt de setembro: recebimento real, competência preservada.
    assert.deepEqual(audit.financialReceiptIds, [19865]);
    // 19866 (NF 7873 válida) sem receipt: continua alertado.
    assert.deepEqual(
      audit.settledWithoutReceipt.map((row) => row.receivableExternalId),
      [19866]
    );
    // Vínculo só por sourceInvoiceId: nenhum CR da 7873 caiu como NF cancelada.
    assert.equal(audit.cancelledInvoiceSettlementIds.includes(19865), false);
    assert.equal(audit.cancelledInvoiceSettlementIds.includes(19866), false);
  });

  it("TESTE H — auditoria agregada e lista detalhada usam a mesma população", async () => {
    const db = makeFakeDb(REAL_7872);

    const audit = await loadSettledReceivablesAuditForPeriod(db as never, 2026, 9);
    const detailed = await loadSettledWithoutReceiptInconsistencies(db as never, 2026, 9);
    const summary = summarizeSettledReceivablesAudit(audit, 200);

    assert.deepEqual(summary, {
      titulos_baixados_no_periodo: 7,
      titulos_baixados_com_receipt_real: 1,
      titulos_baixados_intercompany: 0,
      titulos_baixados_nfe_cancelada: 5,
      titulos_baixados_nfe_cancelada_ids: [19851, 19852, 19853, 19854, 19855],
      titulos_com_baixa_no_periodo_sem_recebimento: 1,
      conferencia_sem_recebimento_bate: true,
      titulos_com_baixa_no_periodo_sem_recebimento_ids: [19866],
    });
    assert.equal(summary.titulos_com_baixa_no_periodo_sem_recebimento, detailed.length);
    assert.deepEqual(
      summary.titulos_com_baixa_no_periodo_sem_recebimento_ids,
      detailed.map((row) => row.receivableExternalId)
    );
    // O limite corta só a lista exibida, nunca a contagem.
    const limited = summarizeSettledReceivablesAudit(audit, 2);
    assert.equal(limited.titulos_baixados_nfe_cancelada, 5);
    assert.deepEqual(limited.titulos_baixados_nfe_cancelada_ids, [19851, 19852]);
    assert.equal(limited.conferencia_sem_recebimento_bate, true);
  });

  it("TESTE H2 — o script de auditoria não tem consulta própria de baixados nem número mágico de status", () => {
    const root = join(import.meta.dirname, "..", "..", "..");
    const script = readFileSync(join(root, "scripts", "auditCommissionReceiptCompetence.ts"), "utf8");
    assert.match(script, /loadSettledReceivablesAuditForPeriod\(prisma, year, month\)/);
    assert.match(script, /\.\.\.summarizeSettledReceivablesAudit\(settledAudit, limit\)/);
    assert.doesNotMatch(script, /nomusAccountsReceivable\.findMany|classifyReceivableSettlement|loadReceivableIdsWithAnyReceipt/);
    const server = readFileSync(
      join(root, "src", "lib", "commissions", "commissionReceiptCompetence.server.ts"),
      "utf8"
    );
    assert.match(server, /status: NOMUS_NFE_STATUS_CANCELLED/);
    assert.doesNotMatch(server, /status: 7\b|status === 7\b/);
  });

  it("TESTE 9 — a camada de competência não toca fechamentos, ledger nem CommissionRecord", async () => {
    const touched = new Set<string>();
    const db = makeFakeDb({ ...REAL_CASE, touched });

    await loadCommissionCompetenceReceivableIdsForPeriod(db as never, 2026, 7);
    await discoverSalesOrderRefsForReceiptMonth(db as never, 2026, 7);
    await loadSettledWithoutReceiptInconsistencies(db as never, 2026, 7);

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
