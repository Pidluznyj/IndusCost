import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createEmptyTreasuryAccountMemoryStore,
  createMemoryTreasuryAccountRepository,
} from "./repositories/treasuryAccountRepository.memory.js";
import {
  createEmptyTreasuryReconciliationMatchMemoryStore,
  createMemoryTreasuryReconciliationMatchRepository,
  seedMemoryBankMovement,
} from "./repositories/treasuryReconciliationMatchRepository.memory.js";
import type { TreasuryAuditDb } from "./services/treasuryAuditService.server.js";
import {
  clearTreasuryProjectionRecalcRequests,
  listTreasuryProjectionRecalcRequests,
} from "./services/treasuryProjectionRecalc.server.js";
import {
  createTreasuryReconciliationMatchService,
  type TreasuryReconciliationMatchActor,
} from "./services/treasuryReconciliationMatchService.server.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import { parseTreasuryReconciliationAcceptInput } from "./contracts/treasurySchemas.js";

function accountRow(id: string, code: string) {
  return {
    companyCode: "EMP1",
    companyName: null,
    code,
    name: code,
    institutionName: "Bank",
    institutionCode: null,
    accountType: "CHECKING" as const,
    currency: "BRL" as const,
    agencyMasked: "**1",
    accountNumberMasked: "**99",
    includeInConsolidated: true,
    minimumBalance: "0.00",
    allowNegativeBalance: false,
    liquidity: "IMMEDIATE" as const,
    defaultBalanceOrigin: "MANUAL" as const,
    sortOrder: 0,
    nomusBankAccountId: null,
    createdByUserId: "user-admin",
  };
}

const actor: TreasuryReconciliationMatchActor = {
  userId: "user-ops",
  userName: "Operador",
  role: "ADMIN",
  isSuperAdmin: false,
  canViewReconciliation: true,
  canManageReconciliation: true,
  canViewAccounts: true,
  canManageAccounts: true,
  sessionId: "sess-r",
  requestId: "req-r-1",
};

async function createHarness() {
  const accountStore = createEmptyTreasuryAccountMemoryStore();
  const accountRepo = createMemoryTreasuryAccountRepository(accountStore);
  await accountRepo.create(accountRow("tmp", "CXA"));
  accountStore.accounts[0]!.id = "acc-1";
  accountStore.access.push({
    id: "access-1",
    accountId: "acc-1",
    userId: actor.userId,
    accessLevel: "OPERATE",
    canViewBalance: true,
    canMutateBalance: true,
    isActive: true,
    grantedByUserId: null,
    grantedAt: new Date(),
    revokedAt: null,
    notes: null,
  });

  const matchStore = createEmptyTreasuryReconciliationMatchMemoryStore();
  seedMemoryBankMovement(matchStore, {
    id: "mov-1",
    companyCode: "EMP1",
    accountId: "acc-1",
    amount: "1000.00",
    reconciliationStatus: "PENDING",
    reconciledAmount: "0.00",
  });
  seedMemoryBankMovement(matchStore, {
    id: "mov-2",
    companyCode: "EMP1",
    accountId: "acc-1",
    amount: "500.00",
    reconciliationStatus: "PENDING",
    reconciledAmount: "0.00",
  });

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

  const service = createTreasuryReconciliationMatchService({
    prisma: {} as PrismaClient,
    accountRepository: accountRepo,
    matchRepository: createMemoryTreasuryReconciliationMatchRepository(matchStore),
    runTransaction: async (fn) => fn(fakeTx),
  });

  return { service, audits, matchStore };
}

describe("treasuryReconciliationMatch — integração", () => {
  it("1:1 título — audita CREATE, atualiza status MATCHED e solicita recalc", async () => {
    const { service, audits, matchStore } = await createHarness();
    const result = await service.accept(actor, {
      companyCode: "EMP1",
      accountId: "acc-1",
      matchedCivilDate: "2026-07-20",
      justification: "Match manual",
      movements: [{ bankMovementId: "mov-1", amount: "1000.00" }],
      allocations: [
        {
          kind: "TITLE",
          amount: "1000.00",
          memo: null,
          nomusSide: "AR",
          officialTitleId: "title-1",
          nomusExternalId: 1001,
          openBalance: "1000.00",
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
        },
      ],
      suggestionKey: "mov-1|AR|title-1|1000.00",
      algorithmVersion: "1.0.0",
      suggestionScore: 90,
      suggestionConfidence: "HIGH",
      suggestionReasons: ["AMOUNT_EXACT", "DIRECTION_COMPATIBLE"],
    });

    assert.equal(result.match.status, "MATCHED");
    assert.equal(result.match.doesNotRealizeOfficial, true);
    assert.equal(result.match.matchedAmount, "1000.00");
    assert.equal(result.match.allocations[0]!.kind, "TITLE");
    assert.equal(result.projectionRecalc.accepted, true);
    assert.equal(audits[0]?.entityType, "RECONCILIATION_MATCH");
    assert.equal(audits[0]?.action, "CREATE");
    assert.equal(matchStore.movements[0]!.reconciliationStatus, "MATCHED");
    assert.equal(matchStore.movements[0]!.reconciledAmount, "1000.00");
    assert.equal(
      listTreasuryProjectionRecalcRequests()[0]?.reason,
      "reconciliation_matched"
    );
  });

  it("1 movimento × vários títulos + parcial", async () => {
    const { service, matchStore } = await createHarness();
    const result = await service.accept(actor, {
      companyCode: "EMP1",
      accountId: "acc-1",
      matchedCivilDate: "2026-07-20",
      justification: null,
      movements: [{ bankMovementId: "mov-1", amount: "400.00" }],
      allocations: [
        {
          kind: "TITLE",
          amount: "250.00",
          memo: null,
          nomusSide: "AR",
          officialTitleId: "t-a",
          nomusExternalId: 1,
          openBalance: "250.00",
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
        },
        {
          kind: "TITLE",
          amount: "150.00",
          memo: null,
          nomusSide: "AR",
          officialTitleId: "t-b",
          nomusExternalId: 2,
          openBalance: "150.00",
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
        },
      ],
      suggestionKey: null,
      algorithmVersion: null,
      suggestionScore: null,
      suggestionConfidence: null,
      suggestionReasons: null,
    });
    assert.equal(result.match.allocations.length, 2);
    assert.equal(matchStore.movements[0]!.reconciliationStatus, "PARTIAL");
    assert.equal(matchStore.movements[0]!.reconciledAmount, "400.00");
  });

  it("vários movimentos × 1 título", async () => {
    const { service, matchStore } = await createHarness();
    const result = await service.accept(actor, {
      companyCode: "EMP1",
      accountId: "acc-1",
      matchedCivilDate: "2026-07-21",
      justification: "N:1",
      movements: [
        { bankMovementId: "mov-1", amount: "1000.00" },
        { bankMovementId: "mov-2", amount: "500.00" },
      ],
      allocations: [
        {
          kind: "TITLE",
          amount: "1500.00",
          memo: null,
          nomusSide: "AP",
          officialTitleId: "t-ap",
          nomusExternalId: 9,
          openBalance: "1500.00",
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
        },
      ],
      suggestionKey: null,
      algorithmVersion: null,
      suggestionScore: null,
      suggestionConfidence: null,
      suggestionReasons: null,
    });
    assert.equal(result.match.movements.length, 2);
    assert.equal(matchStore.movements[0]!.reconciliationStatus, "MATCHED");
    assert.equal(matchStore.movements[1]!.reconciliationStatus, "MATCHED");
  });

  it("tarifa/juros/desconto/diferença/não identificado/transferência/manual", async () => {
    const { service, matchStore } = await createHarness();
    // 1000 = TITLE 980 + FEE 10 + INTEREST 20 + DIFFERENCE 5 - DISCOUNT 10 - ABATEMENT 5
    await service.accept(actor, {
      companyCode: "EMP1",
      accountId: "acc-1",
      matchedCivilDate: "2026-07-22",
      justification: "ajustes",
      movements: [{ bankMovementId: "mov-1", amount: "1000.00" }],
      allocations: [
        {
          kind: "TITLE",
          amount: "980.00",
          memo: null,
          nomusSide: "AR",
          officialTitleId: "t1",
          nomusExternalId: 1,
          openBalance: "980.00",
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
        },
        {
          kind: "FEE",
          amount: "10.00",
          memo: "tarifa",
          nomusSide: null,
          officialTitleId: null,
          nomusExternalId: null,
          openBalance: null,
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
        },
        {
          kind: "INTEREST",
          amount: "20.00",
          memo: null,
          nomusSide: null,
          officialTitleId: null,
          nomusExternalId: null,
          openBalance: null,
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
        },
        {
          kind: "DIFFERENCE",
          amount: "5.00",
          memo: null,
          nomusSide: null,
          officialTitleId: null,
          nomusExternalId: null,
          openBalance: null,
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: "ROUNDING",
        },
        {
          kind: "DISCOUNT",
          amount: "10.00",
          memo: null,
          nomusSide: null,
          officialTitleId: null,
          nomusExternalId: null,
          openBalance: null,
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
        },
        {
          kind: "ABATEMENT",
          amount: "5.00",
          memo: null,
          nomusSide: null,
          officialTitleId: null,
          nomusExternalId: null,
          openBalance: null,
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
        },
      ],
      suggestionKey: null,
      algorithmVersion: null,
      suggestionScore: null,
      suggestionConfidence: null,
      suggestionReasons: null,
    });
    assert.equal(matchStore.movements[0]!.reconciliationStatus, "MATCHED");

    const { service: s2, matchStore: store2 } = await createHarness();
    await s2.accept(actor, {
      companyCode: "EMP1",
      accountId: "acc-1",
      matchedCivilDate: "2026-07-22",
      justification: "unidentified",
      movements: [{ bankMovementId: "mov-2", amount: "300.00" }],
      allocations: [
        {
          kind: "UNIDENTIFIED",
          amount: "300.00",
          memo: "sem título",
          nomusSide: null,
          officialTitleId: null,
          nomusExternalId: null,
          openBalance: null,
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
        },
      ],
      suggestionKey: null,
      algorithmVersion: null,
      suggestionScore: null,
      suggestionConfidence: null,
      suggestionReasons: null,
    });
    assert.equal(store2.movements[1]!.reconciliationStatus, "PARTIAL");

    await s2.accept(actor, {
      companyCode: "EMP1",
      accountId: "acc-1",
      matchedCivilDate: "2026-07-22",
      justification: "transfer+manual",
      movements: [{ bankMovementId: "mov-2", amount: "200.00" }],
      allocations: [
        {
          kind: "TRANSFER",
          amount: "120.00",
          memo: null,
          nomusSide: null,
          officialTitleId: null,
          nomusExternalId: null,
          openBalance: null,
          transferId: "tr-1",
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
        },
        {
          kind: "MANUAL_LEDGER",
          amount: "80.00",
          memo: "ajuste",
          nomusSide: null,
          officialTitleId: null,
          nomusExternalId: null,
          openBalance: null,
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: "11111111-1111-4111-8111-111111111111",
          differenceCode: null,
        },
      ],
      suggestionKey: null,
      algorithmVersion: null,
      suggestionScore: null,
      suggestionConfidence: null,
      suggestionReasons: null,
    });
    assert.equal(store2.movements[1]!.reconciliationStatus, "MATCHED");
    assert.equal(store2.movements[1]!.reconciledAmount, "500.00");
  });

  it("unmatch restaura status, audita UPDATE e solicita recalc", async () => {
    const { service, audits, matchStore } = await createHarness();
    const accepted = await service.accept(actor, {
      companyCode: "EMP1",
      accountId: "acc-1",
      matchedCivilDate: "2026-07-20",
      justification: null,
      movements: [{ bankMovementId: "mov-1", amount: "1000.00" }],
      allocations: [
        {
          kind: "TITLE",
          amount: "1000.00",
          memo: null,
          nomusSide: "AR",
          officialTitleId: "t1",
          nomusExternalId: 1,
          openBalance: "1000.00",
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
        },
      ],
      suggestionKey: null,
      algorithmVersion: null,
      suggestionScore: null,
      suggestionConfidence: null,
      suggestionReasons: null,
    });

    const undone = await service.unmatch(actor, accepted.match.id, {
      expectedVersion: 1,
      reason: "erro de matching",
    });
    assert.equal(undone.match.status, "UNMATCHED");
    assert.equal(matchStore.movements[0]!.reconciliationStatus, "PENDING");
    assert.equal(matchStore.movements[0]!.reconciledAmount, "0.00");
    assert.equal(audits[1]?.action, "UPDATE");
    assert.ok(
      listTreasuryProjectionRecalcRequests().some(
        (r) => r.reason === "reconciliation_unmatched"
      )
    );
  });

  it("não excede valor do movimento e parse de input funciona", async () => {
    const { service } = await createHarness();
    await assert.rejects(
      () =>
        service.accept(actor, {
          companyCode: "EMP1",
          accountId: "acc-1",
          matchedCivilDate: "2026-07-20",
          justification: null,
          movements: [{ bankMovementId: "mov-1", amount: "1000.01" }],
          allocations: [
            {
              kind: "TITLE",
              amount: "1000.01",
              memo: null,
              nomusSide: "AR",
              officialTitleId: "t1",
              nomusExternalId: 1,
              openBalance: "2000.00",
              transferId: null,
              transferGroupId: null,
              ledgerEntryId: null,
              differenceCode: null,
            },
          ],
          suggestionKey: null,
          algorithmVersion: null,
          suggestionScore: null,
          suggestionConfidence: null,
          suggestionReasons: null,
        }),
      TreasuryDomainError
    );

    const parsed = parseTreasuryReconciliationAcceptInput({
      companyCode: "EMP1",
      accountId: "acc-1",
      matchedCivilDate: "2026-07-20",
      movements: [{ bankMovementId: "mov-1", amount: "10.00" }],
      allocations: [
        {
          kind: "TRANSFER",
          amount: "10.00",
          transferId: "tr-1",
        },
      ],
    });
    assert.equal(parsed.allocations[0]!.kind, "TRANSFER");
  });

  it("não concede match sem permissão manage", async () => {
    const { service } = await createHarness();
    const denied: TreasuryReconciliationMatchActor = {
      ...actor,
      canManageReconciliation: false,
      canManageAccounts: false,
      isSuperAdmin: false,
    };
    await assert.rejects(
      () =>
        service.accept(denied, {
          companyCode: "EMP1",
          accountId: "acc-1",
          matchedCivilDate: "2026-07-20",
          justification: null,
          movements: [{ bankMovementId: "mov-1", amount: "1000.00" }],
          allocations: [
            {
              kind: "UNIDENTIFIED",
              amount: "1000.00",
              memo: "x",
              nomusSide: null,
              officialTitleId: null,
              nomusExternalId: null,
              openBalance: null,
              transferId: null,
              transferGroupId: null,
              ledgerEntryId: null,
              differenceCode: null,
            },
          ],
          suggestionKey: null,
          algorithmVersion: null,
          suggestionScore: null,
          suggestionConfidence: null,
          suggestionReasons: null,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });
});
