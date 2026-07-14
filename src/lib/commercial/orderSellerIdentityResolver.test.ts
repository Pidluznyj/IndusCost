import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommissionSellerIdentityContext } from "@/src/lib/commissions/commissionSellerIdentity.js";
import {
  COMMERCIAL_RESPONSIBLE_NONE_LABEL,
  isSellerIdOnlyLabel,
  ORDER_SELLER_NOT_INFORMED_LABEL,
  ORDER_SELLER_UNMAPPED_LABEL,
  resolveCommercialResponsibleDisplay,
  resolveOrderSellerIdentity,
} from "./orderSellerIdentityResolver.js";

function ctx(
  overrides?: Partial<CommissionSellerIdentityContext>
): CommissionSellerIdentityContext {
  return {
    persons: [
      {
        id: "person-rodrigo",
        nomusPersonId: 646,
        name: "Rodrigo Da Silva Ramos",
        type: "SELLER",
        source: "NOMUS",
        active: true,
        linkedRecordCount: 20,
      },
    ],
    aliases: [
      {
        id: "alias-1399",
        commissionedPersonId: "person-rodrigo",
        source: "NOMUS_ORDER",
        rawSellerId: 1399,
        rawSellerName: "RODRIGO",
        normalizedSellerName: "rodrigo",
        status: "ACTIVE",
        confidence: 1,
      },
    ],
    ...overrides,
  };
}

describe("orderSellerIdentityResolver", () => {
  it("PD 02523: ID 1399 sem nome no SalesOrder → Rodrigo via alias", () => {
    const r = resolveOrderSellerIdentity(
      {
        salesOrder: {
          externalSellerId: 1399,
          nomusSellerName: null,
          issueDate: "2026-03-20",
        },
      },
      ctx()
    );
    assert.equal(r.displayName, "Rodrigo Da Silva Ramos");
    assert.equal(r.rawExternalId, 1399);
    assert.equal(r.isInformed, true);
    assert.equal(r.isMapped, true);
    assert.equal(r.matchType, "RESOLVED_BY_ALIAS");
    assert.ok(!r.alertCodes.includes("SELLER_NOT_INFORMED"));
  });

  it("SalesOrder vazio + snapshot comissão → usa canônico do snapshot", () => {
    const r = resolveOrderSellerIdentity(
      {
        salesOrder: { externalSellerId: null, nomusSellerName: null },
        commissionSnapshot: {
          rawSellerId: 1399,
          rawSellerName: null,
          canonicalSellerId: "person-rodrigo",
          canonicalSellerName: "Rodrigo Da Silva Ramos",
        },
      },
      ctx({ persons: [], aliases: [] })
    );
    assert.equal(r.displayName, "Rodrigo Da Silva Ramos");
    assert.equal(r.source, "COMMISSION_SNAPSHOT");
    assert.ok(
      r.alertCodes.includes("SELLER_MISSING_IN_SALES_ORDER_BUT_PRESENT_IN_SNAPSHOT")
    );
    assert.ok(!r.alertCodes.includes("SELLER_NOT_INFORMED"));
  });

  it("raw seller sem alias → Vendedor não mapeado", () => {
    const r = resolveOrderSellerIdentity(
      {
        salesOrder: { externalSellerId: 9999, nomusSellerName: null },
      },
      ctx({ persons: [], aliases: [] })
    );
    assert.equal(r.displayName, ORDER_SELLER_UNMAPPED_LABEL);
    assert.equal(r.isInformed, true);
    assert.equal(r.isMapped, false);
    assert.ok(r.alertCodes.includes("SELLER_ALIAS_NOT_MAPPED"));
  });

  it("sem raw em nenhuma fonte → Sem vendedor informado", () => {
    const r = resolveOrderSellerIdentity(
      { salesOrder: { externalSellerId: null, nomusSellerName: null } },
      ctx()
    );
    assert.equal(r.displayName, ORDER_SELLER_NOT_INFORMED_LABEL);
    assert.equal(r.isInformed, false);
    assert.ok(r.alertCodes.includes("SELLER_NOT_INFORMED"));
  });

  it("Responsável Comercial rejeita label Vendedor ID", () => {
    assert.equal(isSellerIdOnlyLabel("Vendedor ID 1399"), true);
    const r = resolveCommercialResponsibleDisplay({
      canonicalName: "Vendedor ID 1399",
      source: "AUTO_FROM_SALES_ORDER_SELLER",
    });
    assert.equal(r.displayName, COMMERCIAL_RESPONSIBLE_NONE_LABEL);
    assert.equal(r.source, "NONE");
  });
});
