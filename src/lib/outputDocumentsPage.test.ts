import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildGroupedNavigationStructure,
  getModulePath,
  MODULE_MENU_PERMISSION_KEYS,
} from "@/src/lib/navigationGroups.js";
import {
  canAccessModule,
  resolveModuleIdFromPath,
  type PermissionChecker,
} from "@/src/lib/modulePermissions.js";
import { ResourceKeys } from "@/src/lib/permissionsClient.js";
import { resolveSidebarModuleResourceKey } from "@/src/lib/sidebarMenuResources.js";
import { SIDEBAR_MODULE_CONTRACT_KEYS } from "@/src/lib/sidebarEffectiveAccess.js";
import {
  buildOutputDocumentsQueryString,
  OUTPUT_DOCUMENTS_LIST_API_PATH,
  OUTPUT_DOCUMENTS_SUMMARY_API_PATH,
} from "@/src/lib/outputDocumentsClient.js";
import {
  canAccessOutputDocumentsModule,
  canViewOutputDocuments,
  canViewOutputDocumentsRaw,
  classifyOutputDocumentsDetailError,
  classifyOutputDocumentsListError,
  formatOutputDocumentCancellation,
  formatOutputDocumentFinancialStatusLabel,
  formatOutputDocumentItemCode,
  formatOutputDocumentItemDescription,
  formatOutputDocumentItemLinkStatusLabel,
  formatOutputDocumentItemLocalProduct,
  formatOutputDocumentItemSkuLabel,
  formatOutputDocumentMoney,
  formatOutputDocumentNfe,
  formatOutputDocumentNfeCancellation,
  formatOutputDocumentNfeDocumentaryDiffs,
  formatOutputDocumentNfeStatusLabel,
  formatOutputDocumentNumber,
  formatOutputDocumentOrdersCount,
  formatOutputDocumentOrdersLabel,
  formatOutputDocumentStatusLabel,
  hasActiveOutputDocumentsFilters,
  isOutputDocumentsDateRangeInvalid,
  areOutputDocumentsSearchParamsEqual,
  buildOutputDocumentNfeListHref,
  buildOutputDocumentPortfolioAudit360Href,
  resolveOutputDocumentDetailHeaderLinks,
  OUTPUT_DOCUMENTS_BREADCRUMB,
  OUTPUT_DOCUMENTS_PAGE_SIZE,
  OUTPUT_DOCUMENTS_PAGE_SUBTITLE,
  OUTPUT_DOCUMENTS_PAGE_TITLE,
  OUTPUT_DOCUMENTS_ROUTE_PATH,
  outputDocumentFinancialStatusTone,
  outputDocumentStatusTone,
  parseOutputDocumentsFinancialStatusParam,
  applyOutputDocumentsKpiPreset,
  buildOutputDocumentsPageCsv,
  nextOutputDocumentsSortDir,
  parseOutputDocumentsSortByParam,
  parseOutputDocumentsTriStateParam,
} from "@/src/lib/outputDocumentsUi.js";
import { COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import { HttpError } from "@/src/lib/http.js";
import { OutputDocumentGridTableRow } from "@/src/components/commercial/OutputDocumentGridTableRow.js";
import { OutputDocumentDetailContent } from "@/src/components/commercial/OutputDocumentDetailOverlay.js";
import type { OutputDocumentsListItem } from "@/src/lib/output-documents/outputDocumentsListTypes.js";
import type { OutputDocumentDetailPayload } from "@/src/lib/output-documents/outputDocumentsDetailTypes.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (permission) => set.has(permission),
    hasAnyPermission: (permissions) =>
      permissions.some((permission) => set.has(permission)),
  };
}

function gridItem(
  overrides: Partial<OutputDocumentsListItem> = {}
): OutputDocumentsListItem {
  return {
    id: "00000000-0000-4000-8000-000000000201",
    externalId: 9001,
    tipoDocumentoEstoque: "DocumentoSaida",
    dataDocumento: "2026-07-10T12:00:00.000Z",
    documentNumber: "DS-9001",
    statusRaw: "Emitido",
    isCancelled: false,
    idNfe: 501,
    nfeNumber: "12345",
    customerName: "Cliente Fixture",
    personExternalId: 77,
    companyName: "KOPPETEL",
    companyExternalId: 1,
    totalValue: 1500.5,
    allocatedOrdersCount: 2,
    primaryOrderCode: "PD 02590",
    orderCodes: ["PD 02590", "PD 02591"],
    hasReceivable: true,
    financialStatus: "cr_em_aberto",
    receivableOpenValue: 500.25,
    syncedAt: "2026-07-16T12:00:00.000Z",
    ...overrides,
  };
}

function renderRow(item: OutputDocumentsListItem, selected = false): string {
  return renderToStaticMarkup(
    React.createElement(
      "table",
      null,
      React.createElement(
        "tbody",
        null,
        React.createElement(OutputDocumentGridTableRow, {
          item,
          selected,
          onOpen: () => {},
        })
      )
    )
  );
}

describe("output documents navigation", () => {
  it("registra a rota e o ModulePageShell", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="output-documents"/);
    assert.match(app, /OutputDocumentsModule/);
    assert.match(app, new RegExp(OUTPUT_DOCUMENTS_PAGE_TITLE));
    assert.match(app, new RegExp(OUTPUT_DOCUMENTS_PAGE_SUBTITLE));
  });

  it("inclui Documentos de Saída no grupo Comercial", () => {
    const comercial = buildGroupedNavigationStructure().groups.find(
      (group) => group.id === "comercial"
    );
    const item = comercial?.items.find(
      (candidate) => candidate.itemId === "output-documents"
    );
    assert.ok(item);
    assert.equal(item.path, OUTPUT_DOCUMENTS_ROUTE_PATH);
    assert.equal(item.label, OUTPUT_DOCUMENTS_PAGE_TITLE);
    assert.equal(item.resourceKey, ResourceKeys.COMERCIAL_DOCUMENTOS_SAIDA);
    assert.deepEqual(
      [...MODULE_MENU_PERMISSION_KEYS["output-documents"]],
      ["output_documents.view"]
    );
  });

  it("alinha rota, módulo e recursos de proteção", () => {
    assert.equal(getModulePath("output-documents"), OUTPUT_DOCUMENTS_ROUTE_PATH);
    assert.equal(
      resolveModuleIdFromPath(OUTPUT_DOCUMENTS_ROUTE_PATH),
      "output-documents"
    );
    assert.equal(
      resolveSidebarModuleResourceKey("output-documents"),
      ResourceKeys.COMERCIAL_DOCUMENTOS_SAIDA
    );
    assert.deepEqual(SIDEBAR_MODULE_CONTRACT_KEYS["output-documents"], [
      COMMERCIAL_RESOURCE_KEYS.outputDocuments,
    ]);
  });

  it("oculta o módulo sem permissão e libera com view", () => {
    assert.equal(canAccessModule("output-documents", checker([])), false);
    assert.equal(
      canAccessModule(
        "output-documents",
        checker(["output_documents.view"])
      ),
      true
    );
    assert.equal(canAccessOutputDocumentsModule(checker([])), false);
    assert.equal(
      canAccessOutputDocumentsModule(checker(["output_documents.view"])),
      true
    );
  });
});

describe("outputDocumentsUi", () => {
  it("protege pelo recurso canônico ou fallback legado", () => {
    assert.equal(
      canViewOutputDocuments({
        canPerformAction: (resource, action) =>
          resource === COMMERCIAL_RESOURCE_KEYS.outputDocuments &&
          action === "view",
      }),
      true
    );
    assert.equal(
      canViewOutputDocuments({
        canPerformAction: () => false,
        hasPermission: (permission) => permission === "output_documents.view",
      }),
      true
    );
    assert.equal(
      canViewOutputDocuments({ canPerformAction: () => false }),
      false
    );
  });

  it("presets de KPI, sort e CSV da página", () => {
    assert.deepEqual(applyOutputDocumentsKpiPreset("cancelled"), {
      cancelled: "yes",
      hasReceivable: "all",
      financialStatus: null,
    });
    assert.equal(parseOutputDocumentsTriStateParam("yes"), "yes");
    assert.equal(parseOutputDocumentsSortByParam("totalValue"), "totalValue");
    assert.equal(
      nextOutputDocumentsSortDir("totalValue", "desc", "totalValue"),
      "asc"
    );
    const csv = buildOutputDocumentsPageCsv([gridItem()]);
    assert.match(csv, /Documento/);
    assert.match(csv, /DS-9001/);
    assert.match(csv, /Cliente Fixture/);
  });

  it("classifica erros e valida filtros básicos", () => {
    assert.equal(
      classifyOutputDocumentsListError(new HttpError(403, "forbidden")).kind,
      "access_denied"
    );
    assert.equal(
      classifyOutputDocumentsListError(new HttpError(503, "down")).kind,
      "api_unavailable"
    );
    assert.equal(
      classifyOutputDocumentsListError(new TypeError("network")).kind,
      "api_unavailable"
    );
    assert.equal(
      isOutputDocumentsDateRangeInvalid("2026-07-18", "2026-07-17"),
      true
    );
    assert.equal(
      hasActiveOutputDocumentsFilters({
        search: "",
        customer: "Cliente",
        from: "",
        to: "",
      }),
      true
    );
    assert.equal(
      hasActiveOutputDocumentsFilters({
        search: "",
        customer: "",
        from: "",
        to: "",
        year: "2026",
        defaultYear: "2026",
      }),
      false,
      "ano padrão não conta como filtro extra"
    );
    assert.equal(
      hasActiveOutputDocumentsFilters({
        search: "",
        customer: "",
        from: "",
        to: "",
        year: "2025",
        defaultYear: "2026",
      }),
      true
    );
    assert.equal(
      hasActiveOutputDocumentsFilters({
        search: "",
        customer: "",
        from: "",
        to: "",
        financialStatus: "aguardando_cr",
      }),
      true
    );
    assert.equal(
      parseOutputDocumentsFinancialStatusParam("recebido"),
      "recebido"
    );
    assert.equal(parseOutputDocumentsFinancialStatusParam("nope"), null);
  });

  it("formata colunas do grid e status financeiro", () => {
    assert.equal(formatOutputDocumentNumber(gridItem()), "DS-9001");
    assert.equal(
      formatOutputDocumentNumber(gridItem({ documentNumber: null })),
      "9001"
    );
    assert.match(formatOutputDocumentMoney(1500.5), /1\.500,50/);
    assert.equal(formatOutputDocumentMoney(null), "—");
    assert.equal(formatOutputDocumentOrdersCount(2), "2 pedidos");
    assert.equal(formatOutputDocumentOrdersCount(0), "—");
    assert.equal(
      formatOutputDocumentOrdersLabel({
        allocatedOrdersCount: 1,
        primaryOrderCode: "PD 02596",
        orderCodes: ["PD 02596"],
      }),
      "PD 02596"
    );
    assert.equal(
      formatOutputDocumentOrdersLabel({
        allocatedOrdersCount: 2,
        primaryOrderCode: "PD 02590",
        orderCodes: ["PD 02590", "PD 02591"],
      }),
      "PD 02590 +1"
    );
    assert.equal(formatOutputDocumentNfe(gridItem()), "12345");
    assert.equal(
      formatOutputDocumentFinancialStatusLabel("aguardando_cr"),
      "Aguardando CR"
    );
    assert.equal(outputDocumentFinancialStatusTone("vencido"), "rose");
    assert.equal(outputDocumentFinancialStatusTone("aguardando_cr"), "amber");
    assert.equal(outputDocumentFinancialStatusTone("recebido"), "emerald");
    assert.equal(outputDocumentFinancialStatusTone("cancelado"), "rose");
    assert.equal(
      outputDocumentStatusTone(gridItem({ isCancelled: true })),
      "rose"
    );
    assert.equal(
      formatOutputDocumentStatusLabel(gridItem({ isCancelled: true })),
      "Cancelado"
    );
    assert.equal(
      formatOutputDocumentStatusLabel(
        gridItem({ isCancelled: true, statusRaw: null })
      ),
      "Cancelado"
    );
    assert.equal(OUTPUT_DOCUMENTS_PAGE_SIZE, 50);
  });
});

describe("outputDocumentsClient", () => {
  it("expõe paths locais e serializa filtros", () => {
    assert.equal(
      OUTPUT_DOCUMENTS_LIST_API_PATH,
      "/api/commercial/output-documents"
    );
    assert.equal(
      OUTPUT_DOCUMENTS_SUMMARY_API_PATH,
      "/api/commercial/output-documents/summary"
    );
    assert.equal(
      buildOutputDocumentsQueryString({
        page: 2,
        pageSize: 25,
        search: "  DOC 10 ",
        customer: "Cliente A",
        personExternalId: 501,
        status: "Emitido",
        order: "PD 02534",
        nfe: "12345",
        financialStatus: "aguardando_cr",
        cancelled: "yes",
        hasReceivable: "no",
        sortBy: "dataDocumento",
        sortDir: "desc",
      }),
      "?page=2&pageSize=25&sortBy=dataDocumento&sortDir=desc&personExternalId=501&cancelled=yes&hasReceivable=no&search=DOC+10&customer=Cliente+A&status=Emitido&order=PD+02534&nfe=12345&financialStatus=aguardando_cr"
    );
  });

  it("não importa cliente Nomus no bundle", () => {
    const client = read("src/lib/outputDocumentsClient.ts");
    assert.doesNotMatch(client, /nomusClient|fetchNomus|NOMUS_API/);
  });
});

describe("output documents page filters cards and grid", () => {
  it("mantém breadcrumb, filtros, cards e estados básicos", () => {
    const source = read(
      "src/components/commercial/OutputDocumentsModule.tsx"
    );
    assert.match(source, /OUTPUT_DOCUMENTS_BREADCRUMB/);
    assert.equal(OUTPUT_DOCUMENTS_BREADCRUMB, "Comercial / Documentos de Saída");
    for (const marker of [
      "output-documents-loading",
      "output-documents-skeleton",
      "output-documents-empty",
      "output-documents-empty-filters",
      "output-documents-api-unavailable",
      "output-documents-filters",
      "output-documents-cards",
      "output-documents-grid",
      "output-documents-pagination",
      "output-documents-search",
      "output-documents-year",
      "output-documents-month",
      "output-documents-from",
      "output-documents-to",
      "output-documents-customer",
      "output-documents-status",
      "output-documents-order",
      "output-documents-nfe",
      "output-documents-financial-status",
      "output-documents-cancelled",
      "output-documents-has-receivable",
      "output-documents-clear-filters",
      "output-documents-export-csv",
      "output-documents-refresh",
      "output-documents-card-documents",
      "output-documents-card-total-value",
      "output-documents-card-with-nfe",
      "output-documents-card-with-receivable",
      "output-documents-card-awaiting-receivable",
      "output-documents-card-cancelled",
    ]) {
      assert.match(source, new RegExp(marker));
    }
    assert.match(source, /UnauthorizedAccessGate/);
    assert.match(source, /areOutputDocumentsSearchParamsEqual/);
    assert.match(source, /AbortController/);
    assert.match(source, /SEARCH_DEBOUNCE_MS/);
    assert.match(source, /useSearchParams/);
    assert.match(source, /setSearchParams/);
    assert.match(source, /OUTPUT_DOCUMENTS_PAGE_SIZE/);
    assert.match(source, /fetchOutputDocumentsList/);
    assert.match(source, /fetchOutputDocumentsSummary/);
    assert.match(source, /selectedDocumentId/);
    assert.match(source, /documentId/);
    assert.match(source, /SystemTotalizerCard/);
    assert.match(source, /SummaryKpiGrid/);
    assert.match(source, /applyOutputDocumentsKpiPreset/);
    assert.match(source, /sortBy/);
    assert.match(source, /sortDir/);
    assert.match(source, /CustomerAutocompleteFilter/);
    assert.match(source, /buildSalesOrderYearOptions/);
    assert.match(source, /SALES_ORDER_MONTH_OPTIONS/);
    assert.match(source, /String\(currentYear\)/);
    assert.match(source, /output-documents-year/);
    assert.match(source, /output-documents-month/);
    assert.match(source, /customerId/);
    assert.match(
      source,
      /Documento, pedido, NF-e, cliente ou status/
    );
    assert.doesNotMatch(source, /SKU ou status/);
    assert.match(source, /OUTPUT_DOCUMENT_STATUS_RAW_OPTIONS/);
    assert.doesNotMatch(source, /output-documents-company/);
    assert.doesNotMatch(source, /setCompanyDraft/);
  });

  it("grid renderiza colunas principais e marca cancelados", () => {
    const html = renderRow(gridItem());
    assert.match(html, /DS-9001/);
    assert.match(html, /Cliente Fixture/);
    assert.match(html, /KOPPETEL/);
    assert.match(html, /PD 02590 \+1/);
    assert.match(html, /12345/);
    assert.match(html, /CR em aberto/);
    assert.match(html, /output-documents-row-9001/);

    const cancelled = renderRow(
      gridItem({
        isCancelled: true,
        statusRaw: null,
        financialStatus: "cancelado",
      })
    );
    assert.match(cancelled, /data-cancelled="true"/);
    assert.match(cancelled, /Cancelado/);
    assert.match(cancelled, /bg-rose-50/);
  });

  it("alinha scroll, tipografia do grid e estados vazios ao padrão de OP", () => {
    const source = read(
      "src/components/commercial/OutputDocumentsModule.tsx"
    );
    assert.match(source, /output-documents-grid-top-scroll/);
    assert.match(source, /topGridScrollRef/);
    assert.match(source, /gridScrollRef/);
    assert.match(source, /min-w-\[1180px\]/);
    assert.match(source, /space-y-4/);
    assert.match(source, /p-10 text-center text-sm text-muted-foreground/);
    assert.match(source, /bg-muted\/40 text-xs uppercase tracking-wider/);
    assert.match(source, /overflow-x-auto overflow-y-hidden/);
    assert.doesNotMatch(source, /min-w-\[64rem\]/);
  });

  it("badges financeiros e de status usam tons executivos suaves", () => {
    const cancelled = renderRow(
      gridItem({
        isCancelled: true,
        statusRaw: null,
        financialStatus: "cancelado",
      })
    );
    assert.match(cancelled, /bg-rose-50/);
    assert.match(cancelled, /text-rose-800/);
    assert.doesNotMatch(cancelled, /bg-rose-500 text-white/);

    const awaiting = renderRow(
      gridItem({
        isCancelled: false,
        financialStatus: "aguardando_cr",
      })
    );
    assert.match(awaiting, /Aguardando CR/);
    assert.match(awaiting, /bg-amber-50/);
    assert.match(awaiting, /text-amber-900/);
    assert.doesNotMatch(awaiting, /bg-amber-500 text-white/);

    const received = renderRow(
      gridItem({
        isCancelled: false,
        financialStatus: "recebido",
        receivableOpenValue: 0,
      })
    );
    assert.match(received, /Recebido/);
    assert.match(received, /bg-emerald-50/);
    assert.match(received, /text-emerald-800/);
    assert.doesNotMatch(received, /bg-emerald-500 text-white/);
  });

  it("drawer detalhe preserva largura, abas e estados vazios do padrão OP", () => {
    const source = read(
      "src/components/commercial/OutputDocumentDetailOverlay.tsx"
    );
    assert.match(source, /!max-w-\[1400px\]/);
    assert.match(source, /size="full"/);
    assert.match(source, /OverlayBody className="bg-\[color:var\(--color-overlay-surface-muted\)\] px-4 py-4"/);
    assert.match(source, /variant="pill"/);
    assert.match(source, /border-dashed border-border p-5 text-center/);
    assert.match(source, /output-document-detail-orders-empty/);
    assert.match(source, /output-document-detail-nfes-empty/);
  });

  it("paginação usa pageSize do backend e controles Anterior/Próxima", () => {
    const source = read(
      "src/components/commercial/OutputDocumentsModule.tsx"
    );
    assert.match(source, /pageSize:\s*OUTPUT_DOCUMENTS_PAGE_SIZE/);
    assert.match(source, /output-documents-page-prev/);
    assert.match(source, /output-documents-page-next/);
    assert.match(source, /Página \{page\} de \{totalPages\}/);
    assert.match(source, /totalPages > 1/);
  });
});

describe("output documents detail drawer", () => {
  function detailPayload(
    overrides: Partial<OutputDocumentDetailPayload> = {}
  ): OutputDocumentDetailPayload {
    return {
      document: {
        id: "00000000-0000-4000-8000-000000000301",
        externalId: 8451,
        documentNumber: "DS-8451",
        tipoDocumentoEstoque: "DocumentoSaida",
        statusRaw: "Emitido",
        cancellation: {
          isCancelled: false,
          cancelledAt: null,
          reason: null,
        },
        company: { externalId: 1, name: "KOPPETEL" },
        customer: { externalId: 55, name: "Cliente X" },
        dataDocumento: "2026-06-01T00:00:00.000Z",
        movementDate: "2026-06-02T00:00:00.000Z",
        idNfe: 7208,
        paymentTermsRaw: "30 dias",
        totalValue: 100,
        sync: {
          syncedAt: "2026-07-10T10:00:00.000Z",
          firstSeenAt: "2026-07-01T10:00:00.000Z",
          lastSeenAt: "2026-07-10T10:00:00.000Z",
          presentInLastPayload: true,
        },
      },
      items: [
        {
          id: "item-resolved",
          externalItemId: 10,
          externalProductId: 100,
          sku: "SKU-100",
          productName: "Produto Fixture",
          unitCode: "UN",
          quantity: 10,
          unitValue: 5,
          totalValue: 50,
          allocatedValue: 50,
          unallocatedBalance: 0,
          linkStatus: "resolved",
          linkOrigin: "ITEM_EVIDENCE",
          productLink: { externalProductId: 100, hasProductId: true },
          links: [
            {
              salesOrderId: "order-a",
              salesOrderItemId: "soi-a1",
              orderCode: "PD-100",
              allocatedValue: 50,
              quantityUsedForOrder: 10,
              source: "order_to_cash_fact",
            },
          ],
          alerts: [],
        },
        {
          id: "item-unresolved",
          externalItemId: 11,
          externalProductId: null,
          sku: null,
          productName: null,
          unitCode: null,
          quantity: 2,
          unitValue: 25,
          totalValue: 50,
          allocatedValue: 0,
          unallocatedBalance: 50,
          linkStatus: "unresolved",
          linkOrigin: "UNRESOLVED",
          productLink: { externalProductId: null, hasProductId: false },
          links: [],
          alerts: ["Sem produto no stage"],
        },
      ],
      values: {
        totalValue: 100,
        totalValueSource: "stage_header",
        itemsSum: 100,
        allocatedToOrders: 50,
        unallocatedBalance: 50,
        overAllocation: 0,
        coverageStatus: "partial",
      },
      resolution: {
        listedFromStage: true,
        dependsOnO2cForListing: false,
        itemCount: 2,
        itemsResolved: 1,
        itemsUnresolved: 1,
        itemsPartial: 0,
        itemsConflict: 0,
      },
      orders: [],
      allocations: {
        documentTotalValue: 100,
        allocatedToOrders: 50,
        unallocatedBalance: 50,
        overAllocation: 0,
        coveragePercent: 50,
        coverageStatus: "partial",
        orderShares: [],
      },
      nfes: [
        {
          externalId: 7208,
          numero: "98765",
          serie: "1",
          status: 4,
          isCancelled: false,
          dataEmissao: "2026-06-01T00:00:00.000Z",
          dataProcessamento: null,
          totalValue: 100,
          chaveMasked: "****",
          foundLocally: true,
          isPrimary: true,
          sources: [],
        },
      ],
      financial: {
        status: "cr_em_aberto",
        statusReasons: [],
        financialOrigin: "REAL_RECEIVABLE",
        financialOriginReasons: [],
        receivableTotal: 100,
        open: 100,
        received: 0,
        nextDueDate: null,
        installmentCount: 1,
        titles: [],
        documentPaymentTermsRaw: "30 dias",
        alerts: [],
      },
      audit: null,
      inconsistencies: [],
      permissions: {
        canViewFinancial: true,
        canViewAudit: false,
        canViewRaw: false,
      },
      generatedAt: "2026-07-17T12:00:00.000Z",
      ...overrides,
    };
  }

  it("módulo abre o drawer ao selecionar documento", () => {
    const source = read(
      "src/components/commercial/OutputDocumentsModule.tsx"
    );
    assert.match(source, /OutputDocumentDetailOverlay/);
    assert.match(source, /outputDocumentId=\{selectedDocumentId\}/);
    assert.match(source, /setSelectedDocumentId\(null\)/);
  });

  it("preserva dimensões, scroll e cabeçalho do padrão de OP", () => {
    const source = read(
      "src/components/commercial/OutputDocumentDetailOverlay.tsx"
    );
    assert.match(source, /size="full"/);
    assert.match(
      source,
      /h-\[calc\(100vh-2rem\)\] !max-w-\[1400px\] sm:h-\[92vh\]/
    );
    assert.match(source, /OverlayHeader/);
    assert.match(source, /OverlayBody/);
    assert.match(source, /OverlayTabs/);
    assert.match(source, /output-document-detail-drawer/);
    assert.match(source, /output-document-detail-loading/);
    assert.match(source, /output-document-detail-error/);
    assert.match(source, /output-document-detail-not-found/);
    assert.match(source, /fetchOutputDocumentDetail/);
  });

  it("aba Geral renderiza campos e valores principais", () => {
    const html = renderToStaticMarkup(
      React.createElement(OutputDocumentDetailContent, {
        detail: detailPayload(),
        activeTab: "geral",
      })
    );
    assert.match(html, /output-document-detail-general-panel/);
    for (const label of [
      "Documento",
      "Status",
      "Empresa",
      "Cliente",
      "Emissão",
      "Cancelamento",
      "NF-e",
      "Situação financeira",
      "Sincronização",
      "Valor total",
      "Valor dos itens",
      "Valor alocado",
      "Saldo não alocado",
    ]) {
      assert.match(html, new RegExp(label));
    }
    assert.match(html, /DS-8451/);
    assert.match(html, /KOPPETEL/);
    assert.match(html, /Cliente X/);
    assert.match(html, /98765/);
    assert.match(html, /CR em aberto/);
  });

  it("aba Itens mostra resolvidos e não resolvidos", () => {
    const html = renderToStaticMarkup(
      React.createElement(OutputDocumentDetailContent, {
        detail: detailPayload(),
        activeTab: "itens",
      })
    );
    assert.match(html, /output-document-detail-items-panel/);
    assert.match(html, /output-document-detail-items-table/);
    for (const label of [
      "SKU",
      "Descrição",
      "Quantidade",
      "Unidade",
      "Valor unitário",
      "Valor total",
      "Pedido",
      "Item do pedido",
      "Produto local",
      "Estado do vínculo",
    ]) {
      assert.match(html, new RegExp(label));
    }
    assert.match(html, /data-link-status="resolved"/);
    assert.match(html, /data-link-status="unresolved"/);
    assert.match(html, /Não resolvido/);
    assert.match(html, /PD-100/);
    assert.match(html, /SKU-100/);
    assert.match(html, /Produto Fixture/);
    assert.match(html, /Sem produto no stage|Sem descrição no stage|Produto Nomus/);
  });

  it("classifica 404 como documento inexistente", () => {
    const classified = classifyOutputDocumentsDetailError(
      new HttpError(404, "not found")
    );
    assert.equal(classified.kind, "not_found");
    assert.match(classified.message, /não encontrado/i);
  });

  it("helpers de item cobrem SKU, descrição e vínculo local", () => {
    assert.equal(
      formatOutputDocumentItemCode({
        sku: "610.10AA",
        externalProductId: 397,
        externalItemId: 10,
      }),
      "610.10AA"
    );
    assert.equal(
      formatOutputDocumentItemSkuLabel({
        sku: "610.10AA",
        externalProductId: 397,
        externalItemId: 10,
      }),
      "610.10AA"
    );
    assert.equal(
      formatOutputDocumentItemSkuLabel({
        sku: null,
        externalProductId: 397,
        externalItemId: 10,
      }),
      "ID Nomus 397"
    );
    assert.equal(
      formatOutputDocumentItemCode({
        sku: null,
        externalProductId: 100,
        externalItemId: 10,
      }),
      "100"
    );
    assert.equal(
      formatOutputDocumentItemDescription({
        productName: null,
        externalProductId: null,
        alerts: ["Sem produto no stage"],
      }),
      "Sem produto no stage"
    );
    assert.equal(
      formatOutputDocumentItemLocalProduct({
        sku: "610.10AA",
        externalProductId: 397,
        productLink: { externalProductId: 397, hasProductId: true },
      }),
      "610.10AA"
    );
    assert.equal(
      formatOutputDocumentItemLocalProduct({
        sku: null,
        externalProductId: null,
        productLink: { externalProductId: null, hasProductId: false },
      }),
      "Não vinculado"
    );
    assert.equal(
      formatOutputDocumentItemLinkStatusLabel("unresolved"),
      "Não resolvido"
    );
    assert.equal(
      formatOutputDocumentCancellation({
        isCancelled: false,
        cancelledAt: null,
        reason: null,
      }),
      "Não"
    );
  });

  it("abas Pedidos, NF-e e Financeiro consomem o payload do motor", () => {
    const withOrders = detailPayload({
      orders: [
        {
          salesOrderId: "order-a",
          orderCode: "PD-100",
          issueDate: "2026-06-01T00:00:00.000Z",
          status: "Faturado",
          officialSeller: { externalSellerId: 9, name: "Vendedor X" },
          orderValue: 200,
          allocatedValue: 50,
          coveragePercent: 50,
          sources: ["order_to_cash_fact"],
        },
      ],
      allocations: {
        documentTotalValue: 100,
        allocatedToOrders: 50,
        unallocatedBalance: 50,
        overAllocation: 0,
        coveragePercent: 50,
        coverageStatus: "partial",
        orderShares: [
          {
            salesOrderId: "order-a",
            orderCode: "PD-100",
            allocatedValue: 50,
            shareOfDocumentPercent: 50,
          },
        ],
      },
    });

    const pedidos = renderToStaticMarkup(
      React.createElement(OutputDocumentDetailContent, {
        detail: withOrders,
        activeTab: "pedidos",
        onOpenSalesOrder: () => {},
      })
    );
    assert.match(pedidos, /output-document-detail-orders-panel/);
    assert.match(pedidos, /PD-100/);
    assert.match(pedidos, /Abrir pedido/);
    assert.match(pedidos, /Vendedor X/);
    assert.match(pedidos, /50\.0%/);

    const nfes = renderToStaticMarkup(
      React.createElement(OutputDocumentDetailContent, {
        detail: withOrders,
        activeTab: "nfes",
      })
    );
    assert.match(nfes, /output-document-detail-nfes-panel/);
    assert.match(nfes, /98765/);
    assert.match(nfes, /Diferenças documentais/);
    assert.match(nfes, /Cancelamento/);
    assert.match(nfes, /Autorizada/);
    assert.doesNotMatch(nfes, /Status 4/);

    const financeiro = renderToStaticMarkup(
      React.createElement(OutputDocumentDetailContent, {
        detail: withOrders,
        activeTab: "financeiro",
      })
    );
    assert.match(financeiro, /output-document-detail-financial-panel/);
    assert.match(financeiro, /CR em aberto/);
    assert.match(financeiro, /CR total/);
  });

  it("Financeiro e Auditoria respeitam permissões negadas", () => {
    const denied = detailPayload({
      financial: null,
      audit: null,
      permissions: {
        canViewFinancial: false,
        canViewAudit: false,
        canViewRaw: false,
      },
    });

    const financeiro = renderToStaticMarkup(
      React.createElement(OutputDocumentDetailContent, {
        detail: denied,
        activeTab: "financeiro",
      })
    );
    assert.match(financeiro, /output-document-detail-financial-denied/);

    const auditoria = renderToStaticMarkup(
      React.createElement(OutputDocumentDetailContent, {
        detail: denied,
        activeTab: "auditoria",
      })
    );
    assert.match(auditoria, /output-document-detail-audit-denied/);
  });

  it("abas vazias e aguardando materialização do CR", () => {
    const empty = detailPayload({
      orders: [],
      nfes: [],
      financial: {
        status: "aguardando_cr",
        statusReasons: [],
        financialOrigin: "NONE",
        financialOriginReasons: [],
        receivableTotal: 0,
        open: 0,
        received: 0,
        nextDueDate: null,
        installmentCount: 0,
        titles: [],
        documentPaymentTermsRaw: null,
        alerts: [],
      },
    });

    assert.match(
      renderToStaticMarkup(
        React.createElement(OutputDocumentDetailContent, {
          detail: empty,
          activeTab: "pedidos",
        })
      ),
      /output-document-detail-orders-empty/
    );
    assert.match(
      renderToStaticMarkup(
        React.createElement(OutputDocumentDetailContent, {
          detail: empty,
          activeTab: "nfes",
        })
      ),
      /output-document-detail-nfes-empty/
    );

    const financeiro = renderToStaticMarkup(
      React.createElement(OutputDocumentDetailContent, {
        detail: empty,
        activeTab: "financeiro",
      })
    );
    assert.match(financeiro, /output-document-detail-awaiting-cr/);
    assert.match(financeiro, /Aguardando materialização do CR/);
    assert.match(financeiro, /output-document-detail-financial-titles-empty/);
  });

  it("múltiplos vínculos e auditoria com raw sob permissão", () => {
    const multi = detailPayload({
      orders: [
        {
          salesOrderId: "order-a",
          orderCode: "PD-100",
          issueDate: "2026-06-01T00:00:00.000Z",
          status: "Faturado",
          officialSeller: { externalSellerId: 9, name: "Vendedor X" },
          orderValue: 200,
          allocatedValue: 40,
          coveragePercent: 40,
          sources: ["order_to_cash_fact"],
        },
        {
          salesOrderId: "order-b",
          orderCode: "PD-200",
          issueDate: "2026-06-02T00:00:00.000Z",
          status: "Aberto",
          officialSeller: { externalSellerId: 10, name: "Vendedor Y" },
          orderValue: 80,
          allocatedValue: 10,
          coveragePercent: 10,
          sources: ["sales_order_nfe_link"],
        },
      ],
      nfes: [
        {
          externalId: 7208,
          numero: "98765",
          serie: "1",
          status: 4,
          isCancelled: false,
          dataEmissao: "2026-06-01T00:00:00.000Z",
          dataProcessamento: "2026-06-01T12:00:00.000Z",
          totalValue: 100,
          chaveMasked: "****1111",
          foundLocally: true,
          isPrimary: true,
          sources: ["stock_document_idNfe"],
        },
        {
          externalId: 7209,
          numero: "98766",
          serie: "1",
          status: 7,
          isCancelled: true,
          dataEmissao: "2026-06-03T00:00:00.000Z",
          dataProcessamento: null,
          totalValue: 50,
          chaveMasked: "****2222",
          foundLocally: false,
          isPrimary: false,
          sources: [],
        },
      ],
      inconsistencies: [
        {
          code: "NFE_MISSING_LOCAL",
          severity: "warning",
          message: "NF-e 7209 referenciada, mas ausente no stage local.",
        },
      ],
      financial: {
        status: "parcialmente_recebido",
        statusReasons: [],
        financialOrigin: "REAL_RECEIVABLE",
        financialOriginReasons: [],
        receivableTotal: 100,
        open: 40,
        received: 60,
        nextDueDate: "2026-07-01T00:00:00.000Z",
        installmentCount: 2,
        titles: [
          {
            receivableExternalId: 1,
            sourceInvoiceId: 7208,
            amountReceivable: 60,
            amountReceivableCents: 6000,
            amountReceived: 60,
            amountReceivedCents: 6000,
            balanceReceivable: 0,
            balanceReceivableCents: 0,
            dueDate: "2026-06-15T00:00:00.000Z",
            settlementDate: "2026-06-14T00:00:00.000Z",
            settlement: "recebido",
            dueStatus: "nao_aplicavel",
            alerts: [],
          },
          {
            receivableExternalId: 2,
            sourceInvoiceId: 7208,
            amountReceivable: 40,
            amountReceivableCents: 4000,
            amountReceived: 0,
            amountReceivedCents: 0,
            balanceReceivable: 40,
            balanceReceivableCents: 4000,
            dueDate: "2026-07-01T00:00:00.000Z",
            settlementDate: null,
            settlement: "aberto",
            dueStatus: "a_vencer",
            alerts: [],
          },
        ],
        documentPaymentTermsRaw: "30/60",
        alerts: [],
      },
      audit: {
        stockDocumentId: "00000000-0000-4000-8000-000000000301",
        stockDocumentExternalId: 8451,
        idNfe: 7208,
        payloadHash: "hash-abc",
        firstSeenAt: "2026-07-01T10:00:00.000Z",
        lastSeenAt: "2026-07-10T10:00:00.000Z",
        presentInLastPayload: true,
        syncedAt: "2026-07-10T10:00:00.000Z",
        nfeLink: {
          classification: "persistido",
          sources: ["stock_document_idNfe"],
          reasons: [],
        },
        ordersLink: {
          classification: "derivado",
          sources: ["order_to_cash_fact", "sales_order_nfe_link"],
          reasons: ["dois pedidos"],
        },
        receivablesLink: {
          classification: "derivado",
          sources: ["order_to_cash_fact"],
          reasons: [],
        },
        o2cPresent: true,
        o2cRunIds: ["run-1"],
        conflicts: ["alocação parcial entre pedidos"],
      },
      permissions: {
        canViewFinancial: true,
        canViewAudit: true,
        canViewRaw: true,
      },
      raw: {
        document: { externalId: 8451 },
        items: [{ id: "item-resolved" }],
      },
    });

    const pedidos = renderToStaticMarkup(
      React.createElement(OutputDocumentDetailContent, {
        detail: multi,
        activeTab: "pedidos",
        onOpenSalesOrder: () => {},
      })
    );
    assert.match(pedidos, /PD-100/);
    assert.match(pedidos, /PD-200/);
    assert.match(pedidos, /output-document-detail-open-order-order-a/);

    const nfes = renderToStaticMarkup(
      React.createElement(OutputDocumentDetailContent, {
        detail: multi,
        activeTab: "nfes",
      })
    );
    assert.match(nfes, /98765/);
    assert.match(nfes, /98766/);
    assert.match(nfes, /Ausente no stage local/);

    const financeiro = renderToStaticMarkup(
      React.createElement(OutputDocumentDetailContent, {
        detail: multi,
        activeTab: "financeiro",
      })
    );
    assert.match(financeiro, /output-document-detail-financial-titles/);
    assert.match(financeiro, /Parcialmente recebido/);

    const auditoria = renderToStaticMarkup(
      React.createElement(OutputDocumentDetailContent, {
        detail: multi,
        activeTab: "auditoria",
      })
    );
    assert.match(auditoria, /output-document-detail-audit-panel/);
    assert.match(auditoria, /hash-abc/);
    assert.match(auditoria, /output-document-detail-audit-conflicts/);
    assert.match(auditoria, /output-document-detail-raw-json/);
    assert.match(auditoria, /8451/);

    const auditNoRaw = renderToStaticMarkup(
      React.createElement(OutputDocumentDetailContent, {
        detail: {
          ...multi,
          permissions: {
            canViewFinancial: true,
            canViewAudit: true,
            canViewRaw: false,
          },
          raw: null,
        },
        activeTab: "auditoria",
      })
    );
    assert.match(auditNoRaw, /output-document-detail-raw-denied/);
  });

  it("módulo abre pedido via dialog e overlay não chama Nomus", () => {
    const moduleSource = read(
      "src/components/commercial/OutputDocumentsModule.tsx"
    );
    assert.match(moduleSource, /SalesOrderDetailDialog/);
    assert.match(moduleSource, /onOpenSalesOrder=\{openSalesOrderDetail\}/);
    assert.match(moduleSource, /onOpenNfe=\{openNfeInList\}/);
    assert.match(moduleSource, /dismissOnEsc=\{salesOrderDetailId == null\}/);

    const overlay = read(
      "src/components/commercial/OutputDocumentDetailOverlay.tsx"
    );
    assert.doesNotMatch(overlay, /nomusClient|fetchNomus|NOMUS_API/);
    assert.match(overlay, /Pedidos de Venda/);
    assert.match(overlay, /includeRaw/);
    assert.match(overlay, /OUTPUT_DOCUMENT_AWAITING_CR_MESSAGE/);
    assert.match(overlay, /canViewOutputDocumentsRaw/);
  });

  it("helpers de NF-e e permissão raw", () => {
    assert.equal(
      formatOutputDocumentNfeStatusLabel({ status: 4, isCancelled: false }),
      "Autorizada"
    );
    assert.equal(
      formatOutputDocumentNfeStatusLabel({ status: 7, isCancelled: true }),
      "Cancelada"
    );
    assert.equal(
      formatOutputDocumentNfeStatusLabel({ status: null, isCancelled: false }),
      "Ativa"
    );
    assert.equal(
      formatOutputDocumentNfeCancellation({ isCancelled: true }),
      "Cancelada"
    );
    assert.match(
      formatOutputDocumentNfeDocumentaryDiffs(
        {
          externalId: 7209,
          numero: "98766",
          foundLocally: false,
          isCancelled: true,
        },
        [
          {
            code: "NFE_MISSING_LOCAL",
            message: "NF-e 7209 referenciada, mas ausente no stage local.",
          },
        ]
      ),
      /Ausente no stage local/
    );
    assert.equal(
      canViewOutputDocumentsRaw({
        hasPermission: (p) => p === "output_documents.raw.view",
      }),
      true
    );
    assert.equal(
      canViewOutputDocumentsRaw({ hasPermission: () => false }),
      false
    );
  });
});

describe("output documents page interactions", () => {
  it("preserva filtros ao sincronizar URL e deep link do documento", () => {
    const a = new URLSearchParams(
      "page=2&company=KOPPETEL&documentId=00000000-0000-4000-8000-000000000301"
    );
    const b = new URLSearchParams(
      "documentId=00000000-0000-4000-8000-000000000301&company=KOPPETEL&page=2"
    );
    assert.equal(areOutputDocumentsSearchParamsEqual(a, b), true);
    assert.equal(
      areOutputDocumentsSearchParamsEqual(a, new URLSearchParams("page=2")),
      false
    );

    const moduleSource = read(
      "src/components/commercial/OutputDocumentsModule.tsx"
    );
    assert.match(moduleSource, /areOutputDocumentsSearchParamsEqual/);
    assert.match(
      moduleSource,
      /setSelectedDocumentId\(\(current\) => \(current === fromUrl \? current : fromUrl\)\)/
    );
    assert.match(moduleSource, /setSelectedDocumentId\(null\)/);
  });

  it("drawer expõe voltar, copiar, atualizar e links oficiais", () => {
    const overlay = read(
      "src/components/commercial/OutputDocumentDetailOverlay.tsx"
    );
    assert.match(overlay, /output-document-detail-nav/);
    assert.match(overlay, /output-document-detail-back-list/);
    assert.match(overlay, /output-document-detail-copy-number/);
    assert.match(overlay, /output-document-detail-refresh/);
    assert.match(overlay, /output-document-detail-retry/);
    assert.match(overlay, /navigator\.clipboard\.writeText/);
    assert.match(overlay, /resolveOutputDocumentDetailHeaderLinks/);
  });

  it("links de NF-e e Auditoria 360 respeitam filtros e permissão", () => {
    const current = new URLSearchParams(
      "company=KOPPETEL&page=3&documentId=abc"
    );
    const nfeHref = buildOutputDocumentNfeListHref(
      { numero: "98765", externalId: 7208 },
      current
    );
    assert.match(nfeHref, /nfe=98765/);
    assert.match(nfeHref, /company=KOPPETEL/);
    assert.doesNotMatch(nfeHref, /documentId=/);
    assert.doesNotMatch(nfeHref, /page=/);

    assert.equal(
      buildOutputDocumentPortfolioAudit360Href("order-a"),
      "/finance/portfolio-reconciliation?auditOrderId=order-a"
    );

    const denied = resolveOutputDocumentDetailHeaderLinks(
      {
        nfes: [
          {
            numero: "98765",
            externalId: 7208,
            isPrimary: true,
          },
        ],
        orders: [{ salesOrderId: "order-a" }],
      },
      { canOpenPortfolioAudit360: false },
      { currentSearchParams: current }
    );
    assert.equal(denied.length, 1);
    assert.equal(denied[0]?.id, "nfe");

    const allowed = resolveOutputDocumentDetailHeaderLinks(
      {
        nfes: [
          {
            numero: "98765",
            externalId: 7208,
            isPrimary: true,
          },
        ],
        orders: [{ salesOrderId: "order-a" }],
      },
      { canOpenPortfolioAudit360: true }
    );
    assert.equal(allowed.length, 2);
    assert.ok(allowed.some((link) => link.id === "portfolio_audit_360"));
  });

  it("acesso negado usa o gate oficial com redirecionamento", () => {
    const moduleSource = read(
      "src/components/commercial/OutputDocumentsModule.tsx"
    );
    assert.match(moduleSource, /UnauthorizedAccessGate/);
    assert.match(moduleSource, /forceDenied/);
    assert.doesNotMatch(moduleSource, /output-documents-denied/);
  });
});
