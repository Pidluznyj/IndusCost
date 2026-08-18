import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const src = readFileSync(join(process.cwd(), "scripts/verify-crm-vs-sales-orders.ts"), "utf8");

/**
 * O verificador é a prova de campo da reconciliação PV × CRM. Ele precisa ser
 * read-only e comparar os dois lados pela fonte de cada um.
 */
describe("verificador PV × CRM", () => {
  it("é somente leitura — nenhuma escrita no banco", () => {
    for (const forbidden of [
      ".create(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".executeRaw",
      "TRUNCATE",
      "INSERT",
      "UPDATE ",
    ]) {
      assert.ok(!src.includes(forbidden), `verificador não pode conter ${forbidden}`);
    }
  });

  it("lê o lado oficial pelo construtor e motor de Pedidos de Venda", () => {
    assert.match(src, /buildSalesOrderListWhere/);
    assert.match(src, /resolveOfficialScopedOrderMetrics/);
    assert.match(src, /excludeEconomicGroupCustomers: true/);
  });

  it("lê o lado CRM pelo serviço do cockpit", () => {
    assert.match(src, /loadCrmSalesOrderMetrics/);
  });

  it("cobre os quatro indicadores acordados", () => {
    for (const indicator of [
      "total de pedidos",
      "valor vendido",
      "quantidade em carteira",
      "valor em carteira",
    ]) {
      assert.ok(src.includes(indicator), `falta o indicador: ${indicator}`);
    }
  });

  it("exige delta zero — sem tolerância", () => {
    assert.ok(src.includes('delta === 0 ? "OK" : "DIVERGENTE"'));
  });

  it("cobre os períodos combinados (ano, mês atual, mês fechado, todos os anos)", () => {
    assert.match(src, /mês atual/);
    assert.match(src, /mês fechado/);
    assert.match(src, /todos os anos/);
  });

  it("avisa quando a carga do CRM truncou (número subestimado)", () => {
    assert.match(src, /truncated/);
  });
});
