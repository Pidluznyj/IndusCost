import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { CRM_UI_TABS, TabResourceKeys, isCrmUiTabId } from "@/src/lib/moduleTabResources";
import { resolveContractKeyForInternalSurface } from "@/src/lib/internalSurfaceAccess";
import { CrmReportsSection } from "@/src/components/crm/reports/CrmReportsSection";
import { CrmReportsSummaryCards, CrmReportsUniverseSummary } from "@/src/components/crm/reports/CrmReportsSummaryCards";
import { CrmReportsGlobalFilters, CRM_REPORTS_FILTER_LABELS } from "@/src/components/crm/reports/CrmReportsGlobalFilters";
import { CrmRecentCustomersTable } from "@/src/components/crm/reports/CrmRecentCustomersTable";
import { CrmOverdueRepurchaseTable } from "@/src/components/crm/reports/CrmOverdueRepurchaseTable";
import { CrmRepurchaseCadenceTable } from "@/src/components/crm/reports/CrmRepurchaseCadenceTable";
import { CrmReportBuilder, CRM_REPORT_BUILDER_EMPTY_MESSAGE } from "@/src/components/crm/reports/CrmReportBuilder";
import { CrmReportsPagination, type CrmReportsRowActionHandlers } from "@/src/components/crm/reports/CrmReportsShared";
import { parseCrmCustomReportRequest } from "./crmCustomReportCore.js";
import { CRM_REPORTS_API } from "./crmReportsClient.js";
import { CRM_REPORT_TEMPLATES, applyCrmReportTemplate } from "./crmReportsTemplates.js";
import {
  CRM_REPORTS_CARDS,
  addCrmReportsSelectionCustomer,
  applyCrmReportsCard,
  buildCrmCustomReportRequestBody,
  buildCrmReportsOperationalRequest,
  createDefaultCrmReportsUiState,
  createEmptyCrmReportBuilderState,
  describeCrmReportBuilderIssues,
  hideCheckedCrmReportsCustomers,
  parseCrmReportsUiState,
  resolveCrmReportPeriod,
  serializeCrmReportsUiState,
  showOnlyCheckedCrmReportsCustomers,
  toggleCrmReportDimension,
  toggleCrmReportMetric,
  withCrmReportsFilters,
  withCrmReportsOffset,
  withCrmReportsSelection,
  type CrmReportsCustomerChip,
} from "./crmReportsUiState.js";
import type {
  CrmReportsIndicators,
  CrmReportsOverdueRow,
  CrmReportsPage,
  CrmReportsRecent60dRow,
  CrmReportsWindows,
} from "./crmReportsTypes.js";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const chip = (n: number, label = `Cliente ${n}`): CrmReportsCustomerChip => ({ id: uuid(n), label, sublabel: null });

const WINDOWS: CrmReportsWindows = {
  today: "2026-09-11",
  recent60d: { from: "2026-07-14", to: "2026-09-11", days: 60 },
  rolling12m: { from: "2025-09-12", to: "2026-09-11", months: 12 },
};

const ACTIONS: CrmReportsRowActionHandlers = {
  canOpenCustomer360: true,
  canOpenOrderDetail: true,
  canRegisterContact: true,
  onOpenOrder: () => undefined,
  onRegisterContact: () => undefined,
};

function recentRow(n: number, extra: Partial<CrmReportsRecent60dRow> = {}): CrmReportsRecent60dRow {
  return {
    customerId: uuid(n),
    displayName: `Cliente ${n}`,
    tradeName: null,
    taxId: "11.111.111/0001-11",
    city: "Curitiba",
    state: "PR",
    commercialOwnerName: "Gislene Lima",
    commercialOwnerExternalId: 464,
    lastOrderId: `order-${n}`,
    lastOrderCode: `PD ${n}`,
    lastOrderSellerExternalId: 501,
    lastOrderSellerName: "JOSEANE SOUZA",
    lastOrderSellerLabel: "JOSEANE SOUZA",
    lastOrderSellerResolution: "RESOLVED",
    totalOccasions: 3,
    occasionsUsed: 3,
    intervalsUsed: 2,
    averageRepurchaseDays: 30,
    averageRepurchaseDaysRounded: 30,
    expectedRepurchaseDate: "2026-08-30",
    deltaDays: 12,
    repurchaseStatus: "OVERDUE",
    cadenceConfidence: "LOW",
    lastPurchaseDate: "2026-07-31",
    daysSinceLastPurchase: 42,
    orders60d: 1,
    purchaseValue60d: 500.1,
    averageTicket60d: 500.1,
    ...extra,
  };
}

function page<Row>(rows: Row[], total: number, offset = 0, limit = 25): CrmReportsPage<Row> {
  return { rows, total, limit, offset, returned: rows.length, hasMore: offset + rows.length < total, sort: [] };
}

const render = (node: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

// ---------------------------------------------------------------------------

describe("aba Relatórios — navegação e autorização", () => {
  it("nova aba existe com o resourceKey oficial e resolve para o recurso do contrato", () => {
    const tab = CRM_UI_TABS.find((t) => t.id === "reports");
    assert.deepEqual(tab && { resourceKey: tab.resourceKey, label: tab.label }, {
      resourceKey: "comercial.crm.tab.relatorios",
      label: "Relatórios",
    });
    assert.equal(TabResourceKeys.CRM_RELATORIOS, "comercial.crm.tab.relatorios");
    assert.equal(resolveContractKeyForInternalSurface("comercial.crm.tab.relatorios"), "commercial.crm.reports");
  });

  it("deep-link ?tab=reports é aceito; valor desconhecido não", () => {
    assert.equal(isCrmUiTabId("reports"), true);
    assert.equal(isCrmUiTabId("relatorios"), false);
    assert.equal(isCrmUiTabId(null), false);
    const module_ = read("src/components/CrmModule.tsx");
    assert.match(module_, /const fromUrl = searchParams\.get\("tab"\);\s*\n\s*return isCrmUiTabId\(fromUrl\) \? fromUrl : "general";/);
    assert.match(module_, /next\.set\("tab", activeCrmManagementTab\)/);
  });

  it("sem ?tab, perfil sem Gestão Geral (ex.: só Relatórios) abre na 1ª aba permitida; deep-link negado segue no modal", () => {
    const module_ = read("src/components/CrmModule.tsx");
    assert.match(module_, /const \[crmTabFromUrl\] = useState\(\(\) => isCrmUiTabId\(searchParams\.get\("tab"\)\)\);/);
    assert.match(
      module_,
      /!crmTabFromUrl && crmAuthorizedTabs\.requestedDenied && crmAuthorizedTabs\.allowedIds\.length > 0/
    );
    assert.match(module_, /setActiveCrmManagementTab\(crmAuthorizedTabs\.allowedIds\[0\]!\)/);
    assert.match(
      module_,
      /\(crmAuthorizedTabs\.requestedDenied && !implicitCrmTabDenied\) \? \(\s*\n\s*<UnauthorizedAccessGate forceDenied \/>/
    );
  });

  it("CrmModule: aba protegida pelo recurso oficial, seção lazy e sem papel fixo", () => {
    const module_ = read("src/components/CrmModule.tsx");
    assert.match(
      module_,
      /<ProtectedTab\s*\n\s*resourceKey=\{TabResourceKeys\.CRM_RELATORIOS\}\s*\n\s*active=\{activeCrmManagementTab === "reports"\}/
    );
    assert.match(module_, /React\.lazy\(\(\) =>\s*\n\s*import\("@\/src\/components\/crm\/reports\/CrmReportsSection"\)/);
    assert.doesNotMatch(module_, /import \{[^}]*CrmReportsSection[^}]*\} from/);
    assert.match(module_, /permissions\.canViewTabResource\(TabResourceKeys\.CRM_RELATORIOS\)/);
    // Ações por permissão das telas de destino, nunca por papel.
    assert.match(module_, /canPerformAction\(\s*COMMERCIAL_RESOURCE_KEYS\.salesOrdersDetail,\s*"view"\s*\)/);
    assert.match(module_, /canPerformAction\(\s*COMMERCIAL_RESOURCE_KEYS\.crmActivities,\s*"create"\s*\)/);
    assert.match(module_, /hasAnyPermission\(\[\.\.\.CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS\]\)/);
    // Abrir direto em Relatórios não dispara o dashboard pesado de vendedores.
    assert.match(module_, /if \(activeCrmManagementTab === "reports"\) return;\s*\n\s*if \(hasPrefetchedSellerOptionsRef\.current\) return;/);
  });
});

describe("abertura da aba — só o operacional; construtor vazio", () => {
  it("render inicial: carregando listas, construtor com a mensagem vazia e nenhum resultado", () => {
    const html = render(
      <CrmReportsSection
        canOpenCustomer360
        canOpenOrderDetail
        canRegisterContact
        onRegisterContact={() => undefined}
      />
    );
    assert.match(html, /data-testid="crm-reports-loading"/);
    assert.ok(html.includes(CRM_REPORT_BUILDER_EMPTY_MESSAGE));
    assert.equal(CRM_REPORT_BUILDER_EMPTY_MESSAGE, "Selecione os filtros e clique em Gerar relatório.");
    assert.doesNotMatch(html, /crm-report-builder-result/);
  });

  it("na montagem a seção busca operacional + opções; o personalizado só no clique", () => {
    const section = read("src/components/crm/reports/CrmReportsSection.tsx");
    const builder = read("src/components/crm/reports/CrmReportBuilder.tsx");
    assert.match(section, /fetchCrmReportsOperational\(/);
    assert.match(section, /fetchCrmReportsFilterOptions\(/);
    assert.doesNotMatch(section, /fetchCrmCustomReport|CRM_REPORTS_API\.custom\b/);
    // No construtor, a única chamada fica em `execute`, disparado por handleGenerate / paginação.
    const effects = builder.match(/useEffect\(([\s\S]*?)\);/g) ?? [];
    assert.ok(effects.length > 0);
    for (const effect of effects) assert.doesNotMatch(effect, /fetchReport|execute\(|handleGenerate/);
    assert.match(builder, /onClick=\{handleGenerate\}/);
    assert.equal(CRM_REPORTS_API.operational, "/api/crm/reports/operational");
    assert.equal(CRM_REPORTS_API.custom, "/api/crm/reports/custom");
  });

  it("request inicial = filtros vazios, visões padrão, 1ª página de cada lista", () => {
    const request = buildCrmReportsOperationalRequest(createDefaultCrmReportsUiState());
    assert.deepEqual(request.filters, {
      customerIds: [],
      commercialOwner: null,
      lastOrderSeller: null,
      city: [],
      state: [],
      customerSelection: { mode: "ALL", customerIds: [] },
    });
    assert.deepEqual(request.views, { cadence: { statuses: [] }, overdue: { severity: "ALL", sort: "DELAY_DESC" } });
    assert.deepEqual(request.pagination, {
      recent: { limit: 25, offset: 0 },
      cadence: { limit: 25, offset: 0 },
      overdue: { limit: 25, offset: 0 },
    });
  });
});

describe("cards e universo — números do payload", () => {
  const indicators: CrmReportsIndicators = {
    customersPurchased60d: 1234,
    repurchaseDueNext15d: 7,
    overdueRepurchase: 55,
    severelyOverdueRepurchase: 9,
    insufficientCadence: 31,
  };

  it("cinco cards clicáveis com rótulos da missão e valores do backend", () => {
    const html = render(
      <CrmReportsSummaryCards indicators={indicators} refreshing={false} active={new Set()} onSelect={() => undefined} />
    );
    for (const label of [
      "Compraram nos últimos 60 dias",
      "Recompra nos próximos 15 dias",
      "Recompra atrasada",
      "Atrasados &gt; 30 dias",
      "Sem cadência suficiente",
    ]) {
      assert.ok(html.includes(label), label);
    }
    for (const value of ["1.234", ">7<", ">55<", ">9<", ">31<"]) assert.ok(html.includes(value), value);
    assert.equal((html.match(/<button/g) ?? []).length, 5);
  });

  it("card só seleciona a visão (sem cálculo): cada card aponta a lista e o recorte certo", () => {
    const base = createDefaultCrmReportsUiState();
    const due = applyCrmReportsCard(withCrmReportsOffset(base, "cadence", 50), "dueNext15d");
    assert.equal(due.target, "cadence");
    assert.deepEqual(due.state.views.cadence.statuses, ["DUE_SOON"]);
    assert.equal(due.state.offsets.cadence, 0);
    assert.deepEqual(applyCrmReportsCard(base, "insufficientCadence").state.views.cadence.statuses, ["INSUFFICIENT_HISTORY"]);
    assert.equal(applyCrmReportsCard(base, "severelyOverdue").state.views.overdue.severity, "SEVERE");
    assert.equal(applyCrmReportsCard(base, "overdue").state.views.overdue.severity, "ALL");
    assert.equal(applyCrmReportsCard(base, "purchased60d").target, "recent");
    assert.deepEqual(
      CRM_REPORTS_CARDS.map((c) => c.indicator),
      ["customersPurchased60d", "repurchaseDueNext15d", "overdueRepurchase", "severelyOverdueRepurchase", "insufficientCadence"]
    );
  });

  it("resumo do universo mostra permitido / ocultados / analisados do backend", () => {
    const html = render(
      <CrmReportsUniverseSummary
        universe={{ authorizedCustomers: 812, matchedBeforeExclusions: 800, manuallyExcluded: 3, analyzedCustomers: 797 }}
        selection={{ mode: "EXCLUDE", requestedIds: 4, idsOutsideUniverse: 1 }}
      />
    );
    assert.match(html, /Clientes no universo permitido<\/span><span[^>]*>812</);
    assert.match(html, /Ocultados<\/span><span[^>]*>3</);
    assert.match(html, /Clientes analisados<\/span><span[^>]*>797</);
    assert.match(html, /Após filtros<\/span><span[^>]*>800</);
    assert.match(html, /1 cliente\(s\) da seleção estão fora do universo/);
  });
});

describe("ocultar clientes — o request muda (EXCLUDE / ONLY)", () => {
  it("excluir cliente altera o request e volta as listas para a 1ª página", () => {
    let state = withCrmReportsOffset(createDefaultCrmReportsUiState(), "overdue", 25);
    state = withCrmReportsSelection(state, hideCheckedCrmReportsCustomers(state.selection, [chip(1), chip(2)]));
    const request = buildCrmReportsOperationalRequest(state);
    assert.deepEqual(request.filters?.customerSelection, { mode: "EXCLUDE", customerIds: [uuid(1), uuid(2)] });
    assert.equal(request.pagination?.overdue?.offset, 0);
  });

  it("ONLY: 'mostrar somente selecionados' manda só os marcados; ocultar dentro do ONLY tira da lista", () => {
    const only = showOnlyCheckedCrmReportsCustomers([chip(3), chip(4), chip(3)]);
    assert.deepEqual(only, { mode: "ONLY", customers: [chip(3), chip(4)] });
    const request = buildCrmReportsOperationalRequest(withCrmReportsSelection(createDefaultCrmReportsUiState(), only));
    assert.deepEqual(request.filters?.customerSelection, { mode: "ONLY", customerIds: [uuid(3), uuid(4)] });
    assert.deepEqual(hideCheckedCrmReportsCustomers(only, [chip(3)]), { mode: "ONLY", customers: [chip(4)] });
    assert.deepEqual(hideCheckedCrmReportsCustomers(only, [chip(3), chip(4)]), {
      mode: "EXCLUDE",
      customers: [chip(3), chip(4)],
    });
  });

  it("modo sem cliente não recorta; busca parte de EXCLUDE; 'Todos' guarda os chips sem aplicar", () => {
    const empty = buildCrmReportsOperationalRequest(
      withCrmReportsSelection(createDefaultCrmReportsUiState(), { mode: "ONLY", customers: [] })
    );
    assert.deepEqual(empty.filters?.customerSelection, { mode: "ALL", customerIds: [] });
    const added = addCrmReportsSelectionCustomer({ mode: "ALL", customers: [] }, chip(5));
    assert.equal(added.mode, "EXCLUDE");
    const kept = buildCrmReportsOperationalRequest(
      withCrmReportsSelection(createDefaultCrmReportsUiState(), { mode: "ALL", customers: [chip(5)] })
    );
    assert.deepEqual(kept.filters?.customerSelection, { mode: "ALL", customerIds: [] });
  });

  it("filtros globais: Responsável Comercial e Vendedor do último pedido vão em campos distintos", () => {
    const state = withCrmReportsFilters(createDefaultCrmReportsUiState(), {
      commercialOwner: { key: "gislene lima", label: "Gislene Lima", filter: { sellerIdentityKey: "gislene lima" } },
      lastOrderSeller: { sellerKey: "501", label: "JOSEANE SOUZA" },
      city: "Curitiba",
      state: "PR",
      customers: [chip(7)],
    });
    const { filters } = buildCrmReportsOperationalRequest(state);
    assert.deepEqual(filters?.commercialOwner, { sellerIdentityKey: "gislene lima" });
    assert.deepEqual(filters?.lastOrderSeller, { sellerKey: "501" });
    assert.deepEqual([filters?.city, filters?.state, filters?.customerIds], [["Curitiba"], ["PR"], [uuid(7)]]);
  });

  it("estado salvo é por usuário: sem id não persiste; CrmModule passa o id da sessão", () => {
    const section = read("src/components/crm/reports/CrmReportsSection.tsx");
    assert.match(section, /scope \? `\$\{CRM_REPORTS_UI_STORAGE_KEY\}:\$\{scope\}` : null/);
    assert.match(section, /if \(!storageKey\) return;/);
    assert.match(read("src/components/CrmModule.tsx"), /storageScope=\{auth\.authUser\?\.id \?\? null\}/);
  });

  it("estado salvo na sessão volta igual; lixo volta ao padrão", () => {
    const state = withCrmReportsSelection(
      withCrmReportsFilters(createDefaultCrmReportsUiState(), { state: "SC" }),
      { mode: "EXCLUDE", customers: [chip(8, "Britânia")] }
    );
    const restored = parseCrmReportsUiState(serializeCrmReportsUiState(state));
    assert.deepEqual(restored?.selection, state.selection);
    assert.equal(restored?.filters.state, "SC");
    assert.equal(parseCrmReportsUiState("{nope"), null);
    const hostile = parseCrmReportsUiState(
      JSON.stringify({ selection: { mode: "DROP", customers: [{ id: "x'; drop", label: "?" }] }, pageSize: 5000 })
    );
    assert.deepEqual(hostile?.selection, { mode: "ALL", customers: [] });
    assert.equal(hostile?.pageSize, 25);
  });
});

describe("listas — rótulos, ações canônicas e paginação", () => {
  it("Responsável Comercial ≠ Vendedor do último pedido (rótulos e colunas explícitos)", () => {
    assert.equal(CRM_REPORTS_FILTER_LABELS.commercialOwner, "Responsável Comercial");
    assert.equal(CRM_REPORTS_FILTER_LABELS.lastOrderSeller, "Vendedor do último pedido");
    const filters = render(
      <CrmReportsGlobalFilters
        filters={createDefaultCrmReportsUiState().filters}
        options={null}
        optionsLoading
        optionsError={null}
        filtersActive={false}
        onChange={() => undefined}
        onClearAll={() => undefined}
      />
    );
    for (const label of ["Cliente", "Responsável Comercial", "Vendedor do último pedido", "Cidade", "UF"]) {
      assert.ok(filters.includes(`>${label}</label>`), label);
    }
    assert.match(filters, /não define carteira/);
    const table = render(
      <CrmRecentCustomersTable
        page={page([recentRow(1)], 1)}
        refreshing={false}
        filtered={false}
        checked={new Map()}
        onToggleChecked={() => undefined}
        onToggleManyChecked={() => undefined}
        onPageChange={() => undefined}
        actions={ACTIONS}
        exporting={null}
        onExport={() => undefined}
      />
    );
    const headers = [...table.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    assert.deepEqual(headers.filter(Boolean), [
      "Cliente",
      "Responsável Comercial",
      "Vendedor do último pedido",
      "Última compra",
      "Dias sem comprar",
      "Pedidos 60d",
      "Venda 60d",
      "Ticket médio",
      "Tempo médio de recompra",
      "Próxima compra esperada",
      "Situação",
      "Ações",
    ]);
    assert.ok(table.includes("Gislene Lima") && table.includes("JOSEANE SOUZA"));
    assert.ok(table.includes("Atrasado · 12 dias"));
  });

  it("Cliente 360 = rota canônica de Inteligência do Cliente; último pedido no modal canônico", () => {
    const table = render(
      <CrmOverdueRepurchaseTable
        page={page([{ ...(recentRow(9) as unknown as CrmReportsOverdueRow), overdueDays: 12, orders12m: 3, purchaseValue12m: 3000.1, averageTicket12m: 1000.03, lastContactAt: null, nextFollowUpAt: null, hasOverdueFollowUp: true }], 1)}
        refreshing={false}
        filtered={false}
        severity="ALL"
        sort="DELAY_DESC"
        onSeverityChange={() => undefined}
        onSortChange={() => undefined}
        checked={new Map()}
        onToggleChecked={() => undefined}
        onToggleManyChecked={() => undefined}
        onPageChange={() => undefined}
        actions={ACTIONS}
        exporting={null}
        onExport={() => undefined}
      />
    );
    assert.ok(table.includes(`href="/crm/customers/${uuid(9)}/intelligence"`));
    assert.ok(table.includes("Cliente 360"));
    assert.ok(table.includes("Último pedido") && table.includes("Registrar contato"));
    assert.ok(table.includes("Sim · atrasado"));
    const section = read("src/components/crm/reports/CrmReportsSection.tsx");
    assert.match(section, /React\.lazy\(\(\) =>\s*\n\s*import\("@\/src\/components\/sales\/SalesOrderDetailDialog"\)/);
    assert.match(section, /<SalesOrderDetailDialog\s*\n\s*open\s*\n\s*salesOrderId=\{detailOrder\.id\}/);
    for (const file of [
      "CrmReportsSection.tsx",
      "CrmReportsShared.tsx",
      "CrmReportBuilder.tsx",
      "CrmRecentCustomersTable.tsx",
      "CrmRepurchaseCadenceTable.tsx",
      "CrmOverdueRepurchaseTable.tsx",
    ]) {
      const src = read(`src/components/crm/reports/${file}`);
      assert.doesNotMatch(src, /CustomerCommercial360|CustomerIntelligencePage|role="dialog"/, file);
    }
  });

  it("sem permissão de destino, a ação some (a UI não oferece o que o backend negaria)", () => {
    const table = render(
      <CrmRecentCustomersTable
        page={page([recentRow(2)], 1)}
        refreshing={false}
        filtered={false}
        checked={new Map()}
        onToggleChecked={() => undefined}
        onToggleManyChecked={() => undefined}
        onPageChange={() => undefined}
        actions={{ ...ACTIONS, canOpenCustomer360: false, canOpenOrderDetail: false, canRegisterContact: false }}
        exporting={null}
        onExport={() => undefined}
      />
    );
    assert.ok(!table.includes("/intelligence"));
    assert.ok(!table.includes("Último pedido") && !table.includes("Registrar contato"));
  });

  it("uma compra só → 'Sem cadência suficiente', sem previsão", () => {
    const table = render(
      <CrmRepurchaseCadenceTable
        page={page(
          [
            {
              ...recentRow(3),
              totalOccasions: 1,
              occasionsUsed: 1,
              intervalsUsed: 0,
              averageRepurchaseDays: null,
              averageRepurchaseDaysRounded: null,
              expectedRepurchaseDate: null,
              deltaDays: null,
              repurchaseStatus: "INSUFFICIENT_HISTORY",
              cadenceConfidence: "NONE",
              orders12m: 1,
              purchaseValue12m: 10,
              averageTicket12m: 10,
            },
          ],
          1
        )}
        refreshing={false}
        filtered={false}
        statuses={[]}
        onStatusesChange={() => undefined}
        checked={new Map()}
        onToggleChecked={() => undefined}
        onToggleManyChecked={() => undefined}
        onPageChange={() => undefined}
        actions={ACTIONS}
        exporting={null}
        onExport={() => undefined}
      />
    );
    assert.ok(table.includes("Sem cadência suficiente"));
    assert.ok(table.includes("Sem histórico")); // confiança NONE
    // A única data na linha é a última compra: nenhuma "próxima compra esperada" inventada.
    assert.deepEqual(table.match(/\d{2}\/\d{2}\/\d{4}/g), ["31/07/2026"]);
    assert.ok(table.includes(">—<"));
  });

  it("paginação real: rótulos vêm de total/offset/returned do backend", () => {
    const html = render(<CrmReportsPagination page={page([recentRow(26)], 26, 25)} onChange={() => undefined} />);
    assert.match(html, /Mostrando 26–26 de <strong[^>]*>26<\/strong>/);
    assert.match(html, /disabled=""[^>]*>[\s\S]*Próxima/);
    const shell = render(
      <CrmRecentCustomersTable
        page={page([recentRow(1), recentRow(2)], 312)}
        refreshing={false}
        filtered={false}
        checked={new Map()}
        onToggleChecked={() => undefined}
        onToggleManyChecked={() => undefined}
        onPageChange={() => undefined}
        actions={ACTIONS}
        exporting={null}
        onExport={() => undefined}
      />
    );
    // Total da lista = 312 (backend), mesmo com 2 linhas na página.
    assert.match(shell, />312 clientes</);
    assert.match(shell, /Mostrando 1–2 de <strong[^>]*>312<\/strong>/);
    const next = buildCrmReportsOperationalRequest(withCrmReportsOffset(createDefaultCrmReportsUiState(), "recent", 25));
    assert.deepEqual(next.pagination?.recent, { limit: 25, offset: 25 });
  });
});

describe("construtor — só spec, execução no clique, modelos válidos no backend", () => {
  it("render inicial: formulário e mensagem, sem tabela", () => {
    const html = render(
      <CrmReportBuilder ui={createDefaultCrmReportsUiState()} windows={WINDOWS} filtersActive={false} canOpenCustomer360 />
    );
    for (const text of ["Relatório personalizado", "Filtros", "Dimensões", "Métricas", "Agrupar por", "Ordenação", "Gerar relatório"]) {
      assert.ok(html.includes(text), text);
    }
    assert.ok(html.includes(CRM_REPORT_BUILDER_EMPTY_MESSAGE));
    assert.doesNotMatch(html, /<table/);
  });

  it("os 8 modelos só preenchem o construtor e todos passam no parser do backend", () => {
    assert.deepEqual(
      CRM_REPORT_TEMPLATES.map((t) => t.label),
      [
        "Vendas por Cliente",
        "Vendas por Responsável Comercial",
        "Vendas por Vendedor do Pedido",
        "Responsável × Vendedor do Pedido",
        "Clientes sem Compra",
        "Evolução Mensal por Cliente",
        "Atrasados para Recompra",
        "Próximos a Recomprar",
      ]
    );
    for (const template of CRM_REPORT_TEMPLATES) {
      const builder = applyCrmReportTemplate(createEmptyCrmReportBuilderState(), template);
      assert.deepEqual(describeCrmReportBuilderIssues(builder), [], template.id);
      const period = resolveCrmReportPeriod(builder, WINDOWS);
      assert.equal(period.ok, true, template.id);
      const body = buildCrmCustomReportRequestBody({
        builder,
        ui: createDefaultCrmReportsUiState(),
        period: period.ok ? period.period : null,
      });
      const parsed = parseCrmCustomReportRequest(body);
      assert.equal(parsed.ok, true, `${template.id}: ${parsed.ok === false ? parsed.errors.join(" ") : ""}`);
    }
  });

  it("período sai das janelas do backend (sem conta de data no navegador)", () => {
    const base = createEmptyCrmReportBuilderState();
    assert.deepEqual(resolveCrmReportPeriod({ ...base, periodPreset: "LAST_12_MONTHS" }, WINDOWS), {
      ok: true,
      period: { from: "2025-09-12", to: "2026-09-11" },
    });
    assert.deepEqual(resolveCrmReportPeriod({ ...base, periodPreset: "LAST_60_DAYS" }, WINDOWS), {
      ok: true,
      period: { from: "2026-07-14", to: "2026-09-11" },
    });
    assert.deepEqual(resolveCrmReportPeriod({ ...base, periodPreset: "CURRENT_YEAR" }, WINDOWS), {
      ok: true,
      period: { from: "2026-01-01", to: "2026-09-11" },
    });
    assert.deepEqual(resolveCrmReportPeriod({ ...base, periodPreset: "PREVIOUS_YEAR" }, WINDOWS), {
      ok: true,
      period: { from: "2025-01-01", to: "2025-12-31" },
    });
    assert.deepEqual(resolveCrmReportPeriod({ ...base, periodPreset: "FULL_HISTORY" }, null), { ok: true, period: null });
    assert.equal(resolveCrmReportPeriod({ ...base, periodPreset: "LAST_12_MONTHS" }, null).ok, false);
    assert.equal(
      resolveCrmReportPeriod({ ...base, periodPreset: "CUSTOM", customFrom: "2026-05-01", customTo: "2026-04-01" }, WINDOWS).ok,
      false
    );
  });

  it("disponibilidade de métrica = contrato do backend; até 3 dimensões; o spec leva os filtros globais", () => {
    let builder = toggleCrmReportDimension(createEmptyCrmReportBuilderState(), "customer");
    builder = toggleCrmReportMetric(builder, "overdueDays");
    assert.deepEqual(builder.metrics, ["overdueDays"]);
    builder = toggleCrmReportDimension(builder, "month"); // cadência deixa de valer por mês
    assert.deepEqual(builder.metrics, []);
    builder = toggleCrmReportMetric(builder, "lastPurchaseDate"); // indisponível com Mês → ignorado
    assert.deepEqual(builder.metrics, []);
    builder = toggleCrmReportDimension(toggleCrmReportDimension(builder, "city"), "state");
    assert.deepEqual(builder.dimensions, ["customer", "month", "city"]);
    const ui = withCrmReportsSelection(createDefaultCrmReportsUiState(), { mode: "EXCLUDE", customers: [chip(1)] });
    const body = buildCrmCustomReportRequestBody({ builder, ui, period: null });
    assert.deepEqual(body.filters?.customerSelection, { mode: "EXCLUDE", customerIds: [uuid(1)] });
  });
});
