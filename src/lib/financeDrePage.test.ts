import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  classifyDreCostCenterRole,
  bucketCostCenterSpendByDreRole,
} from "@/src/lib/financeDreCostCenterRoles.js";
import {
  allocateOrderCmvToNfeMonths,
  buildFinanceDreInformativeReport,
  buildFinanceDreLines,
  buildFinanceDreSourceChecks,
  emptyDreSeries,
  resolveBilledOrderCmv,
  roundDreMoney,
} from "@/src/lib/financeDreMath.js";
import { extractDreNfeItemsFromRawPayload } from "@/src/lib/financeDreNfeItemExtract.js";
import {
  buildFinanceDreQuery,
  createDefaultFinanceDreUiFilters,
  financeDreFiltersEqual,
  getFinanceDreApiPath,
  normalizeFinanceDreUiFilters,
} from "@/src/lib/financeDreViewModel.js";
import { buildFinanceDreExportCsv } from "@/src/lib/financeDreExport.js";
import { canViewFinanceDre } from "@/src/lib/financeDrePermissions.js";
import { FINANCE_SECTION_IDS, FINANCE_SECTION_PATHS } from "@/src/lib/financeNavigation.js";
import { FINANCE_UI_SECTIONS } from "@/src/lib/internalSurfaceAccess.js";
import { FINANCE_MODULE_RESOURCE_KEYS, FINANCE_MODULE_PILOT_ENDPOINTS } from "@/src/lib/financeModulesAccess.js";
import { FINANCE_DRE_OFFICIAL_SOURCES, type FinanceDreReport } from "@/src/lib/financeDreTypes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("finance dre navigation & permissions", () => {
  it("registra seção dre na navegação e UI", () => {
    assert.ok(FINANCE_SECTION_IDS.includes("dre"));
    assert.equal(FINANCE_SECTION_PATHS.dre, "/finance/dre");
    assert.ok(FINANCE_UI_SECTIONS.some((s) => s.id === "dre" && s.path === "/finance/dre"));
    assert.equal(FINANCE_MODULE_RESOURCE_KEYS.dre, "finance.dre");
  });

  it("FinanceModule e server registram rota/API", () => {
    const mod = readSrc("src/components/FinanceModule.tsx");
    assert.match(mod, /FinanceManagerialDrePage/);
    assert.match(mod, /path="dre"/);
    const server = readSrc("server.ts");
    assert.match(server, /registerFinanceDreRoutes/);
    assert.ok(
      FINANCE_MODULE_PILOT_ENDPOINTS.some(
        (e) => e.path === "/api/finance/dre" && e.resourceKey === "finance.dre"
      )
    );
  });

  it("contrato de permissão inclui finance.dre", () => {
    const resources = readSrc("src/lib/security/permissionContract/resources.ts");
    assert.match(resources, /resourceKey: "finance\.dre"/);
    assert.match(resources, /finance\.dre\.view/);
  });

  it("canViewFinanceDre aceita bags oficiais", () => {
    assert.equal(canViewFinanceDre({ hasPermission: (k) => k === "finance.dre.view" }), true);
    assert.equal(canViewFinanceDre({ hasPermission: (k) => k === "reports.view" }), true);
    assert.equal(canViewFinanceDre({ hasPermission: () => false }), false);
  });
});

describe("finance dre official motors wiring", () => {
  it("serviço orquestra motores oficiais sem reinventar elegibilidade", () => {
    const service = readSrc("src/lib/financeDreService.server.ts");
    assert.match(service, /queryMonthlyFiscalNfe/);
    assert.match(service, /buildFinanceCostCenterDashboardDefault/);
    assert.match(service, /loadMonthlyCmvFromNfeProductCosts/);
    assert.match(service, /queryMonthlyFiscalNfeDeductions/);
    assert.doesNotMatch(service, /calculateSalesOrderMarginsForOrders/);
  });

  it("queries NF-e reutilizam predicado oficial do faturamento", () => {
    const queries = readSrc("src/lib/financeDreNfeQueries.server.ts");
    assert.match(queries, /fiscalNfeWhereSql/);
    assert.match(queries, /nfeCompetenceDateSql/);
    const billing = readSrc("src/lib/financeBillingNfeDashboard.ts");
    assert.match(billing, /export function fiscalNfeWhereSql/);
    assert.match(billing, /export function nfeCompetenceDateSql/);
  });
});

describe("financeDreCostCenterRoles", () => {
  it("classifica papéis do Excel (Planilha2)", () => {
    assert.equal(classifyDreCostCenterRole("LOG", "Logística"), "logistics");
    assert.equal(classifyDreCostCenterRole("EXP", "Expedição"), "logistics");
    assert.equal(classifyDreCostCenterRole("EMB", "Embalagens"), "packaging");
    assert.equal(classifyDreCostCenterRole("FOLHA", "Folha de pagamento"), "payroll");
    assert.equal(classifyDreCostCenterRole("BEN", "Benefícios"), "benefits");
    assert.equal(classifyDreCostCenterRole("MONT", "Montagem"), "assembly");
    assert.equal(classifyDreCostCenterRole("MO", "Mão de obra"), "labor");
    assert.equal(classifyDreCostCenterRole("IMP", "Impostos"), "tax");
    assert.equal(classifyDreCostCenterRole("MP", "Matéria prima"), "raw_material");
    assert.equal(classifyDreCostCenterRole("ADM", "Administrativo"), "admin");
  });

  it("separa fretes, embalagens, pessoal, imposto/MP e admin mensais", () => {
    const { buckets } = bucketCostCenterSpendByDreRole(
      [
        { year: 2026, month: 3, code: "LOG", name: "Logística", amount: 100 },
        { year: 2026, month: 3, code: "EMB", name: "Embalagens", amount: 40 },
        { year: 2026, month: 3, code: "FOLHA", name: "Folha", amount: 200 },
        { year: 2026, month: 3, code: "ADM", name: "Aluguel", amount: 300 },
        { year: 2026, month: 3, code: "MP", name: "Matéria prima", amount: 999 },
        { year: 2026, month: 3, code: "IMP", name: "Impostos", amount: 80 },
      ],
      2026,
      [{ year: 2026, month: 3, unclassifiedAmount: 50 }],
      3
    );
    assert.equal(buckets.logistics[2], 100);
    assert.equal(buckets.packaging[2], 40);
    assert.equal(buckets.personnel[2], 200);
    assert.equal(buckets.admin[2], 300);
    assert.equal(buckets.rawMaterial[2], 999);
    assert.equal(buckets.tax[2], 80);
    assert.equal(buckets.unclassified[2], 50);
  });
});

describe("financeDreMath", () => {
  it("monta DRE com custos oficiais e pessoal fora do resultado", () => {
    const receita = emptyDreSeries();
    receita[0] = 1000;
    const pis = emptyDreSeries();
    pis[0] = 20;
    const cmv = emptyDreSeries();
    cmv[0] = 400;
    const fretes = emptyDreSeries();
    fretes[0] = 50;
    const admin = emptyDreSeries();
    admin[0] = 100;
    const pessoal = emptyDreSeries();
    pessoal[0] = 250;

    const embalagens = emptyDreSeries();
    embalagens[0] = 30;
    const { lines, kpis } = buildFinanceDreLines({
      highlightMonth: 1,
      receitaBruta: receita,
      cofins: emptyDreSeries(),
      icms: emptyDreSeries(),
      icmsSt: emptyDreSeries(),
      ipi: emptyDreSeries(),
      pis,
      devolucoes: emptyDreSeries(),
      cmv,
      fretes,
      embalagens,
      despesasAdmin: admin,
      despesasPessoal: pessoal,
      impostosCc: emptyDreSeries(),
      materiaPrimaCc: emptyDreSeries(),
      unclassifiedCcAmount: emptyDreSeries(),
      quality: { unlinkedNfeCount: 0, unlinkedNfeRevenue: 0, taxSummaryGapCount: 0 },
    });

    // 1000 - 20 = 980 líquida; custos 480; lucro bruto 500; admin 100 → 400
    assert.equal(kpis.receitaLiquida, 980);
    assert.equal(kpis.lucroBruto, 500);
    assert.equal(kpis.resultadoOperacional, 400);
    assert.equal(kpis.lucroLiquidoAproximado, 400);
    assert.ok(lines.some((l) => l.id === "embalagens"));
    assert.ok(!lines.some((l) => l.id === "despesas_pessoal_info"));

    const resultLine = lines.find((l) => l.id === "resultado_operacional");
    assert.equal(resultLine?.values.highlight, 400);

    const info = buildFinanceDreInformativeReport({
      highlightMonth: 1,
      despesasPessoal: pessoal,
      impostosCc: emptyDreSeries(),
      materiaPrimaCc: emptyDreSeries(),
      unclassifiedCcAmount: emptyDreSeries(),
      unlinkedNfeRevenueByMonth: emptyDreSeries(),
      unlinkedNfeCount: 0,
    });
    assert.ok(info.items.some((i) => i.id === "pessoal_cc" && i.highlightAmount === 250));
    assert.ok(info.items.some((i) => i.id === "resultado_financeiro_fora_escopo"));
    assert.ok(
      buildFinanceDreSourceChecks({
        unlinkedNfeCount: 0,
        taxSummaryGapCount: 0,
        unclassifiedYtd: 0,
        pricedLineCount: 12,
      }).some((c) => c.id === "cmv_nfe_custo" && c.appliedToResult)
    );

    const extracted = extractDreNfeItemsFromRawPayload({
      itens: [
        { idProduto: 99, codigoProduto: "SKU-1", quantidade: 2, valorUnitario: 10 },
        { idProduto: 100, quantidade: 0 },
      ],
    });
    assert.equal(extracted.length, 1);
    assert.equal(extracted[0]?.externalProductId, 99);
    assert.equal(extracted[0]?.quantity, 2);
  });

  it("aloca CMV por peso das NF-e e só da parcela faturada", () => {
    assert.equal(
      resolveBilledOrderCmv({
        orderTotalCost: 100,
        orderNetRevenue: 200,
        linkedNfeValorLiquidoSum: 50,
      }),
      25
    );
    const series = allocateOrderCmvToNfeMonths({
      orderTotalCost: 100,
      orderNetRevenue: 100,
      nfes: [
        { month: 1, valorLiquido: 75 },
        { month: 2, valorLiquido: 25 },
      ],
    });
    assert.equal(series[0], 75);
    assert.equal(series[1], 25);
  });

  it("gera alerta quando há lacuna de CMV por item/custo", () => {
    const { qualityAlerts } = buildFinanceDreLines({
      highlightMonth: 1,
      receitaBruta: emptyDreSeries(),
      cofins: emptyDreSeries(),
      icms: emptyDreSeries(),
      icmsSt: emptyDreSeries(),
      ipi: emptyDreSeries(),
      pis: emptyDreSeries(),
      devolucoes: emptyDreSeries(),
      cmv: emptyDreSeries(),
      fretes: emptyDreSeries(),
      embalagens: emptyDreSeries(),
      despesasAdmin: emptyDreSeries(),
      despesasPessoal: emptyDreSeries(),
      impostosCc: emptyDreSeries(),
      materiaPrimaCc: emptyDreSeries(),
      unclassifiedCcAmount: emptyDreSeries(),
      quality: {
        unlinkedNfeCount: 3,
        unlinkedNfeRevenue: 1200,
        taxSummaryGapCount: 0,
        missingCostLineCount: 3,
        pricedLineCount: 10,
      },
    });
    assert.ok(qualityAlerts.some((a) => a.code === "CMV_MISSING_COST"));
  });
});

describe("financeDreViewModel & export", () => {
  it("serializa filtros e paths", () => {
    const filters = normalizeFinanceDreUiFilters({
      year: "2026",
      month: "7",
      company: "koppetel",
    });
    const q = buildFinanceDreQuery(filters);
    assert.match(q, /year=2026/);
    assert.match(q, /month=7/);
    assert.match(q, /company=koppetel/);
    assert.equal(getFinanceDreApiPath(q), `/api/finance/dre?${q}`);
    assert.equal(
      financeDreFiltersEqual(filters, createDefaultFinanceDreUiFilters(new Date(2026, 6, 1))),
      false
    );
  });

  it("CSV contém colunas mensais", () => {
    const series = emptyDreSeries();
    series[0] = 10;
    const report: FinanceDreReport = {
      schemaVersion: 1,
      title: "DRE",
      subtitle: "t",
      disclaimer: "d",
      generatedAt: new Date().toISOString(),
      filters: { year: 2026, highlightMonth: 1, company: "all", dateBase: "emissao" },
      companyLabel: "Todas",
      monthLabels: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"],
      kpis: {
        receitaLiquida: 10,
        lucroBruto: 10,
        margemBrutaPct: 100,
        resultadoOperacional: 10,
        margemOperacionalPct: 100,
        lucroLiquidoAproximado: 10,
      },
      lines: [
        {
          id: "receita_bruta",
          label: "Receita bruta",
          kind: "total",
          parentId: null,
          values: { byMonth: series, ytd: 10, highlight: 10 },
          pctOfNetRevenue: 100,
          expandable: true,
        },
      ],
      costCenterBreakdown: [],
      sourceChecks: [],
      informativeReport: {
        title: "Relatório informativo",
        subtitle: "",
        items: [],
        totalNotAppliedHighlight: 0,
        totalNotAppliedYtd: 0,
      },
      qualityAlerts: [],
      sources: FINANCE_DRE_OFFICIAL_SOURCES,
    };
    const csv = buildFinanceDreExportCsv(report);
    assert.match(csv, /Receita bruta/);
    assert.match(csv, /Jan/);
    assert.match(csv, /10,00/);
    assert.equal(roundDreMoney(1.006), 1.01);
  });
});

describe("finance dre presentation UX", () => {
  it("página abre modal fullscreen de apresentação", () => {
    const page = readSrc("src/components/finance/FinanceManagerialDrePage.tsx");
    assert.match(page, /FinanceDrePresentationModal/);
    assert.match(page, /FinanceDreInformativeReport/);
    assert.match(page, /finance-dre-open-presentation/);
    const modal = readSrc("src/components/finance/dre/FinanceDrePresentationModal.tsx");
    assert.match(modal, /showAllMonths/);
    assert.match(modal, /FinanceDreInformativeReport/);
    assert.match(modal, /z-\[85\]/);
    const grid = readSrc("src/components/finance/dre/FinanceDreGrid.tsx");
    assert.match(grid, /showAllMonths/);
    assert.match(grid, /rowSeparators|border-t-2|border-l-\[3px\]/);
  });

  it("PDF/impressão usa documento paisagem dedicado (não fica em branco)", () => {
    const page = readSrc("src/components/finance/FinanceManagerialDrePage.tsx");
    assert.match(page, /FinanceDrePrintDocument/);
    assert.match(page, /finance-dre-print-route/);
    assert.match(page, /createPortal/);
    const printDoc = readSrc("src/components/finance/dre/FinanceDrePrintDocument.tsx");
    assert.match(printDoc, /finance-dre-print-root/);
    assert.match(printDoc, /showAllMonths/);
    assert.match(printDoc, /expandAll/);
    const css = readSrc("src/components/finance/dre/finance-dre-print.css");
    assert.match(css, /A4 landscape/);
    assert.match(css, /body\.finance-dre-print-route #root/);
    const globalPrint = readSrc("src/reports-print.css");
    assert.match(globalPrint, /#finance-dre-print-root/);
    assert.match(globalPrint, /body\.finance-dre-print-route #root/);
    const main = readSrc("src/main.tsx");
    assert.match(main, /finance-dre-print\.css/);
  });
});
