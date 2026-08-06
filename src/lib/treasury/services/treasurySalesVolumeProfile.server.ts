/**
 * Carregador do perfil de sensibilidade de vendas (server-only, read-only).
 *
 * Monta o INPUT do motor `computeTreasurySalesVolumeScenarios` a partir das
 * fontes oficiais — nenhum percentual inventado:
 *
 *  BASE DE VENDAS (medida canônica dos relatórios de vendas):
 *    SalesOrder.totalNetValue por issueDate, excluindo CANCELLED/ERROR e
 *    respeitando a política de presença Nomus — a MESMA população dos
 *    gráficos mensais oficiais ("Valor vendido em pedidos emitidos").
 *    Meses COMPLETOS: o mês corrente nunca entra como mês fechado.
 *    Não existe previsão/meta comercial oficial no IndusCost hoje →
 *    prioridade 4 da spec (histórico recente de Pedidos de Venda).
 *
 *  CUSTOS VARIÁVEIS (frações oficiais por pedido, mix histórico real):
 *    - Matéria-prima/insumos: Σ totalCost / Σ totalNetValue;
 *    - Impostos: Σ totalTaxes / Σ totalNetValue;
 *    - Fretes: Σ totalFreight / Σ totalNetValue;
 *    - Comissões: CommissionOrderSnapshot (ACTIVE) —
 *      Σ totalFinalCommissionAmount / Σ totalSoldAmount.
 *    Categoria sem valor oficial (razão ~0) fica FORA com aviso de
 *    cobertura — nunca inventamos percentual.
 *
 *  PRAZO VENDA→RECEBIMENTO (perfil real ponderado por valor):
 *    NomusAccountsReceivable.sourceInvoiceId → SalesOrderNfeLink.nfeExternalId
 *    → SalesOrder.issueDate; prazo = (settlementDate ?? dueDate) − issueDate,
 *    agregado em buckets semanais. Histórico insuficiente → fallback da
 *    política, declarado.
 *
 * Somente leitura. Nada é persistido. Nenhum título é criado.
 */

import type { PrismaClient } from "@prisma/client";
import { mergeSalesOrderOperationalPresenceWhere } from "@/src/lib/nomus/nomusSourcePresencePolicy.js";
import type { TreasurySalesVolumeScenarioPolicy } from "../contracts/treasurySalesVolumeScenarioPolicy.js";
import type {
  TreasuryReceiptLagProfile,
  TreasurySalesVolumeBaseline,
  TreasuryVariableCostInput,
} from "../domain/treasuryCaixaSalesVolumeScenarios.js";

export type TreasurySalesVolumeProfile = {
  baseline: TreasurySalesVolumeBaseline;
  receiptLagProfile: TreasuryReceiptLagProfile;
  variableCosts: TreasuryVariableCostInput[];
  coverageWarnings: string[];
};

/** Piso mínimo de histórico para o perfil de recebimento ser confiável. */
const MIN_RECEIPT_SAMPLE_TITLES = 20;
/** Razão mínima para uma categoria de custo contar como fonte confiável. */
const MIN_MEANINGFUL_RATIO = 0.001; // 0,1% do valor vendido
const RECEIPT_LAG_MAX_DAYS = 365;
const RECEIPT_SAMPLE_TAKE = 5000;

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function monthKeyUtc(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** Meses completos de lookback: [asOfMonth−lookback, asOfMonth). */
export function resolveLookbackMonths(
  asOfCivilDate: string,
  lookbackMonths: number
): { monthsUsed: string[]; startIso: Date; endExclusiveIso: Date } {
  const [y, m] = asOfCivilDate.slice(0, 10).split("-").map(Number);
  const endExclusive = new Date(Date.UTC(y!, m! - 1, 1));
  const start = new Date(Date.UTC(y!, m! - 1 - lookbackMonths, 1));
  const monthsUsed: string[] = [];
  const cur = new Date(start);
  while (cur < endExclusive) {
    monthsUsed.push(monthKeyUtc(cur));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return { monthsUsed, startIso: start, endExclusiveIso: endExclusive };
}

export async function loadTreasurySalesVolumeProfile(
  prisma: Pick<
    PrismaClient,
    "salesOrder" | "commissionOrderSnapshot" | "nomusAccountsReceivable" | "salesOrderNfeLink"
  >,
  asOfCivilDate: string,
  policy: TreasurySalesVolumeScenarioPolicy
): Promise<TreasurySalesVolumeProfile> {
  const warnings: string[] = [];
  const { monthsUsed, startIso, endExclusiveIso } = resolveLookbackMonths(
    asOfCivilDate,
    policy.lookbackMonths
  );

  // ── Base de vendas + razões de custo (população comercial oficial) ─────
  const orders = await prisma.salesOrder.findMany({
    where: mergeSalesOrderOperationalPresenceWhere({
      status: { notIn: ["CANCELLED", "ERROR"] },
      issueDate: { gte: startIso, lt: endExclusiveIso },
    }),
    select: {
      issueDate: true,
      totalNetValue: true,
      totalCost: true,
      totalTaxes: true,
      totalFreight: true,
    },
  });

  let sumNet = 0;
  let sumCost = 0;
  let sumTaxes = 0;
  let sumFreight = 0;
  const netByMonth = new Map<string, number>();
  for (const o of orders) {
    const net = toNumber(o.totalNetValue);
    if (net <= 0) continue;
    sumNet += net;
    sumCost += toNumber(o.totalCost);
    sumTaxes += toNumber(o.totalTaxes);
    sumFreight += toNumber(o.totalFreight);
    const mk = monthKeyUtc(new Date(o.issueDate));
    netByMonth.set(mk, (netByMonth.get(mk) ?? 0) + net);
  }
  const monthlyAverageAmount =
    monthsUsed.length > 0 ? sumNet / monthsUsed.length : 0;
  if (monthlyAverageAmount <= 0) {
    warnings.push(
      "Sem Pedidos de Venda no período de referência — base de vendas zerada; cenários não simulam movimentos."
    );
  }

  const baseline: TreasurySalesVolumeBaseline = {
    source: "SALES_HISTORY",
    monthlyAverageAmount: Math.round(monthlyAverageAmount * 100) / 100,
    monthsUsed,
    measure: "SALES_ORDER_TOTAL_NET_VALUE",
    description: `média dos últimos ${monthsUsed.length} meses completos de Pedidos de Venda (${monthsUsed[0] ?? "—"} a ${monthsUsed[monthsUsed.length - 1] ?? "—"})`,
  };

  // ── Comissão (fonte oficial do módulo de comissões) ────────────────────
  const commissionAgg = await prisma.commissionOrderSnapshot.aggregate({
    where: {
      status: "ACTIVE",
      saleDate: { gte: startIso, lt: endExclusiveIso },
    },
    _sum: { totalFinalCommissionAmount: true, totalSoldAmount: true },
  });
  const commissionSold = toNumber(commissionAgg._sum.totalSoldAmount);
  const commissionAmount = toNumber(
    commissionAgg._sum.totalFinalCommissionAmount
  );
  const commissionRatio =
    commissionSold > 0 ? commissionAmount / commissionSold : 0;

  // ── Custos variáveis com fonte confiável ───────────────────────────────
  const variableCosts: TreasuryVariableCostInput[] = [];
  function pushCost(
    kind: TreasuryVariableCostInput["kind"],
    ratio: number,
    ratioSource: string,
    outflowLagDays: number,
    missingLabel: string
  ) {
    if (ratio >= MIN_MEANINGFUL_RATIO) {
      variableCosts.push({
        kind,
        ratio,
        ratioSource,
        outflowLagDays,
        lagSource: "parâmetro configurável da política (sem prazo oficial medido)",
        isFallbackLag: true,
      });
    } else {
      warnings.push(missingLabel);
    }
  }
  if (sumNet > 0) {
    pushCost(
      "RAW_MATERIAL",
      sumCost / sumNet,
      `custo oficial dos Pedidos (Σ totalCost / Σ totalNetValue, ${monthsUsed.length}m)`,
      policy.defaultRawMaterialLagDays,
      "Matéria-prima sem custo oficial nos Pedidos do período — categoria fora da simulação."
    );
    pushCost(
      "TAX",
      sumTaxes / sumNet,
      `impostos oficiais dos Pedidos (Σ totalTaxes / Σ totalNetValue, ${monthsUsed.length}m)`,
      policy.defaultTaxLagDays,
      "Impostos sem valor oficial nos Pedidos do período — categoria fora da simulação."
    );
    pushCost(
      "FREIGHT",
      sumFreight / sumNet,
      `fretes oficiais dos Pedidos (Σ totalFreight / Σ totalNetValue, ${monthsUsed.length}m)`,
      policy.defaultFreightLagDays,
      "Fretes sem valor oficial nos Pedidos do período — categoria fora da simulação."
    );
  }
  pushCost(
    "COMMISSION",
    commissionRatio,
    `regra oficial de comissões (CommissionOrderSnapshot ACTIVE, ${monthsUsed.length}m)`,
    policy.defaultCommissionLagDays,
    "Comissões sem snapshot oficial no período — categoria fora da simulação."
  );

  // ── Perfil venda→recebimento (prazo real, ponderado por valor) ─────────
  const receivables = await prisma.nomusAccountsReceivable.findMany({
    where: {
      sourceInvoiceId: { not: null },
      dueDate: { gte: startIso },
      amountReceivable: { gt: 0 },
    },
    select: {
      sourceInvoiceId: true,
      dueDate: true,
      settlementDate: true,
      amountReceivable: true,
    },
    take: RECEIPT_SAMPLE_TAKE,
    orderBy: { dueDate: "desc" },
  });
  const invoiceIds = [
    ...new Set(
      receivables
        .map((r) => r.sourceInvoiceId)
        .filter((v): v is number => typeof v === "number")
    ),
  ];
  const links = invoiceIds.length
    ? await prisma.salesOrderNfeLink.findMany({
        where: { nfeExternalId: { in: invoiceIds } },
        select: {
          nfeExternalId: true,
          SalesOrder: { select: { issueDate: true } },
        },
      })
    : [];
  const issueByInvoice = new Map<number, Date>();
  for (const l of links) {
    const issue = l.SalesOrder?.issueDate;
    if (issue && !issueByInvoice.has(l.nfeExternalId)) {
      issueByInvoice.set(l.nfeExternalId, new Date(issue));
    }
  }

  const MS_DAY = 24 * 60 * 60 * 1000;
  const weightByWeekBucket = new Map<number, number>();
  let sampleTitles = 0;
  for (const r of receivables) {
    const issue = r.sourceInvoiceId
      ? issueByInvoice.get(r.sourceInvoiceId)
      : undefined;
    const effective = r.settlementDate ?? r.dueDate;
    if (!issue || !effective) continue;
    const lag = Math.round(
      (new Date(effective).getTime() - issue.getTime()) / MS_DAY
    );
    if (!Number.isFinite(lag) || lag < 0 || lag > RECEIPT_LAG_MAX_DAYS) continue;
    const weight = toNumber(r.amountReceivable);
    if (weight <= 0) continue;
    const bucket = Math.floor(lag / 7);
    weightByWeekBucket.set(bucket, (weightByWeekBucket.get(bucket) ?? 0) + weight);
    sampleTitles += 1;
  }

  let receiptLagProfile: TreasuryReceiptLagProfile;
  if (sampleTitles >= MIN_RECEIPT_SAMPLE_TITLES) {
    const totalWeight = [...weightByWeekBucket.values()].reduce(
      (s, w) => s + w,
      0
    );
    receiptLagProfile = {
      buckets: [...weightByWeekBucket.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([bucket, weight]) => ({
          lagDays: bucket * 7 + 3, // ponto médio da semana
          weight: weight / totalWeight,
        })),
      source: `prazo real venda→recebimento (CR→NF-e→Pedido, ${sampleTitles} títulos ponderados por valor)`,
      isFallback: false,
    };
  } else {
    receiptLagProfile = {
      buckets: [{ lagDays: policy.defaultReceiptLagDays, weight: 1 }],
      source: `parâmetro configurável da política (${policy.defaultReceiptLagDays} dias) — histórico CR→Pedido insuficiente`,
      isFallback: true,
    };
    warnings.push(
      "Condições de pagamento por histórico indisponíveis — usando prazo único configurável para os recebimentos simulados."
    );
  }

  return { baseline, receiptLagProfile, variableCosts, coverageWarnings: warnings };
}
