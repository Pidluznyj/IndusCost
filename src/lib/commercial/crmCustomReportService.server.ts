/**
 * CRM > Relatórios — relatório personalizado (shell de I/O).
 *
 * Executa SÓ quando o usuário clica "Gerar relatório" (nenhuma consulta na
 * abertura da aba). Reusa exatamente o pipeline das listas —
 * `runCrmReportsAnalysis` (escopo, carteira, filtros, exclusões, pedidos
 * canônicos) — e só agrega no núcleo puro `crmCustomReportCore`.
 * Responsável e rótulo de vendedor são resolvidos em lote, só se a dimensão
 * for pedida. Nada é escrito nem cacheado.
 */

import type { CrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope.js";
import { buildSalesOrderSellerFilterOptionLabel } from "@/src/lib/salesOrderNomusSellerDisplay.js";
import type { CommercialResponsibleMap } from "@/src/lib/commercial/crmCommercialResponsibleResolver.js";
import {
  buildCrmReportsSourceInfo,
  resolveCrmReportsOwnersInBatches,
  runCrmReportsAnalysis,
  type CrmReportsDataSource,
  type CrmReportsRun,
  type CrmReportsRunOptions,
} from "@/src/lib/commercial/crmReportsOperationalService.server.js";
import {
  computeCrmCustomReport,
  pageCrmCustomReport,
  type CrmCustomReportComputed,
  type CrmCustomReportOwner,
} from "@/src/lib/commercial/crmCustomReportCore.js";
import type { CrmCustomReportResponse, CrmCustomReportSpec } from "@/src/lib/commercial/crmReportsTypes.js";

function toOwner(map: CommercialResponsibleMap, customerId: string): CrmCustomReportOwner | null {
  const owner = map.get(customerId);
  if (!owner) return null;
  const key =
    owner.sellerIdentityKey?.trim() ||
    (owner.sellerExternalId != null ? `__ID_ONLY__:${owner.sellerExternalId}` : owner.sellerCanonicalName ?? "");
  return key && owner.sellerCanonicalName ? { key, label: owner.sellerCanonicalName } : null;
}

export type CrmCustomReportRun = { run: CrmReportsRun; computed: CrmCustomReportComputed };

/** Pipeline completo (todas as linhas) — base da tela e da exportação. */
export async function runCrmCustomReport(
  ds: CrmReportsDataSource,
  scope: CrmCommercialAccessScope,
  spec: CrmCustomReportSpec,
  options: CrmReportsRunOptions = {}
): Promise<CrmCustomReportRun> {
  const run = await runCrmReportsAnalysis(ds, scope, spec.filters, options);
  const analyzedIds = run.analysis.analyzed.map((facts) => facts.customer.id);
  const needsOwner = spec.dimensions.includes("commercialOwner");
  const owners =
    needsOwner && analyzedIds.length > 0 ? await resolveCrmReportsOwnersInBatches(ds, analyzedIds) : new Map();
  const needsSeller = spec.dimensions.includes("orderSeller");
  const sellerCtx = needsSeller && analyzedIds.length > 0 ? await run.loadSellerContext() : null;
  const sellerLabels = new Map<number | null, string>();

  const computed = computeCrmCustomReport(spec, {
    today: run.analysis.windows.today,
    facts: run.analysis.analyzed,
    ordersByCustomer: run.ordersByCustomer,
    ownerOf: (customerId) => toOwner(owners, customerId),
    sellerLabelOf: (externalSellerId) => {
      if (!sellerLabels.has(externalSellerId)) {
        sellerLabels.set(
          externalSellerId,
          sellerCtx ? buildSalesOrderSellerFilterOptionLabel(externalSellerId, sellerCtx) : "—"
        );
      }
      return sellerLabels.get(externalSellerId)!;
    },
  });
  return { run, computed };
}

export function buildCrmCustomReportSourceInfo(run: CrmReportsRun): CrmCustomReportResponse["sourceInfo"] {
  return {
    ...buildCrmReportsSourceInfo(run),
    periodAxis: "SalesOrder.issueDate (dia civil local)",
    recencyAxis: "Histórico inteiro até hoje (motor de recompra)",
  };
}

/** POST /api/crm/reports/custom — página do relatório + totais + subtotais. */
export async function loadCrmCustomReport(
  ds: CrmReportsDataSource,
  scope: CrmCommercialAccessScope,
  spec: CrmCustomReportSpec,
  options: CrmReportsRunOptions = {}
): Promise<CrmCustomReportResponse> {
  const { run, computed } = await runCrmCustomReport(ds, scope, spec, options);
  const page = pageCrmCustomReport(computed, spec);
  return {
    asOf: run.now.toISOString(),
    today: run.analysis.windows.today,
    spec,
    scope: run.scope,
    selection: run.analysis.selection,
    universe: run.analysis.universe,
    sourceInfo: buildCrmCustomReportSourceInfo(run),
    columns: computed.columns,
    rows: page.rows,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    returned: page.returned,
    hasMore: page.hasMore,
    totals: computed.totals,
    groups: page.groups,
  };
}
