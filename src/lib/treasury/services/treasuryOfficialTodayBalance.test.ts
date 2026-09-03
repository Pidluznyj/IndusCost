/**
 * RED — prova o defeito real de `loadTreasuryOfficialTodayBalance`
 * (Tesouraria › Caixa, card "Caixa hoje" / modal de saldo do dia).
 *
 * Defeito: quando só um SUBCONJUNTO das contas do consolidado informou saldo
 * (via rotina "Saldos do Dia" ou via posição mais recente de qualquer
 * origem), a função soma o subconjunto e devolve esse SUBTOTAL como se fosse
 * o saldo consolidado da empresa inteira — casos reais observados em
 * produção em 02/09 e 03/09/2026 (2/3 e 1/3 contas, respectivamente).
 *
 * Este arquivo testa a função REAL (`treasuryOfficialTodayBalance.server.ts`),
 * não um stub. Os testes (1), (2) e (4) fixam o comportamento CORRETO
 * (`amount: null` quando a cobertura é parcial, e um campo novo
 * `latestPosition` só informativo) que a função ainda NÃO implementa — por
 * isso FALHAM contra o código atual. Os testes (3), (5), (6) e (7) cobrem
 * caminhos já corretos hoje (cobertura completa / exclusão de conta fora do
 * consolidado / ausência de contas elegíveis) e devem PASSAR.
 *
 * Rodar com:
 *   node --import tsx --test src/lib/treasury/services/treasuryOfficialTodayBalance.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { loadTreasuryOfficialTodayBalance } from "./treasuryOfficialTodayBalance.server.js";
import { todayTreasuryCivilDateInSaoPaulo } from "../contracts/treasuryCivilDate.js";
import { buildTreasuryDailyClosingBankSnapshotIdempotencyKey } from "../domain/treasuryDailyAccountRoutineRules.js";

// ── Data civil de hoje — o teste não pode depender de uma data fixa ─────────

const TODAY = todayTreasuryCivilDateInSaoPaulo();

function yesterdayOf(civilDate: string): string {
  const [y, m, d] = civilDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

const YESTERDAY = yesterdayOf(TODAY);

function routineKey(civilDate: string): string {
  return buildTreasuryDailyClosingBankSnapshotIdempotencyKey({ civilDate, version: 1 });
}

// ── Contas reais do caso (KOPPETEL/LAZARIOS) ────────────────────────────────

type FakeAccount = {
  id: string;
  companyCode: string;
  isActive: boolean;
  includeInConsolidated: boolean;
};

const ACC_VK: FakeAccount = {
  id: "acc-vk",
  companyCode: "KOPPETEL",
  isActive: true,
  includeInConsolidated: true,
};
const ACC_VL: FakeAccount = {
  id: "acc-vl",
  companyCode: "LAZARIOS",
  isActive: true,
  includeInConsolidated: true,
};
const ACC_SK: FakeAccount = {
  id: "acc-sk",
  companyCode: "KOPPETEL",
  isActive: true,
  includeInConsolidated: true,
};

// ── fakePrisma ───────────────────────────────────────────────────────────

type FakeSnapshotRow = {
  accountId: string;
  idempotencyKey: string;
  availableBalance: string | number;
  referenceAt?: Date;
  createdAt: Date;
};

function applyOrderBy(rows: FakeSnapshotRow[], orderBy: unknown): FakeSnapshotRow[] {
  const specs = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Array<
    Record<string, "asc" | "desc">
  >;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const spec of specs) {
      const entry = Object.entries(spec)[0];
      if (!entry) continue;
      const [key, dir] = entry;
      const av = (a as unknown as Record<string, Date | undefined>)[key];
      const bv = (b as unknown as Record<string, Date | undefined>)[key];
      const at = av instanceof Date ? av.getTime() : 0;
      const bt = bv instanceof Date ? bv.getTime() : 0;
      if (at === bt) continue;
      const cmp = at > bt ? 1 : -1;
      return dir === "desc" ? -cmp : cmp;
    }
    return 0;
  });
  return sorted;
}

/**
 * Simula os três formatos de consulta que a função real faz em
 * `treasuryBalanceSnapshot.findMany`, distinguindo pelo `where` recebido —
 * exatamente como o Prisma real receberia:
 *   - `idempotencyKey.startsWith` com "daily-closing-bank:" → rotina "Saldos do Dia".
 *   - `referenceAt` presente → snapshot MANUAL genérico (tela "Saldo") do dia.
 *   - nenhum dos dois → posição mais recente por conta, de qualquer origem.
 */
function makeFakePrisma(opts: {
  accounts: FakeAccount[];
  routineSnapshots?: FakeSnapshotRow[];
  genericSnapshots?: FakeSnapshotRow[];
  latestSnapshots?: FakeSnapshotRow[];
}): PrismaClient {
  const routineSnapshots = opts.routineSnapshots ?? [];
  const genericSnapshots = opts.genericSnapshots ?? [];
  const latestSnapshots = opts.latestSnapshots ?? [];

  return {
    treasuryFinancialAccount: {
      findMany: async (args: {
        where?: {
          isActive?: boolean;
          includeInConsolidated?: boolean;
          companyCode?: { not?: string };
        };
      }) => {
        const where = args.where ?? {};
        return opts.accounts.filter((a) => {
          if (where.isActive !== undefined && a.isActive !== where.isActive) return false;
          if (
            where.includeInConsolidated !== undefined &&
            a.includeInConsolidated !== where.includeInConsolidated
          )
            return false;
          if (
            where.companyCode?.not !== undefined &&
            a.companyCode === where.companyCode.not
          )
            return false;
          return true;
        });
      },
    },
    treasuryDailyClosing: {
      // Sem fechamento formal (CLOSED) em nenhum cenário desta suíte.
      findFirst: async () => null,
    },
    treasuryBalanceSnapshot: {
      findMany: async (args: {
        where?: {
          accountId?: { in?: string[] };
          idempotencyKey?: { startsWith?: string };
          referenceAt?: unknown;
        };
        orderBy?: unknown;
      }) => {
        const where = args.where ?? {};
        let rows: FakeSnapshotRow[];
        if (where.idempotencyKey?.startsWith?.includes("daily-closing-bank:")) {
          rows = routineSnapshots;
        } else if (where.referenceAt !== undefined) {
          rows = genericSnapshots;
        } else {
          rows = latestSnapshots;
        }
        const allow = where.accountId?.in;
        if (Array.isArray(allow)) {
          const set = new Set(allow);
          rows = rows.filter((r) => set.has(r.accountId));
        }
        return applyOrderBy(rows, args.orderBy);
      },
    },
  } as unknown as PrismaClient;
}

// ── (1)/(2) Cobertura parcial NUNCA vira saldo consolidado ─────────────────

describe("loadTreasuryOfficialTodayBalance — subtotal parcial NUNCA vira saldo consolidado (defeito real)", () => {
  it("(1) 3 contas esperadas, só 2 informaram via rotina 'Saldos do Dia' hoje (caso real 02/09) → amount deve ser null", async () => {
    const prisma = makeFakePrisma({
      accounts: [ACC_VK, ACC_VL, ACC_SK],
      routineSnapshots: [
        {
          accountId: "acc-vk",
          idempotencyKey: routineKey(TODAY),
          availableBalance: "125699.11",
          createdAt: new Date(`${TODAY}T10:02:00.000Z`),
        },
        {
          accountId: "acc-vl",
          idempotencyKey: routineKey(TODAY),
          availableBalance: "1844.22",
          createdAt: new Date(`${TODAY}T10:01:00.000Z`),
        },
      ],
    });

    const result = await loadTreasuryOfficialTodayBalance(prisma, TODAY);

    assert.equal(result.accountsCovered, 2);
    assert.equal(result.accountsWithoutBalance, 1);
    assert.equal(
      result.amount,
      null,
      "defeito: subtotal parcial (125699.11 + 1844.22 = 127543.33, só 2/3 contas) não pode virar o saldo consolidado da empresa inteira"
    );
  });

  it("(2) só 1 conta (Sisprime) informou via rotina hoje (caso real 03/09) → amount deve ser null", async () => {
    const prisma = makeFakePrisma({
      accounts: [ACC_VK, ACC_VL, ACC_SK],
      routineSnapshots: [
        {
          accountId: "acc-sk",
          idempotencyKey: routineKey(TODAY),
          availableBalance: "271077.10",
          createdAt: new Date(`${TODAY}T10:00:00.000Z`),
        },
      ],
    });

    const result = await loadTreasuryOfficialTodayBalance(prisma, TODAY);

    assert.equal(result.accountsCovered, 1);
    assert.equal(
      result.amount,
      null,
      "defeito: saldo de UMA conta (271077.10) virou o saldo consolidado das 3 contas"
    );
  });
});

// ── (3) Cobertura completa via rotina já funciona hoje ──────────────────────

describe("loadTreasuryOfficialTodayBalance — cobertura completa (rotina) já funciona corretamente hoje", () => {
  it("(3) 3/3 contas informaram via rotina 'Saldos do Dia' hoje → amount = soma total, source DAILY_ROUTINE_SNAPSHOT", async () => {
    const prisma = makeFakePrisma({
      accounts: [ACC_VK, ACC_VL, ACC_SK],
      routineSnapshots: [
        {
          accountId: "acc-vk",
          idempotencyKey: routineKey(TODAY),
          availableBalance: "125699.11",
          createdAt: new Date(`${TODAY}T10:02:00.000Z`),
        },
        {
          accountId: "acc-vl",
          idempotencyKey: routineKey(TODAY),
          availableBalance: "1844.22",
          createdAt: new Date(`${TODAY}T10:01:00.000Z`),
        },
        {
          accountId: "acc-sk",
          idempotencyKey: routineKey(TODAY),
          availableBalance: "271077.10",
          createdAt: new Date(`${TODAY}T10:00:00.000Z`),
        },
      ],
    });

    const result = await loadTreasuryOfficialTodayBalance(prisma, TODAY);

    assert.equal(result.source, "DAILY_ROUTINE_SNAPSHOT");
    assert.equal(result.accountsCovered, 3);
    assert.equal(result.accountsWithoutBalance, 0);
    assert.equal(result.amount, 398620.43);
  });
});

// ── (4) Posição mais antiga não pode virar âncora de HOJE ──────────────────

describe("loadTreasuryOfficialTodayBalance — posição mais antiga não pode virar âncora de HOJE (defeito real)", () => {
  it("(4) nenhum snapshot de hoje; só posições soltas de ontem → amount null, source NONE, latestPosition informativo preenchido", async () => {
    const prisma = makeFakePrisma({
      accounts: [ACC_VK, ACC_VL, ACC_SK],
      latestSnapshots: [
        {
          accountId: "acc-vk",
          idempotencyKey: "",
          availableBalance: "100000.00",
          referenceAt: new Date(`${YESTERDAY}T18:00:00.000Z`),
          createdAt: new Date(`${YESTERDAY}T18:00:00.000Z`),
        },
        {
          accountId: "acc-vl",
          idempotencyKey: "",
          availableBalance: "2000.00",
          referenceAt: new Date(`${YESTERDAY}T17:00:00.000Z`),
          createdAt: new Date(`${YESTERDAY}T17:00:00.000Z`),
        },
        {
          accountId: "acc-sk",
          idempotencyKey: "",
          availableBalance: "300000.00",
          referenceAt: new Date(`${YESTERDAY}T19:00:00.000Z`),
          createdAt: new Date(`${YESTERDAY}T19:00:00.000Z`),
        },
      ],
    });

    const result = await loadTreasuryOfficialTodayBalance(prisma, TODAY);

    assert.equal(
      result.amount,
      null,
      "defeito: posição de ONTEM (soma 402000.00) virou âncora de HOJE"
    );
    assert.equal(result.source, "NONE", `defeito: source veio "${result.source}" em vez de "NONE"`);
    assert.ok(
      result.latestPosition,
      "defeito: campo informativo latestPosition não existe na resposta atual"
    );
    assert.equal(result.latestPosition?.amount, 402000);
    assert.equal(result.latestPosition?.accountsCovered, 3);
    assert.equal(result.latestPosition?.accountsExpected, 3);
    assert.equal(result.latestPosition?.accountsUpdatedToday, 0);
  });
});

// ── (5) Conta fora do consolidado nunca soma nem conta ──────────────────────

describe("loadTreasuryOfficialTodayBalance — conta fora do consolidado nunca soma nem conta", () => {
  it("(5) conta com includeInConsolidated:false é excluída do findMany e não entra na soma nem na contagem", async () => {
    const ACC_OUT: FakeAccount = {
      id: "acc-app",
      companyCode: "KOPPETEL",
      isActive: true,
      includeInConsolidated: false,
    };
    const prisma = makeFakePrisma({
      accounts: [ACC_VK, ACC_VL, ACC_SK, ACC_OUT],
      routineSnapshots: [
        {
          accountId: "acc-vk",
          idempotencyKey: routineKey(TODAY),
          availableBalance: "125699.11",
          createdAt: new Date(`${TODAY}T10:02:00.000Z`),
        },
        {
          accountId: "acc-vl",
          idempotencyKey: routineKey(TODAY),
          availableBalance: "1844.22",
          createdAt: new Date(`${TODAY}T10:01:00.000Z`),
        },
        {
          accountId: "acc-sk",
          idempotencyKey: routineKey(TODAY),
          availableBalance: "271077.10",
          createdAt: new Date(`${TODAY}T10:00:00.000Z`),
        },
        // Presente na tabela bruta, mas a conta está fora do consolidado —
        // jamais deve ser somada nem contada.
        {
          accountId: "acc-app",
          idempotencyKey: routineKey(TODAY),
          availableBalance: "999999.99",
          createdAt: new Date(`${TODAY}T10:03:00.000Z`),
        },
      ],
    });

    const result = await loadTreasuryOfficialTodayBalance(prisma, TODAY);

    assert.equal(result.accountsCovered, 3, "a 4ª conta (fora do consolidado) não pode contar");
    assert.equal(result.accountsWithoutBalance, 0);
    assert.equal(
      result.amount,
      398620.43,
      "o saldo absurdo (999999.99) da conta excluída não pode entrar na soma"
    );
  });
});

// ── (6) Snapshot genérico com cobertura completa já funciona hoje ──────────

describe("loadTreasuryOfficialTodayBalance — snapshot genérico (tela 'Saldo') com cobertura completa já funciona hoje", () => {
  it("(6) 3/3 contas com snapshot MANUAL genérico (sem prefixo de rotina) hoje → amount = soma, source GENERIC_MANUAL_SNAPSHOT", async () => {
    const prisma = makeFakePrisma({
      accounts: [ACC_VK, ACC_VL, ACC_SK],
      genericSnapshots: [
        {
          accountId: "acc-vk",
          idempotencyKey: "",
          availableBalance: "10.00",
          referenceAt: new Date(`${TODAY}T09:00:00.000Z`),
          createdAt: new Date(`${TODAY}T09:00:00.000Z`),
        },
        {
          accountId: "acc-vl",
          idempotencyKey: "",
          availableBalance: "20.00",
          referenceAt: new Date(`${TODAY}T09:00:00.000Z`),
          createdAt: new Date(`${TODAY}T09:00:00.000Z`),
        },
        {
          accountId: "acc-sk",
          idempotencyKey: "",
          availableBalance: "30.00",
          referenceAt: new Date(`${TODAY}T09:00:00.000Z`),
          createdAt: new Date(`${TODAY}T09:00:00.000Z`),
        },
      ],
    });

    const result = await loadTreasuryOfficialTodayBalance(prisma, TODAY);

    assert.equal(result.source, "GENERIC_MANUAL_SNAPSHOT");
    assert.equal(result.accountsCovered, 3);
    assert.equal(result.amount, 60);
  });
});

// ── (7) Nenhuma conta com companyCode presente ──────────────────────────────

describe("loadTreasuryOfficialTodayBalance — nenhuma conta com companyCode presente", () => {
  it("(7) todas as contas sem companyCode utilizável → nenhuma conta elegível, amount null, source NONE", async () => {
    const NO_CODE_VK: FakeAccount = { ...ACC_VK, companyCode: "" };
    const NO_CODE_VL: FakeAccount = { ...ACC_VL, companyCode: "" };
    const prisma = makeFakePrisma({ accounts: [NO_CODE_VK, NO_CODE_VL] });

    const result = await loadTreasuryOfficialTodayBalance(prisma, TODAY);

    assert.equal(result.accountsCovered, 0, "nenhuma conta elegível (totalAccounts efetivo = 0)");
    assert.equal(result.accountsWithoutBalance, 0);
    assert.equal(result.amount, null);
    assert.equal(result.source, "NONE");
  });
});
