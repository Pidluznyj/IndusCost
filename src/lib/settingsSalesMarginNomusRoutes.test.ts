import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("settingsSalesMarginNomusRoutes", () => {
  function read(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
  }

  it("expõe rotas de config e preview", () => {
    const routes = read("src/lib/settingsSalesMarginNomusRoutes.ts");
    const server = read("server.ts");
    assert.match(routes, /\/api\/settings\/sales-margin-nomus/);
    assert.match(routes, /\/api\/settings\/sales-margin-nomus\/preview/);
    assert.match(server, /registerSettingsSalesMarginNomusRoutes/);
  });

  it("usa permissões de parâmetros globais", () => {
    const routes = read("src/lib/settingsSalesMarginNomusRoutes.ts");
    assert.match(routes, /SETTINGS_GLOBAL_PARAMS_EDIT_PERMISSIONS/);
    assert.match(routes, /SETTINGS_GLOBAL_PARAMS_VIEW_PERMISSIONS/);
  });

  it("motor carrega config Nomus", () => {
    const adapter = read("src/lib/salesMarginRulesAdapter.ts");
    assert.match(adapter, /loadSalesMarginNomusConfig/);
    assert.match(adapter, /resolveOfficialSalesMarginTaxContext/);
  });

  it("UI não calcula margem no React", () => {
    const panel = read("src/components/settings/SalesMarginNomusConfigPanel.tsx");
    assert.match(panel, /sales-margin-nomus\/preview/);
    assert.doesNotMatch(panel, /computeWeightedMarginPercent/);
    assert.doesNotMatch(panel, /buildOfficialSalesMarginRulesResult/);
  });

  it("PUT valida TaxRule e retorna payload completo com taxRules", () => {
    const routes = read("src/lib/settingsSalesMarginNomusRoutes.ts");
    assert.match(routes, /validateSalesMarginNomusConfigForSave/);
    assert.match(routes, /buildSalesMarginNomusSettingsPayload/);
    assert.match(routes, /listActiveSalesTaxRules/);
    assert.match(routes, /taxRules/);
  });

  it("UI valida TaxRule antes de salvar", () => {
    const panel = read("src/components/settings/SalesMarginNomusConfigPanel.tsx");
    assert.match(panel, /validateSalesMarginNomusConfigForSave/);
    assert.match(panel, /SALES_MARGIN_NOMUS_TAX_RULE_REQUIRED_MESSAGE/);
    assert.match(panel, /Configuração fiscal incompleta/);
  });
});
