/**
 * RED (TDD) — universo canônico de contas do CONSOLIDADO.
 *
 * Trava o contrato de `deriveTreasuryMembershipFromAccountFields` (fallback
 * derivado por campos da conta) e de `loadTreasuryConsolidatedAccountUniverse`
 * (carregador com no máximo 2 consultas totais — contas + memberships, nunca
 * uma por conta). Ver src/lib/treasury/services/treasuryConsolidatedAccountUniverse.server.ts
 * para os tipos/assinaturas de referência.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  deriveTreasuryMembershipFromAccountFields,
  loadTreasuryConsolidatedAccountUniverse,
} from "./treasuryConsolidatedAccountUniverse.server.js";
import type { TreasuryConsolidatedAccountFieldsForMembership } from "./treasuryConsolidatedAccountUniverse.server.js";

type FakeAccountRow = {
  id: string;
  companyCode: string | null;
  name: string;
  includeInConsolidated: boolean;
  isActive: boolean;
  createdAt: Date;
  deactivatedAt: Date | null;
};

type FakeMembershipRow = {
  id: string;
  accountId: string;
  validFrom: string;
  validUntil: string | null;
  reason: string;
  createdByUserId: string | null;
  createdAt: Date;
  closedAt: Date | null;
  closedByUserId: string | null;
};

function accountFixture(id: string, companyCode: string): FakeAccountRow {
  return {
    id,
    companyCode,
    name: `Conta ${id}`,
    includeInConsolidated: true,
    isActive: true,
    createdAt: new Date("2026-01-01T12:00:00Z"),
    deactivatedAt: null,
  };
}

function fakeMembershipRow(
  accountId: string,
  validFrom: string,
  validUntil: string | null
): FakeMembershipRow {
  return {
    id: `mem-${accountId}-${validFrom}`,
    accountId,
    validFrom,
    validUntil,
    reason: "BOOTSTRAP",
    createdByUserId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    closedAt: null,
    closedByUserId: null,
  };
}

function fakePrisma(accounts: FakeAccountRow[], memberships: FakeMembershipRow[]) {
  const calls = { account: 0, membership: 0 };
  const prisma = {
    treasuryFinancialAccount: {
      findMany: async (_args: unknown) => {
        calls.account += 1;
        return accounts;
      },
    },
    treasuryConsolidatedAccountMembership: {
      findMany: async (_args: unknown) => {
        calls.membership += 1;
        return memberships;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, calls };
}

const DEFAULT_RANGE = { fromCivilDate: "2026-01-01", toCivilDate: "2026-12-31" };

describe("deriveTreasuryMembershipFromAccountFields", () => {
  it("includeInConsolidated=false → null (nunca fez parte do consolidado, até onde os campos permitem saber)", () => {
    const account: TreasuryConsolidatedAccountFieldsForMembership = {
      id: "acc-out",
      includeInConsolidated: false,
      isActive: true,
      createdAt: new Date("2026-01-01T12:00:00Z"),
      deactivatedAt: null,
    };

    assert.equal(deriveTreasuryMembershipFromAccountFields(account), null);
  });

  it("conta ativa: validFrom = dia civil SP de createdAt (21:00 SP vira o dia seguinte em UTC), validUntil null", () => {
    // 2026-08-25T02:30:00.000Z = 2026-08-24 23:30 America/Sao_Paulo (UTC-3)
    const account: TreasuryConsolidatedAccountFieldsForMembership = {
      id: "acc-active",
      includeInConsolidated: true,
      isActive: true,
      createdAt: new Date("2026-08-25T02:30:00.000Z"),
      deactivatedAt: null,
    };

    assert.deepEqual(deriveTreasuryMembershipFromAccountFields(account), {
      validFrom: "2026-08-24",
      validUntil: null,
    });
  });

  it("conta desativada: validFrom/validUntil = dia civil SP de createdAt/deactivatedAt", () => {
    // createdAt 2026-01-10T12:00:00Z = 2026-01-10 09:00 SP
    // deactivatedAt 2026-09-02T01:00:00.000Z = 2026-09-01 22:00 SP
    const account: TreasuryConsolidatedAccountFieldsForMembership = {
      id: "acc-deactivated",
      includeInConsolidated: true,
      isActive: false,
      createdAt: new Date("2026-01-10T12:00:00Z"),
      deactivatedAt: new Date("2026-09-02T01:00:00.000Z"),
    };

    assert.deepEqual(deriveTreasuryMembershipFromAccountFields(account), {
      validFrom: "2026-01-10",
      validUntil: "2026-09-01",
    });
  });
});

describe("loadTreasuryConsolidatedAccountUniverse", () => {
  it("conta com 1+ linhas na tabela de membership usa essas linhas (membershipSource TABLE)", async () => {
    const { prisma } = fakePrisma(
      [
        {
          id: "acc-table",
          companyCode: "KOPPETEL",
          name: "Banco Tabela",
          includeInConsolidated: true,
          isActive: true,
          createdAt: new Date("2026-01-01T12:00:00Z"),
          deactivatedAt: null,
        },
      ],
      [fakeMembershipRow("acc-table", "2026-01-01", null)]
    );

    const universe = await loadTreasuryConsolidatedAccountUniverse(prisma, DEFAULT_RANGE);

    assert.equal(universe.accounts.length, 1);
    const [entry] = universe.accounts;
    assert.equal(entry.accountId, "acc-table");
    assert.equal(entry.membershipSource, "TABLE");
    assert.deepEqual(entry.memberships, [{ validFrom: "2026-01-01", validUntil: null }]);
  });

  it("conta sem nenhuma linha de membership cai no fallback derivado (membershipSource DERIVED) e gera warning", async () => {
    const { prisma } = fakePrisma(
      [
        {
          id: "acc-derived",
          companyCode: "LAZARIOS",
          name: "Banco Derivado",
          includeInConsolidated: true,
          isActive: true,
          createdAt: new Date("2026-02-01T12:00:00Z"),
          deactivatedAt: null,
        },
      ],
      []
    );

    const universe = await loadTreasuryConsolidatedAccountUniverse(prisma, DEFAULT_RANGE);

    assert.equal(universe.accounts.length, 1);
    const [entry] = universe.accounts;
    assert.equal(entry.membershipSource, "DERIVED");
    assert.equal(entry.memberships.length, 1);
    assert.match(entry.memberships[0].validFrom, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(entry.memberships[0].validUntil, null);

    const warning = universe.warnings.find(
      (w) => w.code === "MEMBERSHIP_DERIVED_FROM_ACCOUNT_FIELDS"
    );
    assert.ok(warning, "esperava warning MEMBERSHIP_DERIVED_FROM_ACCOUNT_FIELDS em universe.warnings");
    assert.match(warning!.message, /acc-derived/);
  });

  it("conta com companyCode vazio/null é excluída do universo", async () => {
    const { prisma } = fakePrisma(
      [
        {
          id: "acc-empty",
          companyCode: "",
          name: "Banco Sem Empresa",
          includeInConsolidated: true,
          isActive: true,
          createdAt: new Date("2026-01-01T12:00:00Z"),
          deactivatedAt: null,
        },
        {
          id: "acc-null",
          companyCode: null,
          name: "Banco Empresa Nula",
          includeInConsolidated: true,
          isActive: true,
          createdAt: new Date("2026-01-01T12:00:00Z"),
          deactivatedAt: null,
        },
        {
          id: "acc-valid",
          companyCode: "KOPPETEL",
          name: "Banco Válido",
          includeInConsolidated: true,
          isActive: true,
          createdAt: new Date("2026-01-01T12:00:00Z"),
          deactivatedAt: null,
        },
      ],
      []
    );

    const universe = await loadTreasuryConsolidatedAccountUniverse(prisma, DEFAULT_RANGE);

    assert.deepEqual(
      universe.accounts.map((a) => a.accountId),
      ["acc-valid"]
    );
    assert.deepEqual(universe.companyCodes, ["KOPPETEL"]);
  });

  it("companyCodes lista os códigos distintos presentes, sem duplicar, em ordem estável", async () => {
    const { prisma } = fakePrisma(
      [
        accountFixture("acc-1", "KOPPETEL"),
        accountFixture("acc-2", "LAZARIOS"),
        accountFixture("acc-3", "KOPPETEL"),
      ],
      []
    );

    const universe = await loadTreasuryConsolidatedAccountUniverse(prisma, DEFAULT_RANGE);

    assert.deepEqual(universe.companyCodes, ["KOPPETEL", "LAZARIOS"]);
  });

  it("conta inativa com deactivatedAt anterior ao range.fromCivilDate pedido ainda aparece no universo", async () => {
    const { prisma } = fakePrisma(
      [
        {
          id: "acc-old",
          companyCode: "KOPPETEL",
          name: "Conta Antiga Desativada",
          includeInConsolidated: true,
          isActive: false,
          createdAt: new Date("2024-01-01T12:00:00Z"),
          deactivatedAt: new Date("2024-06-01T12:00:00Z"),
        },
      ],
      []
    );

    const universe = await loadTreasuryConsolidatedAccountUniverse(prisma, {
      fromCivilDate: "2026-01-01",
      toCivilDate: "2026-12-31",
    });

    assert.ok(
      universe.accounts.some((a) => a.accountId === "acc-old"),
      "conta inativa desde antes do range pedido não deveria ser excluída do universo (precisa resolver dias passados)"
    );
  });

  it("no máximo 2 chamadas totais ao fakePrisma (contas + memberships) — nunca uma consulta por conta", async () => {
    const { prisma, calls } = fakePrisma(
      [
        accountFixture("acc-1", "KOPPETEL"),
        accountFixture("acc-2", "KOPPETEL"),
        accountFixture("acc-3", "LAZARIOS"),
        accountFixture("acc-4", "LAZARIOS"),
        accountFixture("acc-5", "KOPPETEL"),
      ],
      [fakeMembershipRow("acc-1", "2026-01-01", null)]
    );

    await loadTreasuryConsolidatedAccountUniverse(prisma, DEFAULT_RANGE);

    assert.equal(calls.account, 1);
    assert.equal(calls.membership, 1);
    assert.ok(calls.account + calls.membership <= 2);
  });
});
