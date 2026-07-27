import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createEmptyTreasuryAccountMemoryStore,
  createMemoryTreasuryAccountRepository,
} from "./repositories/treasuryAccountRepository.memory.js";
import { createTreasuryAccountService } from "./services/treasuryAccountService.server.js";
import type { TreasuryAuditDb } from "./services/treasuryAuditService.server.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryAccountActor } from "./domain/treasuryAccountRules.js";

function createServiceHarness() {
  const store = createEmptyTreasuryAccountMemoryStore();
  const repository = createMemoryTreasuryAccountRepository(store);
  const audits: Array<Record<string, unknown>> = [];

  const fakeTx = {
    treasuryAuditLog: {
      async create(args: { data: Record<string, unknown> }) {
        const row = { id: `audit-${audits.length + 1}`, ...args.data };
        audits.push(row);
        store.audits.push({
          entityType: String(args.data.entityType),
          entityId: String(args.data.entityId),
          action: String(args.data.action),
        });
        return row;
      },
    },
  } as unknown as TreasuryAuditDb;

  const service = createTreasuryAccountService({
    prisma: {} as PrismaClient,
    repository,
    runTransaction: async (fn) => fn(fakeTx),
  });

  return { store, repository, audits, service };
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

const viewer: TreasuryAccountActor = {
  userId: "viewer-1",
  userName: "Viewer",
  role: "VIEWER",
  isSuperAdmin: false,
  canViewAccounts: true,
  canManageAccounts: false,
  sessionId: "sess-v",
  requestId: "req-v",
};

const superAdmin: TreasuryAccountActor = {
  userId: "sa-1",
  role: "SUPER_ADMIN",
  isSuperAdmin: true,
  canViewAccounts: true,
  canManageAccounts: true,
};

describe("treasuryAccountService — integração (memory)", () => {
  it("cria, lista, consulta e audita criação", async () => {
    const { service, audits } = createServiceHarness();
    const created = await service.createAccount(admin, {
      companyCode: "LAZARIOS",
      code: "CX01",
      name: "Caixa",
      institutionName: "Banco X",
      accountType: "CASH",
      agencyMasked: "****1",
      accountNumberMasked: "****9999",
      sortOrder: 10,
    });
    assert.equal(created.code, "CX01");
    assert.equal(created.agencyMasked, "****1");
    assert.ok(audits.some((a) => a.action === "CREATE"));

    const listed = await service.listAccessibleAccounts(admin, {
      companyCode: "LAZARIOS",
      sortBy: "sortOrder",
    });
    assert.equal(listed.rows.length, 1);
    assert.equal(listed.sortBy, "sortOrder");

    const got = await service.getAccount(admin, created.id);
    assert.equal(got.id, created.id);
  });

  it("atualiza com optimistic lock e audita alteração", async () => {
    const { service, audits } = createServiceHarness();
    const created = await service.createAccount(admin, {
      companyCode: "LAZARIOS",
      code: "CX02",
      name: "Caixa 2",
      institutionName: "Banco Y",
      accountType: "CHECKING",
      agencyMasked: "****2",
      accountNumberMasked: "****8888",
    });
    const updated = await service.updateAccount(admin, created.id, {
      expectedUpdatedAt: created.updatedAt,
      name: "Caixa 2A",
      justification: "renomeação",
    });
    assert.equal(updated.name, "Caixa 2A");
    assert.ok(audits.some((a) => a.action === "UPDATE"));

    await assert.rejects(
      () =>
        service.updateAccount(admin, created.id, {
          expectedUpdatedAt: created.updatedAt,
          name: "stale",
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
  });

  it("configura saldo mínimo, liquidez, consolidado e ordem", async () => {
    const { service } = createServiceHarness();
    let acc = await service.createAccount(admin, {
      companyCode: "LAZARIOS",
      code: "CX03",
      name: "Conta cfg",
      institutionName: "Banco Z",
      accountType: "CHECKING",
      agencyMasked: "****3",
      accountNumberMasked: "****7777",
    });
    acc = await service.setMinimumBalance(admin, acc.id, {
      minimumBalance: "1500.5",
      expectedUpdatedAt: acc.updatedAt,
    });
    assert.equal(acc.minimumBalance, "1500.50");
    acc = await service.setLiquidity(admin, acc.id, {
      liquidity: "D_PLUS_1",
      expectedUpdatedAt: acc.updatedAt,
    });
    assert.equal(acc.liquidity, "D_PLUS_1");
    acc = await service.setIncludeInConsolidated(admin, acc.id, {
      includeInConsolidated: false,
      expectedUpdatedAt: acc.updatedAt,
    });
    assert.equal(acc.includeInConsolidated, false);
    acc = await service.setSortOrder(admin, acc.id, {
      sortOrder: 5,
      expectedUpdatedAt: acc.updatedAt,
    });
    assert.equal(acc.sortOrder, 5);
  });

  it("desativa e reativa; impede exclusão com histórico", async () => {
    const { service, store } = createServiceHarness();
    let acc = await service.createAccount(admin, {
      companyCode: "LAZARIOS",
      code: "CX04",
      name: "Conta life",
      institutionName: "Banco W",
      accountType: "SAVINGS",
      agencyMasked: "****4",
      accountNumberMasked: "****6666",
    });
    acc = await service.deactivateAccount(admin, acc.id, {
      reason: "encerrada",
      expectedUpdatedAt: acc.updatedAt,
    });
    assert.equal(acc.isActive, false);
    acc = await service.reactivateAccount(admin, acc.id, {
      expectedUpdatedAt: acc.updatedAt,
    });
    assert.equal(acc.isActive, true);

    store.snapshots.push({ accountId: acc.id });
    await assert.rejects(
      () => service.deleteAccount(acc.id),
      (err: unknown) =>
        err instanceof TreasuryDomainError && /histórico/.test((err as Error).message)
    );
  });

  it("não lista/consulta conta sem autorização; mascara para VIEW", async () => {
    const { service } = createServiceHarness();
    const created = await service.createAccount(admin, {
      companyCode: "LAZARIOS",
      code: "CX05",
      name: "Privada",
      institutionName: "Banco V",
      accountType: "CHECKING",
      agencyMasked: "****55",
      accountNumberMasked: "****5555",
    });

    await assert.rejects(
      () => service.getAccount(viewer, created.id),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );

    await service.grantAccountAccess(admin, created.id, {
      userId: viewer.userId,
      accessLevel: "VIEW",
    });
    const listed = await service.listAccessibleAccounts(viewer, {
      companyCode: "LAZARIOS",
    });
    assert.equal(listed.rows.length, 1);
    // VIEW redige mais o identificador armazenado
    assert.notEqual(listed.rows[0].accountNumberMasked, "****5555");
    assert.match(listed.rows[0].accountNumberMasked, /\*\*55$/);

    const asSuper = await service.getAccount(superAdmin, created.id);
    assert.equal(asSuper.accountNumberMasked, "****5555");
  });

  it("gerencia acesso por usuário e valida origem≠destino", async () => {
    const { service, audits } = createServiceHarness();
    const created = await service.createAccount(admin, {
      companyCode: "LAZARIOS",
      code: "CX06",
      name: "ACL",
      institutionName: "Banco U",
      accountType: "CHECKING",
      agencyMasked: "****6",
      accountNumberMasked: "****4444",
    });
    const grant = await service.grantAccountAccess(admin, created.id, {
      userId: viewer.userId,
      accessLevel: "OPERATE",
      canMutateBalance: true,
    });
    assert.equal(grant.accessLevel, "OPERATE");
    assert.ok(audits.some((a) => a.action === "ACCESS_GRANT"));

    const revoked = await service.revokeAccountAccess(
      admin,
      created.id,
      viewer.userId
    );
    assert.equal(revoked.isActive, false);
    assert.ok(audits.some((a) => a.action === "ACCESS_REVOKE"));

    assert.throws(
      () => service.assertTransferAccountsDistinct(created.id, created.id),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "VALIDATION_ERROR"
    );
  });
});
