import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateCommissionOrderProvisionRows,
  assembleCommissionOrderProvisionPayload,
  buildCommissionOrderProvisionCards,
  parseCommissionOrderProvisionQuery,
  resolveCommissionOrderProvisionMonthRanges,
  resolveCommissionOrderProvisionSaleDateBounds,
} from "./commissionOrderProvision.shared.js";

describe("commissionOrderProvision", () => {
  it("confirma agregação: comissão do pedido = soma dos snapshots/itens finais", () => {
    const rows = aggregateCommissionOrderProvisionRows([
      {
        id: "s1",
        salesOrderId: "o1",
        orderCode: "PD 02716",
        saleDate: "2026-07-10",
        customerNameSnapshot: "Cliente A",
        canonicalSellerId: "seller-1",
        canonicalSellerName: "Maria",
        rawSellerId: 10,
        rawSellerName: "Maria",
        nfeId: 100,
        totalSoldAmount: 1000,
        totalGrossCommissionAmount: 50,
        totalFinalCommissionAmount: 50,
        hasCustomerExcludedItems: false,
      },
      {
        id: "s2",
        salesOrderId: "o1",
        orderCode: "PD 02716",
        saleDate: "2026-07-15",
        customerNameSnapshot: "Cliente A",
        canonicalSellerId: "seller-1",
        canonicalSellerName: "Maria",
        rawSellerId: 10,
        rawSellerName: "Maria",
        nfeId: 101,
        totalSoldAmount: 500,
        totalGrossCommissionAmount: 25,
        totalFinalCommissionAmount: 25,
        hasCustomerExcludedItems: false,
      },
      {
        id: "s3",
        salesOrderId: "o2",
        orderCode: "PD 02717",
        saleDate: "2026-07-12",
        customerNameSnapshot: "Cliente excluído",
        canonicalSellerId: "seller-1",
        canonicalSellerName: "Maria",
        rawSellerId: 10,
        rawSellerName: "Maria",
        nfeId: null,
        totalSoldAmount: 800,
        totalGrossCommissionAmount: 40,
        totalFinalCommissionAmount: 0,
        hasCustomerExcludedItems: true,
      },
    ]);

    assert.equal(rows.length, 2);
    const pd = rows.find((r) => r.orderCode === "PD 02716");
    assert.ok(pd);
    assert.equal(pd!.totalFinalCommissionAmount, 75);
    assert.equal(pd!.snapshotCount, 2);
    assert.deepEqual(pd!.nfeIds, [100, 101]);

    const cards = buildCommissionOrderProvisionCards(rows);
    assert.equal(cards.orderCount, 2);
    assert.equal(cards.totalFinalCommissionAmount, 75);
    assert.equal(cards.zeroCommissionOrderCount, 1);
    assert.equal(cards.sellers[0]?.sellerName, "Maria");
    assert.equal(cards.sellers[0]?.totalFinalCommissionAmount, 75);
  });

  it("esconde zerados por padrão e monta payload", () => {
    const payload = assembleCommissionOrderProvisionPayload({
      query: parseCommissionOrderProvisionQuery({ year: "2026" }),
      snapshots: [
        {
          id: "s1",
          salesOrderId: "o1",
          orderCode: "PD 1",
          saleDate: new Date(2026, 6, 1),
          customerNameSnapshot: "A",
          canonicalSellerId: null,
          canonicalSellerName: "João",
          rawSellerId: 1,
          rawSellerName: "João",
          nfeId: null,
          totalSoldAmount: 100,
          totalGrossCommissionAmount: 10,
          totalFinalCommissionAmount: 10,
          hasCustomerExcludedItems: false,
        },
        {
          id: "s2",
          salesOrderId: "o2",
          orderCode: "PD 2",
          saleDate: new Date(2026, 6, 2),
          customerNameSnapshot: "B",
          canonicalSellerId: null,
          canonicalSellerName: "João",
          rawSellerId: 1,
          rawSellerName: "João",
          nfeId: null,
          totalSoldAmount: 100,
          totalGrossCommissionAmount: 10,
          totalFinalCommissionAmount: 0,
          hasCustomerExcludedItems: true,
        },
      ],
    });

    assert.equal(payload.source, "COMMISSION_ORDER_SNAPSHOT_ACTIVE");
    assert.equal(payload.cards.orderCount, 1);
    assert.equal(payload.cards.totalFinalCommissionAmount, 10);
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0]?.orderCode, "PD 1");
  });

  it("filtra saleDate por ano/mês", () => {
    const bounds = resolveCommissionOrderProvisionSaleDateBounds(
      parseCommissionOrderProvisionQuery({ year: "2026", month: "7" })
    );
    assert.ok(bounds);
    assert.equal(bounds!.gte.getFullYear(), 2026);
    assert.equal(bounds!.gte.getMonth(), 6);
    assert.equal(bounds!.lte.getMonth(), 6);
  });

  it("aceita months=6,7 e monta faixas mensais exatas", () => {
    const query = parseCommissionOrderProvisionQuery({
      year: "2026",
      months: "6,7",
    });
    assert.deepEqual(query.months, [6, 7]);
    assert.equal(query.month, null);
    const bounds = resolveCommissionOrderProvisionSaleDateBounds(query);
    assert.ok(bounds);
    assert.equal(bounds!.gte.getMonth(), 5);
    assert.equal(bounds!.lte.getMonth(), 6);
    const ranges = resolveCommissionOrderProvisionMonthRanges(query);
    assert.ok(ranges);
    assert.equal(ranges!.length, 2);
    assert.equal(ranges![0]!.gte.getMonth(), 5);
    assert.equal(ranges![1]!.gte.getMonth(), 6);
  });

  it("months=1,3 gera OR sem incluir fevereiro no filtro exato", () => {
    const query = parseCommissionOrderProvisionQuery({
      year: "2026",
      months: "1,3",
    });
    const ranges = resolveCommissionOrderProvisionMonthRanges(query);
    assert.ok(ranges);
    assert.equal(ranges!.length, 2);
    assert.equal(ranges![0]!.gte.getMonth(), 0);
    assert.equal(ranges![0]!.lte.getMonth(), 0);
    assert.equal(ranges![1]!.gte.getMonth(), 2);
    assert.equal(ranges![1]!.lte.getMonth(), 2);
  });

  it("month legado vira months=[n]", () => {
    const query = parseCommissionOrderProvisionQuery({ year: "2026", month: "3" });
    assert.deepEqual(query.months, [3]);
    assert.equal(query.month, 3);
  });

  it("sellerId UUID vira canonicalSellerId (padrão Relatórios)", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const query = parseCommissionOrderProvisionQuery({
      year: "2026",
      sellerId: id,
    });
    assert.equal(query.canonicalSellerId, id);
  });

  it("payload inclui sellerOptions", () => {
    const payload = assembleCommissionOrderProvisionPayload({
      query: parseCommissionOrderProvisionQuery({ year: "2026", months: "all" }),
      snapshots: [
        {
          id: "s1",
          salesOrderId: "o1",
          orderCode: "PD 1",
          saleDate: new Date(2026, 0, 1),
          customerNameSnapshot: "A",
          canonicalSellerId: "11111111-1111-4111-8111-111111111111",
          canonicalSellerName: "Maria",
          rawSellerId: 1,
          rawSellerName: "Maria",
          nfeId: null,
          totalSoldAmount: 100,
          totalGrossCommissionAmount: 10,
          totalFinalCommissionAmount: 10,
          hasCustomerExcludedItems: false,
        },
      ],
    });
    assert.ok(payload.sellerOptions.some((o) => o.label === "Maria"));
    assert.equal(payload.sellerOptions[0]?.value, "all");
  });
});
