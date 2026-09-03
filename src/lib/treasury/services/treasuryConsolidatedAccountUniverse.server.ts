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
  void account;
  throw new Error("not implemented: deriveTreasuryMembershipFromAccountFields");
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
  void prisma;
  void range;
  throw new Error("not implemented: loadTreasuryConsolidatedAccountUniverse");
}
