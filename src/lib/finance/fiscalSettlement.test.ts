/**
 * Testes T05 — apuração, guia, AP, baixa, alocação, estorno, autorização helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFiscalGuideDedupeKey,
  computeFiscalAmountDue,
  computeFiscalBalanceDue,
  resolveFiscalGuideStatus,
} from "./fiscalSettlementClient.js";
import {
  canManageFiscalAllocations,
  canManageFiscalSettlements,
  canViewFiscalSettlements,
} from "./fiscalSettlementPermissions.js";
import {
  cancelFiscalPaymentGuide,
  createFiscalAllocation,
  createFiscalApurationPeriod,
  createFiscalPaymentGuide,
  registerFiscalGuidePayment,
  reverseFiscalGuidePayment,
  addFiscalPaymentProof,
} from "./fiscalSettlementService.server.js";

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "toNumber" in v) {
    try {
      return (v as { toNumber: () => number }).toNumber();
    } catch {
      return Number(v) || 0;
    }
  }
  return Number(v) || 0;
}

function money(n: number) {
  const v = Number(n) || 0;
  return {
    toNumber: () => v,
    toFixed: (d: number) => v.toFixed(d),
    valueOf: () => v,
  };
}

function makePrismaMock(seed?: {
  ap?: { externalId: number; amountPaid: number } | null;
  salesOrderId?: string;
  nfeId?: string;
}) {
  const periods: any[] = [];
  const guides: any[] = [];
  const proofs: any[] = [];
  const allocations: any[] = [];
  const audits: any[] = [];

  const prisma = {
    fiscalApurationPeriod: {
      findMany: async ({ include }: any) =>
        periods.map((p) => ({
          ...p,
          lines: include?.lines ? p.lines ?? [] : undefined,
        })),
      findUnique: async ({ where }: any) =>
        periods.find((p) => p.id === where.id) ?? null,
      create: async ({ data, include }: any) => {
        const id = `period-${periods.length + 1}`;
        const lines = (data.lines?.create ?? []).map((l: any, i: number) => ({
          id: `line-${i + 1}`,
          periodId: id,
          ...l,
          assessedAmount: money(toNum(l.assessedAmount)),
          creditsAmount: money(toNum(l.creditsAmount)),
          compensationsAmount: money(toNum(l.compensationsAmount)),
          interestAmount: money(toNum(l.interestAmount)),
          fineAmount: money(toNum(l.fineAmount)),
          amountDue: money(toNum(l.amountDue)),
        }));
        const row = {
          id,
          ...data,
          lines,
          createdAt: new Date(),
          updatedAt: new Date(),
          status: data.status ?? "OPEN",
          closedAt: null,
        };
        delete (row as any).lines;
        row.lines = lines;
        periods.push(row);
        return include?.lines ? row : { ...row, lines: undefined };
      },
      update: async ({ where, data, include }: any) => {
        const idx = periods.findIndex((p) => p.id === where.id);
        periods[idx] = { ...periods[idx], ...data };
        return include?.lines ? periods[idx] : periods[idx];
      },
    },
    fiscalPaymentGuide: {
      findMany: async () =>
        guides.map((g) => ({
          ...g,
          proofs: proofs.filter((p) => p.guideId === g.id),
          allocations: allocations.filter((a) => a.guideId === g.id),
        })),
      findUnique: async ({ where, include }: any) => {
        let g =
          guides.find((x) => x.id === where.id) ??
          (where.dedupeKey
            ? guides.find((x) => x.dedupeKey === where.dedupeKey)
            : null);
        if (!g) return null;
        if (include) {
          return {
            ...g,
            proofs: proofs.filter((p) => p.guideId === g.id),
            allocations: allocations.filter((a) => a.guideId === g.id),
          };
        }
        return g;
      },
      create: async ({ data, include }: any) => {
        const id = `guide-${guides.length + 1}`;
        const row = {
          id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          cancelledAt: null,
        };
        // Prisma.Decimal mock
        for (const k of [
          "assessedAmount",
          "creditsAmount",
          "compensationsAmount",
          "interestAmount",
          "fineAmount",
          "amountDue",
          "amountPaid",
          "balanceDue",
        ]) {
          row[k] = money(toNum(data[k]));
        }
        guides.push(row);
        if (include) {
          return { ...row, proofs: [], allocations: [] };
        }
        return row;
      },
      update: async ({ where, data, include }: any) => {
        const idx = guides.findIndex((g) => g.id === where.id);
        const next = { ...guides[idx], ...data };
        for (const k of Object.keys(data)) {
          if (
            [
              "assessedAmount",
              "creditsAmount",
              "compensationsAmount",
              "interestAmount",
              "fineAmount",
              "amountDue",
              "amountPaid",
              "balanceDue",
            ].includes(k)
          ) {
            next[k] = money(toNum(data[k]));
          }
        }
        guides[idx] = next;
        if (include) {
          return {
            ...next,
            proofs: proofs.filter((p) => p.guideId === next.id),
            allocations: allocations.filter((a) => a.guideId === next.id),
          };
        }
        return next;
      },
    },
    fiscalPaymentProof: {
      create: async ({ data }: any) => {
        const row = {
          id: `proof-${proofs.length + 1}`,
          ...data,
          uploadedAt: new Date(),
        };
        proofs.push(row);
        return row;
      },
    },
    fiscalAllocation: {
      create: async ({ data }: any) => {
        const row = {
          id: `alloc-${allocations.length + 1}`,
          ...data,
          allocatedAmount: money(toNum(data.allocatedAmount)),
          allocationBase:
            data.allocationBase == null
              ? null
              : money(toNum(data.allocationBase)),
          calculatedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          version: data.version ?? 1,
        };
        allocations.push(row);
        return row;
      },
      findMany: async ({ where }: any) =>
        allocations.filter((a) =>
          where?.salesOrderId ? a.salesOrderId === where.salesOrderId : true
        ),
    },
    fiscalSettlementAuditLog: {
      create: async ({ data }: any) => {
        audits.push(data);
        return { id: `audit-${audits.length}`, ...data };
      },
    },
    nomusAccountsPayable: {
      findUnique: async ({ where }: any) => {
        if (!seed?.ap || seed.ap.externalId !== where.externalId) return null;
        return {
          externalId: seed.ap.externalId,
          documentNumber: "AP-1",
          personName: "RECEITA FEDERAL",
          amountPaid: money(seed.ap.amountPaid),
          balancePayable: money(0),
          paymentDate: new Date("2026-03-20T12:00:00Z"),
          settlementDate: new Date("2026-03-20T12:00:00Z"),
        };
      },
      findMany: async ({ where }: any) => {
        if (!seed?.ap) return [];
        const ids: number[] = where?.externalId?.in ?? [];
        if (!ids.includes(seed.ap.externalId)) return [];
        return [
          {
            externalId: seed.ap.externalId,
            documentNumber: "AP-1",
            personName: "RECEITA FEDERAL",
            amountPaid: money(seed.ap.amountPaid),
            balancePayable: money(0),
            paymentDate: new Date("2026-03-20T12:00:00Z"),
            settlementDate: new Date("2026-03-20T12:00:00Z"),
          },
        ];
      },
    },
    salesOrder: {
      findUnique: async ({ where }: any) =>
        where.id === (seed?.salesOrderId ?? "so-1")
          ? { id: where.id }
          : null,
    },
    nomusNfe: {
      findUnique: async ({ where }: any) =>
        where.id === (seed?.nfeId ?? "nfe-1") ? { id: where.id } : null,
    },
    _audits: audits,
    _guides: guides,
    _allocations: allocations,
  };

  return prisma as any;
}

describe("fiscalSettlementClient helpers", () => {
  it("calcula devido com crédito, compensação, juros e multa", () => {
    const due = computeFiscalAmountDue({
      assessedAmount: 1000,
      creditsAmount: 100,
      compensationsAmount: 50,
      interestAmount: 20,
      fineAmount: 10,
    });
    assert.equal(due, 880);
    assert.equal(computeFiscalBalanceDue(880, 400), 480);
    assert.equal(computeFiscalBalanceDue(880, 880), 0);
  });

  it("resolve status parcial / pago / cancelado", () => {
    assert.equal(
      resolveFiscalGuideStatus({ amountDue: 100, amountPaid: 0, status: "ISSUED" }),
      "ISSUED"
    );
    assert.equal(
      resolveFiscalGuideStatus({ amountDue: 100, amountPaid: 40 }),
      "PARTIALLY_PAID"
    );
    assert.equal(
      resolveFiscalGuideStatus({ amountDue: 100, amountPaid: 100 }),
      "PAID"
    );
    assert.equal(
      resolveFiscalGuideStatus({
        amountDue: 100,
        amountPaid: 100,
        cancelled: true,
      }),
      "CANCELLED"
    );
  });

  it("dedupe key exige número da guia", () => {
    assert.equal(
      buildFiscalGuideDedupeKey({
        guideType: "DARF",
        guideNumber: null,
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
      }),
      null
    );
    assert.equal(
      buildFiscalGuideDedupeKey({
        guideType: "DARF",
        guideNumber: "123",
        revenueCode: "5629",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
      }),
      "DARF|123|5629|2026-03-01|2026-03-31"
    );
  });
});

describe("fiscalSettlementPermissions", () => {
  it("autorização view/manage/allocation", () => {
    assert.equal(
      canViewFiscalSettlements({
        hasPermission: (p) => p === "finance.tax_apuration.view",
      }),
      true
    );
    assert.equal(
      canViewFiscalSettlements({ hasPermission: (p) => p === "taxes.view" }),
      true
    );
    assert.equal(
      canManageFiscalSettlements({
        hasPermission: (p) => p === "finance.tax_apuration.manage",
      }),
      true
    );
    assert.equal(
      canManageFiscalSettlements({ hasPermission: () => false }),
      false
    );
    assert.equal(
      canManageFiscalAllocations({
        hasPermission: (p) => p === "finance.tax_allocation.manage",
      }),
      true
    );
  });
});

describe("fiscalSettlementService — fluxos", () => {
  it("cria apuração com linhas e totais", async () => {
    const prisma = makePrismaMock();
    const period = await createFiscalApurationPeriod(prisma, {
      jurisdiction: "FEDERAL",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      lines: [
        {
          taxType: "IPI",
          nature: "DEBIT",
          assessedAmount: 129.19,
          creditsAmount: 0,
        },
      ],
    });
    assert.equal(period.totals.assessedAmount, 129.19);
    assert.equal(period.totals.amountDue, 129.19);
    assert.equal(period.lines.length, 1);
  });

  it("cria guia, baixa parcial, comprovante, alocação e estorno", async () => {
    const prisma = makePrismaMock({
      ap: { externalId: 9001, amountPaid: 500 },
      salesOrderId: "so-1",
    });

    const guide = await createFiscalPaymentGuide(prisma, {
      taxType: "IPI",
      jurisdiction: "FEDERAL",
      guideType: "DARF",
      guideNumber: "G-1",
      revenueCode: "5629",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      assessedAmount: 1000,
      interestAmount: 50,
      fineAmount: 20,
      accountsPayableExternalId: 9001,
    });

    // AP é fonte oficial do pago
    assert.equal(guide.amountPaid, 500);
    assert.equal(guide.status, "PARTIALLY_PAID");
    assert.equal(guide.amountDue, 1070);
    assert.ok(guide.accountsPayable);

    const paid = await registerFiscalGuidePayment(prisma, guide.id, {
      amountPaid: 1070,
    });
    assert.equal(paid.status, "PAID");
    assert.equal(paid.balanceDue, 0);

    const proof = await addFiscalPaymentProof(prisma, guide.id, {
      fileName: "comprovante.pdf",
      originalFileName: "comprovante.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      storageKey: "manual:comprovante.pdf",
    });
    assert.equal(proof.fileName, "comprovante.pdf");

    const alloc = await createFiscalAllocation(prisma, {
      guideId: guide.id,
      salesOrderId: "so-1",
      taxType: "IPI",
      allocatedAmount: 129.19,
      allocationMethod: "MANUAL",
      manualOverride: true,
      notes: "Alocação gerencial PD 02457 — não é pagamento da NF",
    });
    assert.equal(alloc.isManagerialOnly, true);
    assert.equal(alloc.settlementId, guide.id);

    const reversed = await reverseFiscalGuidePayment(prisma, guide.id);
    assert.equal(reversed.status, "REVERSED");
    assert.equal(reversed.amountPaid, 0);
  });

  it("bloqueia guia duplicada e cancela", async () => {
    const prisma = makePrismaMock();
    await createFiscalPaymentGuide(prisma, {
      taxType: "ICMS",
      jurisdiction: "STATE",
      guideType: "GNRE",
      guideNumber: "DUP-1",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      assessedAmount: 10,
    });
    await assert.rejects(
      () =>
        createFiscalPaymentGuide(prisma, {
          taxType: "ICMS",
          jurisdiction: "STATE",
          guideType: "GNRE",
          guideNumber: "DUP-1",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
          assessedAmount: 10,
        }),
      /duplicada/i
    );

    const g = prisma._guides[0];
    const cancelled = await cancelFiscalPaymentGuide(prisma, g.id);
    assert.equal(cancelled.status, "CANCELLED");
  });

  it("rejeita alocação acima do pago e AP inexistente", async () => {
    const prisma = makePrismaMock({ salesOrderId: "so-1" });
    const guide = await createFiscalPaymentGuide(prisma, {
      taxType: "PIS",
      jurisdiction: "FEDERAL",
      guideType: "DARF",
      guideNumber: "PIS-1",
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      assessedAmount: 100,
      amountPaid: 50,
    });
    await assert.rejects(
      () =>
        createFiscalAllocation(prisma, {
          guideId: guide.id,
          salesOrderId: "so-1",
          taxType: "PIS",
          allocatedAmount: 80,
          allocationMethod: "MANUAL",
        }),
      /excede/i
    );

    await assert.rejects(
      () =>
        createFiscalPaymentGuide(prisma, {
          taxType: "COFINS",
          jurisdiction: "FEDERAL",
          guideType: "DARF",
          guideNumber: "X",
          periodStart: "2026-02-01",
          periodEnd: "2026-02-28",
          assessedAmount: 1,
          accountsPayableExternalId: 999999,
        }),
      /Contas a Pagar/i
    );
  });
});
