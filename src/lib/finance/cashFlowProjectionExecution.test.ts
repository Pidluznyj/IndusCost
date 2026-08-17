/**
 * GATE DE EXECUÇÃO — qual caminho realmente roda.
 *
 * Os testes de flag provam a ESCOLHA (env → modo) e a FIAÇÃO (quais handlers
 * resolvem a flag). Este arquivo prova a EXECUÇÃO: dado o modo, qual
 * implementação de fato rodou — via contadores incrementados dentro de cada
 * ramo, não por leitura de código.
 *
 * `loadFinanceArEffectiveOrderContextsForPortfolio` é a fronteira exportada que
 * os três endpoints alcançam; ela recebe o `projectionMode` e escolhe o ramo.
 *
 * No modo legacy o ramo chama `getOrderFullAudit`, que usa o cliente Prisma do
 * módulo (não injetável) e falha sem banco. Isso não atrapalha a prova: o
 * contador é incrementado ANTES da chamada, então o que se mede é o caminho
 * tomado. A corrida com timeout existe só para não depender do tempo de falha
 * da conexão.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCashFlowProjectionTelemetry,
  resetCashFlowProjectionTelemetry,
} from "@/src/lib/finance/cashFlowProjectionTelemetry.js";
import { loadFinanceArEffectiveOrderContextsForPortfolio } from "@/src/lib/finance/financeAccountsReceivableEffectiveTitles.server.js";
import type { PrismaClient } from "@prisma/client";

type Row = Record<string, unknown>;

function matches(row: Row, where: unknown): boolean {
  if (where == null || typeof where !== "object") return true;
  for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
    if (key === "OR") {
      if (!(cond as unknown[]).some((b) => matches(row, b))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(cond as unknown[]).every((b) => matches(row, b))) return false;
      continue;
    }
    const value = row[key];
    if (cond != null && typeof cond === "object") {
      const c = cond as Record<string, unknown>;
      if ("in" in c) {
        if (!(c.in as unknown[]).includes(value)) return false;
        continue;
      }
      if ("equals" in c) {
        if (value !== c.equals) return false;
        continue;
      }
      if ("not" in c) {
        if (value === c.not) return false;
        continue;
      }
      continue; // contains/mode etc. — não restringe nesta fixture
    }
    if (value !== cond) return false;
  }
  return true;
}

const ORDER: Row = {
  id: "SO-EXEC",
  orderCode: "PV-EXEC",
  status: "OPEN",
  sourcePresenceStatus: "PRESENT",
  externalCustomerId: 77,
  Customer: { companyName: "Cliente", taxId: "000" },
  issueDate: new Date("2026-01-05T00:00:00.000Z"),
  expectedDeliveryDate: null,
  paymentTerms: "30/60",
  paymentMethod: "Boleto",
  nomusRawResponse: null,
  totalNetValue: "1000",
  totalGrossValue: "1000",
  items: [],
  nfeLinks: [],
};

function makePrisma() {
  const data: Record<string, Row[]> = {
    salesOrderNfeLink: [
      {
        salesOrderId: "SO-EXEC",
        orderCode: "PV-EXEC",
        nfeExternalId: 900,
        nfeKey: "CHAVE-900",
        SalesOrder: { id: "SO-EXEC", orderCode: "PV-EXEC" },
      },
    ],
    salesOrder: [ORDER],
    salesOrderItem: [],
    orderToCashAuditFact: [],
    nomusAccountsReceivable: [],
    nomusStockDocument: [],
    nomusStockDocumentItem: [],
    nomusNfe: [{ externalId: 900, status: 1 }],
  };
  const table = (name: string) => ({
    async findMany(args: { where?: unknown } = {}) {
      return (data[name] ?? []).filter((r) => matches(r, args.where)) as never;
    },
    async findFirst(args: { where?: unknown } = {}) {
      return ((data[name] ?? []).find((r) => matches(r, args.where)) ??
        null) as never;
    },
    async findUnique(args: { where?: unknown } = {}) {
      return ((data[name] ?? []).find((r) => matches(r, args.where)) ??
        null) as never;
    },
  });
  return new Proxy({} as PrismaClient, {
    get: (_t, prop: string) => table(prop),
  });
}

const ROWS = [{ description: "PD PV-EXEC", sourceInvoiceId: 900 }];

/** Não deixa o teste depender do tempo de falha da conexão do caminho legado. */
async function comLimite(p: Promise<unknown>): Promise<void> {
  await Promise.race([
    p.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 400)),
  ]);
}

describe("GATE DE EXECUÇÃO — legacy × light", () => {
  it("modo legacy: getOrderFullAudit é o caminho; light loader não roda", async () => {
    resetCashFlowProjectionTelemetry();
    await comLimite(
      loadFinanceArEffectiveOrderContextsForPortfolio(
        makePrisma(),
        ROWS,
        new Date("2026-03-15T12:00:00.000Z"),
        80,
        "legacy"
      )
    );

    const t = getCashFlowProjectionTelemetry();
    assert.equal(t.lastProjectionMode, "legacy");
    assert.ok(
      t.fullAuditCalls >= 1,
      `esperava execução da auditoria 360º, veio ${t.fullAuditCalls}`
    );
    assert.equal(t.lightLoaderCalls, 0, "light loader não pode rodar no legacy");
  });

  it("modo light: o loader leve roda e getOrderFullAudit NÃO é usado", async () => {
    resetCashFlowProjectionTelemetry();
    await comLimite(
      loadFinanceArEffectiveOrderContextsForPortfolio(
        makePrisma(),
        ROWS,
        new Date("2026-03-15T12:00:00.000Z"),
        80,
        "light"
      )
    );

    const t = getCashFlowProjectionTelemetry();
    assert.equal(t.lastProjectionMode, "light");
    assert.ok(
      t.lightLoaderCalls >= 1,
      `esperava execução do loader leve, veio ${t.lightLoaderCalls}`
    );
    assert.equal(
      t.fullAuditCalls,
      0,
      "TRAVA: a auditoria 360º não pode ser usada no caminho leve"
    );
  });

  it("default (sem modo informado) executa legacy", async () => {
    resetCashFlowProjectionTelemetry();
    await comLimite(
      loadFinanceArEffectiveOrderContextsForPortfolio(
        makePrisma(),
        ROWS,
        new Date("2026-03-15T12:00:00.000Z")
      )
    );
    const t = getCashFlowProjectionTelemetry();
    assert.equal(t.lastProjectionMode, "legacy");
    assert.equal(t.lightLoaderCalls, 0);
  });

  it("a telemetria não carrega nada além de números e o modo", () => {
    resetCashFlowProjectionTelemetry();
    const t = getCashFlowProjectionTelemetry();
    assert.deepEqual(Object.keys(t).sort(), [
      "fullAuditCalls",
      "lastProjectionMode",
      "lightLoaderCalls",
    ]);
    assert.equal(t.lastProjectionMode, null);
    assert.equal(t.fullAuditCalls, 0);
    assert.equal(t.lightLoaderCalls, 0);
  });
});
