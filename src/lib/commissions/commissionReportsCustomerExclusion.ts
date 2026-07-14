/**
 * Soft-aplica das regras de cliente não comissionável nos Relatórios.
 * Não altera ledger/fechamento — só a classificação exibida / exportada.
 */
import {
  CUSTOMER_COMMISSION_EXCLUSION_MESSAGE,
  type CustomerExclusionRuleSnapshot,
} from "./commissionCustomerExclusion.js";
import { resolveCustomerExclusionForSale } from "./commissionCustomerExclusionApply.js";
import { roundMoney } from "./commission-money.shared.js";
import type { CommissionReportSourceLine } from "./commissionReports.shared.js";

const CUSTOMER_EXCLUDED_BY_RULE_REASON = "CLIENTE_EXCLUIDO_POR_REGRA";

function parseReferenceDate(iso: string | null | undefined, year: number, month: number): Date {
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(Date.UTC(year, month - 1, 15));
}

function previousDisplayCommission(line: CommissionReportSourceLine): number {
  const candidates = [
    line.grossCommissionAmount,
    line.releasedCommissionAmount,
    line.expectedCommissionAmount,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0.009) {
      return roundMoney(value);
    }
  }
  return 0;
}

/**
 * Reclassifica linhas ainda "comissionáveis" (ou outras sem exclusão) quando a regra
 * ativa de cliente não comissionável se aplica na data do recebimento.
 */
export function applyActiveCustomerExclusionsToReportLines(
  lines: CommissionReportSourceLine[],
  rules: CustomerExclusionRuleSnapshot[]
): CommissionReportSourceLine[] {
  if (lines.length === 0 || rules.length === 0) return lines;

  return lines.map((line) => {
    if (line.status === "CUSTOMER_EXCLUDED" || line.status === "GROUP_COMPANY_EXCLUDED") {
      return line;
    }

    const exclusion = resolveCustomerExclusionForSale({
      customerId: line.customerId,
      customerExternalId: line.customerExternalId,
      customerName: line.customerName,
      referenceDate: parseReferenceDate(line.settlementDate, line.year, line.month),
      rules,
    });
    if (!exclusion) return line;

    const priorCommission = previousDisplayCommission(line);
    return {
      ...line,
      status: "CUSTOMER_EXCLUDED",
      statusReason: CUSTOMER_EXCLUDED_BY_RULE_REASON,
      exclusionReason: exclusion.reason || CUSTOMER_COMMISSION_EXCLUSION_MESSAGE,
      ratePercent: 0,
      releasedCommissionAmount: 0,
      expectedCommissionAmount: priorCommission > 0 ? priorCommission : line.expectedCommissionAmount,
      grossCommissionAmount: priorCommission > 0 ? priorCommission : line.grossCommissionAmount,
      source:
        line.source === "PERSISTED_LEDGER" || line.source === "PERSISTED_SCHEDULE"
          ? `${line.source}+CUSTOMER_EXCLUSION_RULE`
          : line.source,
    };
  });
}
