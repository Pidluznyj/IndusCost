/**
 * Regressão: saldo informado pela tela genérica "Saldo"
 * (TreasuryAccountBalancePage → POST .../balance-snapshots) precisa aparecer
 * na linha do tempo do Caixa mesmo sem passar pela rotina "Saldos do Dia" nem
 * pelo fechamento formal — é o caminho usado para informar saldo
 * inicial/final retroativo de um mês inteiro.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { loadFallbackGenericManualBalanceSumByCivilDate } from "./treasuryCaixaService.server.js";

type FakeSnapshotRow = {
  accountId: string;
  idempotencyKey: string;
  availableBalance: string;
  referenceAt: Date;
  createdAt: Date;
};

function fakePrisma(rows: FakeSnapshotRow[]): PrismaClient {
  return {
    treasuryBalanceSnapshot: {
      findMany: async (args: {
        orderBy?: Array<{ referenceAt?: "asc" | "desc"; createdAt?: "asc" | "desc" }>;
      }) => {
        const sorted = [...rows];
        sorted.sort((a, b) => {
          for (const clause of args.orderBy ?? []) {
            if (clause.referenceAt === "desc") {
              const diff = b.referenceAt.getTime() - a.referenceAt.getTime();
              if (diff !== 0) return diff;
            }
            if (clause.createdAt === "desc") {
              const diff = b.createdAt.getTime() - a.createdAt.getTime();
              if (diff !== 0) return diff;
            }
          }
          return 0;
        });
        return sorted;
      },
    },
  } as unknown as PrismaClient;
}

describe("loadFallbackGenericManualBalanceSumByCivilDate", () => {
  it("soma saldo informado pela tela genérica Saldo, por dia civil (referenceAt), de contas ativas", async () => {
    const prisma = fakePrisma([
      {
        accountId: "acc-1",
        idempotencyKey: "bal-1700000000-abc123",
        availableBalance: "52500.00",
        referenceAt: new Date("2026-02-01T00:00:00Z"),
        createdAt: new Date("2026-08-04T10:00:00Z"),
      },
      {
        accountId: "acc-2",
        idempotencyKey: "bal-1700000001-def456",
        availableBalance: "1000.00",
        referenceAt: new Date("2026-02-01T00:00:00Z"),
        createdAt: new Date("2026-08-04T10:00:00Z"),
      },
    ]);

    const result = await loadFallbackGenericManualBalanceSumByCivilDate(
      prisma,
      ["acc-1", "acc-2"],
      "2025-01-01",
      "2026-12-31"
    );

    assert.equal(result.get("2026-02-01"), 53500);
  });

  it("saldo inicial (01/mês) e final (último dia/mês) do mesmo mês viram dois dias distintos", async () => {
    const prisma = fakePrisma([
      {
        accountId: "acc-1",
        idempotencyKey: "bal-a",
        availableBalance: "10000.00",
        referenceAt: new Date("2026-02-01T00:00:00Z"),
        createdAt: new Date("2026-08-01T10:00:00Z"),
      },
      {
        accountId: "acc-1",
        idempotencyKey: "bal-b",
        availableBalance: "15000.00",
        referenceAt: new Date("2026-02-28T00:00:00Z"),
        createdAt: new Date("2026-08-01T11:00:00Z"),
      },
    ]);

    const result = await loadFallbackGenericManualBalanceSumByCivilDate(
      prisma,
      ["acc-1"],
      "2025-01-01",
      "2026-12-31"
    );

    assert.equal(result.get("2026-02-01"), 10000);
    assert.equal(result.get("2026-02-28"), 15000);
  });

  it("usa só a versão mais recente por conta+dia civil (correção/reenvio)", async () => {
    const prisma = fakePrisma([
      {
        accountId: "acc-1",
        idempotencyKey: "bal-old",
        availableBalance: "50000.00",
        referenceAt: new Date("2026-02-01T00:00:00Z"),
        createdAt: new Date("2026-08-01T10:00:00Z"),
      },
      {
        accountId: "acc-1",
        idempotencyKey: "bal-new",
        availableBalance: "52500.00",
        referenceAt: new Date("2026-02-01T00:00:00Z"),
        createdAt: new Date("2026-08-04T10:00:00Z"),
      },
    ]);

    const result = await loadFallbackGenericManualBalanceSumByCivilDate(
      prisma,
      ["acc-1"],
      "2025-01-01",
      "2026-12-31"
    );

    assert.equal(result.get("2026-02-01"), 52500);
  });

  it("ignora snapshot da rotina Saldos do Dia (já coberto pelo outro fallback)", async () => {
    const prisma = fakePrisma([
      {
        accountId: "acc-1",
        idempotencyKey: "daily-closing-bank:2026-02-01:v1",
        availableBalance: "50000.00",
        referenceAt: new Date("2026-08-01T10:00:00Z"),
        createdAt: new Date("2026-08-01T10:00:00Z"),
      },
      {
        accountId: "acc-1",
        idempotencyKey: "daily-opening:2026-02-01:v1",
        availableBalance: "40000.00",
        referenceAt: new Date("2026-08-01T10:00:00Z"),
        createdAt: new Date("2026-08-01T10:00:00Z"),
      },
    ]);

    const result = await loadFallbackGenericManualBalanceSumByCivilDate(
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
        idempotencyKey: "bal-old",
        availableBalance: "50000.00",
        referenceAt: new Date("2020-01-01T00:00:00Z"),
        createdAt: new Date("2020-01-01T10:00:00Z"),
      },
    ]);

    const result = await loadFallbackGenericManualBalanceSumByCivilDate(
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

    const result = await loadFallbackGenericManualBalanceSumByCivilDate(
      prisma,
      [],
      "2025-01-01",
      "2026-12-31"
    );

    assert.equal(result.size, 0);
    assert.equal(called, false);
  });
});
