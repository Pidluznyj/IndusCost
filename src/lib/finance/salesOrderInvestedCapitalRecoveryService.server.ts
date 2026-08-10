/**
 * FIN-11c — Serviço da Recuperação do Dinheiro Investido.
 * Zero regra de negócio própria: carrega via loaders/motores oficiais já
 * existentes e monta o resultado. Sem N+1 (uma consulta em lote por fonte,
 * nunca uma chamada por Pedido).
 *
 * Fontes reutilizadas:
 *   - `loadSalesOrderIndustrialResultReportPayload` — população de Pedidos
 *     (mesmo filtro Ano/Mês/Cliente/Vendedor/Status da tela de Resultado
 *     Industrial) + custo industrial oficial já resolvido por vigência.
 *   - `loadFinanceArManagementRowsFromPrisma` + `filterFinanceArOperationalPortfolioRows`
 *     — população de CR reais (previsão suprimida via FIN-02).
 *   - `resolveFinanceArNfeOrderLinksFromRows` + `buildFinanceArOrderCodeResolverWithNfeLinks`
 *     — vínculo AR → Pedido (NF-e ou pista no texto), mesma regra usada em
 *     outras telas financeiras.
 *
 * Escopo desta versão (ver cabeçalho de `salesOrderInvestedCapitalRecoverySnapshot.ts`):
 *   - AR carregado numa janela de anos limitada (`AR_LOOKBACK_YEARS`), não a
 *     história inteira da empresa — evita full scan; documentado, não
 *     escondido.
 *   - `forecastCapitalRecoveryDate`/aging usam só CR real em aberto
 *     vinculado ao Pedido — a hierarquia completa do FIN-05 (+ previsão
 *     residual do Pedido ainda não faturada) fica para uma iteração futura.
 */

import type { PrismaClient } from "@prisma/client";
import { loadSalesOrderIndustrialResultReportPayload } from "../sales/salesOrderIndustrialResultReportService.server.js";
import type { SalesOrderIndustrialResultReportRow } from "../sales/salesOrderIndustrialResultReport.js";
import {
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
} from "../salesOrderListQuery.server.js";
import { loadFinanceArManagementRowsFromPrisma } from "../financeAccountsReceivableManagement.server.js";
import { resolveFinanceArNfeOrderLinksFromRows } from "./financeAccountsReceivableEffectiveTitles.server.js";
import {
  buildFinanceArOrderCodeResolverWithNfeLinks,
  filterFinanceArOperationalPortfolioRows,
} from "./financeArOperationalPortfolio.js";
import type { FinanceArDashboardRow } from "../financeAccountsReceivableDashboard.js";
import { toCivilDateKey } from "../financeCivilDate.js";
import {
  buildSalesOrderInvestedCapitalRecoverySnapshot,
  type SalesOrderInvestedCapitalRecoverySnapshot,
} from "./salesOrderInvestedCapitalRecoverySnapshot.js";
import {
  distributeMoneyOnStreetAcrossAging,
  INVESTED_CAPITAL_AGING_BUCKET_LABELS,
  type InvestedCapitalAgingBucketKey,
} from "./salesOrderInvestedCapitalRecoveryMath.js";

/** Janela de carga de CR reais — evita full scan histórico; ver cabeçalho do arquivo. */
const AR_LOOKBACK_YEARS = 3;

const COST_SOURCE_STATUS_LABELS: Record<string, string> = {
  CUSTO_NAO_LOCALIZADO: "Custo publicado não localizado na data do pedido",
  CUSTO_AMBIGUO: "Custo ambíguo para o produto na data do pedido",
  INCOMPLETO: "Custo incompleto para um ou mais itens do pedido",
};

const INVESTED_CAPITAL_RECOVERY_STATUS_VALUES = [
  "SEM_RECUPERACAO",
  "EM_RECUPERACAO",
  "CAPITAL_RECUPERADO",
  "DADOS_INSUFICIENTES",
] as const;

type InvestedCapitalRecoveryStatus = (typeof INVESTED_CAPITAL_RECOVERY_STATUS_VALUES)[number];

/**
 * Filtro "Status econômico" — classificação calculada por Pedido (não é um
 * campo de `SalesOrder`, por isso não passa por `parseSalesOrderListQuery`).
 * Aplicado sobre `rows` ANTES de KPIs/aging/top clientes (seção 5+), para que
 * a tela inteira — cards, gráfico de aging, top clientes e tabela — reflita
 * sempre a MESMA população filtrada.
 */
function parseInvestedCapitalRecoveryStatusParam(
  value: unknown
): InvestedCapitalRecoveryStatus | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const token = raw.trim().toUpperCase();
  return (INVESTED_CAPITAL_RECOVERY_STATUS_VALUES as readonly string[]).includes(token)
    ? (token as InvestedCapitalRecoveryStatus)
    : null;
}

export type SalesOrderInvestedCapitalRecoveryQuery = {
  /** Mesmo contrato de `parseSalesOrderListQuery` — página, filtros, etc. */
  query: Record<string, unknown>;
  referenceDate?: Date;
};

export type SalesOrderInvestedCapitalRecoveryKpis = {
  moneyOnStreetToday: number;
  capitalRecoveredTotal: number;
  investedCapitalAnalyzedTotal: number;
  totalOutstandingReceivable: number;
  ordersFullyRecoveredCount: number;
  ordersPartiallyRecoveredCount: number;
  ordersInsufficientDataCount: number;
  averageDaysToRecoverCapital: number | null;
  /** Imposto total da população filtrada — só informativo, mesmo motor do Resultado Industrial. */
  totalTaxesAnalyzed: number;
};

export type SalesOrderInvestedCapitalRecoveryTopCustomer = {
  customerName: string;
  moneyOnStreet: number;
  percentOfTotal: number;
};

export type SalesOrderInvestedCapitalRecoveryPayload = {
  generatedAt: string;
  totalOrdersInScope: number;
  truncated: boolean;
  kpis: SalesOrderInvestedCapitalRecoveryKpis;
  agingBuckets: Array<{ key: InvestedCapitalAgingBucketKey; label: string; amount: number }>;
  topCustomers: SalesOrderInvestedCapitalRecoveryTopCustomer[];
  rows: SalesOrderInvestedCapitalRecoverySnapshot[];
  /**
   * Diagnóstico temporário (investigação da tela vazia após o filtro de
   * grupo econômico). Camada em que a população zera:
   * rawTotalSalesOrders (tabela inteira) → totalCandidates (+ status/presença
   * operacional) → eligibleOrders (+ exclusão intercompany, = totalOrdersInScope).
   */
  populationDiagnostics: {
    rawTotalSalesOrders: number;
    totalCandidates: number;
    intercompanyExcluded: number;
    eligibleOrders: number;
  } | null;
};

function resolveCostUnavailableReason(row: SalesOrderIndustrialResultReportRow): string | null {
  if (row.costSourceStatus === "OK") return null;
  return COST_SOURCE_STATUS_LABELS[row.costSourceStatus] ?? "Custo industrial indisponível para este pedido";
}

export async function getSalesOrderInvestedCapitalRecoveryPayload(
  prisma: PrismaClient,
  input: SalesOrderInvestedCapitalRecoveryQuery
): Promise<SalesOrderInvestedCapitalRecoveryPayload> {
  const referenceDate = input.referenceDate ?? new Date();
  const todayCivilDate = toCivilDateKey(referenceDate) ?? referenceDate.toISOString().slice(0, 10);

  // 1) População de Pedidos + custo industrial oficial já resolvido — mesmo
  //    filtro/paginação da tela de Resultado Industrial (uma consulta), MENOS
  //    empresas do grupo econômico (Lazarios/Koppetel/SM). Operação intercompany
  //    não representa exposição comercial externa — exclusão ocorre ANTES de
  //    qualquer cálculo de capital investido/recebimento (ver `financeInternalGroupExclusions.ts`,
  //    mesma autoridade canônica já usada em AR/AP/DRE).
  const industrialReport = await loadSalesOrderIndustrialResultReportPayload(prisma, {
    query: input.query,
    referenceDate,
    excludeEconomicGroupCustomers: true,
  });

  const populationDiagnostics = await computeInvestedCapitalRecoveryPopulationDiagnostics(
    prisma,
    input.query,
    industrialReport.totalOrdersInScope
  );

  const orderCodes = industrialReport.rows.map((r) => r.orderCode);
  const orderCodeToSalesOrderId = new Map<string, string>();
  for (const row of industrialReport.rows) {
    orderCodeToSalesOrderId.set(row.orderCode, row.salesOrderId);
  }

  // 2) CR reais numa janela limitada de anos (não a história inteira — ver
  //    cabeçalho do arquivo) — uma consulta, sem filtro por pedido.
  const lookbackFromYear = referenceDate.getFullYear() - AR_LOOKBACK_YEARS;
  const arLoaded =
    orderCodes.length === 0
      ? { rows: [] as FinanceArDashboardRow[], syncCutoff: null }
      : await loadFinanceArManagementRowsFromPrisma(
          prisma,
          {
            status: "all",
            dueDateFrom: new Date(lookbackFromYear, 0, 1),
            dueDateTo: new Date(referenceDate.getFullYear() + 1, 11, 31),
          },
          referenceDate
        );

  const operationalArRows = filterFinanceArOperationalPortfolioRows(
    arLoaded.rows,
    { status: "all" },
    referenceDate,
    arLoaded.syncCutoff
  );

  // 3) Vínculo AR → Pedido (NF-e ou pista de texto) — uma consulta em lote.
  const nfeLinks = await resolveFinanceArNfeOrderLinksFromRows(prisma, operationalArRows);
  const resolveOrderCode = buildFinanceArOrderCodeResolverWithNfeLinks(operationalArRows, nfeLinks);

  const arRowsBySalesOrderId = new Map<string, FinanceArDashboardRow[]>();
  for (const row of operationalArRows) {
    const orderCode = resolveOrderCode(row);
    if (!orderCode) continue;
    const salesOrderId = orderCodeToSalesOrderId.get(orderCode);
    if (!salesOrderId) continue; // AR de um pedido fora da população filtrada — ignora.
    const bucket = arRowsBySalesOrderId.get(salesOrderId) ?? [];
    bucket.push(row);
    arRowsBySalesOrderId.set(salesOrderId, bucket);
  }

  // 4) Monta o snapshot de cada Pedido — pura, sem I/O.
  const economicStatusFilter = parseInvestedCapitalRecoveryStatusParam(
    input.query.economicStatus
  );
  const allRows: SalesOrderInvestedCapitalRecoverySnapshot[] = industrialReport.rows.map((orderRow) => {
    const arRows = arRowsBySalesOrderId.get(orderRow.salesOrderId) ?? [];
    return buildSalesOrderInvestedCapitalRecoverySnapshot(
      {
        salesOrderId: orderRow.salesOrderId,
        orderCode: orderRow.orderCode,
        customerName: orderRow.customerName || null,
        sellerName: orderRow.sellerName || null,
        saleValue: orderRow.orderCommercialValue,
        investedCapital: orderRow.costSourceStatus === "OK" ? orderRow.totalIndustrialCost : null,
        investedCapitalUnavailableReason: resolveCostUnavailableReason(orderRow),
        orderStatus: orderRow.orderStatus,
        orderStatusLabel: orderRow.orderStatusLabel,
        realReceivables: arRows.map((r) => ({
          externalId: r.externalId,
          dueDate: r.dueDate ? toCivilDateKey(r.dueDate) : null,
          settlementDate: r.settlementDate ? toCivilDateKey(r.settlementDate) : null,
          amountReceivable: r.amountReceivable ?? 0,
          amountReceived: r.amountReceived ?? 0,
          balanceReceivable: r.balanceReceivable ?? 0,
        })),
        totalTaxes: orderRow.totalTaxes,
        taxSourceLabel: orderRow.taxSourceLabel,
      },
      todayCivilDate
    );
  });

  // Status econômico filtra a POPULAÇÃO inteira (não só a tabela) — cards,
  // aging e top clientes usam sempre a mesma base que as linhas exibidas.
  const rows = economicStatusFilter
    ? allRows.filter((r) => r.status === economicStatusFilter)
    : allRows;

  // 5) KPIs — SOMA sobre a MESMA população que a tabela mostra (nunca uma
  //    página, sempre `rows` inteiro).
  const withCapital = rows.filter((r) => r.investedCapital != null);
  const moneyOnStreetToday = roundMoney(sum(withCapital, (r) => r.moneyOnStreet ?? 0));
  const capitalRecoveredTotal = roundMoney(sum(withCapital, (r) => r.capitalRecovered ?? 0));
  const investedCapitalAnalyzedTotal = roundMoney(sum(withCapital, (r) => r.investedCapital ?? 0));
  const totalOutstandingReceivable = roundMoney(sum(rows, (r) => r.outstandingReceivable));
  const totalTaxesAnalyzed = roundMoney(sum(rows, (r) => r.totalTaxes ?? 0));
  const ordersFullyRecoveredCount = rows.filter((r) => r.status === "CAPITAL_RECUPERADO").length;
  const ordersPartiallyRecoveredCount = rows.filter((r) => r.status === "EM_RECUPERACAO").length;
  const ordersInsufficientDataCount = rows.filter((r) => r.status === "DADOS_INSUFICIENTES").length;

  const daysToRecoverKnown = rows
    .map((r) => computeDaysToRecoverCapitalIfKnown(r))
    .filter((d): d is number => d != null);
  const averageDaysToRecoverCapital =
    daysToRecoverKnown.length > 0
      ? Math.round(sum(daysToRecoverKnown, (d) => d) / daysToRecoverKnown.length)
      : null;

  // 6) Aging do capital na rua — distribui cada Pedido sobre sua PRÓPRIA
  //    agenda de CR real aberto, depois soma por faixa.
  const agingTotals: Record<InvestedCapitalAgingBucketKey, number> = {
    overdue: 0,
    d0to30: 0,
    d31to60: 0,
    d61to90: 0,
    d90plus: 0,
    noForecast: 0,
  };
  for (const r of withCapital) {
    if (!r.moneyOnStreet || r.moneyOnStreet <= 0) continue;
    const buckets = distributeMoneyOnStreetAcrossAging({
      moneyOnStreet: r.moneyOnStreet,
      scheduleEvents: r.openRealReceivableEvents,
      todayCivilDate,
    });
    for (const key of Object.keys(agingTotals) as InvestedCapitalAgingBucketKey[]) {
      agingTotals[key] = roundMoney(agingTotals[key] + buckets[key]);
    }
  }

  // 7) Top clientes por capital na rua.
  const byCustomer = new Map<string, number>();
  for (const r of withCapital) {
    if (!r.moneyOnStreet || r.moneyOnStreet <= 0) continue;
    const name = r.customerName ?? "Sem cliente identificado";
    byCustomer.set(name, roundMoney((byCustomer.get(name) ?? 0) + r.moneyOnStreet));
  }
  const topCustomers = [...byCustomer.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([customerName, amount]) => ({
      customerName,
      moneyOnStreet: amount,
      percentOfTotal: moneyOnStreetToday > 0 ? roundMoney((amount / moneyOnStreetToday) * 100) : 0,
    }));

  return {
    generatedAt: referenceDate.toISOString(),
    totalOrdersInScope: industrialReport.totalOrdersInScope,
    truncated: industrialReport.truncated,
    kpis: {
      moneyOnStreetToday,
      capitalRecoveredTotal,
      investedCapitalAnalyzedTotal,
      totalOutstandingReceivable,
      ordersFullyRecoveredCount,
      ordersPartiallyRecoveredCount,
      ordersInsufficientDataCount,
      averageDaysToRecoverCapital,
      totalTaxesAnalyzed,
    },
    agingBuckets: (Object.keys(agingTotals) as InvestedCapitalAgingBucketKey[]).map((key) => ({
      key,
      label: INVESTED_CAPITAL_AGING_BUCKET_LABELS[key],
      amount: agingTotals[key],
    })),
    topCustomers,
    rows,
    populationDiagnostics,
  };
}

/**
 * Observabilidade (seção 26 da missão intercompany) — não é obrigatório expor
 * na UI, mas está temporariamente no payload para investigar a tela vazia
 * relatada em produção sem precisar de acesso a banco/logs do servidor.
 * Três contagens leves (`count()`, sem a carga pesada de itens/custo/
 * imposto do relatório) que isolam em qual camada a população zera:
 *   rawTotalSalesOrders  — tabela inteira, sem where nenhum (sanity check).
 *   totalCandidates      — + status/presença operacional (SEM exclusão de grupo).
 *   eligibleOrders       — + exclusão intercompany (== totalOrdersInScope).
 */
async function computeInvestedCapitalRecoveryPopulationDiagnostics(
  prisma: PrismaClient,
  query: Record<string, unknown>,
  eligibleOrders: number
): Promise<SalesOrderInvestedCapitalRecoveryPayload["populationDiagnostics"]> {
  try {
    const rawTotalSalesOrders = await prisma.salesOrder.count();
    const parsed = parseSalesOrderListQuery(query);
    const sellerWhere = await resolveSalesOrderListSellerWhere(prisma, {
      sellerKeyRaw: parsed.sellerKeyRaw,
      sellerText: parsed.sellerText,
    });
    const candidateWhere = await resolveSalesOrderListWhere(prisma, parsed, sellerWhere, {
      excludeEconomicGroupCustomers: false,
    });
    const totalCandidates = await prisma.salesOrder.count({ where: candidateWhere });
    const diagnostics = {
      rawTotalSalesOrders,
      totalCandidates,
      intercompanyExcluded: Math.max(0, totalCandidates - eligibleOrders),
      eligibleOrders,
    };
    console.info("[invested-capital-recovery] population", JSON.stringify(diagnostics));
    return diagnostics;
  } catch (err) {
    console.warn(
      "[invested-capital-recovery] population diagnostics failed",
      err instanceof Error ? err.message : err
    );
    // Diagnóstico não pode derrubar a rota — falha aqui é só observabilidade perdida.
    return null;
  }
}

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((acc, item) => acc + pick(item), 0);
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Prazo realizado — seção 16: SEM evidência canônica confirmada de "data de
 * saída/faturamento" nesta iteração (não confundir com `issueDate`, que é a
 * data do Pedido, não a evidência de saída). Retorna sempre null até que
 * essa evidência seja auditada e confirmada — não inventa a regra.
 */
function computeDaysToRecoverCapitalIfKnown(
  _snapshot: SalesOrderInvestedCapitalRecoverySnapshot
): number | null {
  return null;
}
