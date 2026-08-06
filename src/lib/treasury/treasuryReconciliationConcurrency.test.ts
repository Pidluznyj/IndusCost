/**
 * CASH-SUPPORT-P0-CONCURRENCY-001 — regressão de integridade financeira.
 *
 * O defeito: `accept()` lia a capacidade livre do movimento ANTES de abrir a
 * transação e reaproveitava o valor dentro dela. Dois aceites concorrentes
 * enxergavam a mesma capacidade e ambos gravavam, estourando o movimento.
 *
 * Como o teste prova a correção sem Postgres: `runTransaction` é um mutex, que
 * é exatamente a serialização que `SELECT ... FOR UPDATE` garante no banco.
 * Com o código antigo o teste FALHA mesmo com o mutex — porque a leitura
 * acontecia fora da região crítica. Com a correção, a segunda requisição
 * relê a capacidade já consumida e é rejeitada.
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
import { sumTreasuryMoney } from "./treasuryMoney.js";

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
  sessionId: "sess-c",
  requestId: "req-c-1",
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

async function createHarness(movementAmount: string) {
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

  const matchStore = createEmptyTreasuryReconciliationMatchMemoryStore();
  seedMemoryBankMovement(matchStore, {
    id: "mov-1",
    companyCode: "EMP1",
    accountId: "acc-1",
    amount: movementAmount,
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

  // Mutex = serialização da transação, equivalente ao FOR UPDATE do Postgres.
  // Cede o event loop dentro da região crítica para que qualquer leitura feita
  // FORA dela (o defeito) seja observada como capacidade desatualizada.
  let chain: Promise<unknown> = Promise.resolve();
  const runTransaction = <T,>(fn: (tx: TreasuryAuditDb) => Promise<T>) => {
    const next = chain.then(async () => {
      await new Promise((r) => setImmediate(r));
      return fn(fakeTx);
    });
    chain = next.catch(() => undefined);
    return next;
  };

  const service = createTreasuryReconciliationMatchService({
    prisma: {} as PrismaClient,
    accountRepository: accountRepo,
    matchRepository: createMemoryTreasuryReconciliationMatchRepository(matchStore),
    runTransaction,
    notifyPostClosing: async () => ({ raised: false, reason: "DAY_NOT_CLOSED" }),
  });

  return { service, matchStore };
}

function acceptInput(amount: string, titleId: string) {
  return {
    companyCode: "EMP1",
    accountId: "acc-1",
    matchedCivilDate: "2026-07-20",
    justification: "Concorrência",
    movements: [{ bankMovementId: "mov-1", amount }],
    allocations: [
      {
        kind: "TITLE" as const,
        amount,
        memo: null,
        nomusSide: "AR" as const,
        officialTitleId: titleId,
        nomusExternalId: 1001,
        openBalance: amount,
        transferId: null,
        transferGroupId: null,
        ledgerEntryId: null,
        differenceCode: null,
      },
    ],
  };
}

/** Soma das pernas ativas gravadas contra o movimento. */
function totalAllocatedToMovement(
  matchStore: ReturnType<typeof createEmptyTreasuryReconciliationMatchMemoryStore>,
  movementId: string
): string {
  const amounts: string[] = [];
  for (const match of matchStore.matches) {
    if (match.status !== "MATCHED" && match.status !== "PENDING") continue;
    for (const mov of match.movements) {
      if (mov.bankMovementId === movementId) amounts.push(String(mov.amount));
    }
  }
  return sumTreasuryMoney(amounts);
}

describe("CASH-SUPPORT-P0-CONCURRENCY-001", () => {
  it("dois aceites concorrentes (7.000 + 6.000) não estouram movimento de 10.000", async () => {
    const { service, matchStore } = await createHarness("10000.00");

    const results = await Promise.allSettled([
      service.accept(actor, acceptInput("7000.00", "title-A") as never),
      service.accept(actor, acceptInput("6000.00", "title-B") as never),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    assert.equal(ok.length, 1, "exatamente um aceite deve vencer");
    assert.equal(failed.length, 1, "o outro deve ser rejeitado");

    const rejection = (failed[0] as PromiseRejectedResult).reason;
    assert.ok(
      rejection instanceof TreasuryDomainError,
      "rejeição deve ser erro de domínio controlado"
    );

    const total = totalAllocatedToMovement(matchStore, "mov-1");
    assert.equal(total, "7000.00", "só a alocação vencedora pode estar gravada");

    const movement = matchStore.movements.find((m) => m.id === "mov-1")!;
    assert.equal(movement.reconciledAmount, "7000.00");
    assert.equal(movement.reconciliationStatus, "PARTIAL");
  });

  it("execução repetida é determinística (10 rodadas)", async () => {
    for (let round = 0; round < 10; round += 1) {
      const { service, matchStore } = await createHarness("10000.00");
      await Promise.allSettled([
        service.accept(actor, acceptInput("7000.00", "title-A") as never),
        service.accept(actor, acceptInput("6000.00", "title-B") as never),
      ]);
      const total = totalAllocatedToMovement(matchStore, "mov-1");
      assert.ok(
        Number(total) <= 10000,
        `rodada ${round}: total ${total} excedeu a capacidade`
      );
    }
  });

  it("três aceites concorrentes nunca ultrapassam a capacidade", async () => {
    const { service, matchStore } = await createHarness("1000.00");

    await Promise.allSettled([
      service.accept(actor, acceptInput("600.00", "t-1") as never),
      service.accept(actor, acceptInput("600.00", "t-2") as never),
      service.accept(actor, acceptInput("600.00", "t-3") as never),
    ]);

    const total = totalAllocatedToMovement(matchStore, "mov-1");
    assert.equal(total, "600.00", "apenas um aceite cabe em 1.000");
  });

  it("aceites sequenciais consomem a capacidade até esgotar", async () => {
    const { service, matchStore } = await createHarness("1000.00");

    await service.accept(actor, acceptInput("400.00", "t-1") as never);
    await service.accept(actor, acceptInput("600.00", "t-2") as never);

    const movement = matchStore.movements.find((m) => m.id === "mov-1")!;
    assert.equal(movement.reconciledAmount, "1000.00");
    assert.equal(movement.reconciliationStatus, "MATCHED");

    await assert.rejects(
      () => service.accept(actor, acceptInput("0.01", "t-3") as never),
      (err: unknown) => err instanceof TreasuryDomainError,
      "movimento integralmente conciliado deve rejeitar nova alocação"
    );
  });

  it("mesmo movimento repetido na requisição é agregado, não sobrescrito", async () => {
    const { service, matchStore } = await createHarness("1000.00");

    // Duas pernas de 600 sobre o MESMO movimento: isoladamente cada uma cabe,
    // somadas estouram. Antes da correção ambas passavam e a gravação
    // sobrescrevia, deixando reconciledAmount em 600 com 1.200 alocados.
    await assert.rejects(
      () =>
        service.accept(actor, {
          companyCode: "EMP1",
          accountId: "acc-1",
          matchedCivilDate: "2026-07-20",
          justification: "Duas pernas mesmo movimento",
          movements: [
            { bankMovementId: "mov-1", amount: "600.00" },
            { bankMovementId: "mov-1", amount: "600.00" },
          ],
          allocations: [
            {
              kind: "TITLE",
              amount: "1200.00",
              memo: null,
              nomusSide: "AR",
              officialTitleId: "title-X",
              nomusExternalId: 2001,
              openBalance: "1200.00",
              transferId: null,
              transferGroupId: null,
              ledgerEntryId: null,
              differenceCode: null,
            },
          ],
        } as never),
      (err: unknown) => err instanceof TreasuryDomainError
    );

    const movement = matchStore.movements.find((m) => m.id === "mov-1")!;
    assert.equal(movement.reconciledAmount, "0.00", "nada pode ter sido gravado");
    assert.equal(totalAllocatedToMovement(matchStore, "mov-1"), "0.00");
  });

  it("falha na validação não deixa gravação parcial", async () => {
    const { service, matchStore } = await createHarness("100.00");

    await assert.rejects(
      () => service.accept(actor, acceptInput("500.00", "t-big") as never),
      (err: unknown) => err instanceof TreasuryDomainError
    );

    assert.equal(matchStore.matches.length, 0, "nenhum match gravado");
    const movement = matchStore.movements.find((m) => m.id === "mov-1")!;
    assert.equal(movement.reconciledAmount, "0.00");
    assert.equal(movement.reconciliationStatus, "PENDING");
  });
});
