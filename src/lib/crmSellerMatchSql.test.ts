import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  buildCrmCommercialOwnerOnlyOrderScopeSql,
  buildCrmOrderSellerNameSql,
  buildCrmSellerFilterSql,
  buildCrmSellerPortfolioOrderScopeSql,
  hasCrmSellerMatchFilter,
} from "@/src/lib/crmSellerMatchSql";

function sqlText(sql: Prisma.Sql): string {
  return sql.strings.join("?");
}

describe("crmSellerMatchSql — vendedor do pedido vs carteira", () => {
  it("nome do pedido usa nomusSellerName com fallback responsible", () => {
    const text = sqlText(buildCrmOrderSellerNameSql("so"));
    assert.match(text, /nomusSellerName/);
    assert.match(text, /responsible/);
    assert.match(text, /COALESCE/);
  });

  it("filtro por sellerIdentityKey compara nome Nomus normalizado, não só responsible legado", () => {
    const text = sqlText(
      buildCrmSellerFilterSql("so", {
        externalSellerId: null,
        responsible: null,
        sellerIdentityKey: "gislene lima",
      })
    );
    assert.match(text, /nomusSellerName/);
    assert.match(text, /REGEXP_REPLACE/);
    assert.match(text, /translate/);
  });

  it("filtro por externalSellerId usa ID Nomus do pedido", () => {
    const text = sqlText(
      buildCrmSellerFilterSql("so", {
        externalSellerId: 464,
        responsible: null,
        sellerIdentityKey: null,
      })
    );
    assert.match(text, /externalSellerId/);
    assert.ok(text.includes("?") || text.includes("464"));
  });

  it("escopo de carteira une responsável comercial (customerIds) com vendedor do pedido", () => {
    const text = sqlText(
      buildCrmSellerPortfolioOrderScopeSql(
        "so",
        {
          externalSellerId: null,
          responsible: null,
          sellerIdentityKey: "gislene lima",
        },
        ["11111111-1111-1111-1111-111111111111"]
      )
    );
    assert.match(text, /customerId/);
    assert.match(text, /nomusSellerName/);
    assert.match(text, / OR /i);
  });

  it("escopo oficial Gestão por Vendedor usa só responsável comercial (sem OR Nomus)", () => {
    const withOwners = sqlText(
      buildCrmCommercialOwnerOnlyOrderScopeSql(
        "so",
        { externalSellerId: null, responsible: null, sellerIdentityKey: "gislene lima" },
        ["11111111-1111-1111-1111-111111111111"]
      )
    );
    const withoutOwners = sqlText(
      buildCrmCommercialOwnerOnlyOrderScopeSql(
        "so",
        { externalSellerId: null, responsible: null, sellerIdentityKey: "gislene lima" },
        []
      )
    );
    assert.match(withOwners, /customerId/);
    assert.equal(/nomusSellerName/.test(withOwners), false);
    assert.equal(/ OR /i.test(withOwners), false);
    assert.match(withoutOwners, /FALSE|false/i);
  });

  it("sem clientes de responsável comercial, escopo cai só no match do pedido", () => {
    const withOwners = sqlText(
      buildCrmSellerPortfolioOrderScopeSql(
        "so",
        { externalSellerId: null, responsible: null, sellerIdentityKey: "gislene lima" },
        ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]
      )
    );
    const withoutOwners = sqlText(
      buildCrmSellerPortfolioOrderScopeSql(
        "so",
        { externalSellerId: null, responsible: null, sellerIdentityKey: "gislene lima" },
        []
      )
    );
    assert.match(withOwners, /customerId/);
    assert.equal(withoutOwners.includes("customerId"), false);
    assert.match(withoutOwners, /nomusSellerName/);
  });

  it("hasCrmSellerMatchFilter detecta eixo ativo", () => {
    assert.equal(
      hasCrmSellerMatchFilter({
        externalSellerId: null,
        responsible: null,
        sellerIdentityKey: null,
      }),
      false
    );
    assert.equal(
      hasCrmSellerMatchFilter({
        externalSellerId: null,
        responsible: null,
        sellerIdentityKey: "gislene lima",
      }),
      true
    );
    assert.equal(
      hasCrmSellerMatchFilter({
        externalSellerId: null,
        responsible: null,
        sellerIdentityKey: null,
        externalSellerIds: [646, 1399],
      }),
      true
    );
  });

  it("filtro por nome + IDs consolidados usa OR (cobre pedido sem nome)", () => {
    const text = sqlText(
      buildCrmSellerFilterSql("so", {
        externalSellerId: null,
        responsible: null,
        sellerIdentityKey: "rodrigo da silva ramos",
        externalSellerIds: [646, 1399],
      })
    );
    assert.match(text, / OR /i);
    assert.match(text, /externalSellerId/);
    assert.match(text, /nomusSellerName/);
  });
});
