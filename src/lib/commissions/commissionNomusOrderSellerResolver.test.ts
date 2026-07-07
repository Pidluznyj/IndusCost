import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMISSION_HISTORICAL_SELLER_NOMUS_PERSON_ID,
  countNomusOrderSellerResolutions,
  formatNomusOrderSellerDisplayName,
  isNomusOrderSellerResolved,
  resolveNomusOrderSeller,
} from "./commissionNomusOrderSellerResolver.js";
import type { CommissionSellerIdentityContext } from "./commissionSellerIdentity.js";

const GISLENE_ID = "5b611639-1510-4cb4-bb94-d50d0f98f5bc";
const RODRIGO_ID = "rodrigo-person-1399";

function productionLikeCtx(): CommissionSellerIdentityContext {
  return {
    persons: [
      {
        id: GISLENE_ID,
        nomusPersonId: 464,
        name: "GISLENE LIMA",
        type: "SELLER",
        source: "NOMUS",
        active: true,
        linkedRecordCount: 100,
      },
      {
        id: RODRIGO_ID,
        nomusPersonId: 1399,
        name: "RODRIGO",
        type: "SELLER",
        source: "NOMUS",
        active: true,
        linkedRecordCount: 50,
      },
    ],
    aliases: [],
  };
}

describe("resolveNomusOrderSeller", () => {
  it("464 resolve direto para GISLENE (PD 02720)", () => {
    const resolution = resolveNomusOrderSeller(
      { externalSellerId: 464, issueDate: new Date(2026, 5, 1) },
      productionLikeCtx()
    );
    assert.equal(resolution.status, "RESOLVED_BY_NOMUS_PERSON_ID");
    assert.equal(resolution.canonicalCommissionPersonId, GISLENE_ID);
    assert.equal(resolution.canonicalSellerName, "GISLENE LIMA");
    assert.ok(isNomusOrderSellerResolved(resolution));
  });

  it("1399 resolve para Rodrigo, não por responsible legado", () => {
    const resolution = resolveNomusOrderSeller(
      {
        externalSellerId: 1399,
        issueDate: new Date(2026, 5, 1),
        legacyResponsible: "GISLENE LIMA",
      },
      productionLikeCtx()
    );
    assert.equal(resolution.status, "RESOLVED_BY_NOMUS_PERSON_ID");
    assert.equal(resolution.canonicalCommissionPersonId, RODRIGO_ID);
    assert.ok(resolution.warnings.some((w) => w.includes("responsible")));
  });

  it("645 antes de 02/2026 resolve por regra histórica para Gislene", () => {
    const resolution = resolveNomusOrderSeller(
      { externalSellerId: 645, issueDate: new Date(2025, 0, 15) },
      productionLikeCtx()
    );
    assert.equal(resolution.status, "RESOLVED_BY_HISTORICAL_RULE");
    assert.equal(resolution.canonicalCommissionPersonId, GISLENE_ID);
    assert.equal(
      formatNomusOrderSellerDisplayName(resolution),
      "GISLENE LIMA"
    );
  });

  it("646 e 899 antes de 02/2026 também resolvem por regra histórica", () => {
    for (const sellerId of [646, 899]) {
      const resolution = resolveNomusOrderSeller(
        { externalSellerId: sellerId, issueDate: new Date(2025, 6, 17) },
        productionLikeCtx()
      );
      assert.equal(resolution.status, "RESOLVED_BY_HISTORICAL_RULE", `id ${sellerId}`);
    }
  });

  it("899 após 02/2026 fica SELLER_UNRESOLVED", () => {
    const resolution = resolveNomusOrderSeller(
      { externalSellerId: 899, issueDate: new Date(2026, 6, 17) },
      productionLikeCtx()
    );
    assert.equal(resolution.status, "SELLER_UNRESOLVED");
    assert.equal(resolution.canonicalCommissionPersonId, null);
  });

  it("externalSellerId null é NO_SELLER mesmo com nomusSellerName vazio", () => {
    const resolution = resolveNomusOrderSeller(
      { externalSellerId: null, nomusSellerName: null, issueDate: new Date(2026, 0, 1) },
      productionLikeCtx()
    );
    assert.equal(resolution.status, "NO_SELLER");
    assert.equal(
      formatNomusOrderSellerDisplayName(resolution),
      "Vendedor não informado no Nomus"
    );
  });

  it("PD 02498 TAMBASA sem externalSellerId permanece NO_SELLER", () => {
    const resolution = resolveNomusOrderSeller(
      {
        externalSellerId: null,
        legacyResponsible: "TAMBASA",
        issueDate: new Date(2025, 3, 1),
      },
      productionLikeCtx()
    );
    assert.equal(resolution.status, "NO_SELLER");
    assert.ok(resolution.warnings.some((w) => w.includes("responsible")));
  });

  it("contagem produção: 76 históricos (645+646+899) + diretos + sem vendedor", () => {
    const orders: Array<{ externalSellerId: number | null; issueDate: Date }> = [];
    for (let i = 0; i < 2211; i += 1) {
      orders.push({ externalSellerId: 464, issueDate: new Date(2026, 0, 1) });
    }
    for (const [sellerId, count] of [
      [645, 29],
      [646, 37],
      [899, 10],
    ] as const) {
      for (let i = 0; i < count; i += 1) {
        orders.push({ externalSellerId: sellerId, issueDate: new Date(2025, 6, 1) });
      }
    }
    for (let i = 0; i < 410; i += 1) {
      orders.push({ externalSellerId: null, issueDate: new Date(2025, 0, 1) });
    }
    assert.equal(orders.length, 2697);

    const counts = countNomusOrderSellerResolutions(orders, productionLikeCtx());
    assert.equal(counts.total, 2697);
    assert.equal(counts.withExternalSellerId, 2287);
    assert.equal(counts.resolvedByNomusPersonId, 2211);
    assert.equal(counts.resolvedByHistoricalRule, 76);
    assert.equal(counts.noSeller, 410);
    assert.equal(counts.sellerUnresolved, 0);
  });

  it("alias ativo resolve quando nomusPersonId não existe", () => {
    const ctx: CommissionSellerIdentityContext = {
      persons: [
        {
          id: GISLENE_ID,
          nomusPersonId: 464,
          name: "GISLENE LIMA",
          type: "SELLER",
          source: "NOMUS",
          active: true,
        },
      ],
      aliases: [
        {
          id: "alias-645",
          commissionedPersonId: GISLENE_ID,
          source: "NOMUS_ORDER",
          rawSellerId: 645,
          rawSellerName: "LEGADO",
          normalizedSellerName: "LEGADO",
          status: "ACTIVE",
          confidence: 1,
        },
      ],
    };
    const resolution = resolveNomusOrderSeller(
      { externalSellerId: 645, issueDate: new Date(2026, 5, 1) },
      ctx
    );
    assert.equal(resolution.status, "RESOLVED_BY_ALIAS");
    assert.equal(resolution.canonicalCommissionPersonId, GISLENE_ID);
  });

  it("regra histórica usa nomusPersonId 464 configurado", () => {
    assert.equal(COMMISSION_HISTORICAL_SELLER_NOMUS_PERSON_ID, 464);
  });
});
