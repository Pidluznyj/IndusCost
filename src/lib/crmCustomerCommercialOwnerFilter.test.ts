import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildAdminSellerOptionKey, type AdminSellerOption } from "./adminSellerOptionsTypes.js";
import { ORDER_SELLER_UNMAPPED_LABEL } from "./commercial/orderSellerIdentityResolver.js";
import {
  assignmentMatchesCommercialOwnerPortfolio,
  buildCommercialOwnerFilterOptions,
  buildCustomerCommercialOwnerFilterWhere,
  buildManualCommercialOwnerPortfolioWhere,
} from "./crmCustomerCommercialOwner.js";
import { CUSTOMER_LIST_OWNER_NONE, buildCustomerListWhere } from "./customerListQuery.js";

function seller(
  partial: Pick<AdminSellerOption, "displayName" | "sellerIdentityKey"> &
    Partial<AdminSellerOption>
): AdminSellerOption {
  return {
    externalSellerId: null,
    externalSellerIds: [],
    responsible: partial.displayName,
    normalizedName: partial.sellerIdentityKey,
    ordersCount: 1,
    ordersValue: 0,
    proposalsCount: 0,
    proposalsValue: 0,
    source: "sales_orders",
    confidence: "HIGH",
    mergedFragmentCount: 1,
    ...partial,
  };
}

const gislene = seller({
  displayName: "GISLENE LIMA",
  sellerIdentityKey: "gislene lima",
  externalSellerId: 12,
  externalSellerIds: [12, 37],
  ordersCount: 40,
});
const jose = seller({
  displayName: "JOSE EDUARDO CARDOSO DOS SANTOS",
  sellerIdentityKey: "jose eduardo cardoso dos santos",
  externalSellerId: 20,
  externalSellerIds: [20],
  ordersCount: 10,
});
const joseane = seller({
  displayName: "Joseane Aparecida Correa",
  sellerIdentityKey: "joseane aparecida correa",
  externalSellerId: 8,
  externalSellerIds: [8],
});
const vendedorSemCliente = seller({
  displayName: "VENDEDOR X",
  sellerIdentityKey: "vendedor x",
  externalSellerId: 99,
  externalSellerIds: [99],
});

function names(options: { name: string }[]): string[] {
  return options.map((option) => option.name);
}

describe("filtro canônico de responsável comercial", () => {
  it("um responsável atribuído a vários clientes aparece uma vez", () => {
    const built = buildCommercialOwnerFilterOptions(
      [
        { sellerIdentityKey: "gislene lima", sellerExternalId: 12, sellerAliasExternalIds: [12, 37] },
        { sellerIdentityKey: "gislene lima", sellerExternalId: 12, sellerAliasExternalIds: [12, 37] },
      ],
      [gislene, jose, vendedorSemCliente]
    );
    assert.deepEqual(names(built.options), ["GISLENE LIMA"]);
    assert.deepEqual(built.options.map((option) => option.key), [buildAdminSellerOptionKey(gislene)]);
    assert.equal(built.resolvedAssignments, 2);
    assert.equal(built.unresolvedAssignments, 0);
  });

  it("aliases e __ID_ONLY__ do mesmo vendedor viram uma opção e o mesmo WHERE", () => {
    const built = buildCommercialOwnerFilterOptions(
      [
        { sellerIdentityKey: "gislene lima", sellerExternalId: 12, sellerAliasExternalIds: [12] },
        { sellerIdentityKey: "__ID_ONLY__:37", sellerExternalId: 37, sellerAliasExternalIds: [37] },
      ],
      [gislene]
    );
    assert.deepEqual(names(built.options), ["GISLENE LIMA"]);
    assert.equal(built.options[0]?.key, buildAdminSellerOptionKey(gislene));

    const where = buildCustomerCommercialOwnerFilterWhere(built.options[0]!.key, [gislene]);
    const portfolio = buildManualCommercialOwnerPortfolioWhere({
      sellerIdentityKey: gislene.sellerIdentityKey,
      externalSellerId: gislene.externalSellerId,
      externalSellerIds: gislene.externalSellerIds,
      responsible: gislene.responsible,
    });
    assert.deepEqual(where, { CrmCustomerCommercialOwner: { is: portfolio } });
    assert.equal(
      assignmentMatchesCommercialOwnerPortfolio(
        { sellerIdentityKey: "gislene lima", sellerExternalId: 12, sellerAliasExternalIds: [] },
        {
          sellerIdentityKey: gislene.sellerIdentityKey,
          externalSellerId: gislene.externalSellerId,
          externalSellerIds: gislene.externalSellerIds,
          responsible: gislene.responsible,
        }
      ),
      true
    );
    assert.equal(
      assignmentMatchesCommercialOwnerPortfolio(
        { sellerIdentityKey: "__ID_ONLY__:37", sellerExternalId: 37, sellerAliasExternalIds: [] },
        {
          sellerIdentityKey: gislene.sellerIdentityKey,
          externalSellerId: gislene.externalSellerId,
          externalSellerIds: gislene.externalSellerIds,
          responsible: gislene.responsible,
        }
      ),
      true
    );
    const serialized = JSON.stringify(where);
    assert.match(serialized, /gislene lima/);
    assert.match(serialized, /__ID_ONLY__:12/);
    assert.match(serialized, /__ID_ONLY__:37/);
  });

  it("atribuições sem vendedor consolidado não viram Vendedor não mapeado", () => {
    const built = buildCommercialOwnerFilterOptions(
      [
        { sellerIdentityKey: "__ID_ONLY__:900", sellerExternalId: 900, sellerAliasExternalIds: [900] },
        { sellerIdentityKey: "__ID_ONLY__:901", sellerExternalId: 901, sellerAliasExternalIds: [901] },
        { sellerIdentityKey: "__ID_ONLY__:902", sellerExternalId: 902, sellerAliasExternalIds: [902] },
      ],
      [gislene, joseane]
    );
    assert.deepEqual(built.options, []);
    assert.equal(built.unresolvedAssignments, 3);
    assert.equal(names(built.options).includes(ORDER_SELLER_UNMAPPED_LABEL), false);
  });

  it("vendedor consolidado sem cliente atribuído fica fora do filtro", () => {
    const built = buildCommercialOwnerFilterOptions(
      [
        { sellerIdentityKey: "gislene lima", sellerExternalId: 12, sellerAliasExternalIds: [12, 37] },
        {
          sellerIdentityKey: "jose eduardo cardoso dos santos",
          sellerExternalId: 20,
          sellerAliasExternalIds: [20],
        },
      ],
      [gislene, jose, joseane, vendedorSemCliente]
    );
    assert.deepEqual(names(built.options), [
      "GISLENE LIMA",
      "JOSE EDUARDO CARDOSO DOS SANTOS",
    ]);
    assert.equal(names(built.options).includes("VENDEDOR X"), false);
    assert.equal(names(built.options).includes("Joseane Aparecida Correa"), false);
  });

  it("none restringe a clientes sem responsável ativo e vazio não restringe", () => {
    assert.deepEqual(buildCustomerCommercialOwnerFilterWhere(CUSTOMER_LIST_OWNER_NONE, [gislene]), {
      NOT: { CrmCustomerCommercialOwner: { is: { isActive: true } } },
    });
    assert.equal(buildCustomerCommercialOwnerFilterWhere("", [gislene]), undefined);
    assert.equal(buildCustomerCommercialOwnerFilterWhere("   ", [gislene]), undefined);
    assert.equal(buildCustomerListWhere("", undefined), undefined);
    const combined = buildCustomerListWhere("acme", buildCustomerCommercialOwnerFilterWhere("", [gislene]));
    assert.ok(combined);
    assert.equal("CrmCustomerCommercialOwner" in combined, false);
  });

  it("cliente salvo só como __ID_ONLY__ entra no WHERE do responsável canônico", () => {
    const where = buildCustomerCommercialOwnerFilterWhere(buildAdminSellerOptionKey(gislene), [gislene]);
    assert.match(JSON.stringify(where), /__ID_ONLY__:37/);
    assert.equal(
      assignmentMatchesCommercialOwnerPortfolio(
        { sellerIdentityKey: "__ID_ONLY__:37", sellerExternalId: null, sellerAliasExternalIds: [] },
        {
          sellerIdentityKey: gislene.sellerIdentityKey,
          externalSellerId: gislene.externalSellerId,
          externalSellerIds: gislene.externalSellerIds,
          responsible: gislene.responsible,
        }
      ),
      true
    );
  });

  it("deduplica pela optionKey canônica, mesmo com o mesmo nome exibido", () => {
    const mariaA = seller({
      displayName: "MARIA SILVA",
      sellerIdentityKey: "maria silva a",
      externalSellerId: 1,
      externalSellerIds: [1],
    });
    const mariaB = seller({
      displayName: "MARIA SILVA",
      sellerIdentityKey: "maria silva b",
      externalSellerId: 2,
      externalSellerIds: [2],
    });
    const samePersonTwice = buildCommercialOwnerFilterOptions(
      [
        { sellerIdentityKey: "gislene lima", sellerExternalId: 12, sellerAliasExternalIds: [12] },
        { sellerIdentityKey: "__ID_ONLY__:37", sellerExternalId: 37, sellerAliasExternalIds: [] },
      ],
      [gislene]
    );
    assert.equal(samePersonTwice.options.length, 1);

    const homonyms = buildCommercialOwnerFilterOptions(
      [
        { sellerIdentityKey: "maria silva a", sellerExternalId: 1, sellerAliasExternalIds: [1] },
        { sellerIdentityKey: "maria silva b", sellerExternalId: 2, sellerAliasExternalIds: [2] },
      ],
      [mariaA, mariaB]
    );
    assert.equal(homonyms.options.length, 2);
    assert.deepEqual(
      homonyms.options.map((option) => option.key).sort(),
      [buildAdminSellerOptionKey(mariaA), buildAdminSellerOptionKey(mariaB)].sort()
    );
  });

  it("ORDER_SELLER_UNMAPPED_LABEL nunca entra nas opções, nem como rótulo de fallback", () => {
    const unmapped = seller({
      displayName: ORDER_SELLER_UNMAPPED_LABEL,
      sellerIdentityKey: "__ID_ONLY__:900",
      externalSellerId: 900,
      externalSellerIds: [900],
    });
    const built = buildCommercialOwnerFilterOptions(
      [
        { sellerIdentityKey: "__ID_ONLY__:900", sellerExternalId: 900, sellerAliasExternalIds: [900] },
        { sellerIdentityKey: "gislene lima", sellerExternalId: 12, sellerAliasExternalIds: [12, 37] },
        { sellerIdentityKey: "__ID_ONLY__:901", sellerExternalId: 901, sellerAliasExternalIds: [] },
      ],
      [unmapped, gislene]
    );
    assert.deepEqual(names(built.options), ["GISLENE LIMA"]);
    assert.equal(
      built.options.some((option) => option.name === ORDER_SELLER_UNMAPPED_LABEL || option.key.includes("__ID_ONLY__")),
      false
    );
    assert.equal(built.unresolvedAssignments, 2);
    assert.deepEqual(buildCustomerCommercialOwnerFilterWhere(buildAdminSellerOptionKey(unmapped), [unmapped]), {
      id: { in: [] },
    });
  });

  it("a montagem do filtro não consulta o banco por cliente", () => {
    const src = readFileSync("src/lib/crmCustomerCommercialOwner.ts", "utf8");
    const loader = src.slice(
      src.indexOf("async function loadActiveCommercialOwnerAssignments"),
      src.indexOf("export async function listCommercialOwnerFilterOptions")
    );
    const prepare = src.slice(
      src.indexOf("export async function prepareCommercialOwnerCustomerListFilter"),
      src.indexOf("export async function attachCustomerCommercialOwnerListFields")
    );
    const pure = src.slice(
      src.indexOf("export function buildCommercialOwnerFilterOptions"),
      src.indexOf("export function buildCustomerCommercialOwnerFilterWhere")
    );
    assert.equal(loader.match(/findMany/g)?.length, 1);
    assert.match(loader, /isActive: true/);
    assert.doesNotMatch(loader, /for\s*\(|findUnique|customerId/);
    assert.match(prepare, /Promise\.all/);
    assert.match(prepare, /loadActiveCommercialOwnerAssignments\(\)/);
    assert.match(prepare, /fetchAdminSellerOptionsFromDb\(\)/);
    assert.doesNotMatch(prepare, /for\s*\(|findUnique|prisma\.customer/);
    assert.doesNotMatch(pure, /prisma|findMany|fetchAdminSellerOptionsFromDb/);
    assert.doesNotMatch(pure, /commercialOwnerListDisplayName/);
    const server = readFileSync("server.ts", "utf8");
    const handler =
      /app\.get\("\/api\/customers"[\s\S]*?app\.get\("\/api\/customers\/indicators"/.exec(server)?.[0] ?? "";
    assert.match(handler, /prepareCommercialOwnerCustomerListFilter\(list\.commercialOwner\)/);
    assert.doesNotMatch(handler, /distinct:\s*\[\s*"sellerIdentityKey"\s*\]/);
  });
});
