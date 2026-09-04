import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mapNomusPurchaseOrderPayload,
  resolveNomusPurchaseOrderItemLineNumber,
  stableNomusPurchaseOrderPayloadHash,
} from "./nomusPurchaseOrderPayload.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "__fixtures__", "purchaseOrders");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

test("mapNomusPurchaseOrderPayload — list completo (sem itens) mapeia cabeçalho", () => {
  const listPage = loadFixture("listPage1.json") as { pedidosCompra: unknown[] };
  const mapped = mapNomusPurchaseOrderPayload(listPage.pedidosCompra[0]);
  assert.equal(mapped.header.externalId, 90001);
  assert.equal(mapped.header.code, "PC-90001");
  assert.equal(mapped.header.externalSupplierId, 5001);
  assert.equal(mapped.items.length, 0);
});

test("mapNomusPurchaseOrderPayload — list+detail: detail traz itens completos", () => {
  const detail = loadFixture("detail90001Released.json");
  const mapped = mapNomusPurchaseOrderPayload(detail);
  assert.equal(mapped.header.externalId, 90001);
  assert.equal(mapped.items.length, 1);
  assert.equal(mapped.items[0].externalProductId, 40001);
  assert.equal(mapped.items[0].quantityOrdered, 500);
  assert.equal(mapped.items[0].nomusStatusCode, "2");
});

test("mapNomusPurchaseOrderPayload — pedido sem itens não quebra (items = [])", () => {
  const mapped = mapNomusPurchaseOrderPayload({ id: 1, codigoPedido: "PC-1" });
  assert.deepEqual(mapped.items, []);
});

test("mapNomusPurchaseOrderPayload — item sem produto (externalProductId null) preservado, não quebra lote", () => {
  const detail = loadFixture("detail90006CutOffAndUnknown.json");
  const mapped = mapNomusPurchaseOrderPayload(detail);
  assert.equal(mapped.items.length, 2);
  assert.equal(mapped.items[1].externalProductId, null);
  assert.equal(mapped.header.externalSupplierId, null);
});

test("mapNomusPurchaseOrderPayload — status desconhecido do item é preservado bruto (não normalizado/perdido)", () => {
  const detail = loadFixture("detail90006CutOffAndUnknown.json");
  const mapped = mapNomusPurchaseOrderPayload(detail);
  assert.equal(mapped.items[1].nomusStatusCode, "99");
});

test("mapNomusPurchaseOrderPayload — valores decimais preservados sem arredondar", () => {
  const detail = loadFixture("detail90001Released.json") as Record<string, unknown>;
  const mapped = mapNomusPurchaseOrderPayload({ ...detail, valorFrete: "150,75" });
  assert.equal(mapped.header.freightValue, 150.75);
});

test("mapNomusPurchaseOrderPayload — payload malformado (não objeto) não lança, retorna vazio", () => {
  assert.doesNotThrow(() => mapNomusPurchaseOrderPayload(null));
  assert.doesNotThrow(() => mapNomusPurchaseOrderPayload("string malformada"));
  assert.doesNotThrow(() => mapNomusPurchaseOrderPayload(42));
  const mapped = mapNomusPurchaseOrderPayload(undefined);
  assert.equal(mapped.header.externalId, null);
  assert.deepEqual(mapped.items, []);
});

test("resolveNomusPurchaseOrderItemLineNumber — usa sequência quando presente", () => {
  const mapped = mapNomusPurchaseOrderPayload(loadFixture("detail90002Partial.json"));
  assert.equal(resolveNomusPurchaseOrderItemLineNumber(mapped.items[0], 0), 1);
  assert.equal(resolveNomusPurchaseOrderItemLineNumber(mapped.items[1], 1), 2);
});

test("resolveNomusPurchaseOrderItemLineNumber — cai para índice+1 quando sequência ausente/inválida", () => {
  const mapped = mapNomusPurchaseOrderPayload({
    id: 1,
    itens: [{ idProduto: 1 }, { idProduto: 2 }],
  });
  assert.equal(resolveNomusPurchaseOrderItemLineNumber(mapped.items[0], 0), 1);
  assert.equal(resolveNomusPurchaseOrderItemLineNumber(mapped.items[1], 1), 2);
});

test("stableNomusPurchaseOrderPayloadHash — mesmo conteúdo, ordem de chaves diferente → mesmo hash (canonicalização)", () => {
  const a = { id: 1, codigoPedido: "PC-1", valorTotal: 10 };
  const b = { valorTotal: 10, id: 1, codigoPedido: "PC-1" };
  assert.equal(stableNomusPurchaseOrderPayloadHash(a), stableNomusPurchaseOrderPayloadHash(b));
});

test("stableNomusPurchaseOrderPayloadHash — mudança de valor gera hash diferente (idempotência/UPDATE detection)", () => {
  const a = { id: 1, valorTotal: 10 };
  const b = { id: 1, valorTotal: 20 };
  assert.notEqual(
    stableNomusPurchaseOrderPayloadHash(a),
    stableNomusPurchaseOrderPayloadHash(b)
  );
});

test("stableNomusPurchaseOrderPayloadHash — mesmo payload rodado 2x produz hash idêntico (apply idempotente)", () => {
  const detail = loadFixture("detail90001Released.json");
  const h1 = stableNomusPurchaseOrderPayloadHash(detail);
  const h2 = stableNomusPurchaseOrderPayloadHash(detail);
  assert.equal(h1, h2);
});

test("stableNomusPurchaseOrderPayloadHash — arrays de itens em ordem diferente produzem hash diferente (posição importa para chave de linha)", () => {
  const a = { itens: [{ id: 1 }, { id: 2 }] };
  const b = { itens: [{ id: 2 }, { id: 1 }] };
  assert.notEqual(
    stableNomusPurchaseOrderPayloadHash(a),
    stableNomusPurchaseOrderPayloadHash(b)
  );
});
