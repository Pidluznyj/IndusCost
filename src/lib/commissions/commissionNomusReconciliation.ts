/**
 * Reconciliação IndusCost x referência Nomus (auditoria CLI).
 * Lógica pura — reutiliza resumo monthly payable (competência por recebimento) sem alterar cálculo.
 */
import { roundMoney } from "./commission-money.js";
import {
  aggregateMonthlyPayableFromRows,
  buildMonthKey,
  formatMonthLabelPt,
  type CommissionMonthlyPayableDetailLine,
  type CommissionMonthlyPayableSummary,
} from "./commissionMonthlyPayable.js";
import {
  buildVisualAuditNomusReference,
  computeVisualAuditCards,
  filterRowsByAppraisalMode,
  type VisualAuditRow,
} from "./commissionVisualAudit.js";

export type NomusReconciliationCliArgs = {
  sellerName: string | null;
  year: number;
  month: number;
  nomusBase: number | null;
  nomusCommission: number | null;
  asJson: boolean;
  asCsv: boolean;
};

export type RateBandSummary = {
  ratePercent: number;
  lineCount: number;
  allocatedBaseAmount: number;
  releasedCommissionAmount: number;
  shareOfBasePercent: number;
};

export type ReconciliationGroupingRow = {
  kind: "customer" | "nfe" | "receivable" | "product";
  key: string;
  label: string;
  lineCount: number;
  allocatedBaseAmount: number;
  releasedCommissionAmount: number;
  averageRatePercent: number;
};

export type SuspiciousTitleRow = {
  nomusReceivableId: number | null;
  nfeNumber: string | null;
  customerName: string | null;
  settlementDate: string | null;
  receivedAmount: number;
  releasedCommissionAmount: number;
  reason: string;
};

export type NomusReconciliationDetailLine = CommissionMonthlyPayableDetailLine & {
  nomusInferredRatePercent: number | null;
  estimatedNomusCommission: number | null;
  estimatedCommissionDiff: number | null;
};

export type NomusReconciliationResult = {
  year: number;
  month: number;
  monthLabelPt: string;
  periodRangeLabel: string;
  sellerName: string | null;
  matchedSellerNames: string[];
  indusBase: number;
  indusCommission: number;
  indusAverageRatePercent: number;
  nomusBase: number | null;
  nomusCommission: number | null;
  nomusAverageRatePercent: number | null;
  baseDiff: number | null;
  commissionDiff: number | null;
  baseDiffPercent: number | null;
  commissionDiffPercent: number | null;
  uniqueReceivablesCount: number;
  receivedAmountTotal: number;
  rateBands: RateBandSummary[];
  topDivergences: ReconciliationGroupingRow[];
  suspiciousTitles: SuspiciousTitleRow[];
  probableCauses: string[];
  detailLines: NomusReconciliationDetailLine[];
  settlementDateBasis: "NomusAccountsReceivable.settlementDate";
};

function parseArgFromArgv(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of argv) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function hasFlagInArgv(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function parseOptionalMoney(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function parseNomusReconciliationCliArgs(
  argv: string[] = process.argv.slice(2)
): NomusReconciliationCliArgs {
  const year = Number.parseInt(parseArgFromArgv(argv, "year") ?? "2026", 10);
  const month = Number.parseInt(parseArgFromArgv(argv, "month") ?? "6", 10);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw new Error("Ano inválido em --year.");
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error("Mês inválido em --month (1-12).");
  }

  return {
    sellerName: parseArgFromArgv(argv, "seller") ?? null,
    year,
    month,
    nomusBase: parseOptionalMoney(parseArgFromArgv(argv, "nomus-base")),
    nomusCommission: parseOptionalMoney(parseArgFromArgv(argv, "nomus-commission")),
    asJson: hasFlagInArgv(argv, "json"),
    asCsv: hasFlagInArgv(argv, "csv"),
  };
}

export function normalizeSellerName(value: string): string {
  return value.trim().toUpperCase();
}

export function sellerNameMatches(
  sellerName: string,
  filter: string | null | undefined
): boolean {
  if (!filter?.trim()) return true;
  return normalizeSellerName(sellerName).includes(normalizeSellerName(filter));
}

export function filterMonthlyPayableSummaryBySellerName(
  summary: CommissionMonthlyPayableSummary,
  sellerName: string
): CommissionMonthlyPayableSummary {
  const matchedSellers = summary.sellers.filter((s) => sellerNameMatches(s.sellerName, sellerName));
  if (matchedSellers.length === 0) {
    return {
      ...summary,
      payableCommissionTotal: 0,
      receivedAmountTotal: 0,
      allocatedBaseAmountTotal: 0,
      expectedCommissionAmountTotal: 0,
      pendingCommissionAmountTotal: 0,
      uniqueReceivablesCount: 0,
      uniqueSellersCount: 0,
      averageCommissionRate: 0,
      receivedVsBaseDiff: 0,
      warnings: [],
      sellers: [],
      details: [],
    };
  }

  const sellerIds = new Set(matchedSellers.map((s) => s.sellerId));
  const details = summary.details.filter((d) => sellerIds.has(d.sellerId));

  let receivedAmountTotal = 0;
  const receivableKeys = new Set<string>();
  for (const d of details) {
    const rk = d.nomusReceivableId != null ? `cr:${d.nomusReceivableId}` : d.lineId;
    if (!receivableKeys.has(rk)) {
      receivableKeys.add(rk);
      receivedAmountTotal = roundMoney(receivedAmountTotal + d.receivedAmount);
    }
  }

  const payableCommissionTotal = roundMoney(
    matchedSellers.reduce((s, x) => s + x.releasedCommissionAmount, 0)
  );
  const allocatedBaseAmountTotal = roundMoney(
    matchedSellers.reduce((s, x) => s + x.allocatedBaseAmount, 0)
  );
  const expectedCommissionAmountTotal = roundMoney(
    matchedSellers.reduce((s, x) => s + x.expectedCommissionAmount, 0)
  );
  const pendingCommissionAmountTotal = roundMoney(
    matchedSellers.reduce((s, x) => s + x.pendingCommissionAmount, 0)
  );
  const averageCommissionRate =
    allocatedBaseAmountTotal > 0
      ? roundMoney((payableCommissionTotal / allocatedBaseAmountTotal) * 100)
      : 0;

  return {
    ...summary,
    payableCommissionTotal,
    receivedAmountTotal,
    allocatedBaseAmountTotal,
    expectedCommissionAmountTotal,
    pendingCommissionAmountTotal,
    uniqueReceivablesCount: receivableKeys.size,
    uniqueSellersCount: matchedSellers.length,
    averageCommissionRate,
    receivedVsBaseDiff: roundMoney(receivedAmountTotal - allocatedBaseAmountTotal),
    warnings: [...new Set(matchedSellers.flatMap((s) => s.warnings))],
    sellers: matchedSellers,
    details,
  };
}

function monthPeriodRangeLabel(year: number, month: number): string {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  const fmt = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  return `${fmt(from)} a ${fmt(to)}`;
}

function aggregateRateBands(
  details: CommissionMonthlyPayableDetailLine[],
  totalBase: number
): RateBandSummary[] {
  const bands = new Map<number, CommissionMonthlyPayableDetailLine[]>();
  for (const d of details) {
    const rate = roundMoney(d.itemRatePercent);
    const bucket = bands.get(rate) ?? [];
    bucket.push(d);
    bands.set(rate, bucket);
  }

  return [...bands.entries()]
    .map(([ratePercent, lines]) => {
      const scheduleKeys = new Set<string>();
      let allocatedBaseAmount = 0;
      let releasedCommissionAmount = 0;
      for (const line of lines) {
        const sk = line.lineId;
        if (scheduleKeys.has(sk)) continue;
        scheduleKeys.add(sk);
        allocatedBaseAmount = roundMoney(allocatedBaseAmount + line.allocatedBaseAmount);
        releasedCommissionAmount = roundMoney(
          releasedCommissionAmount + line.releasedCommissionAmount
        );
      }
      return {
        ratePercent,
        lineCount: scheduleKeys.size,
        allocatedBaseAmount,
        releasedCommissionAmount,
        shareOfBasePercent:
          totalBase > 0 ? roundMoney((allocatedBaseAmount / totalBase) * 100) : 0,
      };
    })
    .sort((a, b) => a.ratePercent - b.ratePercent);
}

function aggregateGrouping(
  details: CommissionMonthlyPayableDetailLine[],
  kind: ReconciliationGroupingRow["kind"],
  keyFn: (d: CommissionMonthlyPayableDetailLine) => string,
  labelFn: (d: CommissionMonthlyPayableDetailLine) => string
): ReconciliationGroupingRow[] {
  const buckets = new Map<string, CommissionMonthlyPayableDetailLine[]>();
  for (const d of details) {
    const key = keyFn(d);
    const bucket = buckets.get(key) ?? [];
    bucket.push(d);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([key, lines]) => {
      const scheduleKeys = new Set<string>();
      let allocatedBaseAmount = 0;
      let releasedCommissionAmount = 0;
      for (const line of lines) {
        if (scheduleKeys.has(line.lineId)) continue;
        scheduleKeys.add(line.lineId);
        allocatedBaseAmount = roundMoney(allocatedBaseAmount + line.allocatedBaseAmount);
        releasedCommissionAmount = roundMoney(
          releasedCommissionAmount + line.releasedCommissionAmount
        );
      }
      return {
        kind,
        key,
        label: labelFn(lines[0]!),
        lineCount: scheduleKeys.size,
        allocatedBaseAmount,
        releasedCommissionAmount,
        averageRatePercent:
          allocatedBaseAmount > 0
            ? roundMoney((releasedCommissionAmount / allocatedBaseAmount) * 100)
            : 0,
      };
    })
    .sort((a, b) => b.releasedCommissionAmount - a.releasedCommissionAmount);
}

function buildTopDivergences(
  details: CommissionMonthlyPayableDetailLine[],
  nomusAverageRatePercent: number | null
): ReconciliationGroupingRow[] {
  const groups = [
    ...aggregateGrouping(details, "customer", (d) => d.customerName ?? "—", (d) =>
      d.customerName ?? "Sem cliente"
    ),
    ...aggregateGrouping(details, "nfe", (d) => d.nfeNumber ?? "—", (d) =>
      `NF ${d.nfeNumber ?? "—"}`
    ),
    ...aggregateGrouping(
      details,
      "receivable",
      (d) => String(d.nomusReceivableId ?? d.lineId),
      (d) => `CR ${d.nomusReceivableId ?? "—"}`
    ),
    ...aggregateGrouping(details, "product", (d) => d.productCode ?? "—", (d) =>
      d.productCode ?? "Sem produto"
    ),
  ];

  if (nomusAverageRatePercent == null) {
    return groups.slice(0, 15);
  }

  return groups
    .map((g) => {
      const expectedAtNomusRate = roundMoney(
        (g.allocatedBaseAmount * nomusAverageRatePercent) / 100
      );
      const rateGap = Math.abs(g.releasedCommissionAmount - expectedAtNomusRate);
      return { ...g, rateGap };
    })
    .sort((a, b) => (b as { rateGap: number }).rateGap - (a as { rateGap: number }).rateGap)
    .slice(0, 15);
}

function buildSuspiciousTitles(
  details: CommissionMonthlyPayableDetailLine[]
): SuspiciousTitleRow[] {
  const seen = new Set<string>();
  const out: SuspiciousTitleRow[] = [];

  for (const d of details) {
    const key = String(d.nomusReceivableId ?? d.lineId);
    if (seen.has(key)) continue;

    const reasons: string[] = [];
    if (d.alerts.length > 0) reasons.push(...d.alerts);
    if (!d.settlementDate) reasons.push("Sem data de baixa no recorte PAYABLE");
    if (d.releasedCommissionAmount <= 0 && d.expectedCommissionAmount > 0) {
      reasons.push("Comissão esperada mas liberada zerada");
    }
    if (Math.abs(d.receivedAmount - d.allocatedBaseAmount) > 0.02 && d.receivedAmount > 0) {
      reasons.push("Valor recebido difere da base rateada");
    }

    if (reasons.length > 0) {
      seen.add(key);
      out.push({
        nomusReceivableId: d.nomusReceivableId,
        nfeNumber: d.nfeNumber,
        customerName: d.customerName,
        settlementDate: d.settlementDate,
        receivedAmount: d.receivedAmount,
        releasedCommissionAmount: d.releasedCommissionAmount,
        reason: reasons.join("; "),
      });
    }
  }

  return out.sort((a, b) => b.releasedCommissionAmount - a.releasedCommissionAmount);
}

function inferProbableCauses(input: {
  baseDiff: number | null;
  commissionDiff: number | null;
  indusAverageRatePercent: number;
  nomusAverageRatePercent: number | null;
  suspiciousCount: number;
  warningsCount: number;
}): string[] {
  const causes: string[] = [];

  if (input.commissionDiff != null && Math.abs(input.commissionDiff) > 0.02) {
    if (input.baseDiff != null && Math.abs(input.baseDiff) > 0.02) {
      causes.push(
        "Base comissionável diferente — títulos baixados no período (settlementDate) podem não coincidir com o recorte Nomus."
      );
    }

    if (
      input.nomusAverageRatePercent != null &&
      Math.abs(input.indusAverageRatePercent - input.nomusAverageRatePercent) > 0.05
    ) {
      causes.push(
        "Percentual médio aplicado difere — IndusCost usa faixas comerciais interpoladas; Nomus pode ter usado percentual fixo ou tabela antiga."
      );
    }

    if (input.suspiciousCount > 0 || input.warningsCount > 0) {
      causes.push(
        "Títulos com alertas (base x recebido, vínculo CR ou liberação parcial) podem explicar diferenças linha a linha."
      );
    }

    if (causes.length === 0) {
      causes.push(
        "Diferença residual — verificar títulos fora do recorte (baixa fora de junho, vendedor diferente ou CR sem vínculo)."
      );
    }

    causes.push(
      "Regra manual antiga no Nomus (percentual único sobre base) pode divergir do motor IndusCost por produto/faixa."
    );
  } else {
    causes.push("Totais IndusCost e referência Nomus estão alinhados dentro de R$ 0,02.");
  }

  return causes;
}

function enrichDetailLines(
  details: CommissionMonthlyPayableDetailLine[],
  nomusAverageRatePercent: number | null
): NomusReconciliationDetailLine[] {
  return details.map((d) => {
    const estimatedNomusCommission =
      nomusAverageRatePercent != null
        ? roundMoney((d.allocatedBaseAmount * nomusAverageRatePercent) / 100)
        : null;
    const estimatedCommissionDiff =
      estimatedNomusCommission != null
        ? roundMoney(d.releasedCommissionAmount - estimatedNomusCommission)
        : null;
    return {
      ...d,
      nomusInferredRatePercent: nomusAverageRatePercent,
      estimatedNomusCommission,
      estimatedCommissionDiff,
    };
  });
}

export function buildNomusReconciliationFromPayableSummary(
  summary: CommissionMonthlyPayableSummary,
  options: {
    sellerName?: string | null;
    nomusBase?: number | null;
    nomusCommission?: number | null;
  } = {}
): NomusReconciliationResult {
  const scoped =
    options.sellerName?.trim()
      ? filterMonthlyPayableSummaryBySellerName(summary, options.sellerName)
      : summary;

  const nomusRef = buildVisualAuditNomusReference({
    mode: "PAYABLE",
    cards: {
      appraisalMode: "PAYABLE",
      documentAmountTotal: scoped.receivedAmountTotal,
      receivableAmountTotal: scoped.receivedAmountTotal,
      receivedAmountTotal: scoped.receivedAmountTotal,
      commissionableBaseTotal: scoped.allocatedBaseAmountTotal,
      commissionCalculatedTotal: scoped.expectedCommissionAmountTotal,
      commissionExpectedTotal: scoped.expectedCommissionAmountTotal,
      commissionReleasedTotal: scoped.payableCommissionTotal,
      commissionPendingTotal: scoped.pendingCommissionAmountTotal,
      commissionFutureTotal: 0,
      commissionBlockedTotal: 0,
      documentCount: new Set(scoped.details.map((d) => d.nfeNumber ?? d.lineId)).size,
      receivableCount: scoped.uniqueReceivablesCount,
      scheduleCount: scoped.details.length,
      divergenceCount: scoped.details.filter((d) => d.alerts.length > 0).length,
      averageRatePercent: scoped.averageCommissionRate,
    },
    nomusBase: options.nomusBase ?? null,
    nomusCommission: options.nomusCommission ?? null,
  });

  const rateBands = aggregateRateBands(scoped.details, scoped.allocatedBaseAmountTotal);
  const suspiciousTitles = buildSuspiciousTitles(scoped.details);
  const topDivergences = buildTopDivergences(scoped.details, nomusRef.nomusAverageRatePercent);
  const detailLines = enrichDetailLines(scoped.details, nomusRef.nomusAverageRatePercent);

  return {
    year: scoped.year,
    month: scoped.month,
    monthLabelPt: scoped.monthLabelPt,
    periodRangeLabel: monthPeriodRangeLabel(scoped.year, scoped.month),
    sellerName: options.sellerName ?? null,
    matchedSellerNames: scoped.sellers.map((s) => s.sellerName),
    indusBase: scoped.allocatedBaseAmountTotal,
    indusCommission: scoped.payableCommissionTotal,
    indusAverageRatePercent: scoped.averageCommissionRate,
    nomusBase: options.nomusBase ?? null,
    nomusCommission: options.nomusCommission ?? null,
    nomusAverageRatePercent: nomusRef.nomusAverageRatePercent,
    baseDiff: nomusRef.baseDiff,
    commissionDiff: nomusRef.commissionDiff,
    baseDiffPercent: nomusRef.baseDiffPercent,
    commissionDiffPercent: nomusRef.commissionDiffPercent,
    uniqueReceivablesCount: scoped.uniqueReceivablesCount,
    receivedAmountTotal: scoped.receivedAmountTotal,
    rateBands,
    topDivergences,
    suspiciousTitles,
    probableCauses: inferProbableCauses({
      baseDiff: nomusRef.baseDiff,
      commissionDiff: nomusRef.commissionDiff,
      indusAverageRatePercent: scoped.averageCommissionRate,
      nomusAverageRatePercent: nomusRef.nomusAverageRatePercent,
      suspiciousCount: suspiciousTitles.length,
      warningsCount: scoped.warnings.length,
    }),
    detailLines,
    settlementDateBasis: "NomusAccountsReceivable.settlementDate",
  };
}

/** Reconciliação a partir de linhas PAYABLE (testes e agregação direta). */
export function buildNomusReconciliationFromPayableRows(
  rows: VisualAuditRow[],
  query: { year: number; month: number; sellerName?: string | null; nomusBase?: number | null; nomusCommission?: number | null }
): NomusReconciliationResult {
  const period = {
    from: new Date(Date.UTC(query.year, query.month - 1, 1)),
    to: new Date(Date.UTC(query.year, query.month, 0, 23, 59, 59, 999)),
  };
  const payableRows = filterRowsByAppraisalMode(rows, "PAYABLE", period);
  const summary = aggregateMonthlyPayableFromRows(payableRows, {
    year: query.year,
    month: query.month,
  });
  return buildNomusReconciliationFromPayableSummary(summary, {
    sellerName: query.sellerName,
    nomusBase: query.nomusBase,
    nomusCommission: query.nomusCommission,
  });
}

export function buildNomusReconciliationCsv(result: NomusReconciliationResult): string {
  const header = [
    `# reconciliacao=${result.monthLabelPt}`,
    `# vendedor=${result.matchedSellerNames.join("; ") || "todos"}`,
    `# indus_base=${result.indusBase.toFixed(2)}`,
    `# indus_comissao=${result.indusCommission.toFixed(2)}`,
    `# nomus_base=${result.nomusBase?.toFixed(2) ?? ""}`,
    `# nomus_comissao=${result.nomusCommission?.toFixed(2) ?? ""}`,
    `# diff_comissao=${result.commissionDiff?.toFixed(2) ?? ""}`,
    `# criterio=${result.settlementDateBasis}`,
    "",
    "vendedor,cliente,pedido,nf,cr,data_baixa,valor_recebido,base_rateada,comissao_induscost,percentual_induscost,percentual_nomus_inferido,diferenca_estimada,status",
  ];

  const lines = result.detailLines.map((d) =>
    [
      `"${d.sellerName.replace(/"/g, '""')}"`,
      `"${(d.customerName ?? "").replace(/"/g, '""')}"`,
      d.orderCode ?? "",
      d.nfeNumber ?? "",
      d.nomusReceivableId ?? "",
      d.settlementDate?.slice(0, 10) ?? "",
      d.receivedAmount.toFixed(2),
      d.allocatedBaseAmount.toFixed(2),
      d.releasedCommissionAmount.toFixed(2),
      d.itemRatePercent.toFixed(4),
      d.nomusInferredRatePercent?.toFixed(4) ?? "",
      d.estimatedCommissionDiff?.toFixed(2) ?? "",
      d.alerts.length > 0 ? `"${d.alerts.join("; ").replace(/"/g, '""')}"` : "",
    ].join(",")
  );

  return [...header, ...lines].join("\n");
}

export function formatNomusReconciliationExecutiveSummary(
  result: NomusReconciliationResult
): string {
  const sellerLabel =
    result.matchedSellerNames.length > 0
      ? result.matchedSellerNames.join(", ")
      : result.sellerName ?? "todos os vendedores";

  const fmt = (v: number | null) =>
    v == null ? "—" : `R$ ${v.toFixed(2).replace(".", ",")}`;

  const lines = [
    `# Reconciliação Comissão ${result.monthLabelPt} — IndusCost x Nomus`,
    "",
    "## Contexto",
    "",
    `- **Vendedor:** ${sellerLabel}`,
    `- **Período Nomus:** ${result.periodRangeLabel}`,
    `- **Critério IndusCost:** títulos baixados no mês (\`${result.settlementDateBasis}\`)`,
    "",
    "## Valores",
    "",
    "| Origem | Base | Comissão | % médio |",
    "|--------|------|----------|---------|",
    `| Nomus (referência manual) | ${fmt(result.nomusBase)} | ${fmt(result.nomusCommission)} | ${result.nomusAverageRatePercent?.toFixed(4) ?? "—"}% |`,
    `| IndusCost (liberada/a pagar) | ${fmt(result.indusBase)} | ${fmt(result.indusCommission)} | ${result.indusAverageRatePercent.toFixed(4)}% |`,
    `| **Diferença** | ${fmt(result.baseDiff)} | ${fmt(result.commissionDiff)} | — |`,
    "",
    `**Comissão a pagar em ${result.monthLabelPt} para ${sellerLabel} (IndusCost):** ${fmt(result.indusCommission)}`,
    "",
    "## Causas prováveis",
    "",
    ...result.probableCauses.map((c) => `- ${c}`),
    "",
    "## Percentuais por faixa (IndusCost)",
    "",
    "| Faixa % | Linhas | Base | Comissão | % da base |",
    "|---------|--------|------|----------|-----------|",
    ...result.rateBands.map(
      (b) =>
        `| ${b.ratePercent.toFixed(4)}% | ${b.lineCount} | ${fmt(b.allocatedBaseAmount)} | ${fmt(b.releasedCommissionAmount)} | ${b.shareOfBasePercent.toFixed(2)}% |`
    ),
    "",
    "## Top divergências (por comissão)",
    "",
    ...result.topDivergences.slice(0, 10).map(
      (d) =>
        `- **${d.label}** (${d.kind}): base ${fmt(d.allocatedBaseAmount)}, comissão ${fmt(d.releasedCommissionAmount)}, ${d.averageRatePercent.toFixed(4)}%`
    ),
    "",
    "## Títulos com alerta",
    "",
    ...(result.suspiciousTitles.length === 0
      ? ["Nenhum título com alerta no recorte."]
      : result.suspiciousTitles.slice(0, 10).map(
          (t) =>
            `- CR ${t.nomusReceivableId ?? "—"} | NF ${t.nfeNumber ?? "—"} | ${t.reason}`
        )),
    "",
    "---",
    "",
    "_Documento gerado pela auditoria `scripts/reconcile-commission-nomus-june-2026.ts`. Referência Nomus informada via parâmetros CLI — não hardcoded em produção._",
  ];

  return lines.join("\n");
}

export { buildMonthKey, formatMonthLabelPt };
