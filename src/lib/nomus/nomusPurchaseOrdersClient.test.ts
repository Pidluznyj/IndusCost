import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchAllNomusPurchaseOrders,
  hasNomusPurchaseOrdersNextPage,
  pickPurchaseOrdersArrayFromUnknown,
} from "./nomusPurchaseOrdersClient.js";

function makePage(ids: number[], totalPaginas: number) {
  return { pedidosCompra: ids.map((id) => ({ id, codigoPedido: `PC-${id}` })), totalPaginas };
}

test("pickPurchaseOrdersArrayFromUnknown — envelope pedidosCompra", () => {
  const rows = pickPurchaseOrdersArrayFromUnknown(makePage([1, 2], 1));
  assert.equal(rows.length, 2);
});

test("pickPurchaseOrdersArrayFromUnknown — array bruto", () => {
  const rows = pickPurchaseOrdersArrayFromUnknown([{ id: 1 }]);
  assert.equal(rows.length, 1);
});

test("pickPurchaseOrdersArrayFromUnknown — payload sem array reconhecido → []", () => {
  assert.deepEqual(pickPurchaseOrdersArrayFromUnknown({ foo: "bar" }), []);
  assert.deepEqual(pickPurchaseOrdersArrayFromUnknown(null), []);
});

test("hasNomusPurchaseOrdersNextPage — usa totalPaginas quando presente", () => {
  assert.equal(hasNomusPurchaseOrdersNextPage(makePage([1], 3), 1, 1), true);
  assert.equal(hasNomusPurchaseOrdersNextPage(makePage([1], 3), 3, 1), false);
});

test("fetchAllNomusPurchaseOrders — primeira página única (sem próxima) → 1 page, stopReason no_next", async () => {
  const fetchJson = async () => makePage([1, 2], 1);
  const result = await fetchAllNomusPurchaseOrders({
    baseUrl: "http://example.test",
    maxPages: 10,
    fetchJson,
  });
  assert.equal(result.rows.length, 2);
  assert.equal(result.pagesRead, 1);
  assert.equal(result.stopReason, "no_next");
});

test("fetchAllNomusPurchaseOrders — múltiplas páginas concatenam pedidos", async () => {
  let call = 0;
  const fetchJson = async () => {
    call += 1;
    if (call === 1) return makePage([1, 2], 3);
    if (call === 2) return makePage([3, 4], 3);
    return makePage([5], 3);
  };
  const result = await fetchAllNomusPurchaseOrders({
    baseUrl: "http://example.test",
    maxPages: 10,
    fetchJson,
  });
  assert.equal(result.rows.length, 5);
  assert.equal(result.pagesRead, 3);
  assert.equal(result.stopReason, "no_next");
});

test("fetchAllNomusPurchaseOrders — última página vazia encerra com empty_page", async () => {
  let call = 0;
  const fetchJson = async () => {
    call += 1;
    if (call === 1) return { pedidosCompra: [{ id: 1 }] };
    return { pedidosCompra: [] };
  };
  const result = await fetchAllNomusPurchaseOrders({
    baseUrl: "http://example.test",
    maxPages: 10,
    fetchJson,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.stopReason, "empty_page");
});

test("fetchAllNomusPurchaseOrders — última página curta (sem hasMore/totalPaginas) encerra por heurística", async () => {
  let call = 0;
  const fetchJson = async () => {
    call += 1;
    if (call === 1) return { pedidosCompra: [{ id: 1 }, { id: 2 }] };
    if (call === 2) return { pedidosCompra: [{ id: 3 }] };
    return { pedidosCompra: [] };
  };
  const result = await fetchAllNomusPurchaseOrders({
    baseUrl: "http://example.test",
    maxPages: 10,
    fetchJson,
  });
  assert.equal(result.rows.length, 3);
});

test("fetchAllNomusPurchaseOrders — página repetida (mesmo fingerprint) detecta loop e para", async () => {
  const fetchJson = async () => makePage([1, 2], 99); // sempre "tem próxima" — loop simulado
  const result = await fetchAllNomusPurchaseOrders({
    baseUrl: "http://example.test",
    maxPages: 10,
    fetchJson,
  });
  assert.equal(result.stopReason, "repeated_page");
  assert.equal(result.pagesRead, 1);
});

test("fetchAllNomusPurchaseOrders — maxPages atingido sem prova de fim → erro explícito (stopReason max_pages)", async () => {
  let call = 0;
  const fetchJson = async () => {
    call += 1;
    return makePage([call * 10, call * 10 + 1], 9999); // sempre indica mais páginas, ids sempre novos
  };
  const result = await fetchAllNomusPurchaseOrders({
    baseUrl: "http://example.test",
    maxPages: 3,
    fetchJson,
  });
  assert.equal(result.pagesRead, 3);
  assert.equal(result.stopReason, "max_pages");
});

test("fetchAllNomusPurchaseOrders — erro HTTP para o lote sem lançar (stopReason http_error, erro registrado)", async () => {
  const fetchJson = async () => {
    throw new Error("Falha HTTP 500 em http://example.test");
  };
  const result = await fetchAllNomusPurchaseOrders({
    baseUrl: "http://example.test",
    maxPages: 10,
    fetchJson,
  });
  assert.equal(result.stopReason, "http_error");
  assert.equal(result.errors.length, 1);
});

test("fetchAllNomusPurchaseOrders — id repetido ENTRE páginas diferentes não é tratado como loop (fingerprints diferentes)", async () => {
  let call = 0;
  const fetchJson = async () => {
    call += 1;
    if (call === 1) return makePage([1, 2], 2);
    return makePage([2, 3], 2); // id 2 repetido, mas página com conteúdo diferente (id 3 novo)
  };
  const result = await fetchAllNomusPurchaseOrders({
    baseUrl: "http://example.test",
    maxPages: 10,
    fetchJson,
  });
  assert.equal(result.stopReason, "no_next");
  assert.equal(result.rows.length, 4); // dedup por externalId é responsabilidade do chamador (sync), não do client
});
