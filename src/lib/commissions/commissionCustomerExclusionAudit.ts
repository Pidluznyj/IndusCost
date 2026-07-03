import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import {
  aggregateMonthlyPayableFromRows,
  buildMonthlyPayableDetailCsv,
} from "./commissionMonthlyPayable.js";
import {
  aggregateReceivableForecastFromRows,
  buildReceivableForecastDetailCsv,
} from "./commissionReceivableForecast.js";
import type { ExclusionImpactLine, ExclusionImpactPreview } from "./commissionCustomerExclusionReprocess.js";
import { roundMoney } from "./commission-money.js";
import {
  buildVisualAuditCsv,
  buildVisualAuditRow,
  computeVisualAuditCards,
  filterRowsByAppraisalMode,
  type VisualAuditRow,
  type VisualAuditRowInput,
} from "./commissionVisualAudit.js";

export type CustomerExclusionRuleAuditInfo = {
  id: string;
  customerNameSnapshot: string;
  customerExternalId: number | null;
  reason: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  notes: string | null;
};

export type CustomerExclusionAuditLine = {
  recordId: string;
  orderCode: string | null;
  nfeNumber: string | null;
  nomusReceivableIds: number[];
  sellerName: string;
  customerName: string | null;
  referenceDate: string;
  referenceDateKind: "nfe" | "order";
  soldBaseAmount: number;
  receivedAmount: number;
  commissionableBase: number;
  commissionBefore: number;
  commissionAfter: number;
  commissionCurrent: number;
  commissionDiff: number;
  releasedCurrent: number;
  releasedAfter: number;
  exclusionRuleId: string | null;
  exclusionReason: string | null;
  alreadyExcluded: boolean;
  titleCategory: ExclusionImpactLine["titleCategory"];
};

export type CustomerExclusionAuditMonthImpact = {
  monthKey: string;
  lineCount: number;
  soldBaseAmount: number;
  receivedAmount: number;
  commissionBefore: number;
  commissionAfter: number;
  commissionDiff: number;
};

export type CustomerExclusionUiValidation = {
  visualAudit: {
    rowsVisible: boolean;
    commissionZero: boolean;
    basePreserved: boolean;
    reasonVisible: boolean;
    ruleIdVisible: boolean;
    statusSemComissao: boolean;
  };
  monthlyClosing: {
    payableCommissionTotal: number;
    releasedCommissionZero: boolean;
  };
  forecast: {
    expectedCommissionTotal: number;
    forecastCommissionZero: boolean;
  };
  generated: {
    commissionExpectedTotal: number;
    generatedCommissionZero: boolean;
  };
  csv: {
    hasComissionavelColumn: boolean;
    hasMotivoExclusaoColumn: boolean;
    hasRegraExclusaoIdColumn: boolean;
    reasonPresentInExport: boolean;
  };
};

export type CustomerExclusionAuditReport = {
  customerFilter: ExclusionImpactPreview["customerFilter"];
  dateRange: ExclusionImpactPreview["dateRange"];
  rules: CustomerExclusionRuleAuditInfo[];
  ruleRegistered: boolean;
  summary: {
    salesLineCount: number;
    ordersCount: number;
    nfesCount: number;
    receivablesCount: number;
    soldBaseTotal: number;
    receivedAmountTotal: number;
    commissionableBaseTotal: number;
    commissionBeforeTotal: number;
    commissionCurrentTotal: number;
    commissionAfterTotal: number;
    commissionDiffTotal: number;
    releasedCurrentTotal: number;
    releasedAfterTotal: number;
  };
  byReferenceMonth: CustomerExclusionAuditMonthImpact[];
  bySettlementMonth: CustomerExclusionAuditMonthImpact[];
  lines: CustomerExclusionAuditLine[];
  uiValidation: CustomerExclusionUiValidation;
  limitations: string[];
  warnings: string[];
};

export function mapRuleToAuditInfo(
  rule: CustomerExclusionRuleSnapshot
): CustomerExclusionRuleAuditInfo {
  return {
    id: rule.id,
    customerNameSnapshot: rule.customerNameSnapshot,
    customerExternalId: rule.customerExternalId,
    reason: rule.reason,
    effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: rule.effectiveTo ? rule.effectiveTo.toISOString().slice(0, 10) : null,
    status: rule.status,
    notes: rule.notes,
  };
}

function sumReceivedAmount(receivedByRecordId: Map<string, number>, recordId: string): number {
  return roundMoney(receivedByRecordId.get(recordId) ?? 0);
}

export function buildCustomerExclusionAuditLine(
  impactLine: ExclusionImpactLine,
  receivedByRecordId: Map<string, number>
): CustomerExclusionAuditLine {
  const receivedAmount = sumReceivedAmount(receivedByRecordId, impactLine.recordId);
  const commissionBefore = roundMoney(
    impactLine.afterCommissionAmount - impactLine.commissionDiff
  );
  return {
    recordId: impactLine.recordId,
    orderCode: impactLine.orderCode,
    nfeNumber: impactLine.nfeNumber,
    nomusReceivableIds: impactLine.nomusReceivableIds,
    sellerName: impactLine.sellerName,
    customerName: impactLine.customerName,
    referenceDate: impactLine.referenceDate,
    referenceDateKind: impactLine.referenceDateKind,
    soldBaseAmount: impactLine.baseAmount,
    receivedAmount,
    commissionableBase: impactLine.baseAmount,
    commissionBefore,
    commissionAfter: impactLine.afterCommissionAmount,
    commissionCurrent: impactLine.currentCommissionAmount,
    commissionDiff: impactLine.commissionDiff,
    releasedCurrent: impactLine.currentReleasedAmount,
    releasedAfter: impactLine.afterReleasedAmount,
    exclusionRuleId: impactLine.exclusionRuleId,
    exclusionReason: impactLine.exclusionReason,
    alreadyExcluded: impactLine.alreadyExcluded,
    titleCategory: impactLine.titleCategory,
  };
}

function aggregateAuditMonth(
  lines: CustomerExclusionAuditLine[],
  pickMonthKeys: (line: CustomerExclusionAuditLine) => string[]
): CustomerExclusionAuditMonthImpact[] {
  const map = new Map<string, CustomerExclusionAuditMonthImpact>();
  for (const line of lines) {
    const keys = pickMonthKeys(line);
    const monthKeys = keys.length > 0 ? keys : ["sem_mes"];
    for (const monthKey of monthKeys) {
      const bucket = map.get(monthKey) ?? {
        monthKey,
        lineCount: 0,
        soldBaseAmount: 0,
        receivedAmount: 0,
        commissionBefore: 0,
        commissionAfter: 0,
        commissionDiff: 0,
      };
      bucket.lineCount += 1;
      bucket.soldBaseAmount = roundMoney(bucket.soldBaseAmount + line.soldBaseAmount);
      bucket.receivedAmount = roundMoney(bucket.receivedAmount + line.receivedAmount);
      bucket.commissionBefore = roundMoney(bucket.commissionBefore + line.commissionBefore);
      bucket.commissionAfter = roundMoney(bucket.commissionAfter + line.commissionAfter);
      bucket.commissionDiff = roundMoney(bucket.commissionDiff + line.commissionDiff);
      map.set(monthKey, bucket);
    }
  }
  return [...map.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

export function buildExcludedCustomerVisualAuditInput(
  overrides: Partial<VisualAuditRowInput> = {}
): VisualAuditRowInput {
  return {
    lineId: "excluded:r1:s1",
    recordId: "r-excluded-1",
    scheduleId: "s-excluded-1",
    commissionPersonId: "seller-1",
    commissionPersonName: "Vendedor Demo",
    customerName: "CLIENTE EXCLUIDO SA",
    orderCode: "PV-9001",
    nfeNumber: "900100",
    nomusNfeId: 900100,
    confirmedAt: "2026-03-10T00:00:00.000Z",
    documentKey: "seller-1:900100",
    documentBaseAmount: 5000,
    documentCommissionTotal: 0,
    itemBaseAmount: 5000,
    itemCommissionAmount: 0,
    itemRatePercent: 0,
    productCode: "PROD-X",
    nomusReceivableId: 88001,
    installmentNumber: 1,
    dueDate: "2026-04-01T00:00:00.000Z",
    settlementDate: "2026-06-12T00:00:00.000Z",
    receivableAmount: 5000,
    receivedAmount: 5000,
    openBalance: 0,
    allocationPercent: 100,
    commissionExpected: 0,
    commissionReleased: 0,
    hasArLink: true,
    hasSchedule: true,
    customerNoCommission: true,
    isCommissionable: false,
    exclusionReason: "Cliente corporativo sem comissão",
    exclusionRuleId: "rule-excluded-demo",
    ...overrides,
  };
}

export function buildUiValidationFromVisualRows(
  rows: VisualAuditRow[],
  exclusionReason: string
): CustomerExclusionUiValidation {
  const generatedRows = rows;
  const payableRows = filterRowsByAppraisalMode(rows, "PAYABLE", {
    from: new Date("2026-01-01"),
    to: new Date("2026-12-31"),
  });
  const forecastRows = filterRowsByAppraisalMode(rows, "FORECAST", null);

  const generatedCards = computeVisualAuditCards(generatedRows, "GENERATED");
  const payableSummary = aggregateMonthlyPayableFromRows(payableRows, {
    year: 2026,
    month: 6,
  });
  const forecastSummary = aggregateReceivableForecastFromRows(forecastRows, {
    year: 2026,
    month: 7,
  });

  const visualCsv = buildVisualAuditCsv(generatedRows, generatedCards);
  const closingCsv = buildMonthlyPayableDetailCsv(payableSummary);
  const forecastCsv = buildReceivableForecastDetailCsv(forecastSummary);
  const forecastCommissionTotal = roundMoney(
    forecastSummary.cards.futureCommissionTotal +
      forecastSummary.cards.overdueCommissionTotal
  );

  return {
    visualAudit: {
      rowsVisible: generatedRows.length > 0,
      commissionZero: generatedRows.every((row) => row.commissionExpected === 0),
      basePreserved: generatedRows.every((row) => row.itemBaseAmount > 0),
      reasonVisible: generatedRows.every((row) => Boolean(row.exclusionReason)),
      ruleIdVisible: generatedRows.every((row) => Boolean(row.exclusionRuleId)),
      statusSemComissao: generatedRows.every((row) => row.commissionStatus === "SEM_COMISSAO"),
    },
    monthlyClosing: {
      payableCommissionTotal: payableSummary.payableCommissionTotal,
      releasedCommissionZero: payableSummary.payableCommissionTotal === 0,
    },
    forecast: {
      expectedCommissionTotal: forecastCommissionTotal,
      forecastCommissionZero: forecastCommissionTotal === 0,
    },
    generated: {
      commissionExpectedTotal: generatedCards.commissionExpectedTotal,
      generatedCommissionZero: generatedCards.commissionExpectedTotal === 0,
    },
    csv: {
      hasComissionavelColumn: visualCsv.includes("comissionavel"),
      hasMotivoExclusaoColumn: visualCsv.includes("motivoExclusao"),
      hasRegraExclusaoIdColumn: visualCsv.includes("regraExclusaoId"),
      reasonPresentInExport:
        visualCsv.includes(exclusionReason) ||
        closingCsv.includes(exclusionReason) ||
        forecastCsv.includes(exclusionReason) ||
        visualCsv.includes("motivoExclusao"),
    },
  };
}

export function buildCustomerExclusionAuditReport(input: {
  preview: ExclusionImpactPreview;
  rules: CustomerExclusionRuleSnapshot[];
  receivedByRecordId?: Map<string, number>;
}): CustomerExclusionAuditReport {
  const receivedByRecordId = input.receivedByRecordId ?? new Map<string, number>();
  const lines = input.preview.lines.map((line) =>
    buildCustomerExclusionAuditLine(line, receivedByRecordId)
  );

  const orderSet = new Set(lines.map((l) => l.orderCode).filter(Boolean));
  const nfeSet = new Set(lines.map((l) => l.nfeNumber).filter(Boolean));
  const receivableSet = new Set(lines.flatMap((l) => l.nomusReceivableIds));

  let soldBaseTotal = 0;
  let receivedAmountTotal = 0;
  let commissionBeforeTotal = 0;
  let commissionCurrentTotal = 0;
  let commissionAfterTotal = 0;
  let releasedCurrentTotal = 0;
  let releasedAfterTotal = 0;

  for (const line of lines) {
    soldBaseTotal = roundMoney(soldBaseTotal + line.soldBaseAmount);
    receivedAmountTotal = roundMoney(receivedAmountTotal + line.receivedAmount);
    commissionBeforeTotal = roundMoney(commissionBeforeTotal + line.commissionBefore);
    commissionCurrentTotal = roundMoney(commissionCurrentTotal + line.commissionCurrent);
    commissionAfterTotal = roundMoney(commissionAfterTotal + line.commissionAfter);
    releasedCurrentTotal = roundMoney(releasedCurrentTotal + line.releasedCurrent);
    releasedAfterTotal = roundMoney(releasedAfterTotal + line.releasedAfter);
  }

  const auditRules = input.rules.map(mapRuleToAuditInfo);
  const limitations = [
    "A regra vem do cadastro CommissionCustomerExclusionRule — nenhum cliente é hardcoded no código.",
    "Registros pagos podem permanecer bloqueados para alteração automática (paidCommissionBlockAutoChange).",
    "Fechamento mensal deriva status de CommissionPaymentBatch; não há entidade persistida de fechamento.",
    "Dados Nomus/AP não são alterados por exclusão de comissão.",
    "Impacto 'antes' usa comissão simulada sem exclusão quando o registro ainda não foi reprocessado.",
  ];

  const fixtureRows = lines.length
    ? lines.map((line, index) =>
        buildVisualAuditRow(
          buildExcludedCustomerVisualAuditInput({
            lineId: `${line.recordId}:${index}`,
            recordId: line.recordId,
            orderCode: line.orderCode,
            nfeNumber: line.nfeNumber,
            customerName: line.customerName,
            itemBaseAmount: line.soldBaseAmount,
            commissionExpected: line.commissionAfter,
            commissionReleased: line.releasedAfter,
            exclusionReason: line.exclusionReason ?? "Cliente excluído de comissionamento",
            exclusionRuleId: line.exclusionRuleId,
            receivedAmount: line.receivedAmount,
            settlementDate:
              input.preview.bySettlementMonth[0]?.monthKey != null
                ? `${input.preview.bySettlementMonth[0]!.monthKey}-15T00:00:00.000Z`
                : null,
          })
        )
      )
    : [buildVisualAuditRow(buildExcludedCustomerVisualAuditInput())];

  const exclusionReason =
    lines.find((line) => line.exclusionReason)?.exclusionReason ??
    auditRules[0]?.reason ??
    "Cliente excluído de comissionamento";

  return {
    customerFilter: input.preview.customerFilter,
    dateRange: input.preview.dateRange,
    rules: auditRules,
    ruleRegistered: auditRules.some((rule) => rule.status === "ACTIVE"),
    summary: {
      salesLineCount: lines.length,
      ordersCount: orderSet.size,
      nfesCount: nfeSet.size,
      receivablesCount: receivableSet.size,
      soldBaseTotal,
      receivedAmountTotal,
      commissionableBaseTotal: soldBaseTotal,
      commissionBeforeTotal,
      commissionCurrentTotal,
      commissionAfterTotal,
      commissionDiffTotal: roundMoney(commissionAfterTotal - commissionCurrentTotal),
      releasedCurrentTotal,
      releasedAfterTotal,
    },
    byReferenceMonth: aggregateAuditMonth(lines, (line) => [line.referenceDate.slice(0, 7)]),
    bySettlementMonth: aggregateAuditMonth(lines, (line) => {
      const impact = input.preview.lines.find((item) => item.recordId === line.recordId);
      return impact?.settlementMonthKeys ?? [];
    }),
    lines,
    uiValidation: buildUiValidationFromVisualRows(fixtureRows, exclusionReason),
    limitations,
    warnings: input.preview.warnings,
  };
}

export function buildCustomerExclusionAuditCsv(report: CustomerExclusionAuditReport): string {
  const header =
    "pedido,nf,cliente,vendedor,referencia,base_vendida,valor_recebido,comissao_antes,comissao_atual,comissao_apos,diferenca,liberado_atual,liberado_apos,regra_id,motivo,ja_excluido,categoria_titulo,cr_ids";
  const rows = report.lines.map((line) =>
    [
      line.orderCode ?? "",
      line.nfeNumber ?? "",
      line.customerName ?? "",
      line.sellerName,
      line.referenceDate,
      line.soldBaseAmount.toFixed(2),
      line.receivedAmount.toFixed(2),
      line.commissionBefore.toFixed(2),
      line.commissionCurrent.toFixed(2),
      line.commissionAfter.toFixed(2),
      line.commissionDiff.toFixed(2),
      line.releasedCurrent.toFixed(2),
      line.releasedAfter.toFixed(2),
      line.exclusionRuleId ?? "",
      line.exclusionReason ?? "",
      line.alreadyExcluded ? "sim" : "nao",
      line.titleCategory,
      line.nomusReceivableIds.join("|"),
    ]
      .map((value) => {
        const s = String(value);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(",")
  );
  return [header, ...rows].join("\n");
}

export function buildCustomerExclusionAuditMarkdown(
  report: CustomerExclusionAuditReport,
  customerLabel: string
): string {
  const rulesSection =
    report.rules.length > 0
      ? report.rules
          .map(
            (rule) =>
              `- **${rule.customerNameSnapshot}** (\`${rule.id}\`)
  - Vigência: ${rule.effectiveFrom} → ${rule.effectiveTo ?? "sem fim"}
  - Status: ${rule.status}
  - Motivo: ${rule.reason}`
          )
          .join("\n")
      : "_Nenhuma regra ACTIVE encontrada para o filtro informado._";

  const monthLines =
    report.byReferenceMonth.length > 0
      ? report.byReferenceMonth
          .map(
            (m) =>
              `| ${m.monthKey} | ${m.lineCount} | ${m.soldBaseAmount.toFixed(2)} | ${m.commissionBefore.toFixed(2)} | ${m.commissionAfter.toFixed(2)} | ${m.commissionDiff.toFixed(2)} |`
          )
          .join("\n")
      : "| — | — | — | — | — | — |";

  return `# Validação — exclusão de comissão (${customerLabel})

Gerado em: ${new Date().toISOString()}
Período: ${report.dateRange.label}

## Regra cadastrada

${rulesSection}

## Resumo do impacto esperado

| Métrica | Valor |
|--------|------:|
| Linhas de venda | ${report.summary.salesLineCount} |
| Pedidos | ${report.summary.ordersCount} |
| NFs | ${report.summary.nfesCount} |
| CRs | ${report.summary.receivablesCount} |
| Base vendida | ${report.summary.soldBaseTotal.toFixed(2)} |
| Valor recebido | ${report.summary.receivedAmountTotal.toFixed(2)} |
| Comissão atual | ${report.summary.commissionCurrentTotal.toFixed(2)} |
| Comissão após exclusão | ${report.summary.commissionAfterTotal.toFixed(2)} |
| Diferença | ${report.summary.commissionDiffTotal.toFixed(2)} |

## Impacto por mês (referência NF/pedido)

| Mês | Linhas | Base | Comissão antes | Comissão após | Diff |
|-----|-------:|-----:|---------------:|--------------:|-----:|
${monthLines}

## Como aparece na auditoria visual

- Linhas **permanecem visíveis** (pedido/NF/CR).
- \`commissionStatus\` = **SEM_COMISSAO**.
- \`isCommissionable\` = false; base/item preservados.
- Alerta: _Cliente excluído de comissionamento — {motivo}_.

## Como aparece no fechamento mensal

- Títulos baixados entram na lista; **comissão liberada = R$ 0,00**.
- Total a pagar no mês ignora comissão do cliente excluído.

## Como aparece na previsão

- Títulos em aberto/futuros visíveis; **comissão prevista = R$ 0,00**.

## Como aparece no CSV

Colunas: \`comissionavel\`, \`motivoExclusao\`, \`regraExclusaoId\`, \`comissaoPrevista\` (0).

## Validação automatizada (fixture)

| Check | OK |
|-------|:--:|
| Auditoria com comissão zero | ${report.uiValidation.visualAudit.commissionZero ? "✓" : "✗"} |
| Base preservada | ${report.uiValidation.visualAudit.basePreserved ? "✓" : "✗"} |
| Fechamento zero | ${report.uiValidation.monthlyClosing.releasedCommissionZero ? "✓" : "✗"} |
| Previsão zero | ${report.uiValidation.forecast.forecastCommissionZero ? "✓" : "✗"} |
| CSV com motivo | ${report.uiValidation.csv.hasMotivoExclusaoColumn ? "✓" : "✗"} |

## Limitações

${report.limitations.map((item) => `- ${item}`).join("\n")}

## Comandos

\`\`\`bash
npx tsx scripts/audit-commission-customer-exclusion.ts --customer="${customerLabel}" --from=${report.dateRange.label.split(" a ")[0]} --to=${report.dateRange.label.split(" a ")[1] ?? report.dateRange.label}
npx tsx scripts/preview-commission-customer-exclusion-impact.ts --customer="${customerLabel}" --from=... --to=...
\`\`\`
`;
}
