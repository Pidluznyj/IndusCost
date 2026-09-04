import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildNomusSupplierAliasIndex,
  matchNomusPurchaseOrderSupplier,
} from "./nomusPurchaseOrderSupplierMatch.js";

test("matching de fornecedor — externalSupplierId exato com 1 alias → MATCHED", () => {
  const index = buildNomusSupplierAliasIndex([
    { externalSupplierId: 5001, supplierId: "supplier-a" },
  ]);
  const result = matchNomusPurchaseOrderSupplier(5001, index);
  assert.equal(result.status, "MATCHED");
  assert.equal(result.financialSupplierId, "supplier-a");
});

test("matching de fornecedor — nenhum alias → UNMATCHED (não bloqueia importação)", () => {
  const index = buildNomusSupplierAliasIndex([]);
  const result = matchNomusPurchaseOrderSupplier(9999, index);
  assert.equal(result.status, "UNMATCHED");
  assert.equal(result.financialSupplierId, null);
  assert.equal(result.reason, "NO_ALIAS_FOUND");
});

test("matching de fornecedor — mais de um alias conflitante → AMBIGUOUS, nunca escolhe o primeiro", () => {
  const index = buildNomusSupplierAliasIndex([
    { externalSupplierId: 5001, supplierId: "supplier-a" },
    { externalSupplierId: 5001, supplierId: "supplier-b" },
  ]);
  const result = matchNomusPurchaseOrderSupplier(5001, index);
  assert.equal(result.status, "AMBIGUOUS");
  assert.equal(result.financialSupplierId, null);
});

test("matching de fornecedor — múltiplos aliases apontando pro MESMO supplierId não é ambiguidade", () => {
  const index = buildNomusSupplierAliasIndex([
    { externalSupplierId: 5001, supplierId: "supplier-a" },
    { externalSupplierId: 5001, supplierId: "supplier-a" },
  ]);
  const result = matchNomusPurchaseOrderSupplier(5001, index);
  assert.equal(result.status, "MATCHED");
  assert.equal(result.financialSupplierId, "supplier-a");
});

test("matching de fornecedor — externalSupplierId ausente/inválido → UNMATCHED, nunca falha", () => {
  const index = buildNomusSupplierAliasIndex([
    { externalSupplierId: 5001, supplierId: "supplier-a" },
  ]);
  assert.equal(matchNomusPurchaseOrderSupplier(null, index).status, "UNMATCHED");
  assert.equal(matchNomusPurchaseOrderSupplier(undefined, index).status, "UNMATCHED");
});

test("matching de fornecedor — nome parecido com ID diferente NÃO vincula (só ID importa)", () => {
  // Este motor nunca recebe nome — só externalSupplierId. Um id diferente
  // do cadastrado nunca casa, independentemente de qualquer semelhança de
  // nome que o chamador possa ter (o chamador nunca passa nome aqui).
  const index = buildNomusSupplierAliasIndex([
    { externalSupplierId: 5001, supplierId: "supplier-a" },
  ]);
  const result = matchNomusPurchaseOrderSupplier(5002, index);
  assert.equal(result.status, "UNMATCHED");
});

test("buildNomusSupplierAliasIndex — aliases com externalSupplierId inválido são ignorados", () => {
  const index = buildNomusSupplierAliasIndex([
    { externalSupplierId: null, supplierId: "supplier-x" },
  ]);
  assert.equal(index.size, 0);
});
