/**
 * Escopo do GET /api/crm/dashboard/basic.
 *
 * Dois defeitos corrigidos aqui:
 *
 * 1. O endpoint escopava "own" pelo VENDEDOR NOMUS do pedido
 *    (`buildCrmSellerCustomerExistsSql`, marcado @deprecated), enquanto todo o
 *    resto do CRM usa o Responsável Comercial do cliente. Responsável de
 *    carteira e vendedor do pedido são eixos separados por regra oficial
 *    (docs/commercial/crm-commercial-owner-and-order-seller-rules.md).
 *
 * 2. A chamada omitia `sellerIdentityKey`. Como `crmCommercialSellerMatchFilters`
 *    zera `externalSellerId`/`responsible` sempre que existe identity key, o
 *    filtro caía em todas as branches e virava `TRUE` — um usuário de escopo
 *    próprio recebia contagens de praticamente toda a base.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCrmDashboardBasicCustomerScopeSql } from "@/src/lib/crmDashboardBasicService.js";

const CUSTOMER_A = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_B = "22222222-2222-4222-8222-222222222222";

describe("crmDashboardBasic — escopo de clientes", () => {
  it("escopo global não restringe", () => {
    const sql = buildCrmDashboardBasicCustomerScopeSql("global", []);
    assert.equal(sql.sql.trim(), "TRUE");
  });

  it("escopo own restringe à carteira do responsável", () => {
    const sql = buildCrmDashboardBasicCustomerScopeSql("own", [CUSTOMER_A, CUSTOMER_B]);
    assert.match(sql.sql, /c\."id" = ANY\(/);
    assert.deepEqual(sql.values, [[CUSTOMER_A, CUSTOMER_B]]);
  });

  it("own SEM carteira é fail-closed: FALSE, nunca TRUE", () => {
    const sql = buildCrmDashboardBasicCustomerScopeSql("own", []);
    assert.equal(sql.sql.trim(), "FALSE");
    assert.notEqual(
      sql.sql.trim(),
      "TRUE",
      "own sem carteira jamais pode liberar o universo inteiro"
    );
  });

  it("escopo none e fail-closed: FALSE", () => {
    // none e a negacao explicita de acesso; jamais pode liberar o universo.
    const sql = buildCrmDashboardBasicCustomerScopeSql("none", []);
    assert.equal(sql.sql.trim(), "FALSE");
    const comIds = buildCrmDashboardBasicCustomerScopeSql("none", [CUSTOMER_A]);
    assert.equal(comIds.sql.trim(), "FALSE");
  });

  it("respeita o alias da tabela", () => {
    const sql = buildCrmDashboardBasicCustomerScopeSql("own", [CUSTOMER_A], "cust");
    assert.match(sql.sql, /cust\."id" = ANY\(/);
  });
});

describe("crmDashboardBasic — contrato de eixo", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/crmDashboardBasicService.ts"),
    "utf8"
  );

  it("não usa mais o eixo depreciado de vendedor Nomus", () => {
    assert.doesNotMatch(
      source,
      /buildCrmSellerCustomerExistsSql/,
      "o escopo de acesso não pode voltar a ser o vendedor do pedido"
    );
  });

  it("resolve a carteira pelo Responsável Comercial", () => {
    assert.match(source, /fetchCrmManualOwnerCustomerIds/);
  });

  it("resolve a carteira uma vez só, sem repetir a consulta por contagem", () => {
    const matches = source.match(/fetchCrmManualOwnerCustomerIds\(/g) ?? [];
    assert.equal(matches.length, 1, "a carteira deve ser resolvida uma única vez");
  });
});

describe("Responsável Comercial × Vendedor do Pedido — regressão de eixo", () => {
  it("carteira de A não passa a ser de B só porque B é o vendedor do pedido", () => {
    // Cliente cuja carteira é do responsável A; o pedido tem vendedor Nomus B.
    // O escopo de acesso considera SOMENTE a carteira (A).
    const carteiraDeA = [CUSTOMER_A];

    // Usuário A (responsável pela carteira) enxerga o cliente.
    const scopeDeA = buildCrmDashboardBasicCustomerScopeSql("own", carteiraDeA);
    assert.deepEqual(scopeDeA.values, [[CUSTOMER_A]]);

    // Usuário B (apenas vendedor do pedido, sem carteira) NÃO enxerga nada por
    // esse eixo — antes do fix, o filtro degradava para TRUE e ele veria tudo.
    const scopeDeB = buildCrmDashboardBasicCustomerScopeSql("own", []);
    assert.equal(scopeDeB.sql.trim(), "FALSE");
  });
});
