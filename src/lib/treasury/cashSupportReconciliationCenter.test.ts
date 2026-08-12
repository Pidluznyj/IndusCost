/**
 * Central de Conciliação Bancária — wiring do backend.
 *
 * Prova, sem Postgres (memory repos, mesmo padrão do teste de concorrência):
 *   1. aceite AUTO é idempotente — repetir o auto-run com a MESMA
 *      idempotencyKey não cria segundo match (nenhum centavo alocado 2x);
 *   2. mesma chave com payload diferente é CONFLICT (chave não é reutilizável);
 *   3. histórico por período (listByMatchedPeriod) devolve ativos e desfeitos,
 *      filtra por data e nunca vaza conta sem acesso do ator.
 */

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
import { clearTreasuryProjectionRecalcRequests } from "./services/treasuryProjectionRecalc.server.js";
import {
  createTreasuryReconciliationMatchService,
  type TreasuryReconciliationMatchActor,
} from "./services/treasuryReconciliationMatchService.server.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import {
  CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION,
} from "./domain/cashSupportAutoReconcile.js";
import { TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION } from "./domain/treasuryReconciliationSuggestionEngine.js";
import {
  TREASURY_RECONCILIATION_DIFFERENCE_CODES,
  resolveTreasuryReconciliationDifferenceKind,
} from "./contracts/treasuryEnums.js";
import { parseTreasuryReconciliationAcceptInput } from "./contracts/treasurySchemas.js";

const actor: TreasuryReconciliationMatchActor = {
  userId: "user-ops",
  userName: "Operador",
  role: "ADMIN",
  isSuperAdmin: false,
  canViewReconciliation: true,
  canManageReconciliation: true,
  canReverseReconciliation: true,
  canViewAccounts: true,
  canManageAccounts: true,
  sessionId: "sess-rc",
  requestId: "req-rc-1",
};

function accountRow(code: string) {
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

async function createHarness() {
  const accountStore = createEmptyTreasuryAccountMemoryStore();
  const accountRepo = createMemoryTreasuryAccountRepository(accountStore);
  await accountRepo.create(accountRow("CXA"));
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
  } as never);
  // Segunda conta SEM acesso do ator — histórico não pode vazá-la.
  await accountRepo.create(accountRow("CXB"));
  accountStore.accounts[1]!.id = "acc-2";

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

  const fakeTx = {
    treasuryAuditLog: {
      async create(args: { data: Record<string, unknown> }) {
        return { id: "audit", ...args.data };
      },
    },
  } as unknown as TreasuryAuditDb;

  clearTreasuryProjectionRecalcRequests();

  const runTransaction = <T,>(fn: (tx: TreasuryAuditDb) => Promise<T>) =>
    fn(fakeTx);

  const matchRepository = createMemoryTreasuryReconciliationMatchRepository(matchStore);
  const service = createTreasuryReconciliationMatchService({
    prisma: {} as PrismaClient,
    accountRepository: accountRepo,
    matchRepository,
    runTransaction,
    notifyPostClosing: async () => ({ raised: false, reason: "DAY_NOT_CLOSED" }),
  });

  return { service, matchStore, matchRepository, accountStore };
}

const AUTO_KEY = `AUTO|${TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION}|${CASH_SUPPORT_AUTO_RECONCILE_RULE_VERSION}|mov-1|900`;

function autoAcceptInput(overrides: Record<string, unknown> = {}) {
  return {
    companyCode: "EMP1",
    accountId: "acc-1",
    matchedCivilDate: "2026-07-20",
    justification: "[AUTO] Conciliação automática AUTO-1.0.0 — score 85 (HIGH)",
    movements: [{ bankMovementId: "mov-1", amount: "1000.00" }],
    allocations: [
      {
        kind: "TITLE" as const,
        amount: "1000.00",
        memo: null,
        nomusSide: "AR" as const,
        officialTitleId: "900",
        nomusExternalId: 900,
        openBalance: "1000.00",
        transferId: null,
        transferGroupId: null,
        ledgerEntryId: null,
        differenceCode: null,
      },
    ],
    idempotencyKey: AUTO_KEY,
    suggestionKey: "mov-1|900",
    algorithmVersion: TREASURY_RECONCILIATION_SUGGESTION_ALGORITHM_VERSION,
    suggestionScore: 85,
    suggestionConfidence: "HIGH",
    suggestionReasons: ["AMOUNT_EXACT", "DOCUMENT_MATCH"],
    ...overrides,
  };
}

describe("Conciliação Bancária — auto-run idempotente e histórico", () => {
  it("repetir o aceite AUTO com a mesma chave não cria segundo match", async () => {
    const { service, matchStore } = await createHarness();

    const first = await service.accept(actor, autoAcceptInput() as never);
    const second = await service.accept(actor, autoAcceptInput() as never);

    assert.equal(matchStore.matches.length, 1, "um único match gravado");
    assert.equal(first.match.id, second.match.id, "mesma evidência devolvida");
    assert.equal(first.match.doesNotRealizeOfficial, true, "nunca baixa oficial");
  });

  it("mesma chave AUTO com payload diferente é CONFLICT — não sobrescreve", async () => {
    const { service } = await createHarness();
    await service.accept(actor, autoAcceptInput() as never);

    await assert.rejects(
      () =>
        service.accept(
          actor,
          autoAcceptInput({
            movements: [{ bankMovementId: "mov-2", amount: "500.00" }],
            allocations: [
              {
                kind: "TITLE" as const,
                amount: "500.00",
                memo: null,
                nomusSide: "AR" as const,
                officialTitleId: "901",
                nomusExternalId: 901,
                openBalance: "500.00",
                transferId: null,
                transferGroupId: null,
                ledgerEntryId: null,
                differenceCode: null,
              },
            ],
          }) as never
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
  });

  it("histórico por período devolve ativos e desfeitos, e respeita a janela", async () => {
    const { service } = await createHarness();
    const { match } = await service.accept(actor, autoAcceptInput() as never);
    await service.accept(
      actor,
      autoAcceptInput({
        matchedCivilDate: "2026-08-05",
        idempotencyKey: `${AUTO_KEY}|ago`,
        movements: [{ bankMovementId: "mov-2", amount: "500.00" }],
        allocations: [
          {
            kind: "TITLE" as const,
            amount: "500.00",
            memo: null,
            nomusSide: "AR" as const,
            officialTitleId: "901",
            nomusExternalId: 901,
            openBalance: "500.00",
            transferId: null,
            transferGroupId: null,
            ledgerEntryId: null,
            differenceCode: null,
          },
        ],
      }) as never
    );

    // Desfaz o primeiro — precisa continuar visível no histórico (auditável).
    await service.unmatch(actor, match.id, {
      expectedVersion: match.version,
      reason: "Teste de reversão auditável",
    });

    const july = await service.listByMatchedPeriod(actor, {
      companyCode: "EMP1",
      from: "2026-07-01",
      to: "2026-07-31",
    });
    assert.equal(july.length, 1);
    assert.equal(july[0]!.isReversed, true, "desfeito permanece no histórico");
    assert.equal(july[0]!.unmatchReason, "Teste de reversão auditável");

    const all = await service.listByMatchedPeriod(actor, {
      companyCode: "EMP1",
      from: "2026-07-01",
      to: "2026-08-31",
    });
    assert.equal(all.length, 2);
    // Mais recente primeiro (matchedCivilDate desc).
    assert.equal(all[0]!.matchedCivilDate, "2026-08-05");
  });

  it("histórico não vaza match de conta que o ator não opera", async () => {
    const { service, matchRepository, accountStore } = await createHarness();
    // Ator SEM direitos globais de conta: o acesso vem só da ACL por conta
    // (acc-1 tem OPERATE; acc-2 não tem nada). canManageAccounts=true seria
    // bypass global legítimo e o teste não provaria a filtragem.
    // canManageReconciliation/canReverse também elevam a bypass global via
    // asAccountActor — o leitor de histórico aqui é view-only de propósito.
    const restrictedActor: TreasuryReconciliationMatchActor = {
      ...actor,
      userId: "user-restricted",
      role: "USER",
      canManageAccounts: false,
      canManageReconciliation: false,
      canReverseReconciliation: false,
      isSuperAdmin: false,
    };
    accountStore.access.push({
      id: "access-2",
      accountId: "acc-1",
      userId: restrictedActor.userId,
      accessLevel: "OPERATE",
      canViewBalance: true,
      canMutateBalance: true,
      isActive: true,
      grantedByUserId: null,
      grantedAt: new Date(),
      revokedAt: null,
      notes: null,
    } as never);

    // Matches em ambas as contas — acc-2 direto no repo (bypass do accept).
    await service.accept(actor, autoAcceptInput() as never);
    await matchRepository.create({
      companyCode: "EMP1",
      accountId: "acc-2",
      status: "MATCHED",
      matchedAmount: "77.00",
      matchedCivilDate: "2026-07-15",
      createdByUserId: "user-x",
      movements: [{ bankMovementId: "mov-9", amount: "77.00", sortOrder: 0 }],
      allocations: [
        { kind: "TITLE", amount: "77.00", officialTitleId: "999", nomusSide: "AR", nomusExternalId: 999, sortOrder: 0 },
      ],
    });

    const result = await service.listByMatchedPeriod(restrictedActor, {
      companyCode: "EMP1",
      from: "2026-07-01",
      to: "2026-07-31",
    });
    assert.equal(result.length, 1, "só a conta com ACL aparece");
    assert.equal(result[0]!.accountId, "acc-1");
  });
});

describe("Conciliação Bancária — classificações oficiais de diferença", () => {
  it("vocabulário fechado tem as 9 classificações do requisito", () => {
    assert.deepEqual(
      [...TREASURY_RECONCILIATION_DIFFERENCE_CODES],
      [
        "DESCONTO",
        "JUROS",
        "MULTA",
        "TARIFA",
        "RETENCAO",
        "ABATIMENTO",
        "COMPENSACAO",
        "ARREDONDAMENTO",
        "OUTRO",
      ]
    );
  });

  it("kind contábil derivado é determinístico para cada classificação × efeito", () => {
    // REDUCE (banco moveu a menos)
    assert.equal(resolveTreasuryReconciliationDifferenceKind("DESCONTO", "REDUCE"), "DISCOUNT");
    assert.equal(resolveTreasuryReconciliationDifferenceKind("RETENCAO", "REDUCE"), "ABATEMENT");
    assert.equal(resolveTreasuryReconciliationDifferenceKind("ABATIMENTO", "REDUCE"), "ABATEMENT");
    assert.equal(resolveTreasuryReconciliationDifferenceKind("COMPENSACAO", "REDUCE"), "ABATEMENT");
    assert.equal(resolveTreasuryReconciliationDifferenceKind("ARREDONDAMENTO", "REDUCE"), "ABATEMENT");
    // ADD (banco moveu a mais)
    assert.equal(resolveTreasuryReconciliationDifferenceKind("JUROS", "ADD"), "INTEREST");
    assert.equal(resolveTreasuryReconciliationDifferenceKind("MULTA", "ADD"), "INTEREST");
    assert.equal(resolveTreasuryReconciliationDifferenceKind("TARIFA", "ADD"), "FEE");
    assert.equal(resolveTreasuryReconciliationDifferenceKind("ARREDONDAMENTO", "ADD"), "DIFFERENCE");
    assert.equal(resolveTreasuryReconciliationDifferenceKind("OUTRO", "ADD"), "DIFFERENCE");
  });

  it("accept aceita differenceCode do vocabulário e persiste na allocation", async () => {
    const { service } = await createHarness();
    // Título 1000, banco creditou 980, desconto justificado de 20.
    const { match } = await service.accept(actor, {
      ...autoAcceptInput({
        idempotencyKey: `${AUTO_KEY}|desc`,
        movements: [{ bankMovementId: "mov-1", amount: "980.00" }],
      }),
      allocations: [
        {
          kind: "TITLE" as const,
          amount: "1000.00",
          memo: null,
          nomusSide: "AR" as const,
          officialTitleId: "900",
          nomusExternalId: 900,
          openBalance: "1000.00",
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: null,
        },
        {
          kind: "DISCOUNT" as const,
          amount: "20.00",
          memo: "Desconto comercial",
          nomusSide: null,
          officialTitleId: null,
          nomusExternalId: null,
          openBalance: null,
          transferId: null,
          transferGroupId: null,
          ledgerEntryId: null,
          differenceCode: "DESCONTO",
        },
      ],
    } as never);
    const discount = match.allocations.find((a) => a.kind === "DISCOUNT");
    assert.equal(discount?.differenceCode, "DESCONTO");
  });

  it("parse rejeita differenceCode fora do vocabulário", () => {
    assert.throws(
      () =>
        parseTreasuryReconciliationAcceptInput({
          companyCode: "EMP1",
          accountId: "acc-1",
          matchedCivilDate: "2026-07-20",
          movements: [{ bankMovementId: "mov-1", amount: "10.00" }],
          allocations: [
            {
              kind: "FEE",
              amount: "10.00",
              differenceCode: "TAXA_INVENTADA",
            },
          ],
        }),
      (err: unknown) =>
        err instanceof Error && /differenceCode/.test(String((err as { field?: string }).field ?? err.message))
    );
  });

  it("parse aceita cada uma das 9 classificações oficiais", () => {
    for (const code of TREASURY_RECONCILIATION_DIFFERENCE_CODES) {
      const parsed = parseTreasuryReconciliationAcceptInput({
        companyCode: "EMP1",
        accountId: "acc-1",
        matchedCivilDate: "2026-07-20",
        movements: [{ bankMovementId: "mov-1", amount: "10.00" }],
        allocations: [
          {
            kind: "TITLE",
            amount: "10.00",
            nomusSide: "AR",
            officialTitleId: "900",
            differenceCode: code,
          },
        ],
      });
      assert.equal(parsed.allocations[0]!.differenceCode, code);
    }
  });
});
