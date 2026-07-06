import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildCustomerIndicatorsPayload } from "./customerIndicators.js";

describe("customerIndicators sales orders", () => {
  it("cliente com SalesOrder e sem Proposal conta como com pedido", () => {
    const res = buildCustomerIndicatorsPayload([
      {
        id: "c1",
        state: "SP",
        status: "ACTIVE",
        segment: "Varejo",
        email: "a@b.com",
        phone: null,
        address: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        salesOrderCount: 2,
        negotiationProposalCount: 0,
      },
    ]);
    assert.equal(res.summary.withSalesOrderCount, 1);
    assert.equal(res.summary.withProposalCount, 1);
    assert.equal(res.summary.withNegotiationProposalCount, 0);
  });

  it("cliente sem SalesOrder e com Proposal não entra como comprador", () => {
    const res = buildCustomerIndicatorsPayload([
      {
        id: "c2",
        state: "RJ",
        status: "ACTIVE",
        segment: null,
        email: null,
        phone: null,
        address: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        salesOrderCount: 0,
        negotiationProposalCount: 3,
      },
    ]);
    assert.equal(res.summary.withSalesOrderCount, 0);
    assert.equal(res.summary.withNegotiationProposalCount, 1);
  });

  it("pedidos cancelados/erro não entram (contagem vem do endpoint)", () => {
    const res = buildCustomerIndicatorsPayload([
      {
        id: "c3",
        state: null,
        status: "ACTIVE",
        segment: null,
        email: null,
        phone: null,
        address: null,
        createdAt: new Date(),
        salesOrderCount: 0,
      },
    ]);
    assert.equal(res.summary.withSalesOrderCount, 0);
  });

  it("semantics não menciona propostas como base principal", () => {
    const res = buildCustomerIndicatorsPayload([]);
    assert.match(res.semantics.label, /pedidos de venda/i);
    assert.doesNotMatch(res.semantics.label, /vínculos com propostas/i);
  });

  it("não retorna NaN nos totais", () => {
    const res = buildCustomerIndicatorsPayload([
      {
        id: "c4",
        state: "MG",
        status: "INACTIVE",
        segment: "—",
        email: "x@y.com",
        phone: "11",
        address: "Rua",
        createdAt: new Date(),
        salesOrderCount: 1,
        negotiationProposalCount: 1,
      },
    ]);
    assert.ok(Number.isFinite(res.summary.withSalesOrderCount));
    assert.ok(Number.isFinite(res.summary.withNegotiationProposalCount));
  });

  it("endpoint indicators usa salesOrders no _count", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const block = server.slice(
      server.indexOf('app.get("/api/customers/indicators"'),
      server.indexOf('app.get("/api/customers/indicators/drilldown"')
    );
    assert.match(block, /salesOrders/);
    assert.match(block, /negotiationProposalCount/);
    assert.equal(block.includes("proposalCount: r._count.proposals"), false);
  });
});
