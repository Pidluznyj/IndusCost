import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildSellerOptionKey,
  formatSellerOptionLabel,
} from "@/src/components/crmSellerDashboardUi.js";
import {
  consolidateSellerRowFragments,
  consolidatedIdentityMatchesUser,
  consolidatedOptionToSellerOption,
  formatConsolidatedSellerAuditLabel,
} from "@/src/lib/crmSellerIdentityConsolidation.js";

describe("crmSellerIdentityConsolidation", () => {
  it("mesmo nome com ID e sem ID vira uma opção única", () => {
    const options = consolidateSellerRowFragments([
      { external_seller_id: 464, responsible: "GISLENE LIMA", orders_count: 5 },
      { external_seller_id: null, responsible: "GISLENE LIMA", orders_count: 2 },
    ]);
    assert.equal(options.length, 1);
    assert.equal(options[0]!.displayName, "GISLENE LIMA");
    assert.equal(options[0]!.ordersCount, 7);
    assert.equal(options[0]!.hasOrdersWithoutNomusId, true);
    assert.deepEqual(options[0]!.externalSellerIds, [464]);
    assert.equal(options[0]!.mergedFragmentCount, 2);
  });

  it("mesmo nome com três IDs Nomus (GISLENE) vira uma opção única", () => {
    const options = consolidateSellerRowFragments([
      { external_seller_id: 464, responsible: "GISLENE LIMA", orders_count: 100 },
      { external_seller_id: 646, responsible: "GISLENE LIMA", orders_count: 80 },
      { external_seller_id: 645, responsible: "GISLENE LIMA", orders_count: 20 },
    ]);
    assert.equal(options.length, 1);
    assert.equal(options[0]!.displayName, "GISLENE LIMA");
    assert.equal(options[0]!.ordersCount, 200);
    assert.deepEqual(options[0]!.externalSellerIds, [464, 645, 646]);
    assert.equal(options[0]!.mergedFragmentCount, 3);
    assert.equal(
      consolidatedIdentityMatchesUser(options[0]!, {
        externalSellerId: 464,
        sellerResponsibleName: null,
      }),
      true
    );
    assert.equal(
      consolidatedIdentityMatchesUser(options[0]!, {
        externalSellerId: 645,
        sellerResponsibleName: null,
      }),
      true
    );
  });

  it("cadastro de usuário usa consolidação no admin seller options", () => {
    const admin = readFileSync(join(process.cwd(), "src/lib/adminSellerOptions.ts"), "utf8");
    const picker = readFileSync(
      join(process.cwd(), "src/components/admin/SellerNomusPicker.tsx"),
      "utf8"
    );
    assert.match(admin, /consolidateAdminSellerMetricsRows/);
    assert.match(picker, /formatAdminSellerOptionSublabel/);
    assert.match(picker, /Consolida/);
    assert.doesNotMatch(picker, /GISLENE|464|646|645/);
  });

  it("sessão enriquece sellerIdentityKey para vínculo só por ID", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(server, /enrichAppAuthSellerCommercialLink/);
  });

  it("mesmo nome com dois IDs vira uma opção única quando o nome normalizado é exatamente igual", () => {
    const options = consolidateSellerRowFragments([
      { external_seller_id: 1399, responsible: "Rodrigo Da Silva Ramos", orders_count: 10 },
      { external_seller_id: 646, responsible: "Rodrigo Da Silva Ramos", orders_count: 4 },
      { external_seller_id: null, responsible: "Rodrigo Da Silva Ramos", orders_count: 1 },
    ]);
    assert.equal(options.length, 1);
    assert.equal(options[0]!.displayName, "Rodrigo Da Silva Ramos");
    assert.equal(options[0]!.ordersCount, 15);
    assert.deepEqual(options[0]!.externalSellerIds, [646, 1399]);
    assert.match(formatConsolidatedSellerAuditLabel(options[0]!), /IDs Nomus: 646, 1399/);
    assert.match(formatConsolidatedSellerAuditLabel(options[0]!), /pedidos: 15/);
  });

  it("nomes diferentes não são consolidados", () => {
    const options = consolidateSellerRowFragments([
      { external_seller_id: 100, responsible: "Ana Souza", orders_count: 3 },
      { external_seller_id: 200, responsible: "Ana Souza Costa", orders_count: 2 },
    ]);
    assert.equal(options.length, 2);
    const names = options.map((o) => o.displayName).sort();
    assert.deepEqual(names, ["Ana Souza", "Ana Souza Costa"]);
  });

  it("vendedor logado com um dos IDs enxerga a identidade consolidada", () => {
    const options = consolidateSellerRowFragments([
      { external_seller_id: 1399, responsible: "Rodrigo Da Silva Ramos", orders_count: 10 },
      { external_seller_id: 646, responsible: "Rodrigo Da Silva Ramos", orders_count: 4 },
    ]);
    const consolidated = options[0]!;
    assert.equal(
      consolidatedIdentityMatchesUser(consolidated, {
        externalSellerId: 646,
        sellerResponsibleName: null,
      }),
      true
    );
    assert.equal(
      consolidatedIdentityMatchesUser(consolidated, {
        externalSellerId: null,
        sellerResponsibleName: "Rodrigo Da Silva Ramos",
      }),
      true
    );
    assert.equal(
      consolidatedIdentityMatchesUser(consolidated, {
        externalSellerId: 999,
        sellerResponsibleName: "Outro Vendedor",
      }),
      false
    );
  });

  it("gestor enxerga lista consolidada sem duplicidade de chave", () => {
    const options = consolidateSellerRowFragments([
      { external_seller_id: 464, responsible: "GISLENE LIMA", orders_count: 5 },
      { external_seller_id: null, responsible: "GISLENE LIMA", orders_count: 2 },
      { external_seller_id: 1399, responsible: "Rodrigo Da Silva Ramos", orders_count: 10 },
      { external_seller_id: 646, responsible: "Rodrigo Da Silva Ramos", orders_count: 4 },
    ]);
    const sellerOptions = options.map(consolidatedOptionToSellerOption);
    const keys = sellerOptions.map((o) => buildSellerOptionKey(o));
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(sellerOptions.length, 2);
    assert.equal(formatSellerOptionLabel(sellerOptions[0]!), "Rodrigo Da Silva Ramos");
  });

  it("API retorna opções consolidadas via serviço", () => {
    const service = readFileSync(
      join(process.cwd(), "src/lib/crmSellerDashboardService.ts"),
      "utf8"
    );
    assert.match(service, /consolidateSellerRowFragments/);
    assert.match(service, /consolidatedOptionToSellerOption/);
    assert.match(service, /sellerIdentityKey/);
    assert.doesNotMatch(service, /sellerOptionsRows\.filter\(sellerRowInScope\)/);
  });

  it("frontend renderiza sem duplicidade no dropdown", () => {
    const section = readFileSync(
      join(process.cwd(), "src/components/CrmSellerDashboardSection.tsx"),
      "utf8"
    );
    assert.match(section, /formatSellerOptionLabel/);
    assert.equal(section.includes("proposalsCount"), false);
    assert.match(section, /buildSellerOptionKey/);
  });
});
