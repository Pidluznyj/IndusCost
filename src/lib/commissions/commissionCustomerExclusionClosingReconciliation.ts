/**
 * Reconciliação das exceções manuais com o universo oficial do Fechamento por recebimento.
 */
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions.js";
import { roundMoney } from "./commission-money.js";
import { COMMISSION_GROUP_COMPANY_EXCLUSION_REASON } from "./commissionInternalGroupExclusion.js";
import { normalizeCustomerNameForExclusion } from "./commissionCustomerExclusion.js";
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import type {
  ReceiptClosingApiLine,
  ReceiptClosingMaterializationSummary,
  ReceiptClosingPagePayload,
} from "./commissionReceiptClosingApi.shared.js";

export const CUSTOMER_EXCLUSION_CLOSING_SCOPE_NOTE =
  "Reconciliação com o Fechamento do mês por settlementDate — mesma base usada em Previsão e Auditoria Visual.";

export const CUSTOMER_EXCLUSION_MANUAL_LABEL = "Exceção manual ativa";
export const CUSTOMER_EXCLUSION_GROUP_AUTO_LABEL = "Exclusão automática — empresa do grupo";
export const CUSTOMER_EXCLUSION_IMPACT_IN_CLOSING_LABEL = "Impactado no fechamento do mês";
export const CUSTOMER_EXCLUSION_EXCLUDED_FROM_COMMISSION_LABEL = "Excluído da comissão";

export type CustomerExclusionClosingCustomerRow = {
  customerKey: string;
  customerName: string | null;
  customerExternalId: number | null;
  customerId: string | null;
  exclusionRuleId: string | null;
  exclusionReason: string | null;
  exclusionLabel: string;
  receivableCount: number;
  receivedAmount: number;
  matchedRuleIds: string[];
};

export type CustomerExclusionGroupCompanyRow = {
  cnpj: string;
  displayCnpj: string;
  companyName: string;
  receivableCount: number;
  receivedAmount: number;
  exclusionLabel: string;
};

export type CustomerExclusionRuleClosingImpact = {
  ruleId: string;
  customerNameSnapshot: string;
  customerExternalId: number | null;
  customerTaxId: string | null;
  reason: string;
  status: string;
  receivableCount: number;
  receivedAmount: number;
  usedInClosing: boolean;
  impactLabel: string | null;
};

export type CustomerExclusionClosingReconciliationPayload = {
  year: number;
  month: number;
  scopeNote: string;
  materializationSummary: ReceiptClosingMaterializationSummary;
  manualExcludedCustomers: CustomerExclusionClosingCustomerRow[];
  groupCompanyExcluded: CustomerExclusionGroupCompanyRow[];
  registeredRulesImpact: CustomerExclusionRuleClosingImpact[];
  fixedGroupCompanies: Array<{
    cnpj: string;
    displayCnpj: string;
    name: string;
    exclusionLabel: string;
    requiresManualRegistration: false;
  }>;
};

function customerKeyFromLine(line: ReceiptClosingApiLine): string {
  if (line.customerId) return `id:${line.customerId}`;
  if (line.customerExternalId != null) return `ext:${line.customerExternalId}`;
  const name = normalizeCustomerNameForExclusion(line.customerName);
  if (name) return `name:${name}`;
  return `recv:${line.nomusReceivableId ?? "unknown"}`;
}

function aggregateCustomerExcludedLines(
  lines: ReceiptClosingApiLine[]
): CustomerExclusionClosingCustomerRow[] {
  const buckets = new Map<string, CustomerExclusionClosingCustomerRow>();
  const receivablesSeen = new Map<string, Set<number>>();

  for (const line of lines) {
    if (line.status !== "CUSTOMER_EXCLUDED" || line.nomusReceivableId == null) continue;
    const key = customerKeyFromLine(line);
    const bucket =
      buckets.get(key) ??
      ({
        customerKey: key,
        customerName: line.customerName,
        customerExternalId: line.customerExternalId,
        customerId: line.customerId,
        exclusionRuleId: line.ruleId,
        exclusionReason: line.exclusionReason,
        exclusionLabel: CUSTOMER_EXCLUSION_EXCLUDED_FROM_COMMISSION_LABEL,
        receivableCount: 0,
        receivedAmount: 0,
        matchedRuleIds: [],
      } satisfies CustomerExclusionClosingCustomerRow);

    const seen = receivablesSeen.get(key) ?? new Set<number>();
    if (!seen.has(line.nomusReceivableId)) {
      seen.add(line.nomusReceivableId);
      bucket.receivableCount += 1;
      bucket.receivedAmount = roundMoney(bucket.receivedAmount + line.receivedAmount);
    }
    receivablesSeen.set(key, seen);

    if (line.ruleId && !bucket.matchedRuleIds.includes(line.ruleId)) {
      bucket.matchedRuleIds.push(line.ruleId);
    }
    if (!bucket.exclusionRuleId && line.ruleId) bucket.exclusionRuleId = line.ruleId;
    if (!bucket.exclusionReason && line.exclusionReason) {
      bucket.exclusionReason = line.exclusionReason;
    }
    buckets.set(key, bucket);
  }

  return [...buckets.values()].sort((a, b) =>
    (a.customerName ?? "").localeCompare(b.customerName ?? "", "pt-BR")
  );
}

function resolveGroupCompanyMeta(line: ReceiptClosingApiLine): {
  cnpj: string;
  displayCnpj: string;
  companyName: string;
} {
  const name = line.customerName ?? "";
  const lineName = normalizeCustomerNameForExclusion(name);
  for (const company of FINANCE_INTERNAL_GROUP_COMPANIES) {
    const normalized = normalizeCustomerNameForExclusion(company.name);
    if (
      lineName.includes(normalized) ||
      company.aliases.some(
        (alias) => lineName === normalizeCustomerNameForExclusion(alias)
      )
    ) {
      return {
        cnpj: company.cnpj,
        displayCnpj: company.displayCnpj,
        companyName: name || company.name,
      };
    }
  }
  return {
    cnpj: `unknown:${lineName || "grupo"}`,
    displayCnpj: "—",
    companyName: name || "Empresa do grupo",
  };
}

function aggregateGroupCompanyLines(
  lines: ReceiptClosingApiLine[]
): CustomerExclusionGroupCompanyRow[] {
  const buckets = new Map<string, CustomerExclusionGroupCompanyRow>();
  const receivablesSeen = new Map<string, Set<number>>();

  for (const line of lines) {
    if (line.status !== "GROUP_COMPANY_EXCLUDED" || line.nomusReceivableId == null) continue;
    const meta = resolveGroupCompanyMeta(line);
    const key = meta.cnpj;
    const bucket =
      buckets.get(key) ??
      ({
        cnpj: meta.cnpj,
        displayCnpj: meta.displayCnpj,
        companyName: meta.companyName,
        receivableCount: 0,
        receivedAmount: 0,
        exclusionLabel: CUSTOMER_EXCLUSION_GROUP_AUTO_LABEL,
      } satisfies CustomerExclusionGroupCompanyRow);

    const seen = receivablesSeen.get(key) ?? new Set<number>();
    if (!seen.has(line.nomusReceivableId)) {
      seen.add(line.nomusReceivableId);
      bucket.receivableCount += 1;
      bucket.receivedAmount = roundMoney(bucket.receivedAmount + line.receivedAmount);
    }
    receivablesSeen.set(key, bucket);
    buckets.set(key, bucket);
  }

  return [...buckets.values()].sort((a, b) => a.companyName.localeCompare(b.companyName, "pt-BR"));
}

function buildRegisteredRulesImpact(
  registeredRules: CustomerExclusionRuleSnapshot[],
  manualExcluded: CustomerExclusionClosingCustomerRow[]
): CustomerExclusionRuleClosingImpact[] {
  const impactByRule = new Map<string, { receivableCount: number; receivedAmount: number }>();
  for (const row of manualExcluded) {
    for (const ruleId of row.matchedRuleIds) {
      const bucket = impactByRule.get(ruleId) ?? { receivableCount: 0, receivedAmount: 0 };
      bucket.receivableCount += row.receivableCount;
      bucket.receivedAmount = roundMoney(bucket.receivedAmount + row.receivedAmount);
      impactByRule.set(ruleId, bucket);
    }
  }

  return registeredRules.map((rule) => {
    const impact = impactByRule.get(rule.id);
    const usedInClosing = impact != null && impact.receivableCount > 0;
    return {
      ruleId: rule.id,
      customerNameSnapshot: rule.customerNameSnapshot,
      customerExternalId: rule.customerExternalId,
      customerTaxId: rule.customerTaxId,
      reason: rule.reason,
      status: rule.status,
      receivableCount: impact?.receivableCount ?? 0,
      receivedAmount: impact?.receivedAmount ?? 0,
      usedInClosing,
      impactLabel: usedInClosing ? CUSTOMER_EXCLUSION_IMPACT_IN_CLOSING_LABEL : null,
    };
  });
}

export function buildCustomerExclusionClosingReconciliation(
  closingPage: ReceiptClosingPagePayload,
  registeredRules: CustomerExclusionRuleSnapshot[]
): CustomerExclusionClosingReconciliationPayload {
  const manualExcludedCustomers = aggregateCustomerExcludedLines(closingPage.lines);
  const groupCompanyExcluded = aggregateGroupCompanyLines(closingPage.groupCompanyAuditLines);

  return {
    year: closingPage.year,
    month: closingPage.month,
    scopeNote: CUSTOMER_EXCLUSION_CLOSING_SCOPE_NOTE,
    materializationSummary: closingPage.materializationSummary,
    manualExcludedCustomers,
    groupCompanyExcluded,
    registeredRulesImpact: buildRegisteredRulesImpact(registeredRules, manualExcludedCustomers),
    fixedGroupCompanies: FINANCE_INTERNAL_GROUP_COMPANIES.map((company) => ({
      cnpj: company.cnpj,
      displayCnpj: company.displayCnpj,
      name: company.name,
      exclusionLabel: CUSTOMER_EXCLUSION_GROUP_AUTO_LABEL,
      requiresManualRegistration: false as const,
    })),
  };
}

export function countManualExcludedCustomersInClosing(
  payload: CustomerExclusionClosingReconciliationPayload
): number {
  return payload.manualExcludedCustomers.length;
}

export function groupCompanyExclusionReasonMatchesClosing(): string {
  return COMMISSION_GROUP_COMPANY_EXCLUSION_REASON;
}
