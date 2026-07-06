import { Prisma } from "@prisma/client";
import { decimalFieldToNumber } from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  resolveTitleAllocationBaseAmount,
  type ApAllocationTitleRow,
} from "@/src/lib/financeAccountsPayableCostCenterAllocation.js";
import {
  FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE,
  FINANCE_AP_ALLOCATION_PERCENTAGE_TOLERANCE,
} from "@/src/lib/financeApAllocationShared.js";
import { isTitleFullyClassified } from "@/src/lib/financeCostCenterDashboard.js";
import { prisma } from "@/src/lib/prisma.js";

export type FinanceIntegrityIssueSeverity = "critical" | "warning";

export type FinanceIntegrityIssue = {
  code: string;
  severity: FinanceIntegrityIssueSeverity;
  message: string;
  entityId?: string;
  accountsPayableId?: number;
};

export type FinanceIntegrityReport = {
  checkedAt: string;
  issues: FinanceIntegrityIssue[];
  summary: {
    critical: number;
    warning: number;
    total: number;
    byCode: Record<string, number>;
  };
};

export type FinanceIntegrityAllocationRow = {
  id: string;
  accountsPayableId: number;
  supplierId: string | null;
  costCenterId: string;
  amount: Prisma.Decimal | null;
  percentage: Prisma.Decimal;
};

export type FinanceIntegrityRuleRow = {
  id: string;
  supplierId: string;
  costCenterId: string;
  isActive: boolean;
  supplierStatus: string;
  costCenterStatus: string;
};

export type FinanceIntegrityDeps = {
  loadAllocations: () => Promise<FinanceIntegrityAllocationRow[]>;
  loadApByExternalId: (externalId: number) => Promise<ApAllocationTitleRow | null>;
  loadActiveRulesWithMeta: () => Promise<FinanceIntegrityRuleRow[]>;
};

function allocationAmount(
  row: FinanceIntegrityAllocationRow,
  titleAmount: number
): number {
  const explicit = row.amount != null ? decimalFieldToNumber(row.amount) : 0;
  if (explicit > 0) return explicit;
  return (titleAmount * decimalFieldToNumber(row.percentage)) / 100;
}

export function runFinanceCostCenterIntegrityCheck(
  deps: FinanceIntegrityDeps
): Promise<FinanceIntegrityReport> {
  return runCheck(deps);
}

async function runCheck(deps: FinanceIntegrityDeps): Promise<FinanceIntegrityReport> {
  const issues: FinanceIntegrityIssue[] = [];
  const allocations = await deps.loadAllocations();
  const rules = await deps.loadActiveRulesWithMeta();

  for (const rule of rules) {
    if (!rule.isActive) continue;
    if (rule.costCenterStatus !== "ACTIVE") {
      issues.push({
        code: "ACTIVE_RULE_INACTIVE_COST_CENTER",
        severity: "critical",
        entityId: rule.id,
        message: `Regra ativa ${rule.id} referencia centro de custo inativo (${rule.costCenterId}).`,
      });
    }
    if (rule.supplierStatus !== "ACTIVE") {
      issues.push({
        code: "ACTIVE_RULE_INACTIVE_SUPPLIER",
        severity: "critical",
        entityId: rule.id,
        message: `Regra ativa ${rule.id} referencia fornecedor inativo (${rule.supplierId}).`,
      });
    }
  }

  const byPayable = new Map<number, FinanceIntegrityAllocationRow[]>();
  for (const allocation of allocations) {
    const list = byPayable.get(allocation.accountsPayableId) ?? [];
    list.push(allocation);
    byPayable.set(allocation.accountsPayableId, list);
  }

  for (const [accountsPayableId, rows] of byPayable.entries()) {
    const ap = await deps.loadApByExternalId(accountsPayableId);
    if (!ap) {
      for (const row of rows) {
        issues.push({
          code: "ORPHAN_ALLOCATION",
          severity: "critical",
          entityId: row.id,
          accountsPayableId,
          message: `Alocação órfã ${row.id} — título AP ${accountsPayableId} não existe.`,
        });
      }
      continue;
    }

    const titleAmount = resolveTitleAllocationBaseAmount(ap);
    const pctTotal = rows.reduce(
      (sum, row) => sum + decimalFieldToNumber(row.percentage),
      0
    );
    if (Math.abs(pctTotal - 100) > FINANCE_AP_ALLOCATION_PERCENTAGE_TOLERANCE) {
      issues.push({
        code: "ALLOCATION_PERCENTAGE_MISMATCH",
        severity: "critical",
        accountsPayableId,
        message: `Título AP ${accountsPayableId}: percentual soma ${pctTotal.toFixed(2)}% (esperado 100%).`,
      });
    }

    const amountTotal = rows.reduce(
      (sum, row) => sum + allocationAmount(row, titleAmount),
      0
    );
    if (
      titleAmount > 0 &&
      Math.abs(amountTotal - titleAmount) > FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE
    ) {
      issues.push({
        code: "ALLOCATION_AMOUNT_MISMATCH",
        severity: "warning",
        accountsPayableId,
        message: `Título AP ${accountsPayableId}: valor alocado ${amountTotal.toFixed(2)} ≠ título ${titleAmount.toFixed(2)}.`,
      });
    }

    const dashboardAllocations = rows.map((row) => ({
      id: row.id,
      accountsPayableId: row.accountsPayableId,
      supplierId: row.supplierId,
      costCenterId: row.costCenterId,
      amount: row.amount,
      percentage: row.percentage,
    }));
    if (
      isTitleFullyClassified(dashboardAllocations) &&
      rows.every((row) => !row.supplierId)
    ) {
      issues.push({
        code: "CLASSIFIED_WITHOUT_SUPPLIER",
        severity: "warning",
        accountsPayableId,
        message: `Título AP ${accountsPayableId} classificado (100%) sem fornecedor consolidado.`,
      });
    }
  }

  const byCode: Record<string, number> = {};
  let critical = 0;
  let warning = 0;
  for (const issue of issues) {
    byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;
    if (issue.severity === "critical") critical += 1;
    else warning += 1;
  }

  return {
    checkedAt: new Date().toISOString(),
    issues,
    summary: {
      critical,
      warning,
      total: issues.length,
      byCode,
    },
  };
}

export function printFinanceCostCenterIntegritySummary(report: FinanceIntegrityReport): void {
  const { summary } = report;
  console.warn(`[finance-cc-integrity] Verificação em ${report.checkedAt}`);
  console.warn(
    `[finance-cc-integrity] Total: ${summary.total} · críticos: ${summary.critical} · avisos: ${summary.warning}`
  );
  if (summary.total === 0) {
    console.warn("[finance-cc-integrity] Nenhuma inconsistência encontrada.");
    return;
  }
  for (const [code, count] of Object.entries(summary.byCode).sort((a, b) => b[1] - a[1])) {
    console.warn(`[finance-cc-integrity]   ${code}: ${count}`);
  }
  const sample = report.issues.slice(0, 25);
  for (const issue of sample) {
    console.warn(`[finance-cc-integrity] [${issue.severity}] ${issue.message}`);
  }
  if (report.issues.length > sample.length) {
    console.warn(
      `[finance-cc-integrity] … e mais ${report.issues.length - sample.length} ocorrência(s).`
    );
  }
}

export function createDefaultFinanceIntegrityDeps(): FinanceIntegrityDeps {
  return {
    loadAllocations: async () =>
      prisma.accountsPayableCostCenterAllocation.findMany({
        select: {
          id: true,
          accountsPayableId: true,
          supplierId: true,
          costCenterId: true,
          amount: true,
          percentage: true,
        },
      }),
    loadApByExternalId: async (externalId) => {
      const row = await prisma.nomusAccountsPayable.findUnique({
        where: { externalId },
        select: {
          externalId: true,
          personId: true,
          personName: true,
          personCnpj: true,
          companyId: true,
          companyName: true,
          rawPayload: true,
          balancePayable: true,
          amountPayable: true,
          suspendPayment: true,
          competenceDate: true,
          dueDate: true,
        },
      });
      if (!row) return null;
      return {
        externalId: row.externalId,
        personId: row.personId,
        personName: row.personName,
        personCnpj: row.personCnpj,
        companyId: row.companyId,
        companyName: row.companyName,
        rawPayload: row.rawPayload,
        balancePayable: decimalFieldToNumber(row.balancePayable),
        amountPayable: decimalFieldToNumber(row.amountPayable),
        suspendPayment: row.suspendPayment,
        competenceDate: row.competenceDate,
        dueDate: row.dueDate,
      };
    },
    loadActiveRulesWithMeta: async () => {
      const rows = await prisma.supplierCostCenterRule.findMany({
        where: { isActive: true },
        select: {
          id: true,
          supplierId: true,
          costCenterId: true,
          isActive: true,
          supplier: { select: { status: true } },
          costCenter: { select: { status: true } },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        supplierId: row.supplierId,
        costCenterId: row.costCenterId,
        isActive: row.isActive,
        supplierStatus: row.supplier.status,
        costCenterStatus: row.costCenter.status,
      }));
    },
  };
}

export async function runFinanceCostCenterIntegrityCheckDefault(): Promise<FinanceIntegrityReport> {
  return runFinanceCostCenterIntegrityCheck(createDefaultFinanceIntegrityDeps());
}
