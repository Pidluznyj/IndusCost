import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractNomusPedidoIdentity,
  fetchNomusPedidosForAudit,
  hasNomusPedidosNextPage,
  lookupNomusPedidoByOrderCode,
  pickPedidosArrayFromUnknown,
} from "./nomusSalesOrdersClient.js";

describe("nomusSalesOrdersClient", () => {
  it("pickPedidosArrayFromUnknown aceita formatos comuns", () => {
    assert.equal(pickPedidosArrayFromUnknown([{ id: 1 }]).length, 1);
    assert.equal(pickPedidosArrayFromUnknown({ pedidos: [{ id: 1 }] }).length, 1);
    assert.equal(pickPedidosArrayFromUnknown({ data: { pedidos: [{ id: 2 }] } }).length, 1);
  });

  it("hasNomusPedidosNextPage usa totalPaginas e tamanho", () => {
    assert.equal(hasNomusPedidosNextPage({ totalPaginas: 2 }, 1, 500), true);
    assert.equal(hasNomusPedidosNextPage({ totalPaginas: 2 }, 2, 10), false);
    assert.equal(hasNomusPedidosNextPage({}, 1, 0), false);
  });

  it("extractNomusPedidoIdentity lê id e codigoPedido", () => {
    const id = extractNomusPedidoIdentity({
      id: 2737,
      codigoPedido: "PD 02739",
      dataEmissao: "10/07/2026",
    });
    assert.equal(id.externalSalesOrderId, 2737);
    assert.equal(id.orderCodeKey, "PD:2739");
  });

  it("7. HTTP 429 recuperado → continua e completa", async () => {
    let calls = 0;
    const fetchJson = async () => {
      calls += 1;
      if (calls === 1) {
        // Simula que o wrapper já recuperou 429 e devolveu página válida.
        return { pedidos: [{ id: 1, codigoPedido: "PD 00001", dataEmissao: "15/07/2026" }] };
      }
      return { pedidos: [] };
    };

    const result = await fetchNomusPedidosForAudit({
      baseUrl: "https://example.test/rest/",
      from: new Date(Date.UTC(2026, 6, 1)),
      to: new Date(Date.UTC(2026, 6, 31)),
      pageSize: 500,
      maxPages: 10,
      fetchJson: fetchJson as never,
      env: {},
    });

    // Dispara onRetryableStatus via fetch real não ocorre aqui; validamos caminho happy.
    assert.equal(result.completeness.complete, true);
    assert.equal(result.completeness.status, "COMPLETE");
    assert.equal(result.pedidos.length, 1);
  });

  it("8. HTTP 429 não recuperado → INCONCLUSIVE_FETCH", async () => {
    const fetchJson = async () => {
      throw new Error("Falha HTTP 429 em https://example.test/rest/pedidos: rate limit");
    };
    const result = await fetchNomusPedidosForAudit({
      baseUrl: "https://example.test/rest/",
      from: new Date(Date.UTC(2026, 6, 1)),
      to: new Date(Date.UTC(2026, 6, 31)),
      fetchJson: fetchJson as never,
      env: {},
    });
    assert.equal(result.completeness.complete, false);
    assert.equal(result.completeness.status, "INCONCLUSIVE_FETCH");
    assert.equal(result.completeness.stopReason, "http_error");
    assert.ok(result.completeness.errors.some((e) => /429/.test(e)));
  });

  it("6. max pages → INCONCLUSIVE_FETCH", async () => {
    const fetchJson = async () => ({
      pedidos: Array.from({ length: 2 }, (_, i) => ({
        id: i + 1,
        codigoPedido: `PD ${String(i + 1).padStart(5, "0")}`,
        dataEmissao: "15/07/2026",
      })),
      totalPaginas: 99,
    });
    const result = await fetchNomusPedidosForAudit({
      baseUrl: "https://example.test/rest/",
      from: new Date(Date.UTC(2026, 6, 1)),
      to: new Date(Date.UTC(2026, 6, 31)),
      pageSize: 2,
      maxPages: 1,
      fetchJson: fetchJson as never,
      env: {},
    });
    assert.equal(result.completeness.complete, false);
    assert.equal(result.completeness.stoppedBecauseMaxPages, true);
    assert.equal(result.completeness.status, "INCONCLUSIVE_FETCH");
  });

  it("startPage != 1 → incompleto sem classificar", async () => {
    const result = await fetchNomusPedidosForAudit({
      baseUrl: "https://example.test/rest/",
      from: new Date(Date.UTC(2026, 6, 1)),
      to: new Date(Date.UTC(2026, 6, 31)),
      startPage: 2,
      fetchJson: (async () => ({ pedidos: [] })) as never,
      env: {},
    });
    assert.equal(result.completeness.complete, false);
    assert.equal(result.pedidos.length, 0);
  });

  it("lookupNomusPedidoByOrderCode encontra PD 02739", async () => {
    const fetchJson = async () => ({
      pedidos: [{ id: 2737, codigoPedido: "PD 02739", dataEmissao: "10/07/2026" }],
    });
    const found = await lookupNomusPedidoByOrderCode({
      baseUrl: "https://example.test/rest/",
      orderCode: "PD 02739",
      from: new Date(Date.UTC(2026, 6, 1)),
      to: new Date(Date.UTC(2026, 6, 31)),
      fetchJson: fetchJson as never,
      env: {},
    });
    assert.equal(found.status, "found");
    if (found.status === "found") {
      assert.equal(found.pedido.externalSalesOrderId, 2737);
    }
  });

  it("lookup ausente retorna not_found", async () => {
    const fetchJson = async () => ({ pedidos: [] });
    const found = await lookupNomusPedidoByOrderCode({
      baseUrl: "https://example.test/rest/",
      orderCode: "PD 02739",
      from: new Date(Date.UTC(2026, 6, 1)),
      to: new Date(Date.UTC(2026, 6, 31)),
      fetchJson: fetchJson as never,
      env: {},
    });
    assert.equal(found.status, "not_found");
  });

  it("HTTP 429 recuperado via onRetryableStatus incrementa contadores", async () => {
    let calls = 0;
    const fetchJson = async (
      _url: URL,
      options?: { onRetryableStatus?: (info: { status: number; attempt: number }) => void }
    ) => {
      calls += 1;
      if (calls === 1) {
        options?.onRetryableStatus?.({ status: 429, attempt: 0 });
        return {
          pedidos: [{ id: 10, codigoPedido: "PD 00010", dataEmissao: "12/07/2026" }],
        };
      }
      return { pedidos: [] };
    };

    const result = await fetchNomusPedidosForAudit({
      baseUrl: "https://example.test/rest/",
      from: new Date(Date.UTC(2026, 6, 1)),
      to: new Date(Date.UTC(2026, 6, 31)),
      fetchJson: fetchJson as never,
      env: {},
    });
    assert.equal(result.completeness.http429Count, 1);
    assert.equal(result.completeness.retries, 1);
    assert.equal(result.completeness.complete, true);
  });
});
