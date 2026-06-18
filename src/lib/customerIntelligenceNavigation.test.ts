import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCustomerIntelligenceApiPath,
  buildCustomerIntelligenceCompatPath,
  buildCustomerIntelligencePath,
  CUSTOMER_INTELLIGENCE_ROUTE_COMPAT,
  CUSTOMER_INTELLIGENCE_ROUTE_PRIMARY,
  CUSTOMER_INTELLIGENCE_TAB_IDS,
} from "./customerIntelligenceNavigation.js";

describe("customerIntelligenceNavigation", () => {
  const appSrc = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");

  it("rota /crm/customers/:customerId/intelligence existe no App", () => {
    assert.ok(appSrc.includes('path="crm/customers/:customerId/intelligence"'));
    assert.equal(CUSTOMER_INTELLIGENCE_ROUTE_PRIMARY, "/crm/customers/:customerId/intelligence");
  });

  it("rota compatível /customers/:customerId/intelligence existe no App", () => {
    assert.ok(appSrc.includes('path="customers/:customerId/intelligence"'));
    assert.equal(CUSTOMER_INTELLIGENCE_ROUTE_COMPAT, "/customers/:customerId/intelligence");
  });

  it("buildCustomerIntelligencePath gera URL navegável", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    assert.equal(
      buildCustomerIntelligencePath(id),
      "/crm/customers/11111111-1111-4111-8111-111111111111/intelligence"
    );
    assert.equal(
      buildCustomerIntelligenceCompatPath(id),
      "/customers/11111111-1111-4111-8111-111111111111/intelligence"
    );
  });

  it("buildCustomerIntelligenceApiPath aponta para endpoint consolidado", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    assert.equal(
      buildCustomerIntelligenceApiPath(id),
      "/api/crm/customers/11111111-1111-4111-8111-111111111111/intelligence"
    );
    assert.equal(
      buildCustomerIntelligenceApiPath(id, "year=2026"),
      "/api/crm/customers/11111111-1111-4111-8111-111111111111/intelligence?year=2026"
    );
  });

  it("define abas da tela", () => {
    assert.ok(CUSTOMER_INTELLIGENCE_TAB_IDS.includes("overview"));
    assert.ok(CUSTOMER_INTELLIGENCE_TAB_IDS.length >= 8);
  });

  it("popup atual possui botão para inteligência completa", () => {
    const modalSrc = readFileSync(
      join(process.cwd(), "src/components/customers/CustomerCommercial360.tsx"),
      "utf8"
    );
    assert.ok(modalSrc.includes("Abrir Inteligência Completa"));
    assert.ok(modalSrc.includes("buildCustomerIntelligencePath"));
  });

  it("listagem de clientes possui link Inteligência", () => {
    const moduleSrc = readFileSync(
      join(process.cwd(), "src/components/CustomerModule.tsx"),
      "utf8"
    );
    assert.ok(moduleSrc.includes("buildCustomerIntelligencePath"));
    assert.ok(moduleSrc.includes("Inteligência do Cliente"));
  });

  it("CRM Comercial possui link Inteligência no cockpit", () => {
    const crmSrc = readFileSync(join(process.cwd(), "src/components/CrmModule.tsx"), "utf8");
    assert.ok(crmSrc.includes("buildCustomerIntelligencePath"));
    assert.ok(crmSrc.includes("Inteligência"));
  });

  it("lista de pedidos possui link seguro para inteligência quando há customerId", () => {
    const salesSrc = readFileSync(
      join(process.cwd(), "src/components/SalesOrdersModule.tsx"),
      "utf8"
    );
    assert.ok(salesSrc.includes("buildCustomerIntelligencePath"));
    assert.ok(salesSrc.includes("customerId"));
  });
});
