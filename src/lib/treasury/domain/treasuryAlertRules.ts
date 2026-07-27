/**
 * Motor puro de alertas da Tesouraria (dashboard/agenda).
 * Sem Prisma / sem I/O — limiares e severidade vêm da config.
 */

import { compareCivilDates } from "@/src/lib/financeCivilDate.js";
import type {
  TreasuryAlertKind,
  TreasuryAlertSettingsFields,
} from "../contracts/treasuryAlertConfig.js";
import { TREASURY_ALERT_KIND_LABELS } from "../contracts/treasuryAlertConfig.js";
import type { TreasuryExceptionSeverity } from "../contracts/treasuryEnums.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";

export type TreasuryAlertItem = {
  id: string;
  kind: TreasuryAlertKind;
  severity: TreasuryExceptionSeverity;
  title: string;
  description: string;
  amount: TreasuryMoneyString | null;
  accountId: string | null;
  civilDate: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
};

export type TreasuryAlertAccountFact = {
  accountId: string;
  code?: string;
  availableBalance: string | null;
  minimumBalance: string;
  allowNegativeBalance?: boolean;
  lastBalanceAtIso: string | null;
};

export type TreasuryAlertReceivableFact = {
  officialTitleId: string;
  customerKey: string;
  customerName?: string | null;
  openAmount: string;
  expectedDate: string | null;
  isCancelled?: boolean;
  isSettled?: boolean;
};

export type TreasuryAlertPromiseFact = {
  id: string;
  officialTitleId: string;
  promisedDate: string;
  status: string;
  promisedAmount: string;
};

export type TreasuryAlertPayableFact = {
  officialTitleId: string;
  openAmount: string;
  isCritical: boolean;
  isProgrammed: boolean;
  isCancelled?: boolean;
  isSettled?: boolean;
};

export type TreasuryAlertSyncFact = {
  side: "AR" | "AP" | string;
  lastSuccessAtIso: string | null;
};

export type TreasuryAlertProjectionDayFact = {
  civilDate: string;
  accountId: string | null;
  closingBalance: string | null;
};

export type TreasuryAlertFacts = {
  asOfCivilDate: string;
  nowEpochMs: number;
  accounts?: TreasuryAlertAccountFact[];
  receivables?: TreasuryAlertReceivableFact[];
  promises?: TreasuryAlertPromiseFact[];
  payables?: TreasuryAlertPayableFact[];
  syncFreshness?: TreasuryAlertSyncFact[];
  projectionDays?: TreasuryAlertProjectionDayFact[];
};

function hoursSince(iso: string | null, nowEpochMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (nowEpochMs - t) / (1000 * 60 * 60);
}

function isKindOn(
  settings: TreasuryAlertSettingsFields,
  kind: TreasuryAlertKind
): boolean {
  if (!settings.alertsEnabled) return false;
  return settings.enabledByKind[kind] !== false;
}

function severityOf(
  settings: TreasuryAlertSettingsFields,
  kind: TreasuryAlertKind
): TreasuryExceptionSeverity {
  return settings.severityByKind[kind] ?? "WARNING";
}

function item(
  partial: Omit<TreasuryAlertItem, "title"> & { title?: string }
): TreasuryAlertItem {
  return {
    ...partial,
    title: partial.title ?? TREASURY_ALERT_KIND_LABELS[partial.kind],
  };
}

function detectNegativeBalance(
  settings: TreasuryAlertSettingsFields,
  facts: TreasuryAlertFacts
): TreasuryAlertItem[] {
  if (!isKindOn(settings, "NEGATIVE_BALANCE")) return [];
  const out: TreasuryAlertItem[] = [];
  for (const a of facts.accounts ?? []) {
    if (a.availableBalance == null) continue;
    const bal = normalizeTreasuryMoneyString(a.availableBalance);
    if (compareTreasuryMoney(bal, "0.00") >= 0) continue;
    out.push(
      item({
        id: `alert:NEGATIVE_BALANCE:${a.accountId}`,
        kind: "NEGATIVE_BALANCE",
        severity: severityOf(settings, "NEGATIVE_BALANCE"),
        description: `Conta ${a.code ?? a.accountId} com saldo ${bal}.`,
        amount: bal,
        accountId: a.accountId,
        civilDate: facts.asOfCivilDate,
        entityId: a.accountId,
        metadata: { allowNegativeBalance: a.allowNegativeBalance ?? false },
      })
    );
  }
  for (const d of facts.projectionDays ?? []) {
    if (d.closingBalance == null) continue;
    const bal = normalizeTreasuryMoneyString(d.closingBalance);
    if (compareTreasuryMoney(bal, "0.00") >= 0) continue;
    const key = d.accountId ?? "consolidated";
    out.push(
      item({
        id: `alert:NEGATIVE_BALANCE:proj:${key}:${d.civilDate}`,
        kind: "NEGATIVE_BALANCE",
        severity: severityOf(settings, "NEGATIVE_BALANCE"),
        description: `Projeção negativa em ${d.civilDate} (${key}).`,
        amount: bal,
        accountId: d.accountId,
        civilDate: d.civilDate,
        entityId: key,
        metadata: { source: "projection" },
      })
    );
  }
  return out;
}

function detectBelowMinimum(
  settings: TreasuryAlertSettingsFields,
  facts: TreasuryAlertFacts
): TreasuryAlertItem[] {
  if (!isKindOn(settings, "BELOW_MINIMUM")) return [];
  const out: TreasuryAlertItem[] = [];
  for (const a of facts.accounts ?? []) {
    if (a.availableBalance == null) continue;
    const bal = normalizeTreasuryMoneyString(a.availableBalance);
    const min = normalizeTreasuryMoneyString(a.minimumBalance);
    if (compareTreasuryMoney(bal, min) >= 0) continue;
    out.push(
      item({
        id: `alert:BELOW_MINIMUM:${a.accountId}`,
        kind: "BELOW_MINIMUM",
        severity: severityOf(settings, "BELOW_MINIMUM"),
        description: `Disponível ${bal} abaixo do mínimo ${min}.`,
        amount: bal,
        accountId: a.accountId,
        civilDate: facts.asOfCivilDate,
        entityId: a.accountId,
        metadata: { minimumBalance: min },
      })
    );
  }
  return out;
}

function detectRelevantReceipt(
  settings: TreasuryAlertSettingsFields,
  facts: TreasuryAlertFacts
): TreasuryAlertItem[] {
  if (!isKindOn(settings, "RELEVANT_RECEIPT_NOT_RECEIVED")) return [];
  const min = normalizeTreasuryMoneyString(settings.relevantReceiptMinAmount);
  const out: TreasuryAlertItem[] = [];
  for (const r of facts.receivables ?? []) {
    if (r.isCancelled || r.isSettled) continue;
    const open = normalizeTreasuryMoneyString(r.openAmount);
    if (compareTreasuryMoney(open, "0.00") <= 0) continue;
    if (compareTreasuryMoney(open, min) < 0) continue;
    if (!r.expectedDate) continue;
    if (compareCivilDates(r.expectedDate, facts.asOfCivilDate) > 0) continue;
    out.push(
      item({
        id: `alert:RELEVANT_RECEIPT:${r.officialTitleId}`,
        kind: "RELEVANT_RECEIPT_NOT_RECEIVED",
        severity: severityOf(settings, "RELEVANT_RECEIPT_NOT_RECEIVED"),
        description: `Recebimento relevante esperado em ${r.expectedDate} ainda aberto.`,
        amount: open,
        accountId: null,
        civilDate: r.expectedDate,
        entityId: r.officialTitleId,
        metadata: {
          customerKey: r.customerKey,
          threshold: min,
        },
      })
    );
  }
  return out;
}

function detectCustomerConcentration(
  settings: TreasuryAlertSettingsFields,
  facts: TreasuryAlertFacts
): TreasuryAlertItem[] {
  if (!isKindOn(settings, "CUSTOMER_CONCENTRATION")) return [];
  const openByCustomer = new Map<string, { name: string; amount: string }>();
  let total = "0.00";
  for (const r of facts.receivables ?? []) {
    if (r.isCancelled || r.isSettled) continue;
    const open = normalizeTreasuryMoneyString(r.openAmount);
    if (compareTreasuryMoney(open, "0.00") <= 0) continue;
    total = addTreasuryMoney(total, open);
    const prev = openByCustomer.get(r.customerKey);
    if (!prev) {
      openByCustomer.set(r.customerKey, {
        name: r.customerName?.trim() || r.customerKey,
        amount: open,
      });
    } else {
      openByCustomer.set(r.customerKey, {
        name: prev.name,
        amount: addTreasuryMoney(prev.amount, open),
      });
    }
  }
  if (compareTreasuryMoney(total, "0.00") <= 0) return [];
  const ranked = [...openByCustomer.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => compareTreasuryMoney(b.amount, a.amount));
  const topN = Math.max(1, Math.trunc(settings.customerConcentrationTopN));
  const top = ranked.slice(0, topN);
  let topSum = "0.00";
  for (const t of top) topSum = addTreasuryMoney(topSum, t.amount);
  const sharePct =
    (Number(topSum) / Number(total)) * 100;
  const threshold = Number(settings.customerConcentrationMinSharePercent);
  if (!Number.isFinite(sharePct) || sharePct < threshold) return [];
  return [
    item({
      id: `alert:CUSTOMER_CONCENTRATION:${facts.asOfCivilDate}`,
      kind: "CUSTOMER_CONCENTRATION",
      severity: severityOf(settings, "CUSTOMER_CONCENTRATION"),
      description: `Top ${topN} clientes concentram ${sharePct.toFixed(2)}% do aberto (limite ${threshold}%).`,
      amount: topSum,
      accountId: null,
      civilDate: facts.asOfCivilDate,
      entityId: top.map((t) => t.key).join(","),
      metadata: {
        topN,
        sharePercent: sharePct.toFixed(2),
        thresholdPercent: settings.customerConcentrationMinSharePercent,
        customers: top.map((t) => ({
          key: t.key,
          name: t.name,
          amount: t.amount,
        })),
        totalOpen: total,
      },
    }),
  ];
}

function detectSyncDelayed(
  settings: TreasuryAlertSettingsFields,
  facts: TreasuryAlertFacts
): TreasuryAlertItem[] {
  if (!isKindOn(settings, "SYNC_DELAYED")) return [];
  const out: TreasuryAlertItem[] = [];
  for (const s of facts.syncFreshness ?? []) {
    const hours = hoursSince(s.lastSuccessAtIso, facts.nowEpochMs);
    if (hours != null && hours <= settings.syncMaxAgeHours) continue;
    out.push(
      item({
        id: `alert:SYNC_DELAYED:${s.side}`,
        kind: "SYNC_DELAYED",
        severity: severityOf(settings, "SYNC_DELAYED"),
        description:
          hours == null
            ? `Sem sucesso de sync ${s.side}.`
            : `Sync ${s.side} atrasada (>${settings.syncMaxAgeHours}h).`,
        amount: null,
        accountId: null,
        civilDate: facts.asOfCivilDate,
        entityId: `sync:${s.side}`,
        metadata: {
          side: s.side,
          maxAgeHours: settings.syncMaxAgeHours,
          ageHours: hours == null ? null : Math.floor(hours),
        },
      })
    );
  }
  return out;
}

function detectStaleBalance(
  settings: TreasuryAlertSettingsFields,
  facts: TreasuryAlertFacts
): TreasuryAlertItem[] {
  if (!isKindOn(settings, "STALE_BALANCE")) return [];
  const out: TreasuryAlertItem[] = [];
  for (const a of facts.accounts ?? []) {
    const hours = hoursSince(a.lastBalanceAtIso, facts.nowEpochMs);
    if (hours != null && hours <= settings.staleBalanceHours) continue;
    out.push(
      item({
        id: `alert:STALE_BALANCE:${a.accountId}`,
        kind: "STALE_BALANCE",
        severity: severityOf(settings, "STALE_BALANCE"),
        description: `Saldo da conta ${a.code ?? a.accountId} desatualizado.`,
        amount:
          a.availableBalance == null
            ? null
            : normalizeTreasuryMoneyString(a.availableBalance),
        accountId: a.accountId,
        civilDate: facts.asOfCivilDate,
        entityId: a.accountId,
        metadata: {
          staleBalanceHours: settings.staleBalanceHours,
          ageHours: hours == null ? null : Math.floor(hours),
        },
      })
    );
  }
  return out;
}

function detectExpiredPromise(
  settings: TreasuryAlertSettingsFields,
  facts: TreasuryAlertFacts
): TreasuryAlertItem[] {
  if (!isKindOn(settings, "EXPIRED_PROMISE")) return [];
  const out: TreasuryAlertItem[] = [];
  for (const p of facts.promises ?? []) {
    const st = p.status.trim().toUpperCase();
    if (st === "FULFILLED" || st === "CANCELLED" || st === "BROKEN") continue;
    const expiredByStatus = st === "EXPIRED";
    const expiredByDate =
      Boolean(p.promisedDate) &&
      compareCivilDates(p.promisedDate, facts.asOfCivilDate) < 0;
    if (!expiredByStatus && !expiredByDate) continue;
    out.push(
      item({
        id: `alert:EXPIRED_PROMISE:${p.id}`,
        kind: "EXPIRED_PROMISE",
        severity: severityOf(settings, "EXPIRED_PROMISE"),
        description: `Promessa ${p.id} vencida em ${p.promisedDate}.`,
        amount: normalizeTreasuryMoneyString(p.promisedAmount),
        accountId: null,
        civilDate: p.promisedDate,
        entityId: p.officialTitleId,
        metadata: { promiseId: p.id, status: p.status },
      })
    );
  }
  return out;
}

function detectCriticalPayment(
  settings: TreasuryAlertSettingsFields,
  facts: TreasuryAlertFacts
): TreasuryAlertItem[] {
  if (!isKindOn(settings, "CRITICAL_PAYMENT")) return [];
  const out: TreasuryAlertItem[] = [];
  for (const p of facts.payables ?? []) {
    if (p.isCancelled || p.isSettled) continue;
    if (!p.isCritical) continue;
    if (p.isProgrammed) continue;
    const open = normalizeTreasuryMoneyString(p.openAmount);
    if (compareTreasuryMoney(open, "0.00") <= 0) continue;
    out.push(
      item({
        id: `alert:CRITICAL_PAYMENT:${p.officialTitleId}`,
        kind: "CRITICAL_PAYMENT",
        severity: severityOf(settings, "CRITICAL_PAYMENT"),
        description: "Pagamento crítico em aberto sem programação.",
        amount: open,
        accountId: null,
        civilDate: facts.asOfCivilDate,
        entityId: p.officialTitleId,
        metadata: {},
      })
    );
  }
  return out;
}

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

/**
 * Gera alertas determinísticos a partir dos fatos + configuração.
 */
export function buildTreasuryAlerts(
  settings: TreasuryAlertSettingsFields,
  facts: TreasuryAlertFacts
): TreasuryAlertItem[] {
  const all = [
    ...detectNegativeBalance(settings, facts),
    ...detectBelowMinimum(settings, facts),
    ...detectRelevantReceipt(settings, facts),
    ...detectCustomerConcentration(settings, facts),
    ...detectSyncDelayed(settings, facts),
    ...detectStaleBalance(settings, facts),
    ...detectExpiredPromise(settings, facts),
    ...detectCriticalPayment(settings, facts),
  ];
  all.sort((a, b) => {
    const bySev =
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
    if (bySev !== 0) return bySev;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return all;
}

/** Filtra alertas relevantes para um dia civil da agenda. */
export function filterTreasuryAlertsForCivilDate(
  alerts: TreasuryAlertItem[],
  civilDate: string
): TreasuryAlertItem[] {
  return alerts.filter(
    (a) => a.civilDate == null || a.civilDate === civilDate
  );
}
