import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("company intelligence — contrato oficial", () => {
  it("expõe as rotas canônicas de Clientes", () => {
    const routes = read("src/lib/companyIntelligenceRoutes.ts");
    assert.ok(routes.includes('"/api/company-intelligence/cnpj/:cnpj"'));
    assert.ok(routes.includes('"/api/customers/:id/company-intelligence"'));
    assert.ok(routes.includes('"/api/customers/:id/company-intelligence/refresh"'));
    assert.ok(routes.includes('"/api/company-intelligence/economic-context"'));
  });

  it("UI de Clientes consulta só a API interna", () => {
    const panel = read("src/components/customers/CustomerCnpjIntelligencePanel.tsx");
    assert.ok(panel.includes("/api/company-intelligence/cnpj/"));
    assert.ok(panel.includes("/api/customers/${customerId}/company-intelligence"));
    assert.equal(panel.includes("brasilapi.com.br"), false);
    assert.equal(panel.includes("publica.cnpj.ws"), false);
    assert.equal(panel.includes("api.bcb.gov.br"), false);
    assert.ok(panel.includes("CnpjSourcesStatusPanel"));
  });

  it("fornecedor reutiliza o motor canônico sem providers próprios", () => {
    const profile = read("src/lib/financeSupplierProfile.ts");
    assert.ok(profile.includes("buildCompanyIntelligencePayload"));
    assert.equal(profile.includes("brasilApiCnpjProvider"), false);
    assert.equal(profile.includes("publicaCnpjWsProvider"), false);
    assert.equal(profile.includes("brasilapi.com.br"), false);
  });

  it("cadastro de fornecedor mostra fontes da mesma intelligence", () => {
    const drawer = read("src/components/finance/cost-centers/FinanceSupplierCadastroDrawer.tsx");
    assert.ok(drawer.includes("CnpjSourcesStatusPanel"));
    assert.ok(drawer.includes("/api/finance/suppliers"));
    assert.equal(drawer.includes("brasilapi.com.br"), false);
  });

  it("payload de API permanece backward-compatible", () => {
    const types = read("src/lib/companyCnpjLookup.ts");
    for (const field of [
      "lookupId",
      "cnpj",
      "source",
      "fromCache",
      "summary",
      "risk",
      "commercial",
      "comparison",
      "rawJson",
      "sources",
      "provenance",
      "conflicts",
      "partialResult",
      "economicContext",
    ]) {
      assert.ok(types.includes(field), `campo ${field} ausente do payload`);
    }
  });

  it("duplicidade de cliente continua bloqueada no cadastro via consulta", () => {
    const lookup = read("src/lib/companyCnpjLookup.ts");
    assert.ok(lookup.includes("DUPLICATE_TAX_ID"));
    assert.ok(lookup.includes("Já existe cliente cadastrado com este CNPJ."));
    assert.ok(lookup.includes("confirmPublicContactOverwrite"));
  });

  it("CustomerCnpjLookup já tem source textual — sem migration destrutiva", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /model CustomerCnpjLookup \{[\s\S]*source\s+String\s+@default\("publica\.cnpj\.ws"\)/);
    assert.equal(schema.includes("DROP TABLE"), false);
  });
});
