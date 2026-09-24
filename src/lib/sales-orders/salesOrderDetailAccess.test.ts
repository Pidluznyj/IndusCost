import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  resolveSalesOrderDetailAccess,
  shouldLoadSalesOrderIndustrialResult,
} from "./salesOrderDetailAccess.js";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("segregação do detalhe do PV por persona SELLER", () => {
  it("SELLER não vê Auditoria 360, Custos nem Resultado; Geral permanece", () => {
    const access = resolveSalesOrderDetailAccess({ role: "SELLER" });
    assert.equal(access.canViewGeneral, true);
    assert.equal(access.canOpenAudit360, false);
    assert.equal(access.canViewCosts, false);
    assert.equal(access.canViewDetailedResult, false);
    assert.equal(shouldLoadSalesOrderIndustrialResult(access), false);
  });

  it("COMMERCIAL_MANAGER, ADMIN e SUPER_ADMIN preservam o acesso", () => {
    for (const role of ["COMMERCIAL_MANAGER", "ADMIN", "SUPER_ADMIN"] as const) {
      const access = resolveSalesOrderDetailAccess({ role });
      assert.equal(access.canOpenAudit360, true, role);
      assert.equal(access.canViewCosts, true, role);
      assert.equal(access.canViewDetailedResult, true, role);
      assert.equal(shouldLoadSalesOrderIndustrialResult(access), true, role);
    }
  });

  it("VIEWER e perfil sem role SELLER não entram nesta segregação", () => {
    for (const role of ["VIEWER", "CUSTOM_PROFILE", null, ""] as const) {
      const access = resolveSalesOrderDetailAccess({ role });
      assert.equal(access.canOpenAudit360, true, String(role));
      assert.equal(access.canViewCosts, true, String(role));
      assert.equal(access.canViewDetailedResult, true, String(role));
    }
  });

  it("grants amplos não vencem o deny da persona SELLER", () => {
    const access = resolveSalesOrderDetailAccess({ role: "seller" });
    assert.equal(access.canOpenAudit360, false);
    assert.equal(access.canViewCosts, false);
    assert.equal(access.canViewDetailedResult, false);
    assert.equal(
      resolveSalesOrderDetailAccess({ role: "COMMERCIAL_MANAGER" }).canViewCosts,
      true
    );
  });

  it("o detalhe não calcula industrialResult para SELLER e nega o bloco", () => {
    const service = read("src/lib/sales-orders/salesOrderDetailService.server.ts");
    const gate =
      /const detailAccess = resolveSalesOrderDetailAccess[\s\S]*?if \(industrialResultAccess === "allowed"\) \{[\s\S]*?loadSalesOrderDetailIndustrialResult\(/.exec(
        service
      );
    assert.ok(gate, "carga industrial precisa ficar dentro do gate de acesso");
    assert.match(service, /industrialResultAccess,/);
    assert.match(service, /getOrderFullAudit\(/);
    assert.doesNotMatch(
      /export async function getSalesOrderDetail[\s\S]*?const detailAccess/.exec(service)?.[0] ??
        "",
      /loadSalesOrderDetailIndustrialResult/
    );
  });

  it("a UI oculta botão e abas do SELLER e não renderiza o conteúdo sensível", () => {
    const dialog = read("src/components/sales/SalesOrderDetailDialog.tsx");
    assert.match(
      dialog,
      /AUDIT_360_ENABLED && onOpenFullAudit && detailAccess\.canOpenAudit360/
    );
    assert.match(dialog, /detailAccess\.canViewCosts/);
    assert.match(dialog, /detailAccess\.canViewDetailedResult/);
    assert.match(dialog, /setActiveTab\("geral"\)/);
    assert.match(
      dialog,
      /activeTab === "custos" &&\s*detailAccess\.canViewCosts &&\s*payload\.industrialResultAccess !== "denied"/
    );
    assert.match(
      dialog,
      /activeTab === "resultado" &&\s*detailAccess\.canViewDetailedResult &&\s*payload\.industrialResultAccess !== "denied"/
    );
    assert.match(dialog, /canViewSalesOrderFiscalTaxes\(auth\)/);
    assert.match(dialog, /sales-order-detail-print/);
    assert.match(dialog, /sales-order-detail-open-cr/);
    assert.doesNotMatch(dialog, /crmCommercialPersona|dataScope/);
  });

  it("Auditoria 360 pública recusa SELLER antes do motor interno", () => {
    const routes = read("src/lib/financePortfolioReconciliationRoutes.ts");
    const handler =
      /\/api\/finance\/portfolio-reconciliation\/orders\/:salesOrderId\/audit-full[\s\S]*?getOrderFullAudit\(/.exec(
        routes
      )?.[0] ?? "";
    assert.match(handler, /resolveSalesOrderDetailAccess/);
    assert.match(handler, /!auditAccess\.canOpenAudit360/);
    assert.match(handler, /status\(403\)/);
    assert.match(handler, /SALES_ORDER_AUDIT_360_DENIED/);
    const denyAt = handler.indexOf("!auditAccess.canOpenAudit360");
    const engineAt = handler.indexOf("getOrderFullAudit(");
    assert.ok(denyAt >= 0 && engineAt > denyAt);
  });
});
