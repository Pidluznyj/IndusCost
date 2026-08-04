/**
 * Regressão: saldo informado via "Saldos do Dia" (TreasuryBalanceSnapshot,
 * chave daily-closing-bank) precisa aparecer na linha do tempo do Caixa
 * mesmo quando o dia nunca passou pelo fechamento formal (TreasuryDailyClosing).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { loadFallbackDailyClosingBankSumByCivilDate } from "./treasuryCaixaService.server.js";

type FakeSnapshotRow = {
  accountId: string;
  idempotencyKey: string;
  availableBalance: string;
  createdAt: Date;
};

function fakePrisma(rows: FakeSnapshotRow[]): PrismaClient {
  return {
    treasuryBalanceSnapshot: {
      findMany: async (args: { orderBy?: { createdAt?: "asc" | "desc" } }) => {
        const sorted = [...rows];
        if (args.orderBy?.createdAt === "desc") {
          sorted.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return sorted;
      },
    },
  } as unknown as PrismaClient;
}

describe("loadFallbackDailyClosingBankSumByCivilDate", () => {
  it("soma o saldo informado (daily-closing-bank) de contas ativas, por dia, quando não há fechamento formal", async () => {
    const prisma = fakePrisma([
      {
        accountId: "acc-1",
        idempotencyKey: "daily-closing-bank:2026-01-01:v1",
        availableBalance: "52500.00",
        createdAt: new Date("2026-08-04T10:00:00Z"),
      },
      {
        accountId: "acc-2",
        idempotencyKey: "daily-closing-bank:2026-01-01:v1",
        availableBalance: "1000.00",
        createdAt: new Date("2026-08-04T10:00:00Z"),
      },
    ]);

    const result = await loadFallbackDailyClosingBankSumByCivilDate(
      prisma,
      ["acc-1", "acc-2"],
      "2025-01-01",
      "2026-12-31"
    );

    assert.equal(result.get("2026-01-01"), 53500);
  });

  it("usa só a versão mais recente por conta+dia (reabertura/correção)", async () => {
    const prisma = fakePrisma([
      {
        accountId: "acc-1",
        idempotencyKey: "daily-closing-bank:2026-01-01:v1",
        availableBalance: "50000.00",
        createdAt: new Date("2026-08-01T10:00:00Z"),
      },
      {
        accountId: "acc-1",
        idempotencyKey: "daily-closing-bank:2026-01-01:v2",
        availableBalance: "52500.00",
        createdAt: new Date("2026-08-04T10:00:00Z"),
      },
    ]);

    const result = await loadFallbackDailyClosingBankSumByCivilDate(
      prisma,
      ["acc-1"],
      "2025-01-01",
      "2026-12-31"
    );

    assert.equal(result.get("2026-01-01"), 52500);
  });

  it("ignora chave de abertura (daily-opening) — só fecha o dia com saldo final bancário", async () => {
    const prisma = fakePrisma([
      {
        accountId: "acc-1",
        idempotencyKey: "daily-opening:2026-01-01:v1",
        availableBalance: "50000.00",
        createdAt: new Date("2026-08-01T10:00:00Z"),
      },
    ]);

    const result = await loadFallbackDailyClosingBankSumByCivilDate(
      prisma,
      ["acc-1"],
      "2025-01-01",
      "2026-12-31"
    );

    assert.equal(result.size, 0);
  });

  it("descarta dia fora do range pedido", async () => {
    const prisma = fakePrisma([
      {
        accountId: "acc-1",
        idempotencyKey: "daily-closing-bank:2020-01-01:v1",
        availableBalance: "50000.00",
        createdAt: new Date("2020-01-01T10:00:00Z"),
      },
    ]);

    const result = await loadFallbackDailyClosingBankSumByCivilDate(
      prisma,
      ["acc-1"],
      "2025-01-01",
      "2026-12-31"
    );

    assert.equal(result.size, 0);
  });

  it("lista de contas vazia não bate no banco e devolve mapa vazio", async () => {
    let called = false;
    const prisma = {
      treasuryBalanceSnapshot: {
        findMany: async () => {
          called = true;
          return [];
        },
      },
    } as unknown as PrismaClient;

    const result = await loadFallbackDailyClosingBankSumByCivilDate(
      prisma,
      [],
      "2025-01-01",
      "2026-12-31"
    );

    assert.equal(result.size, 0);
    assert.equal(called, false);
  });
});
