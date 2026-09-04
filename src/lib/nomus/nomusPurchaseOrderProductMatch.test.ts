import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildNomusProductMatchIndex,
  matchNomusPurchaseOrderProduct,
} from "./nomusPurchaseOrderProductMatch.js";

test("matching de produto — externalProductId exato (number) → MATCHED", () => {
  const index = buildNomusProductMatchIndex([
    { externalProductId: 40001, materialId: "material-a", inventoryItemId: null },
  ]);
  const result = matchNomusPurchaseOrderProduct(40001, index);
  assert.equal(result.status, "MATCHED");
  assert.equal(result.materialId, "material-a");
});

test("matching de produto — String vs Int do mesmo id casam (chave normalizada)", () => {
  const index = buildNomusProductMatchIndex([
    { externalProductId: "40001", materialId: "material-a", inventoryItemId: null },
  ]);
  const result = matchNomusPurchaseOrderProduct(40001, index);
  assert.equal(result.status, "MATCHED");
  assert.equal(result.materialId, "material-a");
});

test("matching de produto — não encontrado → UNMATCHED, não bloqueia importação", () => {
  const index = buildNomusProductMatchIndex([]);
  const result = matchNomusPurchaseOrderProduct(99999, index);
  assert.equal(result.status, "UNMATCHED");
  assert.equal(result.materialId, null);
  assert.equal(result.inventoryItemId, null);
});

test("matching de produto — descrição igual com ID diferente NÃO vincula (motor não recebe descrição)", () => {
  const index = buildNomusProductMatchIndex([
    { externalProductId: 40001, materialId: "material-a", inventoryItemId: null },
  ]);
  const result = matchNomusPurchaseOrderProduct(40002, index);
  assert.equal(result.status, "UNMATCHED");
});

test("matching de produto — externalProductId ausente → UNMATCHED", () => {
  const index = buildNomusProductMatchIndex([
    { externalProductId: 40001, materialId: "material-a", inventoryItemId: null },
  ]);
  assert.equal(matchNomusPurchaseOrderProduct(null, index).status, "UNMATCHED");
  assert.equal(matchNomusPurchaseOrderProduct(undefined, index).status, "UNMATCHED");
});

test("matching de produto — bridge só com inventoryItemId (sem material) ainda casa", () => {
  const index = buildNomusProductMatchIndex([
    { externalProductId: 40005, materialId: null, inventoryItemId: "inv-1" },
  ]);
  const result = matchNomusPurchaseOrderProduct(40005, index);
  assert.equal(result.status, "MATCHED");
  assert.equal(result.inventoryItemId, "inv-1");
  assert.equal(result.materialId, null);
});

test("buildNomusProductMatchIndex — duplicata preserva a primeira entrada (determinístico)", () => {
  const index = buildNomusProductMatchIndex([
    { externalProductId: 40001, materialId: "material-a", inventoryItemId: null },
    { externalProductId: 40001, materialId: "material-b", inventoryItemId: null },
  ]);
  const result = matchNomusPurchaseOrderProduct(40001, index);
  assert.equal(result.materialId, "material-a");
});
