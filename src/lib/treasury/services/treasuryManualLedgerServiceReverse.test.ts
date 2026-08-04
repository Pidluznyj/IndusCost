/**
 * Reverter lançamento manual precisa ser SUPER_ADMIN — o registro some de
 * todos os cálculos (status vira REVERSED, todo consumidor filtra
 * status:"ACTIVE"), então essa ação é mais sensível que criar/gerenciar.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTreasuryManualLedgerService } from "./treasuryManualLedgerService.server.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryLedgerEntryRepository } from "../repositories/treasuryLedgerEntryRepository.server.js";
import type { TreasuryAccountRepository } from "../repositories/treasuryAccountRepository.server.js";

function actorWith(overrides: { isSuperAdmin: boolean; canManageManualEntries?: boolean }) {
  return {
    userId: "user-1",
    userName: "Teste",
    role: overrides.isSuperAdmin ? "SUPER_ADMIN" : "ADMIN",
    sessionId: null,
    requestId: null,
    isSuperAdmin: overrides.isSuperAdmin,
    canViewManualEntries: true,
    canManageManualEntries: overrides.canManageManualEntries ?? true,
    canViewAccounts: true,
    canManageAccounts: true,
  };
}

/** Fake que falha o teste se qualquer método for chamado — prova que o guard corta antes de tocar o banco. */
function shouldNotBeCalledLedgerRepo(): TreasuryLedgerEntryRepository {
  const fail = (method: string) => () => {
    throw new Error(`${method} não deveria ser chamado — o guard de SUPER_ADMIN deveria ter cortado antes.`);
  };
  return {
    findById: fail("findById"),
    list: fail("list"),
    create: fail("create"),
    markReversed: fail("markReversed"),
  } as unknown as TreasuryLedgerEntryRepository;
}

function accountRepoStub(): TreasuryAccountRepository {
  return {
    findById: async () => null,
    findAccess: async () => null,
  } as unknown as TreasuryAccountRepository;
}

describe("treasuryManualLedgerService — reverter exige SUPER_ADMIN", () => {
  it("ator com manageManualEntries mas sem SUPER_ADMIN é barrado (FORBIDDEN), sem tocar no repositório", async () => {
    const service = createTreasuryManualLedgerService({
      ledgerRepository: shouldNotBeCalledLedgerRepo(),
      accountRepository: accountRepoStub(),
    });

    await assert.rejects(
      () =>
        service.reverse(
          actorWith({ isSuperAdmin: false, canManageManualEntries: true }),
          "led-1",
          { expectedVersion: 1, justification: "teste" }
        ),
      (err: unknown) => {
        assert.ok(err instanceof TreasuryDomainError);
        assert.equal(err.code, "FORBIDDEN");
        assert.match(err.message, /SUPER_ADMIN/);
        return true;
      }
    );
  });

  it("ator sem nenhuma permissão e sem SUPER_ADMIN também é barrado (FORBIDDEN)", async () => {
    const service = createTreasuryManualLedgerService({
      ledgerRepository: shouldNotBeCalledLedgerRepo(),
      accountRepository: accountRepoStub(),
    });

    await assert.rejects(
      () =>
        service.reverse(
          actorWith({ isSuperAdmin: false, canManageManualEntries: false }),
          "led-1",
          { expectedVersion: 1, justification: "teste" }
        ),
      (err: unknown) => err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });

  it("SUPER_ADMIN passa do guard (erro seguinte é NOT_FOUND do lançamento, não FORBIDDEN)", async () => {
    const service = createTreasuryManualLedgerService({
      ledgerRepository: {
        findById: async () => null,
        list: async () => ({ total: 0, rows: [] }),
        create: async () => {
          throw new Error("não deveria chegar aqui neste teste");
        },
        markReversed: async () => {
          throw new Error("não deveria chegar aqui neste teste");
        },
      } as unknown as TreasuryLedgerEntryRepository,
      accountRepository: accountRepoStub(),
    });

    await assert.rejects(
      () =>
        service.reverse(
          actorWith({ isSuperAdmin: true, canManageManualEntries: false }),
          "led-inexistente",
          { expectedVersion: 1, justification: "teste" }
        ),
      (err: unknown) => {
        assert.ok(err instanceof TreasuryDomainError);
        // Passou do guard SUPER_ADMIN — o próximo erro é o lançamento não
        // encontrado, prova de que o gate específico de reverse não bloqueou.
        assert.equal(err.code, "NOT_FOUND");
        return true;
      }
    );
  });

  it("create() continua exigindo só manageManualEntries (não fica mais restrito por engano)", async () => {
    const service = createTreasuryManualLedgerService({
      ledgerRepository: {
        findById: async () => null,
        list: async () => ({ total: 0, rows: [] }),
        create: async () => {
          throw new Error("não deveria chegar aqui — o teste para antes, na checagem de conta.");
        },
        markReversed: async () => {
          throw new Error("não usado neste teste");
        },
      } as unknown as TreasuryLedgerEntryRepository,
      accountRepository: accountRepoStub(),
    });

    await assert.rejects(
      () =>
        service.create(actorWith({ isSuperAdmin: false, canManageManualEntries: true }), {
          accountId: "acc-1",
          civilDate: "2026-01-01",
          amount: "10.00",
          direction: "DEBIT",
          nature: "MANUAL",
          memo: null,
          counterpartRef: null,
        }),
      (err: unknown) => {
        assert.ok(err instanceof TreasuryDomainError);
        // Não é FORBIDDEN de permissão — create() segue liberado pra quem
        // tem manageManualEntries; o erro aqui é conta não encontrada (stub).
        assert.notEqual(err.code, "FORBIDDEN");
        return true;
      }
    );
  });
});
