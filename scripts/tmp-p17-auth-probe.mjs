import { authorizeRequireResource } from "../src/lib/security/requireResource.ts";
import { buildRoleBaselineFromSeed } from "../src/lib/security/effectiveAccess/roleBaseline.ts";

function auth(perms, role = "VIEWER") {
  return {
    id: "u",
    name: "t",
    email: "t@t.com",
    role,
    permissions: perms,
    effectivePermissions: perms,
    isActive: true,
  };
}

const adminBase = buildRoleBaselineFromSeed("ADMIN");
for (const k of [
  "finance",
  "finance.cash_flow",
  "finance.billing",
  "finance.sales_orders",
  "finance.executive_report",
  "finance.reports",
  "finance.opex",
  "finance.taxes",
  "finance.portfolio_reconciliation",
  "finance.accounts_receivable",
  "finance.accounts_payable",
  "finance.cost_centers",
  "finance.suppliers",
]) {
  console.log("ADMIN baseline", k, !!adminBase[k]?.view);
}

for (const [label, perms, resource, role] of [
  ["fluxo bag", ["financeiro.fluxo_caixa"], "finance.cash_flow", "VIEWER"],
  ["exec bag", ["finance.executiveReport.view"], "finance.executive_report", "VIEWER"],
  ["financeiro bag", ["financeiro"], "finance", "VIEWER"],
  ["billing sales", ["sales_orders.view"], "finance.billing", "VIEWER"],
  ["billing sales ADMIN", ["sales_orders.view"], "finance.billing", "ADMIN"],
  ["reports.view reports", ["reports.view"], "finance.reports", "VIEWER"],
]) {
  const d = authorizeRequireResource(auth(perms, role), resource, "view", {
    legacyCompatMode: true,
  });
  console.log(label, d.ok);
}
