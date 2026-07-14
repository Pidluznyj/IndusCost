import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommissionSellerIdentityContext } from "@/src/lib/commissions/commissionSellerIdentity.js";
import { resolveOrderFullAuditSellerDisplay } from "./orderFullAuditSellerDisplay.js";

function ctx(
  overrides?: Partial<CommissionSellerIdentityContext>
): CommissionSellerIdentityContext {
  return {
    persons: [
      {
        id: "person-gislene",
        nomusPersonId: 464,
        name: "GISLENE LIMA",
        type: "SELLER",
        source: "NOMUS",
        active: true,
        linkedRecordCount: 10,
      },
    ],
    aliases: [
      {
        id: "alias-alt-id",
        commissionedPersonId: "person-gislene",
        source: "NOMUS_ORDER",
        rawSellerId: 999,
        rawSellerName: "GISLENE LIMA CADASTRO 2",
        normalizedSellerName: "GISLENE LIMA",
        status: "ACTIVE",
        confidence: 1,
      },
    ],
    ...overrides,
  };
}

describe("resolveOrderFullAuditSellerDisplay", () => {
  it("resolve por externalSellerId canônico mesmo com nomusSellerName vazio", () => {
    const r = resolveOrderFullAuditSellerDisplay(
      {
        externalSellerId: 464,
        nomusSellerName: null,
        issueDate: "2026-03-20",
      },
      ctx()
    );
    assert.equal(r.orderSellerName, "GISLENE LIMA");
    assert.equal(r.orderSellerExternalId, 464);
    assert.equal(r.resolutionStatus, "RESOLVED");
  });

  it("normaliza segundo cadastro Nomus via alias para o mesmo vendedor", () => {
    const r = resolveOrderFullAuditSellerDisplay(
      {
        externalSellerId: 999,
        nomusSellerName: "GISLENE LIMA CADASTRO 2",
        issueDate: "2026-03-20",
      },
      ctx()
    );
    assert.equal(r.orderSellerName, "GISLENE LIMA");
    assert.equal(r.resolutionStatus, "RESOLVED_BY_ALIAS");
  });

  it("extrai vendedor do nomusRawResponse quando colunas estão vazias", () => {
    const r = resolveOrderFullAuditSellerDisplay(
      {
        externalSellerId: null,
        nomusSellerName: null,
        issueDate: "2026-03-20",
        nomusRawResponse: {
          idPessoaVendedor: 464,
          nomeVendedor: "GISLENE LIMA",
        },
      },
      ctx()
    );
    assert.equal(r.orderSellerName, "GISLENE LIMA");
    assert.equal(r.orderSellerExternalId, 464);
  });

  it("sem ID e sem nome → Sem vendedor (null)", () => {
    const r = resolveOrderFullAuditSellerDisplay(
      { externalSellerId: null, nomusSellerName: null },
      ctx()
    );
    assert.equal(r.orderSellerName, null);
    assert.equal(r.resolutionStatus, "NO_SELLER");
  });
});
