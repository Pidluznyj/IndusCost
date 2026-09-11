/**
 * CRM > Relatórios — exportação CSV/XLSX (shell de I/O).
 *
 * Exporta com o MESMO spec da tela: mesmo `runCrmReportsAnalysis` (escopo,
 * carteira, filtros, exclusões), mesmas visões (`applyCrmReportsViews`) e os
 * mesmos mapeadores de DTO das listas — nenhuma consulta paralela com regra
 * própria. A diferença para a tela é só a paginação: exporta a lista inteira,
 * com enriquecimento em lote.
 */

import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { CrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope.js";
import { buildSalesOrderSellerFilterOptionLabel } from "@/src/lib/salesOrderNomusSellerDisplay.js";
import { resolveCommercialOwnerDisplay } from "@/src/lib/commercial/commercialPersonIdentityResolver.js";
import {
  CRM_REPORTS_ID_CHUNK_SIZE,
  CRM_REPORTS_VALIDITY_SOURCE,
  buildCrmReportsSourceInfo,
  loadCrmReportsFollowUpsInBatches,
  resolveAuthorizedCustomerWhere,
  resolveCrmReportsOwnersInBatches,
  runCrmReportsAnalysis,
  toOwnerDisplay,
  toSellerDisplay,
  type CrmReportsDataSource,
  type CrmReportsRun,
  type CrmReportsRunOptions,
} from "@/src/lib/commercial/crmReportsOperationalService.server.js";
import { runCrmCustomReport } from "@/src/lib/commercial/crmCustomReportService.server.js";
import {
  applyCrmReportsViews,
  toCrmReportsCadenceRow,
  toCrmReportsOverdueRow,
  toCrmReportsRecent60dRow,
} from "@/src/lib/commercial/crmReportsOperationalCore.js";
import {
  CRM_CADENCE_CONFIDENCE_LABELS,
  CRM_REPORTS_OVERDUE_SEVERITY_LABELS,
  CRM_REPORTS_OVERDUE_SORT_LABELS,
  CRM_REPURCHASE_STATUS_LABELS,
  formatCrmRepurchaseSituation,
} from "@/src/lib/commercial/crmReportsLabels.js";
import {
  buildCrmReportsExportCsv,
  buildCrmReportsExportWorkbook,
  crmReportsExportFilename,
  crmReportsWorkbookToBytes,
  formatCrmReportsBusinessDate,
  type CrmReportsExportColumn,
  type CrmReportsExportFormat,
  type CrmReportsExportMetadata,
  type CrmReportsExportTable,
  type CrmReportsExportValue,
} from "@/src/lib/commercial/crmReportsExport.js";
import {
  CRM_CUSTOM_REPORT_CUSTOMER_STATUS_LABELS,
  CRM_CUSTOM_REPORT_DIMENSION_LABELS,
  CRM_CUSTOM_REPORT_METRIC_LABELS,
  type CrmCustomReportSpec,
  type CrmReportsCadenceRow,
  type CrmReportsListKey,
  type CrmReportsNormalizedFilters,
  type CrmReportsNormalizedRequest,
  type CrmReportsOverdueRow,
  type CrmReportsRecent60dRow,
} from "@/src/lib/commercial/crmReportsTypes.js";

export type CrmReportsExportFile = {
  filename: string;
  contentType: string;
  body: string | Uint8Array;
  rowCount: number;
};

const LIST_TITLES: Record<CrmReportsListKey, string> = {
  recent: "Compraram nos últimos 60 dias",
  cadence: "Ciclo de recompra",
  overdue: "Atrasados para recompra",
};

const LIST_SLUGS: Record<CrmReportsListKey, string> = {
  recent: "compraram-60d",
  cadence: "ciclo-recompra",
  overdue: "atrasados-recompra",
};

const CONTENT_TYPES: Record<CrmReportsExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// ---------------------------------------------------------------------------
// Colunas das listas (os mesmos rótulos da tela)
// ---------------------------------------------------------------------------

type ListColumn<Row> = CrmReportsExportColumn & { value: (row: Row) => CrmReportsExportValue };

const situation = (row: { repurchaseStatus: CrmReportsRecent60dRow["repurchaseStatus"]; deltaDays: number | null }) =>
  formatCrmRepurchaseSituation(row.repurchaseStatus, row.deltaDays);

const RECENT_COLUMNS: Array<ListColumn<CrmReportsRecent60dRow>> = [
  { key: "displayName", label: "Cliente", format: "text", value: (r) => r.displayName },
  { key: "taxId", label: "CNPJ/CPF", format: "text", value: (r) => r.taxId },
  { key: "city", label: "Cidade", format: "text", value: (r) => r.city },
  { key: "state", label: "UF", format: "text", value: (r) => r.state },
  { key: "commercialOwnerName", label: "Responsável Comercial", format: "text", value: (r) => r.commercialOwnerName ?? "Sem responsável comercial" },
  { key: "lastOrderSellerLabel", label: "Vendedor do último pedido", format: "text", value: (r) => r.lastOrderSellerLabel },
  { key: "lastOrderCode", label: "Último pedido", format: "text", value: (r) => r.lastOrderCode },
  { key: "lastPurchaseDate", label: "Última compra", format: "date", value: (r) => r.lastPurchaseDate },
  { key: "daysSinceLastPurchase", label: "Dias sem comprar", format: "days", value: (r) => r.daysSinceLastPurchase },
  { key: "orders60d", label: "Pedidos 60d", format: "integer", value: (r) => r.orders60d },
  { key: "purchaseValue60d", label: "Venda 60d", format: "money", value: (r) => r.purchaseValue60d },
  { key: "averageTicket60d", label: "Ticket médio 60d", format: "money", value: (r) => r.averageTicket60d },
  { key: "averageRepurchaseDays", label: "Tempo médio de recompra (dias)", format: "decimal-days", value: (r) => r.averageRepurchaseDays },
  { key: "expectedRepurchaseDate", label: "Próxima compra esperada", format: "date", value: (r) => r.expectedRepurchaseDate },
  { key: "deltaDays", label: "Desvio (dias)", format: "days", value: (r) => r.deltaDays },
  { key: "situation", label: "Situação", format: "text", value: situation },
  { key: "cadenceConfidence", label: "Confiança", format: "text", value: (r) => CRM_CADENCE_CONFIDENCE_LABELS[r.cadenceConfidence] },
];

const CADENCE_COLUMNS: Array<ListColumn<CrmReportsCadenceRow>> = [
  { key: "displayName", label: "Cliente", format: "text", value: (r) => r.displayName },
  { key: "taxId", label: "CNPJ/CPF", format: "text", value: (r) => r.taxId },
  { key: "commercialOwnerName", label: "Responsável Comercial", format: "text", value: (r) => r.commercialOwnerName ?? "Sem responsável comercial" },
  { key: "occasionsUsed", label: "Ocasiões analisadas", format: "integer", value: (r) => r.occasionsUsed },
  { key: "totalOccasions", label: "Ocasiões no histórico", format: "integer", value: (r) => r.totalOccasions },
  { key: "averageRepurchaseDays", label: "Tempo médio de recompra (dias)", format: "decimal-days", value: (r) => r.averageRepurchaseDays },
  { key: "lastPurchaseDate", label: "Última compra", format: "date", value: (r) => r.lastPurchaseDate },
  { key: "expectedRepurchaseDate", label: "Próxima compra esperada", format: "date", value: (r) => r.expectedRepurchaseDate },
  { key: "deltaDays", label: "Desvio (dias)", format: "days", value: (r) => r.deltaDays },
  { key: "cadenceConfidence", label: "Confiança", format: "text", value: (r) => CRM_CADENCE_CONFIDENCE_LABELS[r.cadenceConfidence] },
  { key: "situation", label: "Situação", format: "text", value: situation },
  { key: "orders12m", label: "Pedidos 12m", format: "integer", value: (r) => r.orders12m },
  { key: "purchaseValue12m", label: "Venda 12m", format: "money", value: (r) => r.purchaseValue12m },
  { key: "averageTicket12m", label: "Ticket médio 12m", format: "money", value: (r) => r.averageTicket12m },
];

const OVERDUE_COLUMNS: Array<ListColumn<CrmReportsOverdueRow>> = [
  { key: "displayName", label: "Cliente", format: "text", value: (r) => r.displayName },
  { key: "taxId", label: "CNPJ/CPF", format: "text", value: (r) => r.taxId },
  { key: "commercialOwnerName", label: "Responsável Comercial", format: "text", value: (r) => r.commercialOwnerName ?? "Sem responsável comercial" },
  { key: "lastOrderSellerLabel", label: "Vendedor do último pedido", format: "text", value: (r) => r.lastOrderSellerLabel },
  { key: "lastOrderCode", label: "Último pedido", format: "text", value: (r) => r.lastOrderCode },
  { key: "lastPurchaseDate", label: "Última compra", format: "date", value: (r) => r.lastPurchaseDate },
  { key: "averageRepurchaseDays", label: "Ciclo médio (dias)", format: "decimal-days", value: (r) => r.averageRepurchaseDays },
  { key: "expectedRepurchaseDate", label: "Deveria ter comprado em", format: "date", value: (r) => r.expectedRepurchaseDate },
  { key: "overdueDays", label: "Atraso (dias)", format: "days", value: (r) => r.overdueDays },
  { key: "cadenceConfidence", label: "Confiança", format: "text", value: (r) => CRM_CADENCE_CONFIDENCE_LABELS[r.cadenceConfidence] },
  { key: "situation", label: "Situação", format: "text", value: situation },
  { key: "orders12m", label: "Compras 12m", format: "integer", value: (r) => r.orders12m },
  { key: "purchaseValue12m", label: "Venda 12m", format: "money", value: (r) => r.purchaseValue12m },
  { key: "averageTicket12m", label: "Ticket médio 12m", format: "money", value: (r) => r.averageTicket12m },
  { key: "lastContactAt", label: "Último contato", format: "date", value: (r) => r.lastContactAt },
  { key: "nextFollowUpAt", label: "Próximo follow-up", format: "date", value: (r) => r.nextFollowUpAt },
  { key: "hasOverdueFollowUp", label: "Follow-up atrasado", format: "boolean", value: (r) => r.hasOverdueFollowUp },
];

function toTable<Row>(columns: Array<ListColumn<Row>>, rows: Row[]): CrmReportsExportTable {
  return {
    columns: columns.map(({ key, label, format }) => ({ key, label, format })),
    rows: rows.map((row) => Object.fromEntries(columns.map((c) => [c.key, c.value(row) ?? null]))),
  };
}

// ---------------------------------------------------------------------------
// Metadados legíveis (filtros, clientes selecionados)
// ---------------------------------------------------------------------------

/**
 * Rótulos (nome — CNPJ) SÓ de clientes do universo autorizado do usuário.
 * ID de outra carteira enviado na seleção vira "(fora do universo)" — o
 * arquivo nunca revela cliente que o usuário não pode ver.
 */
async function resolveCustomerLabels(
  ds: CrmReportsDataSource,
  scope: CrmCommercialAccessScope,
  ids: readonly string[]
): Promise<Array<{ id: string; label: string }>> {
  if (ids.length === 0) return [];
  const found = new Map<string, string>();
  const authorizedWhere = await resolveAuthorizedCustomerWhere(ds, scope);
  if (authorizedWhere) {
    for (let i = 0; i < ids.length; i += CRM_REPORTS_ID_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CRM_REPORTS_ID_CHUNK_SIZE);
      const rows = await ds.searchCustomers({ AND: [authorizedWhere, { id: { in: [...chunk] } }] }, chunk.length);
      for (const row of rows) found.set(row.id, `${row.companyName}${row.taxId ? ` — ${row.taxId}` : ""}`);
    }
  }
  return ids.map((id) => ({ id, label: found.get(id) ?? "(fora do universo — ignorado)" }));
}

async function describeFilters(
  ds: CrmReportsDataSource,
  run: CrmReportsRun,
  filters: CrmReportsNormalizedFilters,
  customerLabels: Map<string, string>
): Promise<Array<{ label: string; value: string }>> {
  const lines: Array<{ label: string; value: string }> = [];
  if (filters.customerIds.length > 0) {
    const names = filters.customerIds.slice(0, 50).map((id) => customerLabels.get(id) ?? id);
    lines.push({
      label: "Cliente",
      value: `${filters.customerIds.length} cliente(s): ${names.join("; ")}${filters.customerIds.length > 50 ? "; …" : ""}`,
    });
  }
  if (filters.commercialOwner) {
    if (run.scope.commercialOwnerFilterIgnored) {
      lines.push({ label: "Responsável Comercial", value: "Ignorado — escopo de carteira própria" });
    } else {
      const owners = await ds.findActiveCommercialOwners();
      const match = owners.find((o) =>
        filters.commercialOwner!.sellerIdentityKey
          ? o.sellerIdentityKey === filters.commercialOwner!.sellerIdentityKey
          : filters.commercialOwner!.externalSellerId != null && o.sellerExternalId === filters.commercialOwner!.externalSellerId
      );
      const label = match
        ? resolveCommercialOwnerDisplay({
            rawId: match.sellerExternalId,
            rawName: match.sellerResponsibleName,
            canonicalName: match.sellerCanonicalName,
            source: "CRM",
          }).displayName
        : filters.commercialOwner.sellerIdentityKey ?? `ID Nomus ${filters.commercialOwner.externalSellerId}`;
      lines.push({ label: "Responsável Comercial", value: label });
    }
  }
  if (filters.lastOrderSeller) {
    const { sellerKey, sellerName } = filters.lastOrderSeller;
    let value = "";
    if (sellerKey === "__NO_SELLER__") value = "Sem vendedor no pedido Nomus";
    else if (sellerKey) {
      const ctx = await run.loadSellerContext();
      value = `${buildSalesOrderSellerFilterOptionLabel(Number(sellerKey), ctx)} (ID Nomus ${sellerKey})`;
    } else if (sellerName) value = `busca "${sellerName}"`;
    lines.push({ label: "Vendedor do último pedido", value });
  }
  if (filters.cities.length > 0) lines.push({ label: "Cidade", value: filters.cities.join(", ") });
  if (filters.states.length > 0) lines.push({ label: "UF", value: filters.states.join(", ") });
  return lines;
}

async function buildMetadata(args: {
  ds: CrmReportsDataSource;
  scope: CrmCommercialAccessScope;
  auth: AppAuthContext;
  run: CrmReportsRun;
  filters: CrmReportsNormalizedFilters;
  title: string;
  extraFilterLines: Array<{ label: string; value: string }>;
}): Promise<CrmReportsExportMetadata> {
  const { ds, scope, auth, run, filters } = args;
  const selectionIds = filters.customerSelection.mode === "ALL" ? [] : filters.customerSelection.customerIds;
  const labelIds = [...new Set([...selectionIds, ...filters.customerIds])];
  const labeled = await resolveCustomerLabels(ds, scope, labelIds);
  const labelMap = new Map(labeled.map((c) => [c.id, c.label]));
  const sourceInfo = buildCrmReportsSourceInfo(run);
  const w = run.analysis.windows;
  const notes: string[] = [];
  if (run.analysis.selection.idsOutsideUniverse > 0) {
    notes.push(`${run.analysis.selection.idsOutsideUniverse} cliente(s) da seleção fora do universo filtrado — ignorados.`);
  }
  if (sourceInfo.futureDatedOrdersIgnored > 0) {
    notes.push(`${sourceInfo.futureDatedOrdersIgnored} pedido(s) com emissão depois de hoje ficaram fora das janelas.`);
  }
  if (run.scope.blockedReason === "SELLER_NOT_LINKED") {
    notes.push("Usuário sem vínculo de Responsável Comercial — carteira vazia.");
  }
  return {
    title: args.title,
    generatedAt: run.now,
    timeZone: sourceInfo.businessTimeZone,
    userLabel: auth.email ? `${auth.name} <${auth.email}>` : auth.name,
    scopeLabel:
      run.scope.dataScope === "global"
        ? "Global — todos os clientes permitidos pelo perfil"
        : "Carteira própria — clientes do Responsável Comercial do usuário",
    filterLines: [...(await describeFilters(ds, run, filters, labelMap)), ...args.extraFilterLines],
    selectionMode: filters.customerSelection.mode,
    selectedCustomers: selectionIds.map((id) => ({ id, label: labelMap.get(id) ?? id })),
    source: `Pedidos de Venda — ${CRM_REPORTS_VALIDITY_SOURCE}. NF, proposta, atividade e comissão não criam compra.`,
    dateAxis: `SalesOrder.issueDate — dia civil local (${sourceInfo.businessTimeZone})`,
    repurchaseVersion: sourceInfo.repurchaseVersion,
    windowsLabel: `Hoje ${formatCrmReportsBusinessDate(w.today)} · 60d ${formatCrmReportsBusinessDate(w.recent60d.from)}–${formatCrmReportsBusinessDate(w.recent60d.to)} · 12m ${formatCrmReportsBusinessDate(w.rolling12m.from)}–${formatCrmReportsBusinessDate(w.rolling12m.to)}`,
    universe: run.analysis.universe,
    notes,
  };
}

function renderFile(
  meta: CrmReportsExportMetadata,
  table: CrmReportsExportTable,
  slug: string,
  format: CrmReportsExportFormat
): CrmReportsExportFile {
  const body =
    format === "csv"
      ? buildCrmReportsExportCsv(meta, table)
      : crmReportsWorkbookToBytes(buildCrmReportsExportWorkbook(meta, table));
  return {
    filename: crmReportsExportFilename(slug, format, meta.generatedAt),
    contentType: CONTENT_TYPES[format],
    body,
    rowCount: table.rows.length,
  };
}

// ---------------------------------------------------------------------------
// Exportações
// ---------------------------------------------------------------------------

/** POST /api/crm/reports/operational/export — lista inteira com o mesmo spec da tela. */
export async function exportCrmReportsOperationalList(args: {
  ds: CrmReportsDataSource;
  scope: CrmCommercialAccessScope;
  auth: AppAuthContext;
  request: CrmReportsNormalizedRequest;
  list: CrmReportsListKey;
  format: CrmReportsExportFormat;
  options?: CrmReportsRunOptions;
}): Promise<CrmReportsExportFile> {
  const { ds, scope, auth, request, list, format } = args;
  const run = await runCrmReportsAnalysis(ds, scope, request.filters, args.options);
  const viewed = applyCrmReportsViews(run.analysis, request.views);
  const facts = list === "recent" ? run.analysis.recent60d : viewed[list];
  const ids = facts.map((f) => f.customer.id);
  const owners = ids.length > 0 ? await resolveCrmReportsOwnersInBatches(ds, ids) : new Map();
  const sellerCtx = list !== "cadence" && ids.length > 0 ? await run.loadSellerContext() : null;
  const followUps = list === "overdue" && ids.length > 0 ? await loadCrmReportsFollowUpsInBatches(ds, ids, run.now) : new Map();

  let table: CrmReportsExportTable;
  if (list === "recent") {
    table = toTable(
      RECENT_COLUMNS,
      facts.map((f) => toCrmReportsRecent60dRow(f, toOwnerDisplay(owners, f.customer.id), toSellerDisplay(f.lastOrder, sellerCtx)))
    );
  } else if (list === "cadence") {
    table = toTable(CADENCE_COLUMNS, facts.map((f) => toCrmReportsCadenceRow(f, toOwnerDisplay(owners, f.customer.id))));
  } else {
    table = toTable(
      OVERDUE_COLUMNS,
      facts.map((f) =>
        toCrmReportsOverdueRow(
          f,
          toOwnerDisplay(owners, f.customer.id),
          toSellerDisplay(f.lastOrder, sellerCtx),
          followUps.get(f.customer.id) ?? null
        )
      )
    );
  }

  const extraFilterLines: Array<{ label: string; value: string }> = [];
  if (list === "cadence" && request.views.cadence.statuses.length > 0) {
    extraFilterLines.push({
      label: "Situação (lista)",
      value: request.views.cadence.statuses.map((s) => CRM_REPURCHASE_STATUS_LABELS[s]).join(", "),
    });
  }
  if (list === "overdue") {
    extraFilterLines.push({ label: "Recorte (lista)", value: CRM_REPORTS_OVERDUE_SEVERITY_LABELS[request.views.overdue.severity] });
    extraFilterLines.push({ label: "Ordenação (lista)", value: CRM_REPORTS_OVERDUE_SORT_LABELS[request.views.overdue.sort] });
  }

  const meta = await buildMetadata({
    ds,
    scope,
    auth,
    run,
    filters: request.filters,
    title: LIST_TITLES[list],
    extraFilterLines,
  });
  return renderFile(meta, table, LIST_SLUGS[list], format);
}

/** POST /api/crm/reports/custom/export — todas as linhas do relatório personalizado. */
export async function exportCrmCustomReport(args: {
  ds: CrmReportsDataSource;
  scope: CrmCommercialAccessScope;
  auth: AppAuthContext;
  spec: CrmCustomReportSpec;
  format: CrmReportsExportFormat;
  options?: CrmReportsRunOptions;
}): Promise<CrmReportsExportFile> {
  const { ds, scope, auth, spec, format } = args;
  const { run, computed } = await runCrmCustomReport(ds, scope, spec, args.options);

  const columns: CrmReportsExportColumn[] = [];
  for (const column of computed.columns) {
    columns.push({ key: column.key, label: column.label, format: column.format });
    if (column.key === "customer") columns.push({ key: "customer__taxId", label: "CNPJ/CPF", format: "text" });
    if (column.key === "orderSeller") columns.push({ key: "orderSeller__id", label: "ID Nomus do vendedor", format: "text" });
  }
  const rows = computed.rows.map((row) => {
    const out: Record<string, CrmReportsExportValue> = {};
    for (const dimension of spec.dimensions) {
      const cell = row.dimensions[dimension];
      out[dimension] = cell?.label ?? null;
      if (dimension === "customer") out.customer__taxId = cell?.sublabel ?? null;
      if (dimension === "orderSeller") out.orderSeller__id = cell?.sublabel?.replace("ID Nomus ", "") ?? null;
    }
    for (const metric of spec.metrics) out[metric] = row.metrics[metric] ?? null;
    return out;
  });
  const totalRow: Record<string, CrmReportsExportValue> = { [spec.dimensions[0]!]: "Total geral" };
  for (const metric of spec.metrics) totalRow[metric] = computed.totals[metric] ?? null;
  const table: CrmReportsExportTable = { columns, rows, footer: rows.length > 0 ? totalRow : null };

  const extraFilterLines = [
    {
      label: "Período (emissão)",
      value: spec.period
        ? `${formatCrmReportsBusinessDate(spec.period.from)} a ${formatCrmReportsBusinessDate(spec.period.to)}`
        : "Histórico inteiro",
    },
    { label: "Situação do cliente", value: CRM_CUSTOM_REPORT_CUSTOMER_STATUS_LABELS[spec.customerStatus] },
    { label: "Dimensões", value: spec.dimensions.map((d) => CRM_CUSTOM_REPORT_DIMENSION_LABELS[d]).join(", ") },
    { label: "Métricas", value: spec.metrics.map((m) => CRM_CUSTOM_REPORT_METRIC_LABELS[m]).join(", ") },
    ...(spec.groupBy ? [{ label: "Agrupar por", value: CRM_CUSTOM_REPORT_DIMENSION_LABELS[spec.groupBy] }] : []),
  ];
  const meta = await buildMetadata({
    ds,
    scope,
    auth,
    run,
    filters: spec.filters,
    title: "Relatório personalizado",
    extraFilterLines,
  });
  return renderFile(meta, table, "personalizado", format);
}
