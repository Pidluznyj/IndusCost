import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createEmptyOfficialTitlesMemoryStore,
  createMemoryTreasuryOfficialTitlesAdapter,
} from "./adapters/treasuryOfficialTitlesAdapter.memory.js";
import type { OfficialNomusPayableRow } from "./mappers/treasuryOfficialTitleMappers.js";
import type { TreasuryAccountRow } from "./mappers/treasuryAccountMappers.js";
import {
  createEmptyTreasuryAccountMemoryStore,
  createMemoryTreasuryAccountRepository,
} from "./repositories/treasuryAccountRepository.memory.js";
import {
  createEmptyTreasuryBalanceMemoryStore,
  createMemoryTreasuryBalanceRepository,
} from "./repositories/treasuryBalanceRepository.memory.js";
import {
  createEmptyTreasuryTitleComplementMemoryStore,
  createMemoryTreasuryTitleOperationalComplementRepository,
} from "./repositories/treasuryTitleOperationalComplementRepository.memory.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryAuditDb } from "./services/treasuryAuditService.server.js";
import {
  clearTreasuryProjectionRecalcRequests,
  listTreasuryProjectionRecalcRequests,
} from "./services/treasuryProjectionRecalc.server.js";
import {
  createTreasuryPayableProgrammingService,
  type TreasuryPayableProgrammingActor,
} from "./services/treasuryPayableProgrammingService.server.js";

function decimalLike(value: string): { toFixed(digits: number): string } {
  return {
    toFixed(digits: number) {
      return Number(value).toFixed(digits);
    },
  };
}

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

const AP_OPEN: OfficialNomusPayableRow = {
  id: "ap-open-1",
  externalId: 55100,
  status: false,
  personId: 77,
  personName: "Fornecedor Beta",
  personCnpj: "11222333000144",
  description: "NF 900",
  documentNumber: "DOC-900",
  classification: "Servico",
  comments: null,
  competenceDate: utcDate(2026, 6, 1),
  dueDate: utcDate(2026, 7, 25),
  scheduleDate: null,
  amountPayable: decimalLike("1000.00"),
  balancePayable: decimalLike("400.00"),
  amountPaid: decimalLike("600.00"),
  amountScheduled: null,
  settlementDate: null,
  paymentDate: null,
  sourceInvoiceId: 900,
  sourceInvoiceNumber: "900",
  sourcePresenceStatus: "PRESENT",
  sourceRemovedAt: null,
  syncedAt: new Date("2026-07-20T12:00:00.000Z"),
  rawPayload: {},
};

const programmer: TreasuryPayableProgrammingActor = {
  userId: "prog-1",
  userName: "Programador",
  role: "ADMIN",
  isSuperAdmin: false,
  canProgramPayables: true,
  sessionId: "sess-p",
  requestId: "req-prog-1",
};

const viewer: TreasuryPayableProgrammingActor = {
  userId: "view-1",
  userName: "Viewer",
  role: "VIEWER",
  isSuperAdmin: false,
  canProgramPayables: false,
};

function accountRow(
  partial: Partial<TreasuryAccountRow> & Pick<TreasuryAccountRow, "id" | "code">
): TreasuryAccountRow {
  const now = new Date("2026-07-01T00:00:00.000Z");
  return {
    companyCode: "LAZARIOS",
    companyName: "Lazarios",
    name: partial.code,
    institutionName: "Banco",
    institutionCode: null,
    accountType: "CHECKING",
    currency: "BRL",
    agencyMasked: "****1",
    accountNumberMasked: "****9999",
    includeInConsolidated: true,
    minimumBalance: "0.00",
    allowNegativeBalance: true,
    liquidity: "HIGH",
    defaultBalanceOrigin: "MANUAL",
    sortOrder: 1,
    nomusBankAccountId: null,
    isActive: true,
    createdByUserId: "admin-1",
    createdAt: now,
    updatedAt: now,
    deactivatedAt: null,
    deactivatedByUserId: null,
    deactivationReason: null,
    ...partial,
  };
}

function createHarness() {
  const officialStore = createEmptyOfficialTitlesMemoryStore();
  officialStore.payables = [AP_OPEN];
  const complementStore = createEmptyTreasuryTitleComplementMemoryStore();
  const accountStore = createEmptyTreasuryAccountMemoryStore();
  accountStore.accounts.push(
    accountRow({ id: "acc-pay", code: "CX01", name: "Caixa pagadora" }),
    accountRow({
      id: "acc-other",
      code: "CX02",
      name: "Outra",
      includeInConsolidated: true,
      sortOrder: 2,
    })
  );
  const balanceStore = createEmptyTreasuryBalanceMemoryStore();
  balanceStore.snapshots.push(
    {
      id: "snap-1",
      accountId: "acc-pay",
      referenceAt: new Date("2026-07-20T00:00:00.000Z"),
      availableBalance: "100.00",
      blockedBalance: "0.00",
      investmentsBalance: "0.00",
      usedLimit: "0.00",
      origin: "MANUAL",
      idempotencyKey: "k1",
      notes: null,
      attachmentUrl: null,
      createdByUserId: "admin-1",
      previousSnapshotId: null,
      createdAt: new Date("2026-07-20T00:00:00.000Z"),
    },
    {
      id: "snap-2",
      accountId: "acc-other",
      referenceAt: new Date("2026-07-20T00:00:00.000Z"),
      availableBalance: "50.00",
      blockedBalance: "0.00",
      investmentsBalance: "0.00",
      usedLimit: "0.00",
      origin: "MANUAL",
      idempotencyKey: "k2",
      notes: null,
      attachmentUrl: null,
      createdByUserId: "admin-1",
      previousSnapshotId: null,
      createdAt: new Date("2026-07-20T00:00:00.000Z"),
    }
  );

  const audits: Array<Record<string, unknown>> = [];
  const fakeTx = {
    treasuryAuditLog: {
      async create(args: { data: Record<string, unknown> }) {
        const row = { id: `audit-${audits.length + 1}`, ...args.data };
        audits.push(row);
        return row;
      },
    },
  } as unknown as TreasuryAuditDb;

  clearTreasuryProjectionRecalcRequests();

  const service = createTreasuryPayableProgrammingService({
    prisma: {} as PrismaClient,
    officialAdapter: createMemoryTreasuryOfficialTitlesAdapter(officialStore),
    complementRepository:
      createMemoryTreasuryTitleOperationalComplementRepository(complementStore),
    accountRepository: createMemoryTreasuryAccountRepository(accountStore),
    balanceRepository: createMemoryTreasuryBalanceRepository(balanceStore),
    runTransaction: async (fn) => fn(fakeTx),
  });

  return { service, audits, complementStore, officialStore };
}

describe("treasuryPayableProgramming — integração", () => {
  it("programa parcial, calcula impacto, audita e dispara recálculo", async () => {
    const { service, audits } = createHarness();
    const result = await service.programPayment(programmer, "ap-open-1", {
      scheduledDate: "2026-08-10",
      plannedAccountId: "acc-pay",
      scheduledAmount: "200.00",
      priority: "HIGH",
      responsibleUserId: "user-resp",
      justification: "Programação parcial de caixa",
      status: "PROGRAMMED",
      expectedVersion: 0,
    });

    assert.equal(result.payable.official.dueDate, "2026-07-25");
    assert.equal(result.programming.scheduledAmount, "200.00");
    assert.equal(result.programming.status, "PROGRAMMED");
    assert.equal(result.impact.accountBalanceBefore, "100.00");
    assert.equal(result.impact.accountBalanceAfter, "-100.00");
    assert.equal(result.impact.consolidatedBalanceBefore, "150.00");
    assert.equal(result.impact.consolidatedBalanceAfter, "-50.00");
    assert.equal(result.impact.createsNegativeAccountBalance, true);
    assert.equal(result.impact.createsNegativeConsolidatedBalance, true);
    assert.ok(result.impact.alerts.length >= 2);
    assert.equal(result.projectionRecalc.accepted, true);
    assert.ok(audits.some((a) => a.entityType === "PAYMENT_SCHEDULE"));
    assert.ok(
      listTreasuryProjectionRecalcRequests().some(
        (r) => r.reason === "payable_payment_programmed"
      )
    );
  });

  it("permite valor acima do saldo com justificativa e autoriza", async () => {
    const { service } = createHarness();
    const result = await service.programPayment(programmer, "ap-open-1", {
      scheduledDate: "2026-08-12",
      plannedAccountId: "acc-pay",
      scheduledAmount: "450.00",
      priority: "URGENT",
      responsibleUserId: null,
      justification: "Acordo excepcional com fornecedor",
      status: "AUTHORIZED",
      expectedVersion: 0,
    });
    assert.equal(result.programming.scheduledAmount, "450.00");
    assert.equal(result.programming.status, "AUTHORIZED");
    assert.equal(result.payable.operationalStatus, "AUTHORIZED");
  });

  it("bloqueia acima do saldo sem justificativa; conflito de versão; permissão", async () => {
    const { service } = createHarness();

    await assert.rejects(
      () =>
        service.programPayment(programmer, "ap-open-1", {
          scheduledDate: "2026-08-10",
          plannedAccountId: "acc-pay",
          scheduledAmount: "450.00",
          priority: "NORMAL",
          responsibleUserId: null,
          justification: "   ",
          status: "PROGRAMMED",
          expectedVersion: 0,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "REQUIRED_FIELD"
    );

    await assert.rejects(
      () =>
        service.programPayment(viewer, "ap-open-1", {
          scheduledDate: "2026-08-10",
          plannedAccountId: "acc-pay",
          scheduledAmount: "50.00",
          priority: "NORMAL",
          responsibleUserId: null,
          justification: "ok",
          status: "PROGRAMMED",
          expectedVersion: 0,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );

    const created = await service.programPayment(programmer, "ap-open-1", {
      scheduledDate: "2026-08-10",
      plannedAccountId: "acc-pay",
      scheduledAmount: "50.00",
      priority: "NORMAL",
      responsibleUserId: null,
      justification: "ok",
      status: "PROGRAMMED",
      expectedVersion: 0,
    });

    await assert.rejects(
      () =>
        service.updateProgramPayment(programmer, "ap-open-1", {
          scheduledAmount: "60.00",
          justification: "ajuste",
          expectedVersion: created.programming.version - 1,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
  });

  it("altera e cancela programação controladamente sem mutar vencimento oficial", async () => {
    const { service } = createHarness();
    const created = await service.programPayment(programmer, "ap-open-1", {
      scheduledDate: "2026-08-10",
      plannedAccountId: "acc-pay",
      scheduledAmount: "80.00",
      priority: "NORMAL",
      responsibleUserId: "r1",
      justification: "programar",
      status: "PROGRAMMED",
      expectedVersion: 0,
    });

    const updated = await service.updateProgramPayment(programmer, "ap-open-1", {
      scheduledAmount: "90.00",
      status: "AUTHORIZED",
      justification: "autorizar pagamento",
      expectedVersion: created.programming.version,
    });
    assert.equal(updated.programming.scheduledAmount, "90.00");
    assert.equal(updated.programming.status, "AUTHORIZED");
    assert.equal(updated.payable.official.dueDate, "2026-07-25");

    const cancelled = await service.cancelProgramPayment(
      programmer,
      "ap-open-1",
      {
        reason: "fornecedor adiou",
        expectedVersion: updated.programming.version,
      }
    );
    assert.equal(cancelled.payable.complement?.scheduledDate, null);
    assert.equal(cancelled.payable.complement?.scheduledAmount, null);
    assert.equal(cancelled.payable.official.dueDate, "2026-07-25");
    assert.ok(cancelled.impact);
  });
});
