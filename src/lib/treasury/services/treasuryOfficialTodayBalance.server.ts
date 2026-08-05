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

  // ── 2) Snapshot da rotina "Saldos do Dia" por conta ───────────────────
  //     Consulta todos os snapshots da rotina; para cada conta pega o mais
  //     recente daquele dia civil (idempotencyKey embute a data).
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
      let total = 0;
      let latest: Date | null = null;
      for (const v of routineByAccount.values()) {
        total += v.amount;
        if (!latest || v.informedAt > latest) latest = v.informedAt;
      }
      return {
        amount: total,
        source: "DAILY_ROUTINE_SNAPSHOT",
        civilDate,
        informedAt: latest?.toISOString() ?? null,
        accountsCovered: routineByAccount.size,
        accountsWithoutBalance: totalAccounts - routineByAccount.size,
        sourceLabel:
          routineByAccount.size === totalAccounts
            ? `Rotina "Saldos do Dia" de ${formatBrDate(civilDate)}`
            : `Rotina "Saldos do Dia" (${routineByAccount.size}/${totalAccounts} contas)`,
      };
    }
  }

  // ── 3) Snapshot MANUAL genérico (tela "Saldo") do dia ─────────────────
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
      let total = 0;
      let latest: Date | null = null;
      for (const v of genericByAccount.values()) {
        total += v.amount;
        if (!latest || v.informedAt > latest) latest = v.informedAt;
      }
      return {
        amount: total,
        source: "GENERIC_MANUAL_SNAPSHOT",
        civilDate,
        informedAt: latest?.toISOString() ?? null,
        accountsCovered: genericByAccount.size,
        accountsWithoutBalance: totalAccounts - genericByAccount.size,
        sourceLabel:
          genericByAccount.size === totalAccounts
            ? `Saldo informado de ${formatBrDate(civilDate)}`
            : `Saldo informado (${genericByAccount.size}/${totalAccounts} contas)`,
      };
    }
  }

  // ── 4) TreasuryFinancialAccount.availableBalance (snapshot Nomus) ─────
  //     É o valor que já aparece no card superior — o mais fresco disponível.
  if (accountIds.length > 0) {
    // O saldo mais recente por conta vem de TreasuryBalanceSnapshot ordenado
    // por referenceAt/createdAt (independente da data pedida) — é o "estoque
    // corrente" que o front usa em fetchTreasuryAccountLatestBalance.
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
      let latest: Date | null = null;
      for (const v of byAccount.values()) {
        total += v.amount;
        if (!latest || v.informedAt > latest) latest = v.informedAt;
      }
      return {
        amount: total,
        source: "ACCOUNT_LATEST_BALANCE",
        civilDate,
        informedAt: latest?.toISOString() ?? null,
        accountsCovered: byAccount.size,
        accountsWithoutBalance: totalAccounts - byAccount.size,
        sourceLabel:
          byAccount.size === totalAccounts
            ? `Saldo mais recente das contas (Nomus)`
            : `Saldo mais recente (${byAccount.size}/${totalAccounts} contas)`,
      };
    }
  }

  return {
    amount: null,
    source: "NONE",
    civilDate,
    informedAt: null,
    accountsCovered: 0,
    accountsWithoutBalance: totalAccounts,
    sourceLabel: "Sem saldo informado — motor cai na cadeia calculada.",
  };
}
