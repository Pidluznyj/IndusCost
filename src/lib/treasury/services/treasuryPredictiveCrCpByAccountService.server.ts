/**
 * Service — CR/CP do Fluxo Gerencial agrupados por conta local via Nomus bankAccountId.
 * Somente leitura dos motores oficiais Nomus AR/AP.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { extractInstallmentFromNomusRaw } from "../mappers/treasuryOfficialTitleMappers.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";
import {
  buildTreasuryCrCpByAccountBoard,
  type TreasuryCrCpByAccountBoardDto,
  type TreasuryCrCpLocalAccount,
  type TreasuryCrCpTitleSeed,
} from "../domain/treasuryPredictiveCrCpByAccountRules.js";

function civilToUtcDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function moneyFromDecimal(
  value: { toFixed(digits: number): string } | string | number | null | undefined
): string {
  if (value == null || value === "") return "0.00";
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  if (typeof value === "number") {
    return normalizeTreasuryMoneyString(value.toFixed(2));
  }
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

const AR_SELECT = {
  id: true,
  personName: true,
  bankAccountId: true,
  bankAccountName: true,
  dueDate: true,
  amountReceivable: true,
  amountReceived: true,
  balanceReceivable: true,
  sourceInvoiceNumber: true,
  description: true,
  rawPayload: true,
  sourcePresenceStatus: true,
  sourceRemovedAt: true,
} satisfies Prisma.NomusAccountsReceivableSelect;

const AP_SELECT = {
  id: true,
  personName: true,
  bankAccountId: true,
  bankAccountName: true,
  dueDate: true,
  amountPayable: true,
  amountPaid: true,
  balancePayable: true,
  documentNumber: true,
  sourceInvoiceNumber: true,
  description: true,
  rawPayload: true,
  sourcePresenceStatus: true,
  sourceRemovedAt: true,
} satisfies Prisma.NomusAccountsPayableSelect;

export type TreasuryPredictiveCrCpByAccountQuery = {
  companyCode: string;
  fromDate: string;
  toDate: string;
};

export type TreasuryPredictiveCrCpByAccountService = {
  getBoard(
    query: TreasuryPredictiveCrCpByAccountQuery
  ): Promise<TreasuryCrCpByAccountBoardDto>;
};

export function createTreasuryPredictiveCrCpByAccountService(input: {
  prisma: PrismaClient;
}): TreasuryPredictiveCrCpByAccountService {
  const { prisma } = input;

  return {
    async getBoard(query) {
      const companyCode = query.companyCode.trim();
      const fromDate = query.fromDate.trim();
      const toDate = query.toDate.trim();
      if (!companyCode) {
        return buildTreasuryCrCpByAccountBoard({
          fromDate,
          toDate,
          accounts: [],
          titles: [],
        });
      }

      const endDay = civilToUtcDate(toDate);
      endDay.setUTCDate(endDay.getUTCDate() + 1);
      const endExclusive = endDay;

      const [accountRows, arRows, apRows] = await Promise.all([
        prisma.treasuryFinancialAccount.findMany({
          where: { companyCode },
          select: {
            id: true,
            code: true,
            name: true,
            institutionName: true,
            nomusBankAccountId: true,
            isActive: true,
            includeInConsolidated: true,
            sortOrder: true,
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
        prisma.nomusAccountsReceivable.findMany({
          where: {
            balanceReceivable: { gt: 0 },
            sourcePresenceStatus: { not: "MISSING_CONFIRMED" },
            sourceRemovedAt: null,
            OR: [
              { dueDate: { lt: endExclusive } },
              { dueDate: null },
            ],
          },
          select: AR_SELECT,
          take: 50_000,
        }),
        prisma.nomusAccountsPayable.findMany({
          where: {
            balancePayable: { gt: 0 },
            sourcePresenceStatus: { not: "MISSING_CONFIRMED" },
            sourceRemovedAt: null,
            OR: [
              { dueDate: { lt: endExclusive } },
              { dueDate: null },
            ],
          },
          select: AP_SELECT,
          take: 50_000,
        }),
      ]);

      const activeIds = accountRows.filter((a) => a.isActive).map((a) => a.id);
      const latestBalances =
        activeIds.length === 0
          ? []
          : await prisma.treasuryBalanceSnapshot.findMany({
              where: { accountId: { in: activeIds }, cancelledAt: null },
              orderBy: [{ referenceAt: "desc" }, { createdAt: "desc" }],
              distinct: ["accountId"],
              select: {
                accountId: true,
                availableBalance: true,
              },
            });
      const balanceByAccount = new Map(
        latestBalances.map((b) => [
          b.accountId,
          moneyFromDecimal(b.availableBalance),
        ])
      );

      const titleIds = [
        ...arRows.map((r) => r.id),
        ...apRows.map((r) => r.id),
      ];
      const overlays =
        titleIds.length === 0
          ? []
          : await prisma.treasuryTitleOperationalComplement.findMany({
              where: {
                officialTitleId: { in: titleIds },
                cancelledAt: null,
                plannedAccountId: { not: null },
              },
              select: {
                officialTitleId: true,
                plannedAccountId: true,
              },
            });
      const plannedByTitle = new Map(
        overlays.map((o) => [o.officialTitleId, o.plannedAccountId])
      );

      const accounts: TreasuryCrCpLocalAccount[] = accountRows.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        institutionName: a.institutionName,
        nomusBankAccountId: a.nomusBankAccountId,
        isActive: a.isActive,
        includeInConsolidated: a.includeInConsolidated,
        sortOrder: a.sortOrder,
        currentBalance: balanceByAccount.get(a.id) ?? "0.00",
      }));

      const titles: TreasuryCrCpTitleSeed[] = [];

      for (const row of arRows) {
        const installment = extractInstallmentFromNomusRaw(
          row.rawPayload,
          row.description
        );
        titles.push({
          id: row.id,
          side: "RECEIVABLE",
          dueDate: toCivilDateKey(row.dueDate),
          openBalance: moneyFromDecimal(row.balanceReceivable),
          originalAmount: moneyFromDecimal(row.amountReceivable),
          settledAmount: moneyFromDecimal(row.amountReceived),
          counterpartyName: row.personName,
          documentNumber: row.sourceInvoiceNumber,
          installmentLabel: installment.installmentLabel,
          nomusFinancialAccountId: row.bankAccountId,
          nomusFinancialAccountName: row.bankAccountName,
          plannedAccountId: plannedByTitle.get(row.id) ?? null,
        });
      }

      for (const row of apRows) {
        const installment = extractInstallmentFromNomusRaw(
          row.rawPayload,
          row.description
        );
        titles.push({
          id: row.id,
          side: "PAYABLE",
          dueDate: toCivilDateKey(row.dueDate),
          openBalance: moneyFromDecimal(row.balancePayable),
          originalAmount: moneyFromDecimal(row.amountPayable),
          settledAmount: moneyFromDecimal(row.amountPaid),
          counterpartyName: row.personName,
          documentNumber: row.documentNumber ?? row.sourceInvoiceNumber,
          installmentLabel: installment.installmentLabel,
          nomusFinancialAccountId: row.bankAccountId,
          nomusFinancialAccountName: row.bankAccountName,
          plannedAccountId: plannedByTitle.get(row.id) ?? null,
        });
      }

      return buildTreasuryCrCpByAccountBoard({
        fromDate,
        toDate,
        accounts,
        titles,
      });
    },
  };
}
