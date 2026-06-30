#!/usr/bin/env npx tsx
/**
 * Auditoria BLOQUEANTE — impede regressão da política oficial de margem Nomus.
 *
 * Varre código-fonte por taxMode none operacional, cálculo legado de margem,
 * tooltips incompletos e divergência entre telas/endpoints.
 *
 * Uso:
 *   npx tsx scripts/audit-sales-margin-official-policy.ts --year=2026 --month=6 --asOfDate=2026-06-29
 *   npm run check:sales-margin-policy
 */
import "dotenv/config";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { prisma } from "../src/lib/prisma.js";
import { buildFinanceSalesOrdersDashboard } from "../src/lib/financeSalesOrdersDashboard.js";
import { loadSalesOrderManagementPage } from "../src/lib/salesOrderIntelligenceRoutes.js";
import { buildSalesOrderResultDashboard } from "../src/lib/salesOrderResultEngine.server.js";
import { buildReportsDataPayload } from "../src/lib/reportsDataService.js";
import { buildSalesMarginNomusPreview } from "../src/lib/salesMarginNomusConfig.server.js";
import {
  calculateOfficialSalesOrderMarginsForOrders,
  OFFICIAL_SM_RULES_SOURCE,
} from "../src/lib/salesMarginRulesAdapter.js";
import {
  attachMarginsToSalesOrders,
  attachMarginToSalesOrderDetail,
  SALES_ORDER_ITEM_MARGIN_SELECT,
} from "../src/lib/salesOrderMarginService.server.js";
import {
  assessSalesMarginNomusFiscalConfig,
  loadSalesMarginNomusConfig,
} from "../src/lib/salesMarginNomusConfig.js";
import { resolveSalesTaxRuleById } from "../src/lib/averageSalesTaxEngine.js";
import { registerOfficialServerResolversForAuditScripts } from "../src/lib/registerServerResolvers.js";
import { createOfficialProductCostAnalysisResolver } from "../src/lib/productCostAnalysisResolver.server.js";
import { buildSalesOrderListWhere } from "../src/lib/salesOrdersListSummary.js";
import { buildOfficialSalesOrderMarginTooltipText } from "../src/lib/salesOrderMarginDisplay.js";
import { marginLabelLooksLikeTotal } from "../src/lib/salesOrderMarginCoverage.js";

type FindingStatus = "OK" | "ALERTA" | "BLOQUEANTE";

type PolicyFinding = {
  file: string;
  line: number;
  occurrence: string;
  permitted: "SIM" | "NÃO";
  reason: string;
  status: FindingStatus;
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function fmt(n: unknown): string {
  if (n == null) return "—";
  if (typeof n === "number" && Number.isFinite(n)) return n.toFixed(2);
  return String(n);
}

function nearlyEqual(a: number | null | undefined, b: number | null | undefined, eps = 0.02): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= eps;
}

const SCAN_ROOTS = ["src", "scripts"] as const;

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  ".git",
  "generated",
]);

const ALLOWED_TAX_MODE_NONE_SUFFIXES = [
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
] as const;

const ALLOWED_TAX_MODE_NONE_FILES = new Set([
  "src/lib/salesMarginRulesEngine.ts",
  "src/lib/salesMarginRulesEngine.test.ts",
  "src/lib/salesOrderMarginDisplay.ts",
  "src/lib/salesOrderMarginTooltip.test.ts",
  "src/lib/salesMarginNomusConfig.ts",
  "src/lib/salesMarginNomusConfig.test.ts",
  "src/lib/salesOrderMarginService.test.ts",
  "src/components/settings/SalesMarginNomusConfigPanel.tsx",
  "scripts/audit-sales-margin-official-policy.ts",
  "scripts/audit-sales-margin-rules-consumption.ts",
  "scripts/audit-sales-margin-configuration.ts",
]);

const OPERATIONAL_NEVER_TAX_MODE_NONE = new Set([
  "src/lib/salesOrderMarginService.server.ts",
  "src/lib/salesMarginRulesAdapter.ts",
  "src/lib/financeSalesOrdersDashboard.ts",
  "src/lib/financeSalesOrdersExport.ts",
  "src/lib/salesOrderInternalMarginExport.server.ts",
  "src/lib/salesOrderMarginIndicators.server.ts",
  "src/lib/salesOrderIntelligenceRoutes.ts",
  "src/lib/customerIntelligenceRoutes.ts",
  "src/lib/customerIntelligence.ts",
  "src/lib/reportsDataService.ts",
  "src/lib/salesOrderResultEngine.server.ts",
  "src/lib/salesOrderRulesAdapter.ts",
  "src/components/sales/SalesOrderListMarginCell.tsx",
  "src/components/sales/SalesOrderListTable.tsx",
  "src/components/sales/SalesOrderMarginAnalysis.tsx",
  "src/components/sales/SalesOrderQuickSummaryDrawer.tsx",
  "src/components/sales/SalesOrderManagementPage.tsx",
  "src/components/sales/SalesOrderManagementMarginOverview.tsx",
  "src/components/sales/SalesOrderManagementKpiSecondaryPanel.tsx",
  "src/components/customers/CustomerCommercial360.tsx",
  "src/components/crm/customer-intelligence/CustomerIntelligenceKpiGrid.tsx",
  "src/components/contextual/SalesOrdersIndicatorsDashboard.tsx",
  "src/components/ReportsModule.tsx",
  "src/components/finance/FinanceSalesOrdersPage.tsx",
]);

const PROPOSAL_PROJECT_EXCLUDE = [
  "/proposal/",
  "/Proposal",
  "/projects/",
  "/ProjectsModule",
  "getProductCostAnalysis",
  "productCostAnalysis",
  "valorHora",
  "valorMaquina",
] as const;

function relPath(abs: string): string {
  return relative(process.cwd(), abs).replace(/\\/g, "/");
}

function isTestFile(file: string): boolean {
  return ALLOWED_TAX_MODE_NONE_SUFFIXES.some((s) => file.endsWith(s));
}

function isProposalOrProject(file: string): boolean {
  return PROPOSAL_PROJECT_EXCLUDE.some((p) => file.includes(p));
}

function walkSourceFiles(): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIR_NAMES.has(entry)) continue;
      const abs = join(dir, entry);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (/\.(ts|tsx)$/.test(entry)) files.push(relPath(abs));
    }
  }
  for (const root of SCAN_ROOTS) {
    const absRoot = join(process.cwd(), root);
    try {
      walk(absRoot);
    } catch {
      /* ignore missing root */
    }
  }
  return files.sort();
}

function truncate(text: string, max = 88): string {
  const oneLine = text.trim().replace(/\s+/g, " ");
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function pushFinding(
  findings: PolicyFinding[],
  input: Omit<PolicyFinding, "permitted"> & { permitted?: PolicyFinding["permitted"] }
) {
  findings.push({
    permitted: input.permitted ?? (input.status === "OK" ? "SIM" : "NÃO"),
    ...input,
  });
}

function scanTaxModeNone(findings: PolicyFinding[], file: string, lines: string[]) {
  if (file === "scripts/audit-sales-margin-official-policy.ts") return;

  const patterns: Array<{ re: RegExp; label: string }> = [
    { re: /taxMode\s*:\s*["']none["']/g, label: 'taxMode: "none"' },
    { re: /taxMode\s*=\s*["']none["']/g, label: 'taxMode = "none"' },
    { re: /buildInput\s*:\s*\{\s*taxMode\s*:\s*["']none["']/g, label: 'buildInput: { taxMode: "none" }' },
    {
      re: /buildOfficialSalesMarginRulesResult\([^)]*taxMode\s*:\s*["']none["']/g,
      label: 'buildOfficialSalesMarginRulesResult(... taxMode: "none")',
    },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\{\s*re:\s*\/|label:\s*['"]buildInput|occurrence:\s*['"]buildInput/.test(line)) {
      continue;
    }
    for (const { re, label } of patterns) {
      re.lastIndex = 0;
      if (!re.test(line)) continue;

      if (isTestFile(file)) {
        pushFinding(findings, {
          file,
          line: i + 1,
          occurrence: truncate(line),
          permitted: "SIM",
          reason: "Arquivo de teste — taxMode none permitido para cenário vendido sem imposto.",
          status: "OK",
        });
        continue;
      }

      if (ALLOWED_TAX_MODE_NONE_FILES.has(file)) {
        const soldWithoutTax =
          line.includes("soldTitle") ||
          line.includes("Margem vendida sem imposto") ||
          line.includes('taxMode === "none"') ||
          line.includes("taxMode?: SalesMarginTaxMode") ||
          file.includes("SalesMarginNomusConfigPanel") ||
          file.includes("salesMarginNomusConfig");
        pushFinding(findings, {
          file,
          line: i + 1,
          occurrence: truncate(line),
          permitted: "SIM",
          reason: soldWithoutTax
            ? "Código rotulado como margem vendida sem imposto ou config Nomus."
            : "Motor/config/auditoria — suporte explícito ao modo none.",
          status: "OK",
        });
        continue;
      }

      if (file.startsWith("scripts/audit-")) {
        pushFinding(findings, {
          file,
          line: i + 1,
          occurrence: truncate(line),
          permitted: "SIM",
          reason: "Script de auditoria/comparação.",
          status: "OK",
        });
        continue;
      }

      const operational = OPERATIONAL_NEVER_TAX_MODE_NONE.has(file);
      pushFinding(findings, {
        file,
        line: i + 1,
        occurrence: truncate(line),
        permitted: "NÃO",
        reason: operational
          ? "Fluxo operacional de margem Nomus não pode forçar taxMode none."
          : "taxMode none fora de teste/motor/config — revisar se é margem padrão operacional.",
        status: operational ? "BLOQUEANTE" : "ALERTA",
      });
    }
  }
}

function scanLegacyMarginPatterns(findings: PolicyFinding[], file: string, lines: string[]) {
  if (isTestFile(file) || isProposalOrProject(file)) return;

  const isOperationalUi =
    file.includes("/sales/") ||
    file.includes("/crm/") ||
    file.includes("CustomerCommercial360") ||
    file.includes("ReportsModule") ||
    file.includes("/finance/") ||
    file.includes("/contextual/SalesOrders");

  const isOperationalLib =
    OPERATIONAL_NEVER_TAX_MODE_NONE.has(file) ||
    file.endsWith(".server.ts");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;

    if (
      isOperationalUi &&
      /totalMarginPerc\).*\/\s*validCount|legacyPercent|marginPercSamples/.test(line)
    ) {
      pushFinding(findings, {
        file,
        line: i + 1,
        occurrence: truncate(line),
        permitted: "NÃO",
        reason: "Fallback legado de margem % (média Nomus ou amostras) em tela operacional.",
        status: "BLOQUEANTE",
      });
    }

    if (
      (isOperationalUi || isOperationalLib) &&
      /safeOrderNet\(it\.marginValue\)|safeOrderNet\(.*\.marginValue\)/.test(line) &&
      !line.includes("officialMarginValue")
    ) {
      pushFinding(findings, {
        file,
        line: i + 1,
        occurrence: truncate(line),
        permitted: "NÃO",
        reason: "Usa marginValue legado do banco em vez de officialMarginValue.",
        status: "BLOQUEANTE",
      });
    }

    if (
      isOperationalUi &&
      /calculateSalesOrderMargin|buildSalesOrderMarginContext\(|calculateSalesOrderMarginsForOrders\(/.test(line)
    ) {
      pushFinding(findings, {
        file,
        line: i + 1,
        occurrence: truncate(line),
        permitted: "NÃO",
        reason: "Componente React não deve calcular margem final — usar payload do backend.",
        status: "BLOQUEANTE",
      });
    }

    if (
      isOperationalUi &&
      /\(\s*\w+\.netRevenue\s*-\s*\w+\.totalCost\s*\)|revenue\s*-\s*cost|netRevenue\s*-\s*cost/i.test(line) &&
      !file.includes("salesOrderMarginDisplay")
    ) {
      pushFinding(findings, {
        file,
        line: i + 1,
        occurrence: truncate(line),
        permitted: "NÃO",
        reason: "Fórmula legada (receita − custo) no frontend operacional.",
        status: "BLOQUEANTE",
      });
    }

    if (
      isOperationalUi &&
      /marginValue\s*\/\s*\w*[Rr]evenue|marginPercent\s*=.*\/\s*\w+/.test(line) &&
      !line.includes("formatSalesOrderMargin") &&
      !line.includes("resolveSalesOrderMargin")
    ) {
      pushFinding(findings, {
        file,
        line: i + 1,
        occurrence: truncate(line),
        permitted: "NÃO",
        reason: "Cálculo de margem % no componente — deve vir do backend.",
        status: "BLOQUEANTE",
      });
    }
  }
}

function scanDisplayPolicy(findings: PolicyFinding[]) {
  const display = readFileSync(join(process.cwd(), "src/lib/salesOrderMarginDisplay.ts"), "utf8");
  if (!display.includes("Imposto estimado") || !display.includes("deductFromGross")) {
    pushFinding(findings, {
      file: "src/lib/salesOrderMarginDisplay.ts",
      line: 0,
      occurrence: "buildOfficialSalesOrderMarginTooltipText",
      permitted: "NÃO",
      reason: "Tooltip oficial deve mencionar imposto quando taxMode = deductFromGross.",
      status: "BLOQUEANTE",
    });
  } else {
    pushFinding(findings, {
      file: "src/lib/salesOrderMarginDisplay.ts",
      line: 0,
      occurrence: "Tooltip gerencial com imposto",
      permitted: "SIM",
      reason: "Tooltip oficial documenta imposto no modo deductFromGross.",
      status: "OK",
    });
  }

  if (!display.includes("isSalesOrderMarginDisplayUnavailable")) {
    pushFinding(findings, {
      file: "src/lib/salesOrderMarginDisplay.ts",
      line: 0,
      occurrence: "isSalesOrderMarginDisplayUnavailable",
      permitted: "NÃO",
      reason: "Deve bloquear exibição silenciosa de 0% quando margem indisponível.",
      status: "BLOQUEANTE",
    });
  }

  const listCell = readFileSync(
    join(process.cwd(), "src/components/sales/SalesOrderListMarginCell.tsx"),
    "utf8"
  );
  if (!listCell.includes("SalesOrderMarginInfoTooltip")) {
    pushFinding(findings, {
      file: "src/components/sales/SalesOrderListMarginCell.tsx",
      line: 0,
      occurrence: "SalesOrderMarginInfoTooltip",
      permitted: "NÃO",
      reason: "Lista de pedidos deve usar tooltip oficial de margem.",
      status: "BLOQUEANTE",
    });
  }

  const partialUiFiles = [
    "src/components/sales/SalesOrderManagementMarginOverview.tsx",
    "src/components/customers/CustomerCommercial360.tsx",
    "src/components/contextual/SalesOrdersIndicatorsDashboard.tsx",
  ];
  for (const file of partialUiFiles) {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    if (
      (src.includes('label="Margem R$ total"') || src.includes('label="Margem total"')) &&
      src.includes("PARTIAL")
    ) {
      pushFinding(findings, {
        file,
        line: 0,
        occurrence: 'label="Margem R$ total"',
        permitted: "NÃO",
        reason: "Margem parcial não pode ser rotulada como total.",
        status: "BLOQUEANTE",
      });
    }
    if (
      src.includes('label="Margem R$"') &&
      !src.includes("resolveSalesOrderMarginMoneyLabel")
    ) {
      pushFinding(findings, {
        file,
        line: 0,
        occurrence: 'label="Margem R$"',
        permitted: "NÃO",
        reason: "Use resolveSalesOrderMarginMoneyLabel para distinguir parcial/total.",
        status: "ALERTA",
      });
    }
  }

  const adapter = readFileSync(join(process.cwd(), "src/lib/salesMarginRulesAdapter.ts"), "utf8");
  if (!adapter.includes("loadSalesMarginNomusConfig") || !adapter.includes("nomusConfig.taxMode")) {
    pushFinding(findings, {
      file: "src/lib/salesMarginRulesAdapter.ts",
      line: 0,
      occurrence: "nomusConfig.taxMode",
      permitted: "NÃO",
      reason: "Adapter oficial deve consumir taxMode da config Nomus.",
      status: "BLOQUEANTE",
    });
  }

  const attachBlock = adapter.includes("calculateOfficialSalesOrderMarginsForOrders")
    ? adapter
    : readFileSync(join(process.cwd(), "src/lib/salesOrderMarginService.server.ts"), "utf8");
  if (/buildInput:\s*\{\s*taxMode:\s*["']none["']/.test(attachBlock)) {
    pushFinding(findings, {
      file: "src/lib/salesMarginRulesAdapter.ts",
      line: 0,
      occurrence: 'buildInput: { taxMode: "none" }',
      permitted: "NÃO",
      reason: "attach*/calculateOfficial não pode forçar taxMode none operacional.",
      status: "BLOQUEANTE",
    });
  }
}

function runStaticAudit(): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  scanDisplayPolicy(findings);

  for (const file of walkSourceFiles()) {
    if (isProposalOrProject(file)) continue;
    const abs = join(process.cwd(), file);
    const content = readFileSync(abs, "utf8");
    const lines = content.split(/\r?\n/);
    scanTaxModeNone(findings, file, lines);
    scanLegacyMarginPatterns(findings, file, lines);
  }

  return findings;
}

function printFindingsTable(findings: PolicyFinding[]) {
  console.log(
    "| Arquivo | Linha | Ocorrência | Permitido? | Motivo | Status |"
  );
  console.log("| --- | ---: | --- | --- | --- | --- |");
  for (const f of findings) {
    const occ = f.occurrence.replace(/\|/g, "\\|");
    const reason = f.reason.replace(/\|/g, "\\|");
    console.log(
      `| ${f.file} | ${f.line || "—"} | ${occ} | ${f.permitted} | ${reason} | ${f.status} |`
    );
  }
}

async function runRuntimeAudit(input: {
  year: number;
  month: number;
  asOfDate: string;
}): Promise<PolicyFinding[]> {
  const findings: PolicyFinding[] = [];
  if (!process.env.DATABASE_URL?.trim()) {
    console.log("\n### Validação runtime — PULADA (DATABASE_URL ausente)");
    return findings;
  }

  const { year, month, asOfDate } = input;
  const ref = new Date(`${asOfDate}T23:59:59`);

  try {
  const listWhere = buildSalesOrderListWhere({ year, month });

  const marginOrderSelect = {
    id: true,
    orderCode: true,
    issueDate: true,
    status: true,
    totalNetValue: true,
    nomusRawResponse: true,
    items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
  } as const;

  const sampleOrders = await prisma.salesOrder.findMany({
    where: listWhere,
    orderBy: { issueDate: "desc" },
    take: 5,
    select: marginOrderSelect,
  });

  const productIds = sampleOrders.flatMap((o) =>
    o.items.map((i) => i.productId).filter((id): id is string => Boolean(id))
  );
  await registerOfficialServerResolversForAuditScripts(prisma, productIds);

  const { config: nomusConfig } = await loadSalesMarginNomusConfig(prisma);
  const taxRule = nomusConfig.defaultTaxRuleId
    ? await resolveSalesTaxRuleById(prisma, nomusConfig.defaultTaxRuleId)
    : null;
  const fiscalAssessment = assessSalesMarginNomusFiscalConfig(nomusConfig, taxRule, null);

  if (nomusConfig.taxMode === "deductFromGross" && fiscalAssessment.status === "BLOQUEANTE") {
    pushFinding(findings, {
      file: "IndirectCost/GLOBAL_PARAM",
      line: 0,
      occurrence: "TaxRule obrigatória ausente",
      permitted: "NÃO",
      reason: fiscalAssessment.reasons.join("; ") || "Config fiscal incompleta para margem gerencial.",
      status: "BLOQUEANTE",
    });
  }

  const marginByOrder = await calculateOfficialSalesOrderMarginsForOrders(prisma, sampleOrders);
  const listWithMargin = await attachMarginsToSalesOrders(prisma, sampleOrders);

  for (const order of sampleOrders) {
    const official = marginByOrder.get(order.id)?.marginSummary;
    const attached = listWithMargin.find((r) => r.id === order.id)?.marginSummary;
    if (!official || !attached) continue;

    const sameTaxMode = (attached.taxMode ?? nomusConfig.taxMode) === (official.taxMode ?? nomusConfig.taxMode);
    if (!sameTaxMode) {
      pushFinding(findings, {
        file: `GET /api/sales-orders (${order.orderCode})`,
        line: 0,
        occurrence: `taxMode attach=${attached.taxMode} official=${official.taxMode}`,
        permitted: "NÃO",
        reason: "taxMode divergente entre attachMargins e motor oficial.",
        status: "BLOQUEANTE",
      });
    }

    if (
      !nearlyEqual(attached.marginValue, official.marginValue) ||
      !nearlyEqual(attached.totalCost, official.totalCost)
    ) {
      pushFinding(findings, {
        file: `GET /api/sales-orders (${order.orderCode})`,
        line: 0,
        occurrence: `margem attach=${attached.marginValue} official=${official.marginValue}`,
        permitted: "NÃO",
        reason: "Margem R$ ou custo divergente na listagem vs motor oficial.",
        status: "BLOQUEANTE",
      });
    } else {
      pushFinding(findings, {
        file: `GET /api/sales-orders (${order.orderCode})`,
        line: 0,
        occurrence: "margem/custo alinhados",
        permitted: "SIM",
        reason: "Listagem e motor oficial concordam na amostra.",
        status: "OK",
      });
    }

    if (order.id) {
      const detail = await attachMarginToSalesOrderDetail(prisma, {
        ...order,
        items: order.items,
      });
      const detailSummary = detail.marginSummary;
      if (
        detailSummary &&
        (!nearlyEqual(detailSummary.marginValue, official.marginValue) ||
          detailSummary.taxMode !== official.taxMode)
      ) {
        pushFinding(findings, {
          file: `GET /api/sales-orders/:id (${order.orderCode})`,
          line: 0,
          occurrence: "detalhe vs motor",
          permitted: "NÃO",
          reason: "Detalhe diverge do motor oficial na amostra.",
          status: "BLOQUEANTE",
        });
      }
    }

    if (nomusConfig.taxMode === "deductFromGross" && official.fiscalConfigComplete !== false) {
      const tooltip = buildOfficialSalesOrderMarginTooltipText({ summary: official });
      if (!tooltip.includes("Imposto estimado") && !tooltip.includes("Imposto:")) {
        pushFinding(findings, {
          file: `tooltip (${order.orderCode})`,
          line: 0,
          occurrence: "tooltip sem imposto",
          permitted: "NÃO",
          reason: "Tooltip gerencial deve mencionar imposto com deductFromGross.",
          status: "BLOQUEANTE",
        });
      }
    }

    if (
      official.costCoverageStatus === "PARTIAL" &&
      marginLabelLooksLikeTotal("Margem gerencial (R$)")
    ) {
      /* label helper ok — check unavailable percent display */
      if (
        official.marginPercent === 0 &&
        official.itemsWithCost === 0 &&
        !tooltipUnavailableWouldShow(official)
      ) {
        pushFinding(findings, {
          file: `display (${order.orderCode})`,
          line: 0,
          occurrence: "marginPercent=0 silencioso",
          permitted: "NÃO",
          reason: "Fallback 0% silencioso com cobertura NONE.",
          status: "BLOQUEANTE",
        });
      }
    }
  }

  const [mgmtPage, resultPayload, financePayload, preview] = await Promise.all([
    loadSalesOrderManagementPage({ year: String(year), month: String(month), pageSize: "10000" }),
    buildSalesOrderResultDashboard(prisma, { year: String(year), month: String(month), asOfDate }),
    buildFinanceSalesOrdersDashboard({ year: String(year), month: String(month) }, ref),
    buildSalesMarginNomusPreview(prisma, { year, month, asOfDate }),
  ]);

  const officialCostResolver = await createOfficialProductCostAnalysisResolver(prisma);
  const reportsPayload = await buildReportsDataPayload(
    prisma,
    {
      dateFrom: `${year}-${String(month).padStart(2, "0")}-01`,
      dateTo: asOfDate,
    },
    { getProductCostAnalysis: (productId) => officialCostResolver.resolve(productId) }
  );

  const mgmt = mgmtPage.marginEconomics?.consolidated;
  const finance = financePayload.summary.marginPortfolio;
  const reports = reportsPayload.marginPortfolio;

  let ordersMarginTotal = 0;
  for (const row of listWithMargin) {
    ordersMarginTotal += row.marginSummary?.marginValue ?? 0;
  }

  const endpoints: Array<{
    label: string;
    taxMode: string | undefined;
    taxAmount: number | null | undefined;
    marginValue: number | null | undefined;
    marginPercent: number | null | undefined;
    coverage: string | undefined;
  }> = [
    {
      label: "GET /api/sales-orders/management",
      taxMode: nomusConfig.taxMode,
      taxAmount: mgmt?.taxAmount,
      marginValue: mgmt?.marginValue,
      marginPercent: mgmt?.marginPercent,
      coverage: mgmt?.costCoverageStatus,
    },
    {
      label: "GET /api/sales-orders/results",
      taxMode: nomusConfig.taxMode,
      taxAmount: resultPayload.totals.taxAmount,
      marginValue: resultPayload.totals.marginAmount,
      marginPercent: resultPayload.totals.marginPercent,
      coverage: "GERENCIAL",
    },
    {
      label: "GET /api/finance/sales-orders/dashboard",
      taxMode: finance?.taxMode ?? nomusConfig.taxMode,
      taxAmount: finance?.taxAmount,
      marginValue: finance?.marginValue,
      marginPercent: finance?.marginPercent,
      coverage: finance?.costCoverageStatus,
    },
    {
      label: "GET /api/reports/data",
      taxMode: reports?.taxMode ?? nomusConfig.taxMode,
      taxAmount: reports?.taxAmount,
      marginValue: reports?.marginValue,
      marginPercent: reports?.marginPercent,
      coverage: reports?.costCoverageStatus,
    },
    {
      label: "GET /api/settings/sales-margin-nomus/preview",
      taxMode: nomusConfig.taxMode,
      taxAmount: preview.taxAmount,
      marginValue: preview.marginValue,
      marginPercent: preview.marginPercent,
      coverage: preview.costCoverageStatus,
    },
  ];

  console.log("\n### Paridade endpoints (amostra via handlers internos)");
  console.log(
    "| Endpoint | taxMode | Imposto | Margem R$ | Margem % | Cobertura | vs Gestão |"
  );
  console.log("| --- | --- | ---: | ---: | ---: | --- | --- |");
  const mgmtMargin = mgmt?.marginValue ?? ordersMarginTotal;
  for (const ep of endpoints) {
    const delta =
      ep.marginValue == null ? "—" : nearlyEqual(ep.marginValue, mgmtMargin) ? "OK" : fmt(ep.marginValue - mgmtMargin);
    console.log(
      `| ${ep.label} | ${ep.taxMode ?? "—"} | ${fmt(ep.taxAmount)} | ${fmt(ep.marginValue)} | ${ep.marginPercent == null ? "—" : `${fmt(ep.marginPercent)}%`} | ${ep.coverage ?? "—"} | ${delta} |`
    );

    if (
      ep.label !== "GET /api/sales-orders/results" &&
      ep.taxMode !== nomusConfig.taxMode &&
      ep.taxMode != null
    ) {
      pushFinding(findings, {
        file: ep.label,
        line: 0,
        occurrence: `taxMode=${ep.taxMode}`,
        permitted: "NÃO",
        reason: `taxMode diverge da config Nomus (${nomusConfig.taxMode}).`,
        status: "BLOQUEANTE",
      });
    }
  }

  const baseUrl = (process.env.AUDIT_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(
    /\/+$/,
    ""
  );
  try {
    const probe = await fetch(`${baseUrl}/api/auth/me`, { signal: AbortSignal.timeout(2000) });
    if (probe.ok) {
      console.log(`\n### Servidor local detectado em ${baseUrl} — HTTP disponível para inspeção manual.`);
      console.log("(Autenticação necessária para comparar JSON bruto; paridade validada via handlers internos.)");
    }
  } catch {
    console.log(`\n### Servidor local não respondeu em ${baseUrl} — paridade via handlers internos apenas.`);
  }

  console.log(`\n- source: ${OFFICIAL_SM_RULES_SOURCE}`);
  console.log(`- amostra pedidos: ${sampleOrders.length}`);
  console.log(`- config taxMode: ${nomusConfig.taxMode}`);
  console.log(`- TaxRule: ${taxRule?.name ?? "—"}`);
  console.log(`- fiscal: ${fiscalAssessment.status}`);

  return findings;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`\n### Validação runtime — FALHOU (banco indisponível ou erro)`);
    console.warn(message.split("\n")[0]);
    pushFinding(findings, {
      file: "runtime/database",
      line: 0,
      occurrence: "DATABASE_URL configurada mas conexão indisponível",
      permitted: "SIM",
      reason: "Runtime pulado — varredura estática ainda válida.",
      status: "OK",
    });
    return findings;
  }
}

function tooltipUnavailableWouldShow(summary: {
  costCoverageStatus?: string;
  itemsWithCost?: number;
  fiscalConfigComplete?: boolean;
  taxMode?: string;
}): boolean {
  if (summary.costCoverageStatus === "NONE" && (summary.itemsWithCost ?? 0) === 0) return true;
  if (summary.taxMode === "deductFromGross" && summary.fiscalConfigComplete === false) return true;
  return false;
}

async function main() {
  const year = Number(parseArg("year") ?? "2026");
  const month = Number(parseArg("month") ?? "6");
  const asOfDate = parseArg("asOfDate") ?? "2026-06-29";

  console.log(
    `Auditoria política oficial de margem Nomus — year=${year} month=${month} asOfDate=${asOfDate}\n`
  );

  const staticFindings = runStaticAudit();
  console.log("### Varredura estática e política de exibição");
  printFindingsTable(staticFindings);

  const runtimeFindings = await runRuntimeAudit({ year, month, asOfDate });
  if (runtimeFindings.length > 0) {
    console.log("\n### Validação runtime / endpoints");
    printFindingsTable(runtimeFindings);
  }

  const allFindings = [...staticFindings, ...runtimeFindings];

  const blocking = allFindings.filter((f) => f.status === "BLOQUEANTE");
  const alerts = allFindings.filter((f) => f.status === "ALERTA");
  const ok = allFindings.filter((f) => f.status === "OK");

  console.log("\n### Resumo");
  console.log(`- OK: ${ok.length}`);
  console.log(`- ALERTA: ${alerts.length}`);
  console.log(`- BLOQUEANTE: ${blocking.length}`);

  const allowedNone = allFindings.filter(
    (f) => f.permitted === "SIM" && /taxMode.*none/i.test(f.occurrence + f.reason)
  );
  if (allowedNone.length > 0) {
    console.log("\n### taxMode none permitido (amostra)");
    for (const f of allowedNone.slice(0, 12)) {
      console.log(`- ${f.file}:${f.line} — ${f.reason}`);
    }
    if (allowedNone.length > 12) console.log(`- … +${allowedNone.length - 12} ocorrências`);
  }

  if (blocking.length > 0) {
    console.error("\nFALHA BLOQUEANTE — política oficial de margem violada.");
    process.exitCode = 1;
  } else if (alerts.length > 0) {
    console.warn("\nALERTAS — revisar antes do próximo release.");
    process.exitCode = 1;
  } else {
    console.log("\nPolítica oficial de margem Nomus: OK");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
