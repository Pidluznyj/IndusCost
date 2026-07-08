import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommissionSellerIdentityContext } from "./commissions/commissionSellerIdentity.js";
import {
  buildSalesOrderNomusSellerDto,
  buildSalesOrderNomusSellerWhereFilter,
  collectExternalSellerIdsMatchingSellerFilter,
  formatSalesOrderNomusSellerListLabel,
} from "./salesOrderNomusSellerDisplay.js";

function ctx(
  overrides: Partial<CommissionSellerIdentityContext> = {}
): CommissionSellerIdentityContext {
  return {
    persons: [
      {
        id: "cp-1",
        nomusPersonId: 464,
        name: "GISLENE LIMA",
        type: "SELLER",
        source: "NOMUS",
        active: true,
        createdAt: new Date("2025-01-01"),
        linkedRecordCount: 10,
      },
    ],
    aliases: [
      {
        id: "al-1",
        commissionedPersonId: "cp-1",
        source: "NOMUS_ORDER",
        rawSellerId: 999,
        rawSellerName: "Gislene legado",
        normalizedSellerName: "GISLENE LEGADO",
        status: "ACTIVE",
        confidence: 1,
      },
    ],
    ...overrides,
  };
}

describe("salesOrderNomusSellerDisplay", () => {
  it("sem externalSellerId → NO_SELLER e label —", () => {
    const seller = buildSalesOrderNomusSellerDto({ externalSellerId: null }, ctx());
    assert.equal(seller.resolutionStatus, "NO_SELLER");
    assert.equal(seller.name, null);
    assert.equal(formatSalesOrderNomusSellerListLabel(seller), "—");
  });

  it("resolve CommissionPerson por nomusPersonId", () => {
    const seller = buildSalesOrderNomusSellerDto({ externalSellerId: 464 }, ctx());
    assert.equal(seller.resolutionStatus, "RESOLVED");
    assert.equal(seller.name, "GISLENE LIMA");
    assert.equal(seller.externalSellerId, 464);
    assert.equal(formatSalesOrderNomusSellerListLabel(seller), "GISLENE LIMA");
  });

  it("resolve por alias aprovado", () => {
    const seller = buildSalesOrderNomusSellerDto({ externalSellerId: 999 }, ctx());
    assert.equal(seller.resolutionStatus, "RESOLVED_BY_ALIAS");
    assert.equal(seller.name, "GISLENE LIMA");
  });

  it("ID mapeado inexistente → SELLER_UNRESOLVED com rótulo técnico", () => {
    const seller = buildSalesOrderNomusSellerDto({ externalSellerId: 7777 }, ctx());
    assert.equal(seller.resolutionStatus, "SELLER_UNRESOLVED");
    assert.match(
      formatSalesOrderNomusSellerListLabel(seller),
      /Vendedor Nomus não mapeado: ID 7777/
    );
  });

  it("filtro por nome coleta externalSellerId da pessoa e do alias", () => {
    const ids = collectExternalSellerIdsMatchingSellerFilter("gislene", ctx());
    assert.ok(ids.includes(464));
    assert.ok(ids.includes(999));
  });

  it("filtro por ID numérico inclui o próprio ID", () => {
    const ids = collectExternalSellerIdsMatchingSellerFilter("464", ctx());
    assert.deepEqual(ids.sort((a, b) => a - b), [464]);
  });

  it("where filter vazio não restringe", () => {
    assert.equal(buildSalesOrderNomusSellerWhereFilter("", ctx()), null);
  });

  it("where filtro sem match → conjunto vazio (nenhum pedido)", () => {
    const where = buildSalesOrderNomusSellerWhereFilter("zzzz-nao-existe", ctx());
    assert.deepEqual(where, { id: { in: [] } });
  });

  it("where filtro por nome → externalSellerId in [...]", () => {
    const where = buildSalesOrderNomusSellerWhereFilter("GISLENE", ctx());
    assert.ok(where && "externalSellerId" in where);
    if (where && "externalSellerId" in where) {
      assert.ok(where.externalSellerId.in.includes(464));
    }
  });
});
