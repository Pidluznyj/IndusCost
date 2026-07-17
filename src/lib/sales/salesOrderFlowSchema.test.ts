import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCHEMA = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260801120000_sales_order_flow_lifecycle_snapshots/migration.sql"
  ),
  "utf8"
);

describe("salesOrderFlow Prisma schema (OP-52)", () => {
  it("declara os 4 models derivados", () => {
    for (const model of [
      "model SalesOrderItemFlowSnapshot",
      "model SalesOrderFlowSnapshot",
      "model SalesOrderFlowEvent",
      "model SalesOrderFlowManagement",
    ]) {
      assert.match(SCHEMA, new RegExp(model));
    }
  });

  it("item snapshot: salesOrderItemId único + fingerprint/versão/computedAt", () => {
    assert.match(
      SCHEMA,
      /model SalesOrderItemFlowSnapshot[\s\S]*salesOrderItemId\s+String\s+@unique\s+@db\.Uuid/
    );
    assert.match(
      SCHEMA,
      /model SalesOrderItemFlowSnapshot[\s\S]*fingerprint\s+String/
    );
    assert.match(
      SCHEMA,
      /model SalesOrderItemFlowSnapshot[\s\S]*computationVersion\s+String/
    );
    assert.match(
      SCHEMA,
      /model SalesOrderItemFlowSnapshot[\s\S]*computedAt\s+DateTime\s+@db\.Timestamptz\(6\)/
    );
  });

  it("pedido snapshot: salesOrderId único + gargalo + valores Decimal", () => {
    assert.match(
      SCHEMA,
      /model SalesOrderFlowSnapshot[\s\S]*salesOrderId\s+String\s+@unique\s+@db\.Uuid/
    );
    assert.match(
      SCHEMA,
      /model SalesOrderFlowSnapshot[\s\S]*bottleneckStage\s+String\?/
    );
    assert.match(
      SCHEMA,
      /model SalesOrderFlowSnapshot[\s\S]*orderValue\s+Decimal\s+@default\(0\)\s+@db\.Decimal\(20,\s*6\)/
    );
    assert.match(
      SCHEMA,
      /model SalesOrderFlowSnapshot[\s\S]*isInActiveOperationalColumn\s+Boolean/
    );
  });

  it("evento é append-only com dedupeKey única, sem updatedAt, com observedAt", () => {
    const eventBlock = SCHEMA.match(
      /model SalesOrderFlowEvent \{[\s\S]*?\n\}/
    )?.[0];
    assert.ok(eventBlock);
    assert.match(eventBlock!, /dedupeKey\s+String\s+@unique/);
    assert.doesNotMatch(eventBlock!, /updatedAt/);
    assert.match(eventBlock!, /occurredAt\s+DateTime/);
    assert.match(eventBlock!, /observedAt\s+DateTime\?/);
  });

  it("management guarda prioridade, bloqueio e nota interna (1:1 pedido)", () => {
    assert.match(
      SCHEMA,
      /model SalesOrderFlowManagement[\s\S]*salesOrderId\s+String\s+@unique\s+@db\.Uuid/
    );
    assert.match(
      SCHEMA,
      /model SalesOrderFlowManagement[\s\S]*priority\s+String\s+@default\("NORMAL"\)/
    );
    assert.match(
      SCHEMA,
      /model SalesOrderFlowManagement[\s\S]*isBlocked\s+Boolean/
    );
    assert.match(
      SCHEMA,
      /model SalesOrderFlowManagement[\s\S]*expectedResolutionAt/
    );
    assert.match(
      SCHEMA,
      /model SalesOrderFlowManagement[\s\S]*internalNote\s+String\?/
    );
  });

  it("SalesOrder/SalesOrderItem só ganham back-relations (sem nova SalesOrder)", () => {
    assert.match(SCHEMA, /model SalesOrder \{[\s\S]*flowSnapshot\s+SalesOrderFlowSnapshot\?/);
    assert.match(SCHEMA, /model SalesOrder \{[\s\S]*flowManagement\s+SalesOrderFlowManagement\?/);
    assert.match(SCHEMA, /model SalesOrderItem \{[\s\S]*flowItemSnapshot\s+SalesOrderItemFlowSnapshot\?/);
    assert.doesNotMatch(SCHEMA, /model KanbanSalesOrder\b/);
  });

  it("índices Kanban presentes no schema", () => {
    assert.match(
      SCHEMA,
      /model SalesOrderFlowSnapshot[\s\S]*@@index\(\[currentStage, isInActiveOperationalColumn\]\)/
    );
    assert.match(
      SCHEMA,
      /model SalesOrderItemFlowSnapshot[\s\S]*@@index\(\[currentStage, isActiveForKanban\]\)/
    );
    assert.match(
      SCHEMA,
      /model SalesOrderFlowEvent[\s\S]*@@index\(\[salesOrderId, occurredAt\(sort: Desc\)\]\)/
    );
  });

  it("migration cria as 4 tabelas e uniques oficiais", () => {
    assert.match(MIGRATION, /CREATE TABLE "SalesOrderItemFlowSnapshot"/);
    assert.match(MIGRATION, /CREATE TABLE "SalesOrderFlowSnapshot"/);
    assert.match(MIGRATION, /CREATE TABLE "SalesOrderFlowEvent"/);
    assert.match(MIGRATION, /CREATE TABLE "SalesOrderFlowManagement"/);
    assert.match(
      MIGRATION,
      /CREATE UNIQUE INDEX "SalesOrderItemFlowSnapshot_salesOrderItemId_key"/
    );
    assert.match(
      MIGRATION,
      /CREATE UNIQUE INDEX "SalesOrderFlowSnapshot_salesOrderId_key"/
    );
    assert.match(
      MIGRATION,
      /CREATE UNIQUE INDEX "SalesOrderFlowEvent_dedupeKey_key"/
    );
    assert.match(
      MIGRATION,
      /CREATE UNIQUE INDEX "SalesOrderFlowManagement_salesOrderId_key"/
    );
  });

  it("migration não altera colunas oficiais de SalesOrder/SalesOrderItem", () => {
    assert.doesNotMatch(MIGRATION, /ALTER TABLE "SalesOrder" ADD COLUMN/);
    assert.doesNotMatch(MIGRATION, /ALTER TABLE "SalesOrderItem" ADD COLUMN/);
    assert.match(MIGRATION, /Sem backfill/i);
  });

  it("migration OP-55 adiciona observedAt no evento", () => {
    const observedMigration = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/20260802120000_sales_order_flow_event_observed_at/migration.sql"
      ),
      "utf8"
    );
    assert.match(observedMigration, /ADD COLUMN "observedAt"/);
    assert.doesNotMatch(observedMigration, /ALTER TABLE "SalesOrder" ADD COLUMN/);
  });
});
