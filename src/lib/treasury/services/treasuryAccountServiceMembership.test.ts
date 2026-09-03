/**
 * TDD (RED) — `createTreasuryAccountService` deve manter a membership
 * temporal do consolidado (`TreasuryConsolidatedMembershipRepository`)
 * sempre que `includeInConsolidated`, criação, desativação ou reativação
 * de conta acontecem.
 *
 * HOJE o serviço recebe `deps.membershipRepository` mas nunca o chama
 * (ver `void membershipRepo;` em treasuryAccountService.server.ts) — este
 * arquivo deve falhar mostrando que NENHUM intervalo é aberto/fechado
 * ainda. Quando a implementação for feita, estes testes viram GREEN sem
 * alteração.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { todayTreasuryCivilDateInSaoPaulo } from "../contracts/treasuryCivilDate.js";
import type { TreasuryAccountActor } from "../domain/treasuryAccountRules.js";
import {
  createEmptyTreasuryAccountMemoryStore,
  createMemoryTreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.memory.js";
import {
  createEmptyTreasuryConsolidatedMembershipMemoryStore,
  createMemoryTreasuryConsolidatedMembershipRepository,
} from "../repositories/treasuryConsolidatedMembershipRepository.memory.js";
import { createTreasuryAccountService } from "./treasuryAccountService.server.js";
import type { TreasuryAuditDb } from "./treasuryAuditService.server.js";

const TODAY = todayTreasuryCivilDateInSaoPaulo();

function createServiceHarness() {
  const store = createEmptyTreasuryAccountMemoryStore();
  const repository = createMemoryTreasuryAccountRepository(store);
  const membershipStore = createEmptyTreasuryConsolidatedMembershipMemoryStore();
  const membershipRepository = createMemoryTreasuryConsolidatedMembershipRepository(
    membershipStore
  );

  const fakeTx = {
    treasuryAuditLog: {
      async create(args: { data: Record<string, unknown> }) {
        return { id: `audit-${store.audits.length + 1}`, ...args.data };
      },
    },
  } as unknown as TreasuryAuditDb;

  const service = createTreasuryAccountService({
    prisma: {} as PrismaClient,
    repository,
    membershipRepository,
    runTransaction: async (fn) => fn(fakeTx),
  });

  return { store, membershipStore, membershipRepository, service };
}

const admin: TreasuryAccountActor = {
  userId: "admin-1",
  userName: "Admin",
  role: "ADMIN",
  isSuperAdmin: false,
  canViewAccounts: true,
  canManageAccounts: true,
  sessionId: "sess-a",
  requestId: "req-a",
};

describe("treasuryAccountService — membership temporal do consolidado (RED)", () => {
  it("createAccount com includeInConsolidated=true abre intervalo ACCOUNT_CREATED válido a partir de hoje", async () => {
    const { service, membershipRepository } = createServiceHarness();
    const created = await service.createAccount(admin, {
      companyCode: "LAZARIOS",
      code: "CX01",
      name: "Caixa",
      institutionName: "Banco X",
      accountType: "CASH",
      agencyMasked: "****1",
      accountNumberMasked: "****9999",
      includeInConsolidated: true,
    });

    const rows = await membershipRepository.listByAccountIds([created.id]);
    assert.equal(
      rows.length,
      1,
      "esperado 1 intervalo de membership aberto ao criar conta com includeInConsolidated=true"
    );
    assert.equal(rows[0].validFrom, TODAY);
    assert.equal(rows[0].validUntil, null);
    assert.equal(rows[0].reason, "ACCOUNT_CREATED");
  });

  it("createAccount com includeInConsolidated=false NÃO abre intervalo algum", async () => {
    const { service, membershipRepository } = createServiceHarness();
    const created = await service.createAccount(admin, {
      companyCode: "LAZARIOS",
      code: "CX02",
      name: "Caixa fora do consolidado",
      institutionName: "Banco Y",
      accountType: "CHECKING",
      agencyMasked: "****2",
      accountNumberMasked: "****8888",
      includeInConsolidated: false,
    });

    const rows = await membershipRepository.listByAccountIds([created.id]);
    assert.equal(
      rows.length,
      0,
      "conta criada fora do consolidado não deve abrir intervalo de membership"
    );
  });

  it("setIncludeInConsolidated(false) fecha o intervalo aberto com reason INCLUDE_OFF", async () => {
    const { service, membershipRepository } = createServiceHarness();
    const created = await service.createAccount(admin, {
      companyCode: "LAZARIOS",
      code: "CX03",
      name: "Conta consolidada",
      institutionName: "Banco Z",
      accountType: "CHECKING",
      agencyMasked: "****3",
      accountNumberMasked: "****7777",
      includeInConsolidated: true,
    });

    const updated = await service.setIncludeInConsolidated(admin, created.id, {
      includeInConsolidated: false,
      expectedUpdatedAt: created.updatedAt,
    });
    assert.equal(updated.includeInConsolidated, false);

    const rows = await membershipRepository.listByAccountIds([created.id]);
    assert.equal(
      rows.length,
      1,
      "deve apenas FECHAR o intervalo existente, não abrir um novo"
    );
    assert.equal(rows[0].validUntil, TODAY);
    assert.equal(rows[0].reason, "INCLUDE_OFF");
  });

  it("setIncludeInConsolidated(true) após fechamento abre um NOVO intervalo preservando o histórico", async () => {
    const { service, membershipRepository } = createServiceHarness();
    const created = await service.createAccount(admin, {
      companyCode: "LAZARIOS",
      code: "CX04",
      name: "Conta liga-desliga",
      institutionName: "Banco W",
      accountType: "CHECKING",
      agencyMasked: "****4",
      accountNumberMasked: "****6666",
      includeInConsolidated: true,
    });

    const off = await service.setIncludeInConsolidated(admin, created.id, {
      includeInConsolidated: false,
      expectedUpdatedAt: created.updatedAt,
    });

    const on = await service.setIncludeInConsolidated(admin, created.id, {
      includeInConsolidated: true,
      expectedUpdatedAt: off.updatedAt,
    });
    assert.equal(on.includeInConsolidated, true);

    const rows = await membershipRepository.listByAccountIds([created.id]);
    assert.equal(
      rows.length,
      2,
      "histórico deve preservar o intervalo fechado (INCLUDE_OFF) e somar o novo (INCLUDE_ON)"
    );
    const [first, second] = rows;
    assert.equal(first.validUntil, TODAY);
    assert.equal(first.reason, "INCLUDE_OFF");
    assert.equal(second.validUntil, null);
    assert.equal(second.reason, "INCLUDE_ON");
  });

  it("deactivateAccount fecha o intervalo aberto com reason DEACTIVATED", async () => {
    const { service, membershipRepository } = createServiceHarness();
    const created = await service.createAccount(admin, {
      companyCode: "LAZARIOS",
      code: "CX05",
      name: "Conta a desativar",
      institutionName: "Banco V",
      accountType: "SAVINGS",
      agencyMasked: "****5",
      accountNumberMasked: "****5555",
      includeInConsolidated: true,
    });

    const deactivated = await service.deactivateAccount(admin, created.id, {
      reason: "encerrada",
      expectedUpdatedAt: created.updatedAt,
    });
    assert.equal(deactivated.isActive, false);

    const rows = await membershipRepository.listByAccountIds([created.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].validUntil, TODAY);
    assert.equal(rows[0].reason, "DEACTIVATED");
  });

  it("reactivateAccount reabre intervalo com reason REACTIVATED quando includeInConsolidated=true", async () => {
    const { service, membershipRepository } = createServiceHarness();
    const created = await service.createAccount(admin, {
      companyCode: "LAZARIOS",
      code: "CX06",
      name: "Conta reativação",
      institutionName: "Banco T",
      accountType: "CHECKING",
      agencyMasked: "****6",
      accountNumberMasked: "****4444",
      includeInConsolidated: true,
    });

    const deactivated = await service.deactivateAccount(admin, created.id, {
      reason: "temporário",
      expectedUpdatedAt: created.updatedAt,
    });

    const reactivated = await service.reactivateAccount(admin, created.id, {
      expectedUpdatedAt: deactivated.updatedAt,
    });
    assert.equal(reactivated.isActive, true);
    assert.equal(reactivated.includeInConsolidated, true);

    const rows = await membershipRepository.listByAccountIds([created.id]);
    assert.equal(
      rows.length,
      2,
      "deve fechar por DEACTIVATED e reabrir por REACTIVATED"
    );
    assert.equal(rows[0].reason, "DEACTIVATED");
    assert.equal(rows[0].validUntil, TODAY);
    assert.equal(rows[1].reason, "REACTIVATED");
    assert.equal(rows[1].validUntil, null);
  });

  it("reactivateAccount NÃO reabre intervalo quando includeInConsolidated=false (conta volta ativa, fora do consolidado)", async () => {
    const { service, membershipRepository } = createServiceHarness();
    const created = await service.createAccount(admin, {
      companyCode: "LAZARIOS",
      code: "CX07",
      name: "Conta fora do consolidado",
      institutionName: "Banco S",
      accountType: "CHECKING",
      agencyMasked: "****7",
      accountNumberMasked: "****3333",
      includeInConsolidated: false,
    });

    const deactivated = await service.deactivateAccount(admin, created.id, {
      reason: "temporário",
      expectedUpdatedAt: created.updatedAt,
    });

    const reactivated = await service.reactivateAccount(admin, created.id, {
      expectedUpdatedAt: deactivated.updatedAt,
    });
    assert.equal(reactivated.isActive, true);
    assert.equal(reactivated.includeInConsolidated, false);

    const rows = await membershipRepository.listByAccountIds([created.id]);
    assert.equal(
      rows.length,
      0,
      "conta fora do consolidado não deve ter intervalo algum, nem antes nem depois da reativação"
    );
  });

  it("updateAccount alterando includeInConsolidated true→false fecha o intervalo", async () => {
    const { service, membershipRepository } = createServiceHarness();
    const created = await service.createAccount(admin, {
      companyCode: "LAZARIOS",
      code: "CX08",
      name: "Conta update",
      institutionName: "Banco R",
      accountType: "CHECKING",
      agencyMasked: "****8",
      accountNumberMasked: "****2222",
      includeInConsolidated: true,
    });

    const updated = await service.updateAccount(admin, created.id, {
      expectedUpdatedAt: created.updatedAt,
      includeInConsolidated: false,
      justification: "saiu do consolidado via edição",
    });
    assert.equal(updated.includeInConsolidated, false);

    const rows = await membershipRepository.listByAccountIds([created.id]);
    assert.equal(
      rows.length,
      1,
      "updateAccount alterando includeInConsolidated para false deve fechar o intervalo aberto"
    );
    assert.equal(rows[0].validUntil, TODAY);
    assert.ok(
      rows[0].reason === "INCLUDE_OFF" || rows[0].reason === "MANUAL",
      `reason esperado INCLUDE_OFF (ou MANUAL para trocas via updateAccount); recebido "${rows[0].reason}"`
    );
  });
});
