import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FINANCE_SECTION_PATHS,
  FINANCE_SECTIONS,
  FINANCE_STANDALONE_PATHS,
  getFinanceDefaultPath,
  getFinanceSectionPath,
  getFinanceSuppliersPath,
  hasNestedFinanceSectionPath,
  isFinanceCanonicalPath,
  isFinanceSuppliersStandalonePath,
  parseFinanceSectionFromPath,
  resolveFinanceCanonicalPath,
} from "./financeNavigation.js";

describe("financeNavigation", () => {
  it("expõe rotas canônicas absolutas", () => {
    assert.equal(getFinanceSectionPath("cash-flow"), "/finance/cash-flow");
    assert.equal(getFinanceSectionPath("accounts-receivable"), "/finance/accounts-receivable");
    assert.equal(getFinanceSectionPath("accounts-payable"), "/finance/accounts-payable");
    assert.equal(getFinanceSectionPath("billing"), "/finance/billing");
    assert.equal(getFinanceSectionPath("executive-report"), "/finance/executive-report");
    assert.equal(getFinanceSuppliersPath(), "/finance/suppliers");
    assert.equal(FINANCE_STANDALONE_PATHS.suppliers, "/finance/suppliers");
    assert.equal(getFinanceDefaultPath(), "/finance/accounts-receivable");
    for (const section of FINANCE_SECTIONS) {
      assert.ok(section.path.startsWith("/finance/"), section.path);
      assert.equal(section.path, FINANCE_SECTION_PATHS[section.id]);
      assert.notEqual(section.id, "suppliers");
    }
  });

  it("identifica paths canônicos vs aninhados", () => {
    assert.equal(isFinanceCanonicalPath("/finance/cash-flow"), true);
    assert.equal(isFinanceCanonicalPath("/finance/accounts-receivable"), true);
    assert.equal(isFinanceCanonicalPath("/finance/accounts-payable"), true);
    assert.equal(isFinanceCanonicalPath("/finance/billing"), true);
    assert.equal(isFinanceCanonicalPath("/finance/executive-report"), true);
    assert.equal(isFinanceCanonicalPath("/finance/suppliers"), true);
    assert.equal(isFinanceSuppliersStandalonePath("/finance/suppliers"), true);
    assert.equal(isFinanceSuppliersStandalonePath("/finance/cost-centers"), false);
    assert.equal(isFinanceCanonicalPath("/finance"), true);
    assert.equal(
      isFinanceCanonicalPath("/finance/accounts-receivable/accounts-payable"),
      false
    );
    assert.equal(hasNestedFinanceSectionPath("/finance/accounts-receivable/accounts-payable"), true);
    assert.equal(
      hasNestedFinanceSectionPath(
        "/finance/accounts-receivable/accounts-payable/accounts-receivable"
      ),
      true
    );
    assert.equal(hasNestedFinanceSectionPath("/finance/accounts-payable"), false);
  });

  it("resolve path aninhado para rota canônica sem concatenar segmentos", () => {
    assert.equal(
      resolveFinanceCanonicalPath("/finance/accounts-receivable/accounts-payable"),
      "/finance/accounts-receivable"
    );
    assert.equal(
      resolveFinanceCanonicalPath(
        "/finance/accounts-receivable/accounts-payable/accounts-receivable"
      ),
      "/finance/accounts-receivable"
    );
    assert.equal(resolveFinanceCanonicalPath("/finance"), "/finance/accounts-receivable");
    assert.equal(
      parseFinanceSectionFromPath("/finance/accounts-payable/extra"),
      "accounts-payable"
    );
  });

  it("alternância de abas não concatena segmentos na string de destino", () => {
    const receivable = getFinanceSectionPath("accounts-receivable");
    const payable = getFinanceSectionPath("accounts-payable");
    const billing = getFinanceSectionPath("billing");
    assert.notEqual(receivable, payable);
    assert.notEqual(billing, payable);
    assert.equal(receivable.split("/").filter(Boolean).length, 2);
    assert.equal(payable.split("/").filter(Boolean).length, 2);
    assert.equal(billing.split("/").filter(Boolean).length, 2);
    assert.ok(!receivable.includes("accounts-payable"));
    assert.ok(!payable.includes("accounts-receivable"));
    assert.ok(!billing.includes("accounts-payable"));
  });

  it("FinanceModule usa navegação absoluta (sem to relativo perigoso)", () => {
    const mod = readFileSync(join(process.cwd(), "src", "components", "FinanceModule.tsx"), "utf8");
    const nav = readFileSync(join(process.cwd(), "src", "lib", "financeNavigation.ts"), "utf8");
    assert.ok(mod.includes("FINANCE_SECTIONS"));
    assert.ok(mod.includes("getFinanceDefaultPath"));
    assert.ok(mod.includes("resolveFinanceCanonicalPath"));
    assert.ok(!mod.includes('to: "accounts-receivable"'));
    assert.ok(!mod.includes('to: "accounts-payable"'));
    assert.ok(!mod.includes('to={defaultSection}'));
    assert.ok(nav.includes('"/finance/cash-flow"'));
    assert.ok(nav.includes('"/finance/accounts-receivable"'));
    assert.ok(nav.includes('"/finance/accounts-payable"'));
    assert.ok(nav.includes('"/finance/billing"'));
    assert.ok(nav.includes('"/finance/executive-report"'));
    assert.ok(nav.includes("FINANCE_STANDALONE_PATHS") || nav.includes("/finance/suppliers"));
    assert.doesNotMatch(mod, /path="suppliers"/);
    assert.doesNotMatch(mod, /FinanceSuppliersPage/);
  });

  it("App.tsx redireciona /finance para rota canônica e isola /finance/suppliers", () => {
    const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    assert.ok(app.includes('path="finance"'));
    assert.ok(app.includes("/finance/accounts-receivable"));
    assert.ok(app.includes('path="finance/suppliers"'));
    assert.ok(app.includes("FinanceSuppliersPage"));
    assert.ok(app.includes('path="finance/*"'));
  });
});
