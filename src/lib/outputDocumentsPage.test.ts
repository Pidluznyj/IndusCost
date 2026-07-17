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
  classifyOutputDocumentsDetailError,
  classifyOutputDocumentsListError,
  formatOutputDocumentCancellation,
  formatOutputDocumentFinancialStatusLabel,
  formatOutputDocumentItemCode,
  formatOutputDocumentItemDescription,
  formatOutputDocumentItemLinkStatusLabel,
  formatOutputDocumentItemLocalProduct,
  formatOutputDocumentMoney,
  formatOutputDocumentNfe,
  formatOutputDocumentNumber,
  formatOutputDocumentOrdersCount,
  formatOutputDocumentStatusLabel,
  hasActiveOutputDocumentsFilters,
  isOutputDocumentsDateRangeInvalid,
  OUTPUT_DOCUMENTS_BREADCRUMB,
  OUTPUT_DOCUMENTS_PAGE_SIZE,
  OUTPUT_DOCUMENTS_PAGE_SUBTITLE,
  OUTPUT_DOCUMENTS_PAGE_TITLE,
  OUTPUT_DOCUMENTS_ROUTE_PATH,
  outputDocumentFinancialStatusTone,
  parseOutputDocumentsFinancialStatusParam,
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
        company: "",
        customer: "Cliente",
        from: "",
        to: "",
      }),
      true
    );
    assert.equal(
      hasActiveOutputDocumentsFilters({
        search: "",
        company: "",
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
    assert.equal(formatOutputDocumentNfe(gridItem()), "12345");
    assert.equal(
      formatOutputDocumentFinancialStatusLabel("aguardando_cr"),
      "Aguardando CR"
    );
    assert.equal(outputDocumentFinancialStatusTone("vencido"), "rose");
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
        status: "Emitido",
        order: "PD 02534",
        nfe: "12345",
        financialStatus: "aguardando_cr",
        cancelled: "yes",
        hasReceivable: "no",
        sortBy: "dataDocumento",
        sortDir: "desc",
      }),
      "?page=2&pageSize=25&sortBy=dataDocumento&sortDir=desc&cancelled=yes&hasReceivable=no&search=DOC+10&customer=Cliente+A&status=Emitido&order=PD+02534&nfe=12345&financialStatus=aguardando_cr"
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
      "output-documents-denied",
      "output-documents-loading",
      "output-documents-empty",
      "output-documents-empty-filters",
      "output-documents-api-unavailable",
      "output-documents-filters",
      "output-documents-cards",
      "output-documents-grid",
      "output-documents-pagination",
      "output-documents-search",
      "output-documents-from",
      "output-documents-to",
      "output-documents-company",
      "output-documents-customer",
      "output-documents-status",
      "output-documents-order",
      "output-documents-nfe",
      "output-documents-financial-status",
      "output-documents-clear-filters",
      "output-documents-card-documents",
      "output-documents-card-total-value",
      "output-documents-card-with-nfe",
      "output-documents-card-with-receivable",
      "output-documents-card-awaiting-receivable",
      "output-documents-card-cancelled",
    ]) {
      assert.match(source, new RegExp(marker));
    }
    assert.match(source, /AbortController/);
    assert.match(source, /SEARCH_DEBOUNCE_MS/);
    assert.match(source, /useSearchParams/);
    assert.match(source, /setSearchParams/);
    assert.match(source, /OUTPUT_DOCUMENTS_PAGE_SIZE/);
    assert.match(source, /fetchOutputDocumentsList/);
    assert.match(source, /fetchOutputDocumentsSummary/);
    assert.match(source, /selectedDocumentId/);
    assert.match(source, /SystemTotalizerCard/);
  });

  it("grid renderiza colunas principais e marca cancelados", () => {
    const html = renderRow(gridItem());
    assert.match(html, /DS-9001/);
    assert.match(html, /Cliente Fixture/);
    assert.match(html, /KOPPETEL/);
    assert.match(html, /2 pedidos/);
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
          status: 100,
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
      "Código",
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
    assert.match(html, /Sem produto no stage|Sem descrição no stage|Produto Nomus/);
  });

  it("classifica 404 como documento inexistente", () => {
    const classified = classifyOutputDocumentsDetailError(
      new HttpError(404, "not found")
    );
    assert.equal(classified.kind, "not_found");
    assert.match(classified.message, /não encontrado/i);
  });

  it("helpers de item cobrem código, descrição e vínculo local", () => {
    assert.equal(
      formatOutputDocumentItemCode({
        externalProductId: 100,
        externalItemId: 10,
      }),
      "100"
    );
    assert.equal(
      formatOutputDocumentItemDescription({
        externalProductId: null,
        alerts: ["Sem produto no stage"],
      }),
      "Sem produto no stage"
    );
    assert.equal(
      formatOutputDocumentItemLocalProduct({
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
});
