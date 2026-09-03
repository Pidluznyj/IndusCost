/**
 * Universo canônico de contas do CONSOLIDADO — server-only.
 *
 * Única autoridade para "quais contas compõem o caixa consolidado e em que
 * dias". Substitui os filtros duplicados (isActive / includeInConsolidated /
 * companyCode) espalhados por treasuryCaixaService, treasuryOfficialTodayBalance
 * e afins, e o padrão `companyAccounts[0]?.companyCode` como empresa global.
 *
 * Membership TEMPORAL: `TreasuryConsolidatedAccountMembership` (intervalos
 * [validFrom, validUntil]). Conta sem nenhuma linha (migration ainda não
 * aplicada / conta legada) cai no fallback DERIVADO pelos campos da conta
 * (`createdAt` → `deactivatedAt`) com warning explícito — nunca silencioso,
 * nunca quebra.
 */

import type { PrismaClient } from "@prisma/client";
import type {
  TreasuryConsolidatedAccountMembershipView,
  TreasuryConsolidatedMembershipInterval,
  TreasuryDailyBalanceWarning,
} from "../domain/treasuryDailyBalanceAuthority.js";
import { civilDateFromInstantInSaoPaulo } from "../contracts/treasuryCivilDate.js";
import { treasuryCompanyCodePresentWhere } from "../treasuryPrismaFilters.js";

export type TreasuryConsolidatedAccountUniverse = {
  accounts: readonly TreasuryConsolidatedAccountMembershipView[];
  /** companyCodes distintos presentes no universo (ordem estável). */
  companyCodes: readonly string[];
  warnings: readonly TreasuryDailyBalanceWarning[];
};

export type TreasuryConsolidatedAccountFieldsForMembership = {
  id: string;
  includeInConsolidated: boolean;
  isActive: boolean;
  createdAt: Date;
  deactivatedAt: Date | null;
};

/**
 * Fallback DERIVADO: intervalo de membership a partir dos campos da conta.
 * `includeInConsolidated = false` → null (nunca esteve no consolidado, até
 * onde os campos permitem saber). Datas civis em America/Sao_Paulo.
 */
export function deriveTreasuryMembershipFromAccountFields(
  account: TreasuryConsolidatedAccountFieldsForMembership
): TreasuryConsolidatedMembershipInterval | null {
  if (!account.includeInConsolidated) return null;

  const validFrom = civilDateFromInstantInSaoPaulo(account.createdAt);
  if (!account.isActive && account.deactivatedAt) {
    return { validFrom, validUntil: civilDateFromInstantInSaoPaulo(account.deactivatedAt) };
  }
  // Ativa, ou inativa sem `deactivatedAt` registrado (defensivo: sem data de
  // desativação não há como fechar o intervalo) — permanece vigente.
  return { validFrom, validUntil: null };
}

/**
 * Colunas `@db.Date` chegam do Prisma como `Date` em meia-noite UTC — extrai
 * o dia civil já persistido sem reinterpretar fuso (diferente de
 * `civilDateFromInstantInSaoPaulo`, que converte um INSTANTE). Aceita string
 * já formatada (dublês de teste) para não quebrar em runtime.
 */
function toIsoDateFromDbDate(value: Date | string): string {
  if (typeof value === "string") return value;
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toIsoDateFromDbDateOrNull(value: Date | string | null): string | null {
  return value == null ? null : toIsoDateFromDbDate(value);
}

/** Código de empresa utilizável: não-nulo e não-vazio após trim. */
function hasUsableCompanyCode(companyCode: string | null | undefined): companyCode is string {
  return companyCode != null && companyCode.trim() !== "";
}

/**
 * Carrega contas (com companyCode presente) que estiveram no consolidado em
 * algum dia de [fromCivilDate, toCivilDate], com seus intervalos. Duas
 * consultas no total (contas + memberships) — nunca por dia/conta.
 */
export async function loadTreasuryConsolidatedAccountUniverse(
  prisma: PrismaClient,
  range: { fromCivilDate: string; toCivilDate: string }
): Promise<TreasuryConsolidatedAccountUniverse> {
  // `range` não filtra nenhuma das duas consultas: o universo de contas é
  // TEMPORAL desde a criação de cada conta (uma conta desativada antes do
  // range pedido ainda precisa resolver dias passados dentro do range — ver
  // teste "conta inativa... ainda aparece no universo") e a tabela de
  // membership é lida por inteiro por conta (nunca por dia).
  void range;

  const accounts = await prisma.treasuryFinancialAccount.findMany({
    where: treasuryCompanyCodePresentWhere(),
    select: {
      id: true,
      companyCode: true,
      name: true,
      includeInConsolidated: true,
      isActive: true,
      createdAt: true,
      deactivatedAt: true,
    },
  });

  const usableAccounts = accounts.filter((account) => hasUsableCompanyCode(account.companyCode));
  const accountIds = usableAccounts.map((account) => account.id);

  const membershipRows =
    accountIds.length > 0
      ? await prisma.treasuryConsolidatedAccountMembership.findMany({
          where: { accountId: { in: accountIds } },
          select: { accountId: true, validFrom: true, validUntil: true },
        })
      : [];

  const membershipsByAccountId = new Map<string, typeof membershipRows>();
  for (const row of membershipRows) {
    const list = membershipsByAccountId.get(row.accountId);
    if (list) list.push(row);
    else membershipsByAccountId.set(row.accountId, [row]);
  }

  const warnings: TreasuryDailyBalanceWarning[] = [];
  const companyCodes: string[] = [];
  const companyCodesSeen = new Set<string>();
  const accountViews: TreasuryConsolidatedAccountMembershipView[] = [];

  for (const account of usableAccounts) {
    const companyCode = account.companyCode as string;
    if (!companyCodesSeen.has(companyCode)) {
      companyCodesSeen.add(companyCode);
      companyCodes.push(companyCode);
    }

    const tableRows = membershipsByAccountId.get(account.id) ?? [];
    let memberships: TreasuryConsolidatedMembershipInterval[];
    let membershipSource: "TABLE" | "DERIVED";

    if (tableRows.length > 0) {
      memberships = tableRows.map((row) => ({
        validFrom: toIsoDateFromDbDate(row.validFrom),
        validUntil: toIsoDateFromDbDateOrNull(row.validUntil),
      }));
      membershipSource = "TABLE";
    } else {
      membershipSource = "DERIVED";
      const derived = deriveTreasuryMembershipFromAccountFields({
        id: account.id,
        includeInConsolidated: account.includeInConsolidated,
        isActive: account.isActive,
        createdAt: account.createdAt,
        deactivatedAt: account.deactivatedAt,
      });
      if (derived) {
        memberships = [derived];
        warnings.push({
          code: "MEMBERSHIP_DERIVED_FROM_ACCOUNT_FIELDS",
          message: `Conta ${account.id} sem linha em TreasuryConsolidatedAccountMembership — membership derivado dos campos da conta (createdAt/isActive/deactivatedAt).`,
        });
      } else {
        memberships = [];
      }
    }

    accountViews.push({
      accountId: account.id,
      accountName: account.name,
      companyCode,
      memberships,
      membershipSource,
    });
  }

  return { accounts: accountViews, companyCodes, warnings };
}
