/**
 * Regressão PERFORMANCE 08 — índices P1 Pedidos + Financeiro.
 * Valida schema + migration SQL (sem aplicar em produção).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const MIGRATION =
  "prisma/migrations/20260804120000_perf08_sales_finance_read_indexes/migration.sql";

describe("PERFORMANCE 08 — índices aprovados (Pedidos + Financeiro)", () => {
  it("1) schema SalesOrder declara createdAt+issueDate e externalSellerId", () => {
    const schema = read("prisma/schema.prisma");
    const soBlock = schema.slice(
      schema.indexOf("model SalesOrder {"),
      schema.indexOf("model SalesOrderNfeLink {")
    );
    assert.match(soBlock, /@@index\(\[createdAt\(sort: Desc\), issueDate\(sort: Desc\)\]\)/);
    assert.match(soBlock, /@@index\(\[externalSellerId\]\)/);
  });

  it("2) migration cria exatamente os 4 índices P1 com nomes claros", () => {
    const sql = read(MIGRATION);
    assert.match(sql, /SalesOrder_createdAt_issueDate_idx/);
    assert.match(sql, /SalesOrder_externalSellerId_idx/);
    assert.match(sql, /NomusAccountsReceivable_open_dueDate_idx/);
    assert.match(sql, /NomusAccountsPayable_open_dueDate_idx/);
    assert.match(sql, /WHERE "balanceReceivable" > 0/);
    assert.match(sql, /WHERE "balancePayable" > 0/);
    const creates = sql.match(/CREATE INDEX IF NOT EXISTS/g) ?? [];
    assert.equal(creates.length, 4);
  });

  it("3) migration nao altera colunas/dados/constraints e nao usa CONCURRENTLY", () => {
    const sql = read(MIGRATION);
    assert.doesNotMatch(sql, /\bALTER TABLE\b/i);
    assert.doesNotMatch(sql, /\bUPDATE\b/i);
    assert.doesNotMatch(sql, /\bDELETE\b/i);
    assert.doesNotMatch(sql, /\bDROP INDEX\b/i);
    assert.doesNotMatch(sql, /CREATE\s+INDEX\s+CONCURRENTLY/i);
    assert.doesNotMatch(sql, /\bADD CONSTRAINT\b/i);
  });

  it("4) indices opcionais P2/P3 do PERF 06 nao foram incluidos sem EXPLAIN", () => {
    const sql = read(MIGRATION);
    assert.doesNotMatch(sql, /open_syncedAt_dueDate/);
    assert.doesNotMatch(sql, /SalesOrder_status_issueDate/);
    assert.doesNotMatch(sql, /NomusNfe_authorized_market/);
    assert.doesNotMatch(sql, /SalesOrder_present_createdAt/);
    assert.doesNotMatch(sql, /SalesOrderNfeLink_valid_for_invoice/);
  });

  it("5) parciais AR/AP nao entram no schema Prisma (suporte WHERE ausente)", () => {
    const schema = read("prisma/schema.prisma");
    assert.doesNotMatch(schema, /open_dueDate_idx/);
    assert.doesNotMatch(schema, /balanceReceivable.*@@index/);
  });
});
