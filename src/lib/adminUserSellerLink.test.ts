import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  parseExternalSellerIdsInput,
  resolveAppUserSellerLinkFromBody,
  resolvePrimaryExternalSellerId,
  roleAllowsSellerNomusLink,
  roleRequiresSellerNomusLink,
} from "@/src/lib/adminUserSellerLink";
import {
  flattenAdminSellerOptionsToNomusPicks,
  type AdminSellerOption,
} from "@/src/lib/adminSellerOptionsTypes";

describe("adminUserSellerLink", () => {
  it("roleAllowsSellerNomusLink cobre vendedor e gestor comercial", () => {
    assert.equal(roleAllowsSellerNomusLink("SELLER"), true);
    assert.equal(roleAllowsSellerNomusLink("COMMERCIAL_MANAGER"), true);
    assert.equal(roleAllowsSellerNomusLink("ADMIN"), false);
    assert.equal(roleRequiresSellerNomusLink("SELLER"), true);
    assert.equal(roleRequiresSellerNomusLink("COMMERCIAL_MANAGER"), false);
  });

  it("parseExternalSellerIdsInput normaliza e deduplica", () => {
    assert.deepEqual(parseExternalSellerIdsInput([646, "464", 464, 0, -1, "x"]), [464, 646]);
    assert.deepEqual(parseExternalSellerIdsInput("464, 646; 1189"), [464, 646, 1189]);
  });

  it("resolvePrimaryExternalSellerId usa o menor ID", () => {
    assert.equal(resolvePrimaryExternalSellerId([646, 464]), 464);
    assert.equal(resolvePrimaryExternalSellerId([]), null);
  });

  it("resolveAppUserSellerLinkFromBody preferencias array e nome", () => {
    assert.deepEqual(
      resolveAppUserSellerLinkFromBody({
        externalSellerIds: [646, 464],
        externalSellerId: 999,
        sellerResponsibleName: "  Gislene Lima ",
      }),
      {
        externalSellerIds: [464, 646],
        externalSellerId: 464,
        sellerResponsibleName: "Gislene Lima",
      }
    );
    assert.deepEqual(
      resolveAppUserSellerLinkFromBody({
        externalSellerId: 1189,
        sellerResponsibleName: "",
      }),
      {
        externalSellerIds: [1189],
        externalSellerId: 1189,
        sellerResponsibleName: null,
      }
    );
  });
});

describe("flattenAdminSellerOptionsToNomusPicks", () => {
  it("expande identidades consolidadas em IDs Nomus selecionáveis", () => {
    const options: AdminSellerOption[] = [
      {
        externalSellerId: 464,
        externalSellerIds: [464, 646],
        sellerIdentityKey: "gislene lima",
        responsible: "Gislene Lima",
        displayName: "Gislene Lima",
        normalizedName: "GISLENE LIMA",
        ordersCount: 10,
        ordersValue: 1000,
        proposalsCount: 0,
        proposalsValue: 0,
        source: "sales_orders",
        confidence: "HIGH",
        mergedFragmentCount: 2,
      },
    ];
    const picks = flattenAdminSellerOptionsToNomusPicks(options);
    assert.equal(picks.length, 2);
    assert.deepEqual(
      picks.map((p) => p.externalSellerId),
      [464, 646]
    );
    assert.equal(picks[0]?.displayName, "Gislene Lima");
  });
});

describe("AdminUsersModule seller Nomus link", () => {
  it("permite vínculo Nomus para vendedor e gestor comercial", () => {
    const src = readFileSync(join(process.cwd(), "src/components/AdminUsersModule.tsx"), "utf8");
    assert.match(src, /roleAllowsSellerNomusLink/);
    assert.match(src, /roleRequiresSellerNomusLink/);
    assert.match(src, /admin-user-seller-nomus-link/);
    assert.match(src, /Gestor comercial/);
    assert.match(src, /Salvar vínculo Nomus/);
  });
});
