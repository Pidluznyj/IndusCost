import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  classifyDreCostCenterRole,
  bucketCostCenterSpendByDreRole,
} from "@/src/lib/financeDreCostCenterRoles.js";
import { buildEstimatedCorporateTaxSeriesFromSingleBase } from "@/src/lib/financeDreEstimatedCorporateTaxes.js";
import {
  allocateOrderCmvToNfeMonths,
  buildFinanceDreInformativeReport,
  buildFinanceDreLines,
  buildFinanceDreSourceChecks,
  emptyDreSeries,
  resolveFinanceDreAvailableThroughMonth,
  resolveBilledOrderCmv,
  roundDreMoney,
  zeroDreSeriesAfterMonth,
} from "@/src/lib/financeDreMath.js";
import { extractDreNfeItemsFromRawPayload } from "@/src/lib/financeDreNfeItemExtract.js";
import {
  buildFinanceDreQuery,
  createDefaultFinanceDreUiFilters,
  financeDreFiltersEqual,
  getFinanceDreApiPath,
  getFinanceDreLineDrilldownPath,
  normalizeFinanceDreUiFilters,
} from "@/src/lib/financeDreViewModel.js";
import { buildFinanceDreExportCsv } from "@/src/lib/financeDreExport.js";
import { canViewFinanceDre } from "@/src/lib/financeDrePermissions.js";
import {
  amountInMonthRange,
  dreDrilldownTotalsMatch,
  financeDreCompositionChildren,
  isFinanceDreDrillableLine,
  isFinanceDreSourceDrillLine,
  scopeMonthRange,
  sumDreDrilldownAmounts,
} from "@/src/lib/financeDreDrilldownMath.js";
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

    // 1000 - 20 = 980 líquida; custos 480; lucro bruto 500; admin 100 → 400 operacional
    // IRPJ/CSLL estimados sobre 400 → lucro líquido após provisões < 400
    assert.equal(kpis.receitaBruta, 1000);
    assert.equal(kpis.receitaBrutaPct, roundDreMoney((1000 / 980) * 100));
    assert.equal(kpis.receitaLiquida, 980);
    assert.equal(kpis.receitaLiquidaPct, 100);
    assert.equal(kpis.lucroBruto, 500);
    assert.equal(kpis.margemBrutaPct, roundDreMoney((500 / 980) * 100));
    assert.equal(kpis.resultadoOperacional, 400);
    assert.equal(kpis.margemOperacionalPct, roundDreMoney((400 / 980) * 100));
    assert.ok(kpis.lucroLiquidoAproximado < 400);
    assert.ok(kpis.margemLiquidaAproximadaPct != null);
    assert.ok(kpis.ytd);
    assert.equal(kpis.ytd.receitaLiquida, 980);
    assert.equal(kpis.ytd.resultadoOperacional, 400);
    assert.ok(lines.some((l) => l.id === "embalagens"));
    assert.ok(lines.some((l) => l.id === "provisoes_estimadas_irpj_csll"));
    assert.ok(lines.some((l) => l.id === "csll_estimada"));
    assert.ok(lines.some((l) => l.id === "irpj_estimado"));
    assert.ok(!lines.some((l) => (l.id as string) === "despesas_pessoal_info"));

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
        receitaBruta: 12,
        receitaBrutaPct: 120,
        receitaLiquida: 10,
        receitaLiquidaPct: 100,
        lucroBruto: 10,
        margemBrutaPct: 100,
        resultadoOperacional: 10,
        margemOperacionalPct: 100,
        lucroLiquidoAproximado: 10,
        margemLiquidaAproximadaPct: 100,
        ytd: {
          receitaBruta: 12,
          receitaBrutaPct: 120,
          receitaLiquida: 10,
          receitaLiquidaPct: 100,
          lucroBruto: 10,
          margemBrutaPct: 100,
          resultadoOperacional: 10,
          margemOperacionalPct: 100,
          lucroLiquidoAproximado: 10,
          margemLiquidaAproximadaPct: 100,
        },
      },
      estimatedCorporateTaxes: buildEstimatedCorporateTaxSeriesFromSingleBase(series, 1),
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
    assert.match(page, /Acumulado \(YTD\)/);
    assert.match(page, /Mês destaque/);
    assert.match(page, /Receita bruta \(YTD\)/);
    assert.match(page, /Receita bruta \(mês\)/);
    assert.match(page, /kpis\.ytd/);
    const modal = readSrc("src/components/finance/dre/FinanceDrePresentationModal.tsx");
    assert.match(modal, /showAllMonths/);
    assert.match(modal, /FinanceDreInformativeReport/);
    assert.match(modal, /z-\[85\]/);
    assert.match(modal, /Receita bruta \(YTD\)/);
    assert.match(modal, /Receita líquida \(YTD\)/);
    assert.match(modal, /kpis\.ytd/);
    assert.doesNotMatch(modal, /Receita líquida \(mês\)/);
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
    assert.match(printDoc, /Receita bruta \(YTD\)/);
    assert.match(printDoc, /Receita líquida \(YTD\)/);
    assert.match(printDoc, /kpis\.ytd/);
    assert.doesNotMatch(printDoc, /Receita líquida \(mês\)/);
    const printCss = readSrc("src/components/finance/dre/finance-dre-print.css");
    assert.match(printCss, /repeat\(5, 1fr\)/);
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

describe("finance dre future months", () => {
  it("resolveFinanceDreAvailableThroughMonth cobre passado/presente/futuro", () => {
    const ref = new Date(2026, 6, 24); // Jul/2026
    assert.equal(resolveFinanceDreAvailableThroughMonth(2025, ref), 12);
    assert.equal(resolveFinanceDreAvailableThroughMonth(2026, ref), 7);
    assert.equal(resolveFinanceDreAvailableThroughMonth(2027, ref), 0);
  });

  it("meses futuros ficam zerados na grade e nas provisoes", () => {
    const receita = emptyDreSeries();
    const fretes = emptyDreSeries();
    const admin = emptyDreSeries();
    for (let i = 0; i < 12; i += 1) {
      receita[i] = 100_000;
      fretes[i] = 26_300;
      admin[i] = 40_000;
    }
    const { lines, estimatedCorporateTaxes } = buildFinanceDreLines({
      highlightMonth: 7,
      availableThroughMonth: 7,
      receitaBruta: receita,
      cofins: emptyDreSeries(),
      icms: emptyDreSeries(),
      icmsSt: emptyDreSeries(),
      ipi: emptyDreSeries(),
      pis: emptyDreSeries(),
      devolucoes: emptyDreSeries(),
      cmv: emptyDreSeries(),
      fretes,
      embalagens: emptyDreSeries(),
      despesasAdmin: admin,
      despesasPessoal: emptyDreSeries(),
      impostosCc: emptyDreSeries(),
      materiaPrimaCc: emptyDreSeries(),
      unclassifiedCcAmount: emptyDreSeries(),
      quality: { unlinkedNfeCount: 0, unlinkedNfeRevenue: 0, taxSummaryGapCount: 0 },
    });
    const resultado = lines.find((l) => l.id === "resultado_operacional");
    const fretesLine = lines.find((l) => l.id === "fretes");
    assert.ok(resultado && fretesLine);
    for (let i = 7; i < 12; i += 1) {
      assert.equal(resultado.values.byMonth[i], 0, `resultado mês ${i + 1}`);
      assert.equal(fretesLine.values.byMonth[i], 0, `fretes mês ${i + 1}`);
      assert.equal(estimatedCorporateTaxes.provisionByMonth[i], 0, `provisão mês ${i + 1}`);
    }
    assert.ok((resultado.values.byMonth[6] ?? 0) !== 0);
    assert.deepEqual(zeroDreSeriesAfterMonth([1, 2, 3, 4], 2), [1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("finance dre line drill-down", () => {
  it("reconcilia totais e compõe linhas de resultado", () => {
    assert.equal(isFinanceDreDrillableLine("icms"), true);
    assert.equal(isFinanceDreSourceDrillLine("icms"), true);
    assert.equal(isFinanceDreSourceDrillLine("deducoes"), false);
    assert.deepEqual(financeDreCompositionChildren("deducoes"), [
      "cofins",
      "icms",
      "icms_st",
      "ipi",
      "pis",
      "devolucoes",
    ]);
    assert.deepEqual(scopeMonthRange("highlight", 7), { fromMonth: 7, toMonth: 7 });
    assert.deepEqual(scopeMonthRange("ytd", 7), { fromMonth: 1, toMonth: 7 });

    const series = emptyDreSeries();
    series[0] = 10.005;
    series[1] = 20.004;
    assert.equal(amountInMonthRange(series, 1, 2), 30.01);
    assert.equal(sumDreDrilldownAmounts([10.004, 20.005]), 30.01);
    assert.equal(dreDrilldownTotalsMatch(100.01, 100.02), true);
    assert.equal(dreDrilldownTotalsMatch(100, 100.05), false);
  });

  it("rota, UI e motores oficiais do drill-down", () => {
    const routes = readSrc("src/lib/financeDreRoutes.ts");
    assert.match(routes, /\/api\/finance\/dre\/lines\/:lineId\/drilldown/);
    assert.match(routes, /buildFinanceDreLineDrilldown/);

    const server = readSrc("src/lib/financeDreDrilldown.server.ts");
    assert.match(server, /fiscalNfeWhereSql/);
    assert.match(server, /SalesOrderNfeLink/);
    assert.match(server, /loadCmvDrilldownBundle/);
    assert.match(server, /buildFinanceCostCenterDashboardDefault/);
    assert.match(server, /totalsMatch/);

    const page = readSrc("src/components/finance/FinanceManagerialDrePage.tsx");
    assert.match(page, /FinanceDreLineDetailModal/);
    assert.match(page, /onLineClick/);
    const modal = readSrc("src/components/finance/dre/FinanceDreLineDetailModal.tsx");
    assert.match(modal, /finance-dre-line-detail-modal/);
    assert.match(modal, /Totais reconciliados/);
    const grid = readSrc("src/components/finance/dre/FinanceDreGrid.tsx");
    assert.match(grid, /onLineClick/);
    assert.match(grid, /Ver origem/);
    assert.match(grid, /Ver cálculo/);

    const pageUi = readSrc("src/components/finance/FinanceManagerialDrePage.tsx");
    assert.match(pageUi, /Lucro líquido após IRPJ e CSLL/);
    assert.match(pageUi, /Estimativa gerencial/);
    assert.match(pageUi, /Acumulado \(YTD\)/);
    assert.doesNotMatch(pageUi, /0\.09|0\.15|20000|numberOfMonthsInPeriod/);

    const path = getFinanceDreLineDrilldownPath("icms", "year=2026&month=7", "highlight");
    assert.match(path, /\/api\/finance\/dre\/lines\/icms\/drilldown/);
    assert.match(path, /scope=highlight/);
    assert.match(path, /year=2026/);
  });

  it("validação de fontes oficiais abre detalhe clicável das lacunas", () => {
    const routes = readSrc("src/lib/financeDreRoutes.ts");
    assert.match(routes, /\/api\/finance\/dre\/source-checks\/:checkId\/drilldown/);
    assert.match(routes, /buildFinanceDreSourceCheckDrilldown/);

    const server = readSrc("src/lib/financeDreSourceCheckDrilldown.server.ts");
    assert.match(server, /loadCmvGapsForMonthRange/);
    assert.match(server, /listUnclassifiedAccountsPayableDefault/);
    assert.match(server, /cmvGapKindLabel|missing_cost|Sem custo vigente/);

    const cmv = readSrc("src/lib/financeDreCmvFromNfe.server.ts");
    assert.match(cmv, /DreCmvGapRow/);
    assert.match(cmv, /loadCmvGapsForMonthRange/);

    const info = readSrc("src/components/finance/dre/FinanceDreInformativeReport.tsx");
    assert.match(info, /onSourceCheckClick/);
    assert.match(info, /Ver registros da validação/);
    assert.match(info, /finance-dre-source-check-/);

    const page = readSrc("src/components/finance/FinanceManagerialDrePage.tsx");
    assert.match(page, /drillSourceCheckId|setDrillSourceCheckId/);
    assert.match(page, /onSourceCheckClick/);

    const modal = readSrc("src/components/finance/dre/FinanceDreLineDetailModal.tsx");
    assert.match(modal, /sourceCheckId/);
    assert.match(modal, /getFinanceDreSourceCheckDrilldownPath/);
  });
});
