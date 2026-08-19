import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PrintPdfAuditRisk = "ok" | "attention" | "risk" | "pending";

export type PrintPdfAuditPrintMode =
  | "browser-print"
  | "pdf-layout"
  | "csv-only"
  | "xlsx"
  | "none"
  | "unknown";

export type PrintPdfAuditEntry = {
  id: string;
  module: string;
  feature: string;
  route: string;
  files: string[];
  printMode: PrintPdfAuditPrintMode;
  hasPrintCss: boolean;
  hasNoPrintShell: boolean;
  hasSafePageBreaks: boolean;
  hasFooterSafeArea: boolean;
  hasChartPrintRules: boolean;
  risk: PrintPdfAuditRisk;
  notes: string[];
};

/** CSS compartilhado entre documentos de impressão IndusCost. */
export const PRINT_GLOBAL_CSS_FILES = [
  "src/components/print/print-document.css",
  "src/reports-print.css",
  "src/proposal-print.css",
  "src/sales-order-print.css",
  "src/material-demand-print.css",
  "src/cnpj-intelligence-print.css",
  "src/project-executive-report-print.css",
  "src/components/finance/executive-report/finance-executive-report-print.css",
  "src/components/commercial/sold-products-print.css",
  "src/components/finance/finance-ar-overdue-print.css",
  "src/components/crm/customer-intelligence/customer-intelligence.css",
] as const;

export const PRINT_PDF_AUDIT_ENTRIES: PrintPdfAuditEntry[] = [
  {
    id: "finance-executive-report",
    module: "Financeiro",
    feature: "Relatório Presidencial",
    route: "/finance/executive-report",
    files: [
      "src/components/finance/FinanceExecutiveReportPage.tsx",
      "src/components/finance/executive-report/ExecutiveReportDocument.tsx",
      "src/components/finance/executive-report/ExecutivePrintPageShell.tsx",
      "src/components/finance/executive-report/finance-executive-report-print.css",
      "src/lib/financeExecutiveReportPrint.ts",
    ],
    printMode: "pdf-layout",
    hasPrintCss: true,
    hasNoPrintShell: true,
    hasSafePageBreaks: true,
    hasFooterSafeArea: true,
    hasChartPrintRules: true,
    risk: "ok",
    notes: [
      "A4 landscape paginado; oculta shell do app.",
      "Observações técnicas de dados não vão para o PDF.",
      "Gráfico de caixa usa annualChart Jan–Dez.",
    ],
  },
  {
    id: "finance-ar-csv-export",
    module: "Financeiro",
    feature: "Contas a Receber — Exportar CSV",
    route: "/finance/accounts-receivable",
    files: [
      "src/components/finance/FinanceAccountsReceivablePage.tsx",
      "src/lib/financeAccountsReceivableExport.ts",
    ],
    printMode: "csv-only",
    hasPrintCss: false,
    hasNoPrintShell: false,
    hasSafePageBreaks: false,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["Exportação CSV via API; sem layout visual de impressão."],
  },
  {
    id: "finance-ar-overdue-print",
    module: "Financeiro",
    feature: "AR Atrasados — Imprimir / PDF + Excel",
    route: "/finance/accounts-receivable",
    files: [
      "src/components/finance/FinanceAccountsReceivableOverdueTab.tsx",
      "src/components/finance/FinanceAccountsReceivableOverduePrintDocument.tsx",
      "src/components/finance/finance-ar-overdue-print.css",
      "src/lib/financeAccountsReceivableOverdueExport.ts",
    ],
    printMode: "pdf-layout",
    hasPrintCss: true,
    hasNoPrintShell: true,
    hasSafePageBreaks: true,
    hasFooterSafeArea: true,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["Portal dedicado #ar-overdue-print-root; A4 landscape."],
  },
  {
    id: "finance-ap-csv-export",
    module: "Financeiro",
    feature: "Contas a Pagar — Exportar CSV",
    route: "/finance/accounts-payable",
    files: [
      "src/components/finance/FinanceAccountsPayablePage.tsx",
      "src/lib/financeAccountsPayableExport.ts",
    ],
    printMode: "csv-only",
    hasPrintCss: false,
    hasNoPrintShell: false,
    hasSafePageBreaks: false,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["Exportação CSV via API; sem layout visual de impressão."],
  },
  {
    id: "finance-cash-flow-csv-export",
    module: "Financeiro",
    feature: "Fluxo de Caixa — Exportar CSV",
    route: "/finance/cash-flow",
    files: [
      "src/components/finance/FinanceCashFlowPage.tsx",
      "src/lib/financeCashFlowExport.ts",
    ],
    printMode: "csv-only",
    hasPrintCss: false,
    hasNoPrintShell: false,
    hasSafePageBreaks: false,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["Multi-seção CSV; gráficos na tela não têm print dedicado."],
  },
  {
    id: "finance-billing-nfe-csv-export",
    module: "Financeiro",
    feature: "Faturamento — Exportar CSV NF-e",
    route: "/finance/billing",
    files: [
      "src/components/finance/FinanceBillingPage.tsx",
      "src/lib/financeBillingNfeExport.ts",
    ],
    printMode: "csv-only",
    hasPrintCss: false,
    hasNoPrintShell: false,
    hasSafePageBreaks: false,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["Exportação CSV NF-e; sem PDF visual."],
  },
  {
    id: "finance-billing-audit-xlsx",
    module: "Financeiro",
    feature: "Faturamento — Exportar composição (auditoria)",
    route: "/finance/billing",
    files: [
      "src/components/finance/billing/FinanceBillingAuditPanel.tsx",
      "src/lib/financeBillingAuditExport.ts",
    ],
    printMode: "xlsx",
    hasPrintCss: false,
    hasNoPrintShell: false,
    hasSafePageBreaks: false,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["Workbook XLSX multi-abas; painel de auditoria é operacional, não PDF."],
  },
  {
    id: "commercial-sold-products",
    module: "Comercial",
    feature: "Produtos Vendidos — Imprimir / PDF + Excel",
    route: "/sales-orders/sold-products",
    files: [
      "src/components/commercial/SoldProductsReportPage.tsx",
      "src/components/commercial/SoldProductsPrintDocument.tsx",
      "src/components/commercial/sold-products-print.css",
      "src/lib/salesProductRankingExport.ts",
    ],
    printMode: "pdf-layout",
    hasPrintCss: true,
    hasNoPrintShell: true,
    hasSafePageBreaks: true,
    hasFooterSafeArea: true,
    hasChartPrintRules: false,
    risk: "ok",
    notes: [
      "A4 landscape; cabeçalho institucional PrintHeader.",
      "Coluna # com largura fixa; tabela table-layout: fixed.",
    ],
  },
  {
    id: "commercial-sold-product-customers-csv",
    module: "Comercial",
    feature: "Clientes compradores do produto — Exportar CSV",
    route: "/sales-orders/sold-products/:productId/customers",
    files: [
      "src/components/commercial/SoldProductCustomersPage.tsx",
      "src/lib/soldProductCustomersExport.ts",
    ],
    printMode: "csv-only",
    hasPrintCss: false,
    hasNoPrintShell: false,
    hasSafePageBreaks: false,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["CSV client-side ou via API; sem print visual."],
  },
  {
    id: "sales-order-print",
    module: "Comercial",
    feature: "Pedido de Venda — Imprimir / Salvar PDF",
    route: "/sales-orders/:id/print",
    files: [
      "src/components/sales/SalesOrderPrintView.tsx",
      "src/sales-order-print.css",
      "src/components/print/PrintDocumentShell.tsx",
    ],
    printMode: "browser-print",
    hasPrintCss: true,
    hasNoPrintShell: true,
    hasSafePageBreaks: true,
    hasFooterSafeArea: true,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["Rota dedicada A4 portrait; body.sales-order-print-route."],
  },
  {
    id: "proposal-print",
    module: "Comercial",
    feature: "Proposta Comercial — Imprimir / Salvar PDF",
    route: "/proposals/:id/print",
    files: [
      "src/components/proposal/ProposalPrintView.tsx",
      "src/components/ProposalClientPreview.tsx",
      "src/proposal-print.css",
    ],
    printMode: "browser-print",
    hasPrintCss: true,
    hasNoPrintShell: true,
    hasSafePageBreaks: true,
    hasFooterSafeArea: true,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["A4 portrait; modal e rota com classes distintas."],
  },
  {
    id: "purchase-order-print",
    module: "Cadeia de Suprimentos",
    feature: "Pedido de Compra — Imprimir / Salvar PDF",
    route: "/purchases (Pedido de compra emitido)",
    files: [
      "src/components/PurchaseModule.tsx",
      "src/lib/printBranding.ts",
    ],
    printMode: "browser-print",
    hasPrintCss: false,
    hasNoPrintShell: true,
    hasSafePageBreaks: true,
    hasFooterSafeArea: true,
    hasChartPrintRules: false,
    risk: "ok",
    notes: [
      "A4 portrait via popup (window.open + document.write) — mesmo padrão institucional de proposal-print (PrintHeader/branding), sem rota dedicada.",
      "@page/estilos inline no HTML gerado (não há arquivo .css separado) — sem regressão de cobertura no audit CSS global.",
    ],
  },
  {
    id: "material-demand-print",
    module: "Comercial / Engenharia",
    feature: "Uso de Matéria-Prima — Imprimir + CSV",
    route: "/sales-orders/material-demand",
    files: [
      "src/components/contextual/ProductMaterialDemandDashboard.tsx",
      "src/components/contextual/MaterialDemandPrintReport.tsx",
      "src/material-demand-print.css",
      "src/lib/materialDemandExport.ts",
    ],
    printMode: "pdf-layout",
    hasPrintCss: true,
    hasNoPrintShell: true,
    hasSafePageBreaks: true,
    hasFooterSafeArea: true,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["Portal #material-demand-print-root; A4 landscape."],
  },
  {
    id: "crm-customer-intelligence",
    module: "CRM",
    feature: "Inteligência do Cliente — Imprimir ficha",
    route: "/customers/:customerId/intelligence",
    files: [
      "src/components/crm/CustomerIntelligencePage.tsx",
      "src/components/crm/customer-intelligence/customer-intelligence.css",
    ],
    printMode: "browser-print",
    hasPrintCss: true,
    hasNoPrintShell: true,
    hasSafePageBreaks: true,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "attention",
    notes: [
      "Imprime aba ativa; oculta shell durante impressão.",
      "Tabelas largas podem estourar largura em alguns navegadores.",
      "Sem paginação dedicada.",
    ],
  },
  {
    id: "customer-cnpj-intelligence",
    module: "CRM / Clientes",
    feature: "Consulta CNPJ — Imprimir relatório",
    route: "/customers",
    files: [
      "src/components/customers/CustomerCnpjIntelligencePanel.tsx",
      "src/components/customers/CnpjCommercialIntelligencePrintReport.tsx",
      "src/cnpj-intelligence-print.css",
      "src/lib/customerCnpjIntelligencePrint.ts",
    ],
    printMode: "pdf-layout",
    hasPrintCss: true,
    hasNoPrintShell: true,
    hasSafePageBreaks: true,
    hasFooterSafeArea: true,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["Portal #cnpj-intelligence-print-root; relatório técnico/comercial."],
  },
  {
    id: "dashboard-sales-funnel",
    module: "Dashboard",
    feature: "Funil de Vendas",
    route: "/dashboard",
    files: ["src/components/dashboard/SalesFunnelPanel.tsx"],
    printMode: "none",
    hasPrintCss: false,
    hasNoPrintShell: false,
    hasSafePageBreaks: false,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["Sem print/PDF/export visual; apenas tela analítica."],
  },
  {
    id: "fleet-reports-csv",
    module: "Frota",
    feature: "Relatórios de Frota — Exportar CSV",
    route: "/fleet",
    files: [
      "src/components/fleet/FleetReportsTab.tsx",
      "src/lib/fleetManagementRoutes.ts",
    ],
    printMode: "csv-only",
    hasPrintCss: false,
    hasNoPrintShell: false,
    hasSafePageBreaks: false,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["CSV via API /api/fleet/reports/*; sem PDF visual."],
  },
  {
    id: "projects-executive-report",
    module: "Projetos",
    feature: "Relatório Gerencial Executivo de Projeto",
    route: "/projects/:projectId/report",
    files: [
      "src/components/projects/ProjectExecutiveReportPage.tsx",
      "src/components/projects/ProjectExecutiveReportPrintControls.tsx",
      "src/project-executive-report-print.css",
    ],
    printMode: "browser-print",
    hasPrintCss: true,
    hasNoPrintShell: true,
    hasSafePageBreaks: true,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["A4 portrait; oculta sidebar/header via body.project-executive-report-route."],
  },
  {
    id: "simulations-report-print",
    module: "Projetos / Simulações",
    feature: "Cenários e Simulações — Imprimir relatório",
    route: "/simulations",
    files: [
      "src/components/SimulationModule.tsx",
      "src/reports-print.css",
    ],
    printMode: "browser-print",
    hasPrintCss: true,
    hasNoPrintShell: true,
    hasSafePageBreaks: true,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "attention",
    notes: [
      "Portal modal; risco histórico de folha em branco se print-root usar position:absolute.",
      "CSS neutraliza min-height/absolute no new-product-report-print-root.",
    ],
  },
  {
    id: "pricing-simulator-print",
    module: "Comercial / Pricing",
    feature: "Formação de Preço — Imprimir resultado",
    route: "/pricing",
    files: ["src/components/PricingModule.tsx", "src/reports-print.css"],
    printMode: "browser-print",
    hasPrintCss: true,
    hasNoPrintShell: true,
    hasSafePageBreaks: true,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "attention",
    notes: ["Portal modal via reports-print.css; delay antes de window.print()."],
  },
  {
    id: "reports-bi-print",
    module: "BI",
    feature: "Relatórios e BI — Imprimir / PDF",
    route: "/reports",
    files: [
      "src/components/ReportsModule.tsx",
      "src/reports-print.css",
    ],
    printMode: "browser-print",
    hasPrintCss: true,
    hasNoPrintShell: true,
    hasSafePageBreaks: true,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "attention",
    notes: [
      "Recharts pode degradar cores/tamanho no PDF do navegador.",
      "Visibility hack global em reports-print.css.",
    ],
  },
  {
    id: "products-engineering-xlsx",
    module: "Engenharia",
    feature: "Engenharia de Produto — Exportar layout",
    route: "/products",
    files: [
      "src/components/ProductModule.tsx",
      "src/lib/productEngineeringExport.ts",
    ],
    printMode: "xlsx",
    hasPrintCss: false,
    hasNoPrintShell: false,
    hasSafePageBreaks: false,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["XLSX client-side; sem print visual."],
  },
  {
    id: "nomus-bom-batch-report",
    module: "Engenharia / Nomus",
    feature: "Relatório Divergências Nomus × IndusCost",
    route: "/products",
    files: ["src/components/product/NomusBomBatchReportPanel.tsx"],
    printMode: "none",
    hasPrintCss: false,
    hasNoPrintShell: false,
    hasSafePageBreaks: false,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["Tela de diagnóstico; sem botão print/export na UI (script CLI disponível)."],
  },
  {
    id: "nomus-bom-classification",
    module: "Engenharia / Nomus",
    feature: "Classificação BOM Nomus",
    route: "/products",
    files: ["src/components/product/NomusBomClassificationPanel.tsx"],
    printMode: "none",
    hasPrintCss: false,
    hasNoPrintShell: false,
    hasSafePageBreaks: false,
    hasFooterSafeArea: false,
    hasChartPrintRules: false,
    risk: "ok",
    notes: ["Diagnóstico read-only; sem export visual."],
  },
];

export type PrintPdfAuditSummary = {
  total: number;
  ok: number;
  attention: number;
  risk: number;
  pending: number;
  visualPrintCount: number;
  csvOnlyCount: number;
  xlsxOnlyCount: number;
  noneCount: number;
  byModule: Record<string, PrintPdfAuditEntry[]>;
};

const VISUAL_PRINT_MODES = new Set<PrintPdfAuditPrintMode>([
  "browser-print",
  "pdf-layout",
]);

const CRITICAL_PRINT_IDS = new Set([
  "finance-executive-report",
  "commercial-sold-products",
  "finance-ar-overdue-print",
  "sales-order-print",
  "proposal-print",
  "material-demand-print",
]);

export function isVisualPrintEntry(entry: PrintPdfAuditEntry): boolean {
  return VISUAL_PRINT_MODES.has(entry.printMode);
}

export function getPrintPdfAuditEntry(id: string): PrintPdfAuditEntry | undefined {
  return PRINT_PDF_AUDIT_ENTRIES.find((e) => e.id === id);
}

export function getPrintPdfAuditEntriesByModule(
  entries: PrintPdfAuditEntry[] = PRINT_PDF_AUDIT_ENTRIES
): Record<string, PrintPdfAuditEntry[]> {
  const byModule: Record<string, PrintPdfAuditEntry[]> = {};
  for (const entry of entries) {
    if (!byModule[entry.module]) byModule[entry.module] = [];
    byModule[entry.module]!.push(entry);
  }
  return byModule;
}

export function summarizePrintPdfAudit(
  entries: PrintPdfAuditEntry[] = PRINT_PDF_AUDIT_ENTRIES
): PrintPdfAuditSummary {
  const byModule = getPrintPdfAuditEntriesByModule(entries);
  let ok = 0;
  let attention = 0;
  let risk = 0;
  let pending = 0;
  let visualPrintCount = 0;
  let csvOnlyCount = 0;
  let xlsxOnlyCount = 0;
  let noneCount = 0;

  for (const entry of entries) {
    if (entry.risk === "ok") ok += 1;
    if (entry.risk === "attention") attention += 1;
    if (entry.risk === "risk") risk += 1;
    if (entry.risk === "pending") pending += 1;
    if (isVisualPrintEntry(entry)) visualPrintCount += 1;
    if (entry.printMode === "csv-only") csvOnlyCount += 1;
    if (entry.printMode === "xlsx") xlsxOnlyCount += 1;
    if (entry.printMode === "none") noneCount += 1;
  }

  return {
    total: entries.length,
    ok,
    attention,
    risk,
    pending,
    visualPrintCount,
    csvOnlyCount,
    xlsxOnlyCount,
    noneCount,
    byModule,
  };
}

export function readRepoFile(relativePath: string, root = process.cwd()): string | null {
  const full = join(root, relativePath);
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf8");
}

export function validatePrintPdfAuditFiles(
  entry: PrintPdfAuditEntry,
  root = process.cwd()
): string[] {
  const issues: string[] = [];
  for (const file of entry.files) {
    if (!existsSync(join(root, file))) {
      issues.push(`arquivo ausente: ${file}`);
    }
  }
  return issues;
}

export function auditPrintCssContent(css: string): {
  hasMediaPrint: boolean;
  hasNoPrint: boolean;
  hasShellHide: boolean;
  hasPageBreakRules: boolean;
  hasFooterSafeArea: boolean;
  hasChartHeightCap: boolean;
  hasLandscapeA4: boolean;
  hasDangerous100vh: boolean;
  hasAlwaysBreakWithoutLastChild: boolean;
} {
  const hasMediaPrint = /@media\s+print/.test(css);
  const hasNoPrint = /\.no-print|no-print|print-no-print|reports-no-print/.test(css);
  const hasShellHide =
    /#root|aside|navbar|sidebar|app-shell|h-screen/.test(css) &&
    /display:\s*none|visibility:\s*hidden/.test(css);
  const hasPageBreakRules = /page-break|break-before|break-after|break-inside/.test(css);
  const hasFooterSafeArea =
    /footer|print-footer|executive-print-page-footer|padding-bottom:\s*5/.test(css);
  const hasChartHeightCap = /max-height:\s*3|executive-chart-body|print-chart/.test(css);
  const hasLandscapeA4 = /A4 landscape|size:\s*A4 landscape/.test(css);
  const hasDangerous100vh = /100vh/.test(css);
  const hasAlwaysBreakWithoutLastChild =
    /page-break-after:\s*always|break-after:\s*page/.test(css) &&
    !/:last-child/.test(css);

  return {
    hasMediaPrint,
    hasNoPrint,
    hasShellHide,
    hasPageBreakRules,
    hasFooterSafeArea,
    hasChartHeightCap,
    hasLandscapeA4,
    hasDangerous100vh,
    hasAlwaysBreakWithoutLastChild,
  };
}

export function getCriticalPrintEntries(
  entries: PrintPdfAuditEntry[] = PRINT_PDF_AUDIT_ENTRIES
): PrintPdfAuditEntry[] {
  return entries.filter((e) => CRITICAL_PRINT_IDS.has(e.id));
}

export function assertNoCriticalPrintPending(
  entries: PrintPdfAuditEntry[] = PRINT_PDF_AUDIT_ENTRIES
): string[] {
  const issues: string[] = [];
  for (const entry of getCriticalPrintEntries(entries)) {
    if (entry.risk === "pending" || entry.risk === "risk") {
      issues.push(`${entry.id} está ${entry.risk}`);
    }
    if (isVisualPrintEntry(entry) && !entry.hasPrintCss) {
      issues.push(`${entry.id} visual sem hasPrintCss`);
    }
  }
  return issues;
}

export function formatPrintPdfAuditReport(
  entries: PrintPdfAuditEntry[] = PRINT_PDF_AUDIT_ENTRIES
): string {
  const summary = summarizePrintPdfAudit(entries);
  const lines: string[] = [
    "=== IndusCost — Auditoria Print/PDF ===",
    `Total: ${summary.total}`,
    `Visual print/PDF: ${summary.visualPrintCount}`,
    `CSV only: ${summary.csvOnlyCount}`,
    `XLSX only: ${summary.xlsxOnlyCount}`,
    `Sem export visual: ${summary.noneCount}`,
    `OK: ${summary.ok} | Atenção: ${summary.attention} | Risco: ${summary.risk} | Pendente: ${summary.pending}`,
    "",
  ];

  for (const [module, moduleEntries] of Object.entries(summary.byModule).sort(([a], [b]) =>
    a.localeCompare(b, "pt-BR")
  )) {
    lines.push(`## ${module}`);
    for (const entry of moduleEntries) {
      lines.push(
        `- [${entry.risk.toUpperCase()}] ${entry.feature} (${entry.printMode}) — ${entry.route}`
      );
      if (entry.notes.length > 0) {
        lines.push(`  ${entry.notes[0]}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
