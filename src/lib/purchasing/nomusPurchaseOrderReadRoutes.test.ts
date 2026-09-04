import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildNomusPurchaseOrderListWhere,
  parseNomusPurchaseOrderListQuery,
} from "../nomus/nomusPurchaseOrderReadService.server.js";

test("parseNomusPurchaseOrderListQuery — defaults seguros com query vazia", () => {
  const parsed = parseNomusPurchaseOrderListQuery({});
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 25);
  assert.equal(parsed.sortBy, "issueDate");
  assert.equal(parsed.sortDir, "desc");
  assert.equal(parsed.dateFrom, null);
});

test("parseNomusPurchaseOrderListQuery — pageSize é limitado a 200 (evita full scan acidental)", () => {
  const parsed = parseNomusPurchaseOrderListQuery({ pageSize: "99999" });
  assert.equal(parsed.pageSize, 200);
});

test("parseNomusPurchaseOrderListQuery — page nunca fica abaixo de 1", () => {
  assert.equal(parseNomusPurchaseOrderListQuery({ page: "-5" }).page, 1);
  assert.equal(parseNomusPurchaseOrderListQuery({ page: "0" }).page, 1);
});

test("parseNomusPurchaseOrderListQuery — sortBy inválido cai para issueDate (nunca quebra a query)", () => {
  const parsed = parseNomusPurchaseOrderListQuery({ sortBy: "'; DROP TABLE" });
  assert.equal(parsed.sortBy, "issueDate");
});

test("parseNomusPurchaseOrderListQuery — filtros de data/fornecedor/comprador/empresa/produto são parseados", () => {
  const parsed = parseNomusPurchaseOrderListQuery({
    dateFrom: "2026-01-01",
    dateTo: "2026-12-31",
    supplierId: "5001",
    buyerId: "701",
    companyId: "1",
    productId: "40001",
    stage: "LIBERADO",
    status: "2",
    code: "PC-9",
  });
  assert.ok(parsed.dateFrom instanceof Date);
  assert.ok(parsed.dateTo instanceof Date);
  assert.equal(parsed.externalSupplierId, 5001);
  assert.equal(parsed.externalBuyerId, 701);
  assert.equal(parsed.externalCompanyId, 1);
  assert.equal(parsed.externalProductId, 40001);
  assert.equal(parsed.derivedStage, "LIBERADO");
  assert.equal(parsed.nomusStatusCode, "2");
  assert.equal(parsed.code, "PC-9");
});

test("buildNomusPurchaseOrderListWhere — sem filtros produz where vazio", () => {
  const where = buildNomusPurchaseOrderListWhere(parseNomusPurchaseOrderListQuery({}));
  assert.deepEqual(where, {});
});

test("buildNomusPurchaseOrderListWhere — filtro de produto vira busca em items.some", () => {
  const where = buildNomusPurchaseOrderListWhere(
    parseNomusPurchaseOrderListQuery({ productId: "40001" })
  );
  assert.deepEqual(where.items, { some: { externalProductId: 40001 } });
});

test("buildNomusPurchaseOrderListWhere — filtro de data monta gte/lte", () => {
  const where = buildNomusPurchaseOrderListWhere(
    parseNomusPurchaseOrderListQuery({ dateFrom: "2026-01-01", dateTo: "2026-01-31" })
  );
  assert.ok(where.issueDate);
});

test("buildNomusPurchaseOrderListWhere — código usa contains case-insensitive", () => {
  const where = buildNomusPurchaseOrderListWhere(
    parseNomusPurchaseOrderListQuery({ code: "pc-9" })
  );
  assert.deepEqual(where.code, { contains: "pc-9", mode: "insensitive" });
});
