/**
 * Aplica middlewares de permissão nas rotas do server.ts (Fase 1K-E).
 * Uso: node scripts/apply-api-permission-guards.mjs
 */
import fs from "fs";
import path from "path";

const serverPath = path.resolve("server.ts");
let src = fs.readFileSync(serverPath, "utf8");

/** [method, pathPattern (regex string), guards to insert after path] */
const rules = [
  // Dashboard
  ["get", '"/api/dashboard"', "requireAppAuth, requirePermission(\"dashboard.view\"), "],

  // Operational roles / payroll (settings.operational)
  ["get", '"/api/roles"', "requireAppAuth, requireBootstrapOrAnyPermission([\"settings.operational.view\", \"settings.view\"]), "],
  ["post", '"/api/roles"', "requireBootstrapOrAnyPermission([\"settings.operational.manage\", \"users.manage\"]), "],
  ["put", '"/api/roles/:id"', "requireBootstrapOrAnyPermission([\"settings.operational.manage\", \"users.manage\"]), "],
  ["delete", '"/api/roles/:id"', "requireBootstrapOrAnyPermission([\"settings.operational.manage\", \"users.manage\"]), "],
  ["get", '"/api/payroll-components"', "requireAppAuth, requireBootstrapOrAnyPermission([\"settings.operational.view\", \"settings.view\"]), "],
  ["post", '"/api/payroll-components"', "requireBootstrapOrAnyPermission([\"settings.operational.manage\", \"users.manage\"]), "],
  ["put", '"/api/payroll-components/:id"', "requireBootstrapOrAnyPermission([\"settings.operational.manage\", \"users.manage\"]), "],
  ["delete", '"/api/payroll-components/:id"', "requireBootstrapOrAnyPermission([\"settings.operational.manage\", \"users.manage\"]), "],

  // Machines
  ["get", '"/api/machines"', "requireAppAuth, requirePermission(\"machines.view\"), "],
  ["post", '"/api/machines"', "requireAppAuth, requirePermission(\"machines.edit\"), "],
  ["put", '"/api/machines/:id"', "requireAppAuth, requirePermission(\"machines.edit\"), "],
  ["delete", '"/api/machines/:id"', "requireAppAuth, requirePermission(\"machines.edit\"), "],

  // Employees
  ["get", '"/api/employees"', "requireAppAuth, requirePermission(\"employees.view\"), "],
  ["post", '"/api/employees"', "requireAppAuth, requirePermission(\"employees.edit\"), "],
  ["put", '"/api/employees/:id"', "requireAppAuth, requirePermission(\"employees.edit\"), "],
  ["delete", '"/api/employees/:id"', "requireAppAuth, requirePermission(\"employees.edit\"), "],
  ["patch", '"/api/employees/:id/status"', "requireAppAuth, requirePermission(\"employees.edit\"), "],

  // Materials
  ["get", '"/api/materials/import/template"', "requireAppAuth, requirePermission(\"materials.view\"), "],
  ["post", '"/api/materials/import/preview"', "requireAppAuth, requirePermission(\"materials.edit\"), upload.single(\"file\"), "],
  ["post", '"/api/materials/import/confirm"', "requireAppAuth, requirePermission(\"materials.edit\"), "],
  ["get", '"/api/materials"', "requireAppAuth, requirePermission(\"materials.view\"), "],
  ["post", '"/api/materials"', "requireAppAuth, requirePermission(\"materials.edit\"), "],
  ["put", '"/api/materials/:id"', "requireAppAuth, requirePermission(\"materials.edit\"), "],
  ["patch", '"/api/materials/:id/status"', "requireAppAuth, requirePermission(\"materials.edit\"), "],
  ["delete", '"/api/materials/:id"', "requireAppAuth, requirePermission(\"materials.edit\"), "],

  // Purchases
  ["get", '"/api/cost-centers"', "requireAppAuth, requirePermission(\"purchases.view\"), "],
  ["post", '"/api/cost-centers"', "requireAppAuth, requirePermission(\"purchases.edit\"), "],
  ["patch", '"/api/cost-centers/:id"', "requireAppAuth, requirePermission(\"purchases.edit\"), "],
  ["get", '"/api/purchase-requests"', "requireAppAuth, requirePermission(\"purchases.view\"), "],
  ["get", '"/api/purchase-requests/:id"', "requireAppAuth, requirePermission(\"purchases.view\"), "],
  ["post", '"/api/purchase-requests"', "requireAppAuth, requirePermission(\"purchases.create\"), "],
  ["put", '"/api/purchase-requests/:id"', "requireAppAuth, requirePermission(\"purchases.edit\"), "],

  // Products
  ["get", '"/api/products/import/template"', "requireAppAuth, requirePermission(\"products.view\"), "],
  ["post", '"/api/products/import/preview"', "requireAppAuth, requirePermission(\"products.edit\"), upload.single(\"file\"), "],
  ["post", '"/api/products/import/confirm"', "requireAppAuth, requirePermission(\"products.edit\"), "],
  ["get", '"/api/products"', "requireAppAuth, requirePermission(\"products.view\"), "],
  ["get", '"/api/products/bom-item-options"', "requireAppAuth, requireAnyPermission([\"products.view\", \"products.tab.bom\", \"products.edit\"]), "],
  ["get", '"/api/products/:id"', "requireAppAuth, requirePermission(\"products.view\"), "],
  ["get", '"/api/products/:id/tree"', "requireAppAuth, requireAnyPermission([\"products.tab.tree\", \"products.tab.bom\", \"products.edit\"]), "],
  ["post", '"/api/products"', "requireAppAuth, requirePermission(\"products.create\"), "],
  ["put", '"/api/products/:id"', "requireAppAuth, requirePermission(\"products.edit\"), "],
  ["delete", '"/api/products/:id"', "requireAppAuth, requirePermission(\"products.delete\"), "],
  ["post", '"/api/products/bulk-delete"', "requireAppAuth, requirePermission(\"products.delete\"), "],
  ["get", '"/api/products/:id/cost-analysis"', "requireAppAuth, requireAnyPermission([\"products.tab.cost\", \"products.tab.composition\", \"proposals.indicators.view\", \"pricing.view\", \"pricing.simulate\"]), "],
  ["get", '"/api/products/:id/pricing-snapshot"', "requireAppAuth, requireAnyPermission([\"pricing.view\", \"pricing.simulate\", \"products.tab.cost\"]), "],
  ["get", '"/api/products/material-demand/summary"', "requireAppAuth, requireAnyPermission([\"proposals.material_report.view\", \"products.view\"]), "],
  ["get", '"/api/products/material-demand/rows"', "requireAppAuth, requireAnyPermission([\"proposals.material_report.view\", \"products.view\"]), "],
  ["get", '"/api/products/material-demand/materials/:materialId/details"', "requireAppAuth, requireAnyPermission([\"proposals.material_report.view\", \"products.view\"]), "],
  ["get", '"/api/products/material-demand/facets"', "requireAppAuth, requireAnyPermission([\"proposals.material_report.view\", \"products.view\"]), "],
  ["get", '"/api/products/material-demand/analysis"', "requireAppAuth, requireAnyPermission([\"proposals.material_report.view\", \"products.view\"]), "],

  // OPEX
  ["get", '"/api/indirect-costs"', "requireAppAuth, requirePermission(\"opex.view\"), "],

  // Price tables
  ["get", '"/api/price-tables"', "requireAppAuth, requireAnyPermission([\"settings.price_tables.view\", \"pricing.view\", \"settings.view\"]), "],
  ["post", '"/api/price-tables/:priceTableId/versions/generate-draft"', "requireAppAuth, requireAnyPermission([\"pricing.generate_tables\", \"settings.price_tables.manage\"]), "],
  ["get", '"/api/price-table-versions/:id/items"', "requireAppAuth, requireAnyPermission([\"settings.price_tables.view\", \"pricing.view\"]), "],
  ["get", '"/api/price-tables/:priceTableId/products/:productId/published-price"', "requireAppAuth, requireAnyPermission([\"pricing.view\", \"proposals.view\", \"settings.price_tables.view\"]), "],
  ["post", '"/api/price-table-versions/:id/publish"', "requireAppAuth, requireAnyPermission([\"pricing.publish_tables\", \"settings.price_tables.manage\"]), "],

  // Tax
  ["get", '"/api/tax-rules"', "requireAppAuth, requireAnyPermission([\"taxes.view\", \"pricing.view\"]), "],
  ["post", '"/api/tax-rules"', "requireAppAuth, requirePermission(\"taxes.edit\"), "],
  ["put", '"/api/tax-rules/:id"', "requireAppAuth, requirePermission(\"taxes.edit\"), "],
  ["delete", '"/api/tax-rules/:id"', "requireAppAuth, requirePermission(\"taxes.edit\"), "],

  // Pricing
  ["get", '"/api/pricing"', "requireAppAuth, requirePermission(\"pricing.view\"), "],
  ["get", '"/api/pricing/commercial-published-prices"', "requireAppAuth, requirePermission(\"pricing.view\"), "],
  ["get", '"/api/pricing/published-price-source-trace"', "requireAppAuth, requirePermission(\"pricing.view\"), "],
  ["post", '"/api/pricing"', "requireAppAuth, requirePermission(\"pricing.view\"), "],
  ["post", '"/api/pricing/bulk-delete"', "requireAppAuth, requirePermission(\"pricing.view\"), "],
  ["delete", '"/api/pricing/:id"', "requireAppAuth, requirePermission(\"pricing.view\"), "],
  ["get", '"/api/pricing/:productId/:taxRuleId/calculate"', "requireAppAuth, requirePermission(\"pricing.simulate\"), "],
  ["post", '"/api/pricing/simulate-unit"', "requireAppAuth, requirePermission(\"pricing.simulate\"), "],
  ["post", '"/api/pricing/simulate-batch"', "requireAppAuth, requirePermission(\"pricing.simulate\"), "],
  ["post", '"/api/pricing/apply-batch"', "requireAppAuth, requirePermission(\"pricing.simulate\"), "],

  // Simulations
  ["get", '"/api/transformation-simulator/official-reference-costs"', "requireAppAuth, requireBootstrapOrAnyPermission([\"products.view\", \"simulations.view\", \"costs.view\"]), "],
  ["get", '"/api/simulations/default-process-hour-costs"', "requireAppAuth, requirePermission(\"simulations.view\"), "],
  ["get", '"/api/simulations"', "requireAppAuth, requirePermission(\"simulations.view\"), "],
  ["post", '"/api/simulations"', "requireAppAuth, requirePermission(\"simulations.create\"), "],
  ["delete", '"/api/simulations/:id"', "requireAppAuth, requirePermission(\"simulations.create\"), "],
  ["get", '"/api/simulations/:id/compare"', "requireAppAuth, requirePermission(\"simulations.view\"), "],
  ["get", '"/api/new-product-simulations"', "requireAppAuth, requirePermission(\"simulations.view\"), "],
  ["get", '"/api/new-product-simulations/:id"', "requireAppAuth, requirePermission(\"simulations.view\"), "],
  ["post", '"/api/new-product-simulations/save"', "requireAppAuth, requirePermission(\"simulations.create\"), "],
  ["post", '"/api/new-product-simulations/:id/clone"', "requireAppAuth, requirePermission(\"simulations.create\"), "],
  ["delete", '"/api/new-product-simulations/:id"', "requireAppAuth, requirePermission(\"simulations.create\"), "],

  // Settings
  ["get", '"/api/branding-settings"', "requireAppAuth, requireBootstrapOrAnyPermission([\"settings.branding.view\", \"settings.view\"]), "],
  ["put", '"/api/branding-settings"', "requireBootstrapOrAnyPermission([\"settings.branding.edit\", \"users.manage\"]), "],
  ["get", '"/api/settings/globals"', "requireBootstrapOrAnyPermission([\"settings.global_params.view\", \"settings.view\"]), "],
  ["get", '"/api/integrations/nomus/health"', "requireBootstrapOrAnyPermission([\"settings.nomus.view\", \"settings.view\"]), "],
  ["get", '"/api/settings/nomus-sync/logs"', "requireBootstrapOrAnyPermission([\"settings.nomus.view\", \"settings.view\"]), "],
  ["get", '"/api/settings/nomus-sync/logs/:fileName"', "requireBootstrapOrAnyPermission([\"settings.nomus.view\", \"settings.view\"]), "],
  ["get", '"/api/settings/nomus-sync/daily-status"', "requireBootstrapOrAnyPermission([\"settings.nomus.sync\", \"settings.view\"]), "],
  ["post", '"/api/settings/nomus-sync/daily-run"', "requireBootstrapOrAnyPermission([\"settings.nomus.sync\", \"settings.view\"]), "],

  // CRM
  ["get", '"/api/crm/dashboard/basic"', "requireAppAuth, requireAnyPermission([\"crm.view\", \"crm.customer_cockpit.view\", \"customers.view\"]), "],
  ["get", '"/api/crm/management-dashboard"', "requireAppAuth, requirePermission(\"crm.general.view\"), "],
  ["get", '"/api/crm/seller-dashboard"', "requireAppAuth, requireAnyPermission([\"crm.seller.view\", \"crm.seller.own\", \"crm.seller.all\"]), "],
  ["get", '"/api/crm/customers"', "requireAppAuth, requireAnyPermission([\"crm.view\", \"crm.customer_cockpit.view\", \"customers.view\"]), "],
  ["get", '"/api/crm/customers/:customerId/profile"', "requireAppAuth, requireAnyPermission([\"crm.customer_cockpit.view\", \"crm.view\", \"customers.view\"]), "],
  ["get", '"/api/crm/customers/:customerId/commercial-intelligence"', "requireAppAuth, requireAnyPermission([\"crm.customer_cockpit.view\", \"customers.commercial360.view\", \"customers.view\"]), "],
  ["put", '"/api/crm/customers/:customerId/profile"', "requireAppAuth, requirePermission(\"crm.profile.edit\"), "],

  // Customers
  ["get", '"/api/customers/import/template"', "requireAppAuth, requirePermission(\"customers.view\"), "],
  ["post", '"/api/customers/import/preview"', "requireAppAuth, requirePermission(\"customers.edit\"), upload.single(\"file\"), "],
  ["post", '"/api/customers/import/confirm"', "requireAppAuth, requirePermission(\"customers.edit\"), "],
  ["get", '"/api/customers"', "requireAppAuth, requirePermission(\"customers.view\"), "],
  ["get", '"/api/customers/indicators"', "requireAppAuth, requirePermission(\"customers.view\"), "],
  ["get", '"/api/customers/indicators/drilldown"', "requireAppAuth, requirePermission(\"customers.view\"), "],
  ["get", '"/api/customers/:id/commercial-360"', "requireAppAuth, requireAnyPermission([\"customers.commercial360.view\", \"customers.view\"]), "],
  ["get", '"/api/customers/:customerId/commercial-activities"', "requireAppAuth, requireAnyPermission([\"crm.customer_cockpit.view\", \"customers.commercial360.view\", \"customers.view\"]), "],
  ["post", '"/api/customers/:customerId/commercial-activities"', "requireAppAuth, requirePermission(\"crm.activities.create\"), "],
  ["post", '"/api/customers"', "requireAppAuth, requirePermission(\"customers.create\"), "],
  ["put", '"/api/customers/:id"', "requireAppAuth, requirePermission(\"customers.edit\"), "],
  ["delete", '"/api/customers/:id"', "requireAppAuth, requirePermission(\"customers.edit\"), "],

  // Proposals
  ["get", '"/api/proposals"', "requireAppAuth, requirePermission(\"proposals.view\"), "],
  ["get", '"/api/proposals/responsibles"', "requireAppAuth, requirePermission(\"proposals.view\"), "],
  ["post", '"/api/proposals/:id/generate-sales-order"', "requireAppAuth, requirePermission(\"proposals.edit\"), "],
  ["get", '"/api/proposals/:id"', "requireAppAuth, requirePermission(\"proposals.view\"), "],
  ["post", '"/api/proposals"', "requireAppAuth, requirePermission(\"proposals.create\"), "],
  ["put", '"/api/proposals/:id"', "requireAppAuth, requirePermission(\"proposals.edit\"), "],
  ["patch", '"/api/proposals/:id/status"', "requireAppAuth, requirePermission(\"proposals.edit\"), "],
  ["delete", '"/api/proposals/:id"', "requireAppAuth, requirePermission(\"proposals.delete\"), "],

  // Sales orders
  ["get", '"/api/sales-orders"', "requireAppAuth, requirePermission(\"sales_orders.view\"), "],
  ["get", '"/api/sales-orders/:id"', "requireAppAuth, requireAnyPermission([\"sales_orders.detail.view\", \"sales_orders.view\"]), "],
];

let applied = 0;
let skipped = 0;

for (const [method, pathLit, guards] of rules) {
  const re = new RegExp(
    `(app\\.${method}\\(${pathLit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},)\\s*(?!requireAppAuth|requirePermission|requireAnyPermission|requireBootstrapOrAnyPermission|requireUserAdmin|requireBootstrapAdmin|requireBootstrapForGlobalParamMutation)`,
    "g"
  );
  const next = src.replace(re, `$1 ${guards}`);
  if (next === src) {
    skipped++;
    console.warn("SKIP (not found or already guarded):", method, pathLit);
  } else {
    applied++;
    src = next;
  }
}

// indirect-costs mutations: wrap requireBootstrapForGlobalParamMutation chain
src = src.replace(
  /app\.post\("\/api\/indirect-costs", requireBootstrapForGlobalParamMutation,/g,
  'app.post("/api/indirect-costs", requireAppAuth, requirePermission("opex.edit"), requireBootstrapForGlobalParamMutation,'
);
src = src.replace(
  /app\.put\("\/api\/indirect-costs\/:id", requireBootstrapForGlobalParamMutation,/g,
  'app.put("/api/indirect-costs/:id", requireAppAuth, requirePermission("opex.edit"), requireBootstrapForGlobalParamMutation,'
);
src = src.replace(
  /app\.delete\("\/api\/indirect-costs\/:id", requireBootstrapForGlobalParamMutation,/g,
  'app.delete("/api/indirect-costs/:id", requireAppAuth, requirePermission("opex.edit"), requireBootstrapForGlobalParamMutation,'
);

fs.writeFileSync(serverPath, src);
console.log(`Done. Applied: ${applied}, Skipped: ${skipped}`);
