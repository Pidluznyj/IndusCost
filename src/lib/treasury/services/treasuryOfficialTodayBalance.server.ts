/**
 * Âncora oficial de saldo de HOJE — server-only.
 *
 * Motivo: os motores de gráfico (Movimento de hoje, Linha do tempo, Cenários)
 * NÃO devem reconstruir o saldo do zero pela cadeia de baixas desde a gênese.
 * O sistema JÁ SABE o saldo real do banco por três fontes; usa a mais
 * confiável disponível e ancora a projeção a partir dela.
 *
 * Precedência (do mais confiável ao menos):
 *   1. TreasuryDailyClosing.observedBalance (status CLOSED, versão mais alta)
 *      → dado imutável, auditado, conciliado.
 *   2. TreasuryBalanceSnapshot da rotina "Saldos do Dia" (por conta ativa)
 *      → informado pelo tesoureiro; idempotencyKey embute a data civil.
 *   3. TreasuryBalanceSnapshot MANUAL genérico (por conta ativa)
 *      → tela "Saldo" (backfill retroativo).
 *   4. TreasuryFinancialAccount.availableBalance
 *      → snapshot Nomus mais recente por conta, o que aparece no card.
 *   5. null → warning; motor cai no fallback de cadeia calculada.
 *
 * Sem esta âncora, aportes/transferências/movimentos SEM título ficam
 * invisíveis (a cadeia parte de R$ 0,00 na gênese) e o gráfico diverge do
 * saldo real. Com a âncora, todos os cenários partem da realidade.
 */

import type { PrismaClient } from "@prisma/client";
import { civilDateToLocalDate } from "@/src/lib/financeCivilDate.js";
import {
  parseTreasuryDailyRoutineSnapshotKey,
  TREASURY_DAILY_CLOSING_BANK_SNAPSHOT_KEY_PREFIX,
} from "../domain/treasuryDailyAccountRoutineRules.js";
import { treasuryCompanyCodePresentWhere } from "../treasuryPrismaFilters.js";
import { civilDateFromInstantInSaoPaulo } from "../contracts/treasuryCivilDate.js";
import { roundTreasuryBalanceMoney } from "../domain/treasuryDailyBalanceAuthority.js";

export type TreasuryOfficialTodayBalanceSource =
  | "DAILY_CLOSING"
  | "DAILY_ROUTINE_SNAPSHOT"
  | "GENERIC_MANUAL_SNAPSHOT"
  | "ACCOUNT_LATEST_BALANCE"
  | "NONE";

export type TreasuryOfficialTodayBalance = {
  /** Valor total consolidado (soma de contas incluídas no consolidado). */
  amount: number | null;
  source: TreasuryOfficialTodayBalanceSource;
  /** Data civil do saldo (YYYY-MM-DD). */
  civilDate: string;
  /** Instante da informação, quando a fonte guardar. */
  informedAt: string | null;
  /** Quantidade de contas ativas do consolidado que compõem o total. */
  accountsCovered: number;
  /** Quantidade de contas ativas que ficaram sem saldo informado nesta fonte. */
  accountsWithoutBalance: number;
  /** Descrição pt-BR curta para a UI ("Fechamento CLOSED de 04/08/2026"). */
  sourceLabel: string;
  /**
   * Posição MAIS RECENTE por conta (informativo, card "Caixa hoje"). NUNCA é
   * âncora: `amount` acima só existe com fechamento formal/manual COMPLETO
   * de hoje. Ausente quando não há snapshot algum.
   */
  latestPosition?: {
    amount: number;
    accountsCovered: number;
    accountsExpected: number;
    /** Dia civil (SP) mais antigo entre as posições usadas. */
    oldestCivilDate: string | null;
    /** Quantas posições são de hoje. */
    accountsUpdatedToday: number;
  } | null;
};

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatBrDate(civilDate: string): string {
  const [y, m, d] = civilDate.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Carrega a âncora oficial de saldo consolidado para a data civil pedida.
 * Nunca lança — devolve `{ amount: null, source: "NONE", … }` se nada existir,
 * para o motor decidir por fallback (cadeia calculada) com warning.
 */
export async function loadTreasuryOfficialTodayBalance(
  prisma: PrismaClient,
  civilDate: string
): Promise<TreasuryOfficialTodayBalance> {
  const accounts = await prisma.treasuryFinancialAccount.findMany({
    where: {
      isActive: true,
      includeInConsolidated: true,
      ...treasuryCompanyCodePresentWhere(),
    },
    select: {
      id: true,
      companyCode: true,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const totalAccounts = accounts.length;
  const accountIds = accounts.map((a) => a.id);
  const companyCode = accounts[0]?.companyCode?.trim() || null;

  // ── 1) TreasuryDailyClosing (CLOSED, versão mais alta) ────────────────
  if (companyCode) {
    const dayStart = civilDateToLocalDate(civilDate);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const closing = await prisma.treasuryDailyClosing.findFirst({
      where: {
        companyCode,
        status: "CLOSED",
        civilDate: {
          gte: new Date(
            Date.UTC(
              dayStart.getFullYear(),
              dayStart.getMonth(),
              dayStart.getDate()
            )
          ),
          lt: new Date(
            Date.UTC(
              dayEnd.getFullYear(),
              dayEnd.getMonth(),
              dayEnd.getDate()
            )
          ),
        },
      },
      orderBy: [{ version: "desc" }],
      select: { observedBalance: true, closedAt: true },
    });
    if (closing) {
      const value = Number(closing.observedBalance);
      if (Number.isFinite(value)) {
        return {
          amount: value,
          source: "DAILY_CLOSING",
          civilDate,
          informedAt: closing.closedAt?.toISOString() ?? null,
          accountsCovered: totalAccounts,
          accountsWithoutBalance: 0,
          sourceLabel: `Fechamento CLOSED de ${formatBrDate(civilDate)}`,
        };
      }
    }
  }

  // Melhor cobertura PARCIAL vista até agora (passos 2 e 3) — nunca vira
  // âncora (`amount`), mas fica visível em `accountsCovered`/
  // `accountsWithoutBalance` mesmo quando a resposta final é `amount: null`.
  // Sem isso, "2/3 contas informaram" ficava indistinguível de "ninguém
  // informou nada" — exatamente o defeito que promovia o subtotal a âncora.
  let bestPartialCovered = 0;
  let bestPartialWithoutBalance = totalAccounts;

  // ── 2) Snapshot da rotina "Saldos do Dia" por conta ───────────────────
  //     Consulta todos os snapshots da rotina; para cada conta pega o mais
  //     recente daquele dia civil (idempotencyKey embute a data). Só ANCORA
  //     (vira `amount`) quando TODAS as contas do consolidado informaram —
  //     um subconjunto nunca é promovido ao saldo da empresa inteira.
  if (accountIds.length > 0) {
    const routineSnapshots = await prisma.treasuryBalanceSnapshot.findMany({
      where: {
        accountId: { in: accountIds },
        origin: "MANUAL",
        cancelledAt: null,
        idempotencyKey: {
          startsWith: `${TREASURY_DAILY_CLOSING_BANK_SNAPSHOT_KEY_PREFIX}:`,
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        accountId: true,
        idempotencyKey: true,
        availableBalance: true,
        createdAt: true,
      },
    });
    const routineByAccount = new Map<
      string,
      { amount: number; informedAt: Date }
    >();
    for (const row of routineSnapshots) {
      const parsed = parseTreasuryDailyRoutineSnapshotKey(row.idempotencyKey);
      if (!parsed || parsed.kind !== "closingBank") continue;
      if (parsed.civilDate !== civilDate) continue;
      if (routineByAccount.has(row.accountId)) continue;
      const value = Number(row.availableBalance);
      if (!Number.isFinite(value)) continue;
      routineByAccount.set(row.accountId, {
        amount: value,
        informedAt: row.createdAt,
      });
    }
    if (routineByAccount.size > 0) {
      if (routineByAccount.size > bestPartialCovered) {
        bestPartialCovered = routineByAccount.size;
        bestPartialWithoutBalance = totalAccounts - routineByAccount.size;
      }
      if (routineByAccount.size === totalAccounts) {
        let total = 0;
        let latest: Date | null = null;
        for (const v of routineByAccount.values()) {
          total += v.amount;
          if (!latest || v.informedAt > latest) latest = v.informedAt;
        }
        return {
          amount: roundTreasuryBalanceMoney(total),
          source: "DAILY_ROUTINE_SNAPSHOT",
          civilDate,
          informedAt: latest?.toISOString() ?? null,
          accountsCovered: routineByAccount.size,
          accountsWithoutBalance: 0,
          sourceLabel: `Rotina "Saldos do Dia" de ${formatBrDate(civilDate)}`,
        };
      }
    }
  }

  // ── 3) Snapshot MANUAL genérico (tela "Saldo") do dia ─────────────────
  //     Mesma regra: só ancora com cobertura COMPLETA.
  if (accountIds.length > 0) {
    const dayStart = civilDateToLocalDate(civilDate);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const genericSnapshots = await prisma.treasuryBalanceSnapshot.findMany({
      where: {
        accountId: { in: accountIds },
        origin: "MANUAL",
        cancelledAt: null,
        referenceAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: [{ referenceAt: "desc" }, { createdAt: "desc" }],
      select: {
        accountId: true,
        availableBalance: true,
        referenceAt: true,
        createdAt: true,
        idempotencyKey: true,
      },
    });
    const genericByAccount = new Map<
      string,
      { amount: number; informedAt: Date }
    >();
    for (const row of genericSnapshots) {
      // Snapshots da rotina "Saldos do Dia" já foram tratados acima.
      if (parseTreasuryDailyRoutineSnapshotKey(row.idempotencyKey)) continue;
      if (genericByAccount.has(row.accountId)) continue;
      const value = Number(row.availableBalance);
      if (!Number.isFinite(value)) continue;
      genericByAccount.set(row.accountId, {
        amount: value,
        informedAt: row.createdAt,
      });
    }
    if (genericByAccount.size > 0) {
      if (genericByAccount.size > bestPartialCovered) {
        bestPartialCovered = genericByAccount.size;
        bestPartialWithoutBalance = totalAccounts - genericByAccount.size;
      }
      if (genericByAccount.size === totalAccounts) {
        let total = 0;
        let latest: Date | null = null;
        for (const v of genericByAccount.values()) {
          total += v.amount;
          if (!latest || v.informedAt > latest) latest = v.informedAt;
        }
        return {
          amount: roundTreasuryBalanceMoney(total),
          source: "GENERIC_MANUAL_SNAPSHOT",
          civilDate,
          informedAt: latest?.toISOString() ?? null,
          accountsCovered: genericByAccount.size,
          accountsWithoutBalance: 0,
          sourceLabel: `Saldo informado de ${formatBrDate(civilDate)}`,
        };
      }
    }
  }

  // ── 4) Posição mais recente por conta (INFORMATIVA — nunca ancora) ────
  //     Antes, esta etapa promovia o "estoque corrente" (qualquer data, até
  //     ontem) a saldo oficial de HOJE — o segundo defeito real observado em
  //     produção. Agora só alimenta `latestPosition`, nunca `amount`.
  let latestPosition: TreasuryOfficialTodayBalance["latestPosition"] = null;
  if (accountIds.length > 0) {
    const latestByAccount = await prisma.treasuryBalanceSnapshot.findMany({
      where: {
        accountId: { in: accountIds },
        cancelledAt: null,
      },
      orderBy: [{ referenceAt: "desc" }, { createdAt: "desc" }],
      select: {
        accountId: true,
        availableBalance: true,
        referenceAt: true,
      },
    });
    const byAccount = new Map<
      string,
      { amount: number; informedAt: Date }
    >();
    for (const row of latestByAccount) {
      if (byAccount.has(row.accountId)) continue;
      const value = Number(row.availableBalance);
      if (!Number.isFinite(value)) continue;
      byAccount.set(row.accountId, {
        amount: value,
        informedAt: row.referenceAt,
      });
    }
    if (byAccount.size > 0) {
      let total = 0;
      let oldest: string | null = null;
      let updatedToday = 0;
      for (const v of byAccount.values()) {
        total += v.amount;
        const posCivilDate = civilDateFromInstantInSaoPaulo(v.informedAt);
        if (oldest == null || posCivilDate < oldest) oldest = posCivilDate;
        if (posCivilDate === civilDate) updatedToday += 1;
      }
      latestPosition = {
        amount: roundTreasuryBalanceMoney(total),
        accountsCovered: byAccount.size,
        accountsExpected: totalAccounts,
        oldestCivilDate: oldest,
        accountsUpdatedToday: updatedToday,
      };
    }
  }

  return {
    amount: null,
    source: "NONE",
    civilDate,
    informedAt: null,
    accountsCovered: bestPartialCovered,
    accountsWithoutBalance: bestPartialWithoutBalance,
    sourceLabel:
      bestPartialCovered > 0
        ? `Saldo informado incompleto (${bestPartialCovered}/${totalAccounts} contas) — motor cai na cadeia calculada.`
        : "Sem saldo informado — motor cai na cadeia calculada.",
    latestPosition,
  };
}
