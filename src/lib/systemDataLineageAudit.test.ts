import assert from "node:assert/strict";
import test from "node:test";
import {
  CRITICAL_LINEAGE_IDS,
  SYSTEM_DATA_LINEAGE,
  assertCriticalLineageCoverage,
  getSystemDataLineageEntry,
  summarizeSystemDataLineage,
} from "./systemDataLineageAudit.js";

test("matriz de rastreabilidade existe e não está vazia", () => {
  assert.ok(SYSTEM_DATA_LINEAGE.length >= 15);
});

test("cada módulo crítico tem pelo menos uma entrada", () => {
  const modules = new Set(SYSTEM_DATA_LINEAGE.map((e) => e.module));
  for (const mod of ["Financeiro", "Comercial", "CRM", "Nomus"]) {
    assert.ok(modules.has(mod), `módulo ${mod} ausente`);
  }
  const coverage = assertCriticalLineageCoverage();
  assert.equal(coverage.ok, true, `faltando: ${coverage.missing.join(", ")}`);
});

test("Contas a Receber aponta para NomusAccountsReceivable", () => {
  const entry = getSystemDataLineageEntry("finance-ar")!;
  assert.ok(entry.prismaModels.includes("NomusAccountsReceivable"));
  assert.ok(entry.backendEndpoints.some((e) => e.includes("accounts-receivable")));
  assert.equal(entry.status, "ok");
});

test("Contas a Pagar aponta para NomusAccountsPayable", () => {
  const entry = getSystemDataLineageEntry("finance-ap")!;
  assert.ok(entry.prismaModels.includes("NomusAccountsPayable"));
  assert.equal(entry.status, "ok");
});

test("Fluxo de Caixa deriva de AR/AP oficiais", () => {
  const entry = getSystemDataLineageEntry("finance-cash-flow")!;
  assert.ok(entry.prismaModels.includes("NomusAccountsReceivable"));
  assert.ok(entry.prismaModels.includes("NomusAccountsPayable"));
  assert.equal(entry.status, "derived");
  assert.ok(entry.derivedFrom.some((d) => d.toLowerCase().includes("receivable")));
  assert.ok(entry.derivedFrom.some((d) => d.toLowerCase().includes("payable")));
});

test("Relatório Presidencial deriva de fontes oficiais", () => {
  const entry = getSystemDataLineageEntry("finance-executive-report")!;
  assert.ok(entry.derivedFrom.length >= 3);
  assert.equal(entry.status, "derived");
  assert.ok(entry.prismaModels.includes("SalesOrder"));
});

test("Cliente 360º usa Customer/SalesOrder/AR canônico", () => {
  const entry = getSystemDataLineageEntry("customer-intelligence")!;
  assert.ok(entry.prismaModels.includes("Customer"));
  assert.ok(entry.prismaModels.includes("SalesOrder"));
  assert.ok(entry.prismaModels.includes("NomusAccountsReceivable"));
  assert.equal(entry.status, "ok");
});

test("Produtos Vendidos usa SalesOrder/SalesOrderItem", () => {
  const entry = getSystemDataLineageEntry("sold-products")!;
  assert.ok(entry.prismaModels.includes("SalesOrder"));
  assert.ok(entry.prismaModels.includes("SalesOrderItem"));
  assert.equal(entry.status, "ok");
});

test("Clientes compradores do produto usa SalesOrder/SalesOrderItem", () => {
  const entry = getSystemDataLineageEntry("sold-product-customers")!;
  assert.ok(entry.prismaModels.includes("SalesOrder"));
  assert.ok(entry.prismaModels.includes("SalesOrderItem"));
});

test("nenhuma funcionalidade crítica fica com status pending", () => {
  const critical = SYSTEM_DATA_LINEAGE.filter((e) =>
    (CRITICAL_LINEAGE_IDS as readonly string[]).includes(e.id)
  );
  assert.ok(critical.every((e) => e.status !== "pending"));
});

test("nenhuma entrada da matriz principal fica pending", () => {
  const summary = summarizeSystemDataLineage();
  assert.equal(summary.pendingIds.length, 0, summary.pendingIds.join(", "));
});

test("matriz diferencia dado real de label/texto de UI", () => {
  const uiOnly = SYSTEM_DATA_LINEAGE.filter((e) => e.status === "static-ui");
  const real = SYSTEM_DATA_LINEAGE.filter((e) => e.status === "ok" || e.status === "derived");
  assert.ok(real.length > uiOnly.length);
  for (const e of real) {
    assert.ok(
      e.prismaModels.length > 0 ||
        e.externalSources.length > 0 ||
        e.derivedFrom.length > 0,
      `${e.id} sem fonte identificada`
    );
  }
});

test("resumo da matriz não produz NaN/Infinity", () => {
  const summary = summarizeSystemDataLineage();
  const values = Object.values(summary.byStatus);
  assert.ok(values.every((v) => Number.isFinite(v)));
  assert.equal(summary.total, values.reduce((a, b) => a + b, 0));
});

test("Atrasados AR deriva de base AR", () => {
  const entry = getSystemDataLineageEntry("finance-ar-overdue")!;
  assert.ok(entry.prismaModels.includes("NomusAccountsReceivable"));
  assert.equal(entry.status, "derived");
});

test("Nomus sync lista modelos de integração", () => {
  const entry = getSystemDataLineageEntry("nomus-sync")!;
  assert.ok(entry.prismaModels.includes("IntegrationRun"));
  assert.ok(entry.externalSources.some((s) => s.toLowerCase().includes("nomus")));
});

test("Uso de Matéria-Prima deriva de SalesOrder e BOM", () => {
  const entry = getSystemDataLineageEntry("material-demand")!;
  assert.ok(entry.prismaModels.includes("SalesOrder"));
  assert.ok(entry.prismaModels.includes("ProductBOM"));
});
