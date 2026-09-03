/**
 * RED — Evidências de saldo por conta × dia civil (Tesouraria › Caixa).
 *
 * Prova, ainda sem implementação (stubs lançam "not implemented: <nome>"):
 *  - `classifyTreasuryBalanceSnapshotRow` classifica pela CHAVE de
 *    idempotência (rotina "Saldos do Dia") ou pelo `referenceAt` em
 *    America/Sao_Paulo (genérico da tela "Saldo") — nunca UTC puro: 21h em
 *    São Paulo (= 00h UTC do dia seguinte) continua sendo o dia civil
 *    anterior. Esse é exatamente o bug de produção que motivou a missão.
 *  - `loadTreasuryDailyBalanceEvidence` faz no máximo 3 consultas totais
 *    (snapshots p/ evidência manual + snapshots p/ posição mais recente +
 *    fechamentos formais), nunca uma por conta/dia; usa só a versão mais
 *    recente por conta+dia+tipo; exclui cancelados e origem ≠ MANUAL das
 *    listas manuais; fechamento formal só status CLOSED, versão mais alta
 *    por companyCode+civilDate; `civilDate` de coluna `@db.Date` (meia-noite
 *    UTC do Prisma) é convertido sem deslocar pro fuso de SP.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  classifyTreasuryBalanceSnapshotRow,
  loadTreasuryDailyBalanceEvidence,
  type TreasuryDailyBalanceEvidence,
} from "./treasuryDailyBalanceEvidence.server.js";

// ── classifyTreasuryBalanceSnapshotRow ──────────────────────────────────────

describe("classifyTreasuryBalanceSnapshotRow", () => {
  it("(1) chave da rotina 'daily-opening:YYYY-MM-DD:vN' → OPENING com civilDate/version da CHAVE (não do referenceAt)", () => {
    const result = classifyTreasuryBalanceSnapshotRow({
      idempotencyKey: "daily-opening:2026-09-01:v2",
      // referenceAt deliberadamente de outro dia: quem manda é a chave.
      referenceAt: new Date("2026-09-05T12:00:00Z"),
    });
    assert.deepEqual(result, { kind: "OPENING", civilDate: "2026-09-01", version: 2 });
  });

  it("(2) chave da rotina 'daily-closing-bank:YYYY-MM-DD:vN' → CLOSING com civilDate/version da CHAVE", () => {
    const result = classifyTreasuryBalanceSnapshotRow({
      idempotencyKey: "daily-closing-bank:2026-09-01:v1",
      referenceAt: new Date("2026-09-05T12:00:00Z"),
    });
    assert.deepEqual(result, { kind: "CLOSING", civilDate: "2026-09-01", version: 1 });
  });

  it("(3) chave genérica (tela 'Saldo') → GENERIC, civilDate do referenceAt em America/Sao_Paulo, version null", () => {
    const result = classifyTreasuryBalanceSnapshotRow({
      idempotencyKey: "bal-1700000000-abc123",
      referenceAt: new Date("2026-09-01T23:59:00-03:00"),
    });
    assert.deepEqual(result, { kind: "GENERIC", civilDate: "2026-09-01", version: null });
  });

  it("(4) mesma função, 20:59 em SP (= 23:59 UTC) → ainda dia civil 2026-09-01", () => {
    const referenceAt = new Date("2026-09-01T20:59:00-03:00");
    assert.equal(referenceAt.toISOString(), "2026-09-01T23:59:00.000Z");
    const result = classifyTreasuryBalanceSnapshotRow({
      idempotencyKey: "bal-1700000001-def456",
      referenceAt,
    });
    assert.equal(result.civilDate, "2026-09-01");
  });

  it("(5) BUG DE PRODUÇÃO: 21h em SP = 00h UTC do dia SEGUINTE — civilDate tem que continuar 2026-09-01, nunca pular pra 2026-09-02 (é o caso que quebra com toISOString().slice(0,10))", () => {
    const referenceAt = new Date("2026-09-01T21:00:00-03:00");
    assert.equal(
      referenceAt.toISOString(),
      "2026-09-02T00:00:00.000Z",
      "sanity check: o instante É meia-noite UTC do dia seguinte"
    );
    const result = classifyTreasuryBalanceSnapshotRow({
      idempotencyKey: "bal-1700000002-ghi789",
      referenceAt,
    });
    assert.equal(result.civilDate, "2026-09-01", "dia civil de São Paulo, não o dia UTC do instante");
  });
});

// ── loadTreasuryDailyBalanceEvidence ────────────────────────────────────────

type RawSnapshotRow = {
  accountId: string;
  idempotencyKey: string;
  referenceAt: Date;
  createdAt: Date;
  availableBalance: string | { toString(): string };
  origin: string;
  /** Não faz parte de TreasuryBalanceSnapshotRowForEvidence: a exclusão é
   * responsabilidade do WHERE do carregador, não de filtro em JS a jusante. */
  cancelledAt: Date | null;
};

type RawClosingRow = {
  companyCode: string;
  /** @db.Date — Prisma entrega meia-noite UTC do dia civil. */
  civilDate: Date;
  version: number;
  /** Não faz parte de TreasuryFormalClosingEvidenceInput: filtrar CLOSED é
   * responsabilidade do WHERE do carregador. */
  status: string;
  openingBalance: string;
  observedBalance: string;
  closedAt: Date | null;
};

function omit<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Omit<T, K> {
  const clone = { ...row } as T;
  for (const key of keys) delete clone[key];
  return clone;
}

/** Emulador mínimo de WHERE do Prisma: igualdade direta, `equals`, `in`, `gte/gt/lte/lt` (datas). */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition === null) return value === null;
    if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
      const cond = condition as Record<string, unknown>;
      if ("equals" in cond) return value === cond.equals;
      if ("in" in cond) return Array.isArray(cond.in) && (cond.in as unknown[]).includes(value);
      if ("gte" in cond || "gt" in cond || "lte" in cond || "lt" in cond) {
        const v = value as Date;
        if ("gte" in cond && !(v.getTime() >= (cond.gte as Date).getTime())) return false;
        if ("gt" in cond && !(v.getTime() > (cond.gt as Date).getTime())) return false;
        if ("lte" in cond && !(v.getTime() <= (cond.lte as Date).getTime())) return false;
        if ("lt" in cond && !(v.getTime() < (cond.lt as Date).getTime())) return false;
        return true;
      }
      // Estrutura não modelada por este fake (ex.: AND/OR aninhado) —
      // permissivo, pra não derrubar o teste por uma condição desconhecida.
      return true;
    }
    return value === condition;
  });
}

function makeFakePrisma(snapshots: readonly RawSnapshotRow[], closings: readonly RawClosingRow[]) {
  const calls = { snapshot: 0, closing: 0 };
  const prisma = {
    treasuryBalanceSnapshot: {
      findMany: async (args?: { where?: Record<string, unknown> }) => {
        calls.snapshot += 1;
        return snapshots
          .filter((row) => matchesWhere(row as unknown as Record<string, unknown>, args?.where))
          .map((row) => omit(row, ["cancelledAt"]));
      },
    },
    treasuryDailyClosing: {
      findMany: async (args?: { where?: Record<string, unknown> }) => {
        calls.closing += 1;
        return closings
          .filter((row) => matchesWhere(row as unknown as Record<string, unknown>, args?.where))
          .map((row) => omit(row, ["status"]));
      },
    },
  } as unknown as PrismaClient;
  return { prisma, calls };
}

function findEvidence<T extends { accountId: string; civilDate: string }>(
  list: readonly T[],
  accountId: string,
  civilDate: string
): T[] {
  return list.filter((e) => e.accountId === accountId && e.civilDate === civilDate);
}

describe("loadTreasuryDailyBalanceEvidence", () => {
  it("(6) por conta+dia+tipo, usa só a versão mais recente (maior createdAt) em manualOpenings/manualClosings", async () => {
    const openingV1ReferenceAt = new Date("2026-09-01T11:00:00-03:00");
    const openingV2ReferenceAt = new Date("2026-09-01T11:05:00-03:00");
    const closingV1ReferenceAt = new Date("2026-09-01T20:00:00-03:00");
    const closingV2ReferenceAt = new Date("2026-09-01T20:05:00-03:00");

    const { prisma } = makeFakePrisma(
      [
        {
          accountId: "acc-1",
          idempotencyKey: "daily-opening:2026-09-01:v1",
          referenceAt: openingV1ReferenceAt,
          createdAt: new Date("2026-08-01T09:00:00Z"),
          availableBalance: "1000.00",
          origin: "MANUAL",
          cancelledAt: null,
        },
        {
          accountId: "acc-1",
          idempotencyKey: "daily-opening:2026-09-01:v2",
          referenceAt: openingV2ReferenceAt,
          createdAt: new Date("2026-08-01T10:00:00Z"),
          availableBalance: "1500.00",
          origin: "MANUAL",
          cancelledAt: null,
        },
        {
          accountId: "acc-1",
          idempotencyKey: "daily-closing-bank:2026-09-01:v1",
          referenceAt: closingV1ReferenceAt,
          createdAt: new Date("2026-08-01T09:30:00Z"),
          availableBalance: "2000.00",
          origin: "MANUAL",
          cancelledAt: null,
        },
        {
          accountId: "acc-1",
          idempotencyKey: "daily-closing-bank:2026-09-01:v2",
          referenceAt: closingV2ReferenceAt,
          createdAt: new Date("2026-08-01T10:30:00Z"),
          availableBalance: "2200.00",
          origin: "MANUAL",
          cancelledAt: null,
        },
      ],
      []
    );

    const evidence: TreasuryDailyBalanceEvidence = await loadTreasuryDailyBalanceEvidence(prisma, {
      accountIds: ["acc-1"],
      companyCodes: ["KOPPETEL"],
      fromCivilDate: "2026-09-01",
      toCivilDate: "2026-09-01",
    });

    const openings = findEvidence(evidence.manualOpenings, "acc-1", "2026-09-01");
    assert.equal(openings.length, 1);
    assert.equal(openings[0].amount, 1500, "fica só a versão mais recente (v2), não a v1");
    assert.equal(openings[0].version, 2);
    assert.equal(openings[0].informedAt, openingV2ReferenceAt.toISOString());

    const closings = findEvidence(evidence.manualClosings, "acc-1", "2026-09-01");
    assert.equal(closings.length, 1);
    assert.equal(closings[0].amount, 2200, "fica só a versão mais recente (v2), não a v1");
    assert.equal(closings[0].version, 2);
    assert.equal(closings[0].informedAt, closingV2ReferenceAt.toISOString());
  });

  it("(7) snapshot com cancelledAt não-nulo é excluído de todas as listas", async () => {
    const { prisma } = makeFakePrisma(
      [
        {
          accountId: "acc-1",
          idempotencyKey: "daily-opening:2026-09-02:v1",
          referenceAt: new Date("2026-09-02T11:00:00-03:00"),
          createdAt: new Date("2026-08-02T09:00:00Z"),
          availableBalance: "9999.00",
          origin: "MANUAL",
          cancelledAt: new Date("2026-08-02T09:05:00Z"),
        },
      ],
      []
    );

    const evidence = await loadTreasuryDailyBalanceEvidence(prisma, {
      accountIds: ["acc-1"],
      companyCodes: ["KOPPETEL"],
      fromCivilDate: "2026-09-02",
      toCivilDate: "2026-09-02",
    });

    assert.equal(findEvidence(evidence.manualOpenings, "acc-1", "2026-09-02").length, 0);
    assert.equal(findEvidence(evidence.manualClosings, "acc-1", "2026-09-02").length, 0);
    assert.equal(findEvidence(evidence.genericSnapshots, "acc-1", "2026-09-02").length, 0);
  });

  it("(8) snapshot com origin ≠ MANUAL é excluído de manualOpenings/manualClosings/genericSnapshots", async () => {
    const { prisma } = makeFakePrisma(
      [
        {
          accountId: "acc-1",
          idempotencyKey: "daily-opening:2026-09-03:v1",
          referenceAt: new Date("2026-09-03T11:00:00-03:00"),
          createdAt: new Date("2026-08-03T09:00:00Z"),
          availableBalance: "800.00",
          origin: "OFX",
          cancelledAt: null,
        },
        {
          accountId: "acc-1",
          idempotencyKey: "bal-ofx-003",
          referenceAt: new Date("2026-09-03T18:00:00-03:00"),
          createdAt: new Date("2026-08-03T09:30:00Z"),
          availableBalance: "820.00",
          origin: "OFX",
          cancelledAt: null,
        },
        // controle: mesmo dia, origem MANUAL — precisa continuar aparecendo.
        {
          accountId: "acc-2",
          idempotencyKey: "daily-opening:2026-09-03:v1",
          referenceAt: new Date("2026-09-03T11:00:00-03:00"),
          createdAt: new Date("2026-08-03T09:00:00Z"),
          availableBalance: "500.00",
          origin: "MANUAL",
          cancelledAt: null,
        },
      ],
      []
    );

    const evidence = await loadTreasuryDailyBalanceEvidence(prisma, {
      accountIds: ["acc-1", "acc-2"],
      companyCodes: ["KOPPETEL"],
      fromCivilDate: "2026-09-03",
      toCivilDate: "2026-09-03",
    });

    assert.equal(
      findEvidence(evidence.manualOpenings, "acc-1", "2026-09-03").length,
      0,
      "origem OFX não é evidência manual de abertura"
    );
    assert.equal(
      findEvidence(evidence.genericSnapshots, "acc-1", "2026-09-03").length,
      0,
      "origem OFX não é snapshot genérico manual"
    );
    const control = findEvidence(evidence.manualOpenings, "acc-2", "2026-09-03");
    assert.equal(control.length, 1, "controle MANUAL continua aparecendo");
    assert.equal(control[0].amount, 500);
  });

  it("(9) formalClosings: só status CLOSED, versão mais alta por companyCode+civilDate; civilDate de @db.Date (meia-noite UTC) não desloca pro fuso de SP", async () => {
    const { prisma } = makeFakePrisma(
      [],
      [
        {
          companyCode: "KOPPETEL",
          civilDate: new Date(Date.UTC(2026, 8, 1)),
          version: 1,
          status: "CLOSED",
          openingBalance: "4000.00",
          observedBalance: "5000.00",
          closedAt: new Date("2026-09-01T23:00:00Z"),
        },
        {
          companyCode: "KOPPETEL",
          civilDate: new Date(Date.UTC(2026, 8, 1)),
          version: 2,
          status: "CLOSED",
          openingBalance: "4000.00",
          observedBalance: "5100.00",
          closedAt: new Date("2026-09-01T23:30:00Z"),
        },
        {
          companyCode: "KOPPETEL",
          civilDate: new Date(Date.UTC(2026, 8, 1)),
          version: 3,
          status: "OPEN",
          openingBalance: "4000.00",
          observedBalance: "5200.00",
          closedAt: null,
        },
      ]
    );

    const evidence = await loadTreasuryDailyBalanceEvidence(prisma, {
      accountIds: ["acc-1"],
      companyCodes: ["KOPPETEL"],
      fromCivilDate: "2026-09-01",
      toCivilDate: "2026-09-01",
    });

    assert.equal(
      evidence.formalClosings.length,
      1,
      "só uma linha: a versão mais alta CLOSED (a v3 é OPEN e não conta)"
    );
    const fc = evidence.formalClosings[0];
    assert.equal(
      fc.civilDate,
      "2026-09-01",
      "Date.UTC(2026,8,1) (meia-noite UTC) é o dia civil 2026-09-01 — não pode virar 2026-08-31 nem 2026-09-02"
    );
    assert.equal(fc.version, 2);
    assert.equal(fc.observedBalance, 5100);
    assert.equal(fc.openingBalance, 4000);
    assert.equal(fc.companyCode, "KOPPETEL");
  });

  it("(10) latestPositions: 1 item por conta, o mais recente por referenceAt desc / createdAt desc como desempate, civilDate em America/Sao_Paulo, sem restringir ao período consultado", async () => {
    const acc1Older = new Date("2026-09-01T10:00:00-03:00");
    const acc1Newer = new Date("2026-09-02T15:00:00-03:00");
    const acc2Tie = new Date("2026-09-02T09:00:00-03:00");

    const { prisma } = makeFakePrisma(
      [
        {
          accountId: "acc-1",
          idempotencyKey: "bal-pos-1",
          referenceAt: acc1Older,
          createdAt: new Date("2026-08-01T09:00:00Z"),
          availableBalance: "1000.00",
          origin: "MANUAL",
          cancelledAt: null,
        },
        {
          accountId: "acc-1",
          idempotencyKey: "bal-pos-2",
          referenceAt: acc1Newer,
          createdAt: new Date("2026-08-01T09:00:00Z"),
          availableBalance: "1800.00",
          origin: "OFX",
          cancelledAt: null,
        },
        {
          accountId: "acc-2",
          idempotencyKey: "bal-pos-3",
          referenceAt: acc2Tie,
          createdAt: new Date("2026-08-01T09:00:00Z"),
          availableBalance: "500.00",
          origin: "MANUAL",
          cancelledAt: null,
        },
        {
          accountId: "acc-2",
          idempotencyKey: "bal-pos-4",
          referenceAt: acc2Tie,
          createdAt: new Date("2026-08-01T10:00:00Z"),
          availableBalance: "700.00",
          origin: "MANUAL",
          cancelledAt: null,
        },
      ],
      []
    );

    // Janela consultada é só 2026-09-01 — a posição mais recente da acc-1 é
    // de 2026-09-02 (fora da janela) e AINDA ASSIM tem que aparecer: é
    // informativo ("Caixa hoje"), não fica preso ao período do relatório.
    const evidence = await loadTreasuryDailyBalanceEvidence(prisma, {
      accountIds: ["acc-1", "acc-2"],
      companyCodes: ["KOPPETEL"],
      fromCivilDate: "2026-09-01",
      toCivilDate: "2026-09-01",
    });

    assert.equal(evidence.latestPositions.length, 2);
    const pos1 = evidence.latestPositions.find((p) => p.accountId === "acc-1");
    assert.ok(pos1);
    assert.equal(pos1!.amount, 1800, "referenceAt mais recente vence, mesmo com origem OFX");
    assert.equal(pos1!.civilDate, "2026-09-02");

    const pos2 = evidence.latestPositions.find((p) => p.accountId === "acc-2");
    assert.ok(pos2);
    assert.equal(pos2!.amount, 700, "empate em referenceAt: desempata por createdAt mais recente");
    assert.equal(pos2!.civilDate, "2026-09-02");
  });

  it("(11) snapshot genérico e snapshot de rotina do MESMO dia e MESMA conta não se confundem", async () => {
    const routineReferenceAt = new Date("2026-09-05T11:00:00-03:00");
    const genericReferenceAt = new Date("2026-09-05T18:00:00-03:00");

    const { prisma } = makeFakePrisma(
      [
        {
          accountId: "acc-2",
          idempotencyKey: "daily-opening:2026-09-05:v1",
          referenceAt: routineReferenceAt,
          createdAt: new Date("2026-08-05T09:00:00Z"),
          availableBalance: "3000.00",
          origin: "MANUAL",
          cancelledAt: null,
        },
        {
          accountId: "acc-2",
          idempotencyKey: "bal-generic-005",
          referenceAt: genericReferenceAt,
          createdAt: new Date("2026-08-05T09:30:00Z"),
          availableBalance: "3500.00",
          origin: "MANUAL",
          cancelledAt: null,
        },
      ],
      []
    );

    const evidence = await loadTreasuryDailyBalanceEvidence(prisma, {
      accountIds: ["acc-2"],
      companyCodes: ["KOPPETEL"],
      fromCivilDate: "2026-09-05",
      toCivilDate: "2026-09-05",
    });

    const openings = findEvidence(evidence.manualOpenings, "acc-2", "2026-09-05");
    const generics = findEvidence(evidence.genericSnapshots, "acc-2", "2026-09-05");
    assert.equal(openings.length, 1);
    assert.equal(openings[0].amount, 3000);
    assert.equal(generics.length, 1);
    assert.equal(generics[0].amount, 3500);
    assert.equal(findEvidence(evidence.manualClosings, "acc-2", "2026-09-05").length, 0);
    assert.ok(!openings.some((e) => e.amount === 3500), "o genérico não pode vazar pra manualOpenings");
    assert.ok(!generics.some((e) => e.amount === 3000), "a rotina não pode vazar pra genericSnapshots");
  });

  it("(12) no máximo 3 chamadas totais ao prisma para todo o carregamento — nunca uma consulta por conta ou por dia", async () => {
    const { prisma, calls } = makeFakePrisma([], []);

    await loadTreasuryDailyBalanceEvidence(prisma, {
      accountIds: ["acc-1", "acc-2", "acc-3", "acc-4", "acc-5"],
      companyCodes: ["KOPPETEL", "LAZARIOS"],
      fromCivilDate: "2026-09-01",
      toCivilDate: "2026-09-10",
    });

    assert.ok(
      calls.snapshot + calls.closing <= 3,
      `esperado no máximo 3 chamadas totais, veio ${calls.snapshot + calls.closing} (snapshot=${calls.snapshot}, closing=${calls.closing})`
    );
  });

  it("(13) availableBalance como objeto Decimal-like ({ toString() }) também vira number", async () => {
    const { prisma } = makeFakePrisma(
      [
        {
          accountId: "acc-1",
          idempotencyKey: "daily-opening:2026-09-06:v1",
          referenceAt: new Date("2026-09-06T11:00:00-03:00"),
          createdAt: new Date("2026-08-06T09:00:00Z"),
          availableBalance: { toString: () => "4321.55" },
          origin: "MANUAL",
          cancelledAt: null,
        },
      ],
      []
    );

    const evidence = await loadTreasuryDailyBalanceEvidence(prisma, {
      accountIds: ["acc-1"],
      companyCodes: ["KOPPETEL"],
      fromCivilDate: "2026-09-06",
      toCivilDate: "2026-09-06",
    });

    const opening = findEvidence(evidence.manualOpenings, "acc-1", "2026-09-06")[0];
    assert.equal(opening.amount, 4321.55);
  });
});
