/**
 * Labels, períodos, visão e helpers — Agenda financeira (client-safe).
 */

import {
  formatFinanceCurrency,
  formatFinanceDateTime,
} from "@/src/lib/financeAccountsReceivableFormat.js";
import type {
  TreasuryAgendaDayDto,
  TreasuryFinancialAccountDto,
  TreasuryProjectionLayer,
} from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_PROJECTION_LAYERS,
  todayTreasuryCivilDateInSaoPaulo,
} from "@/src/lib/treasury/contracts/index.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  type TreasuryMoneyString,
} from "./treasuryMoney.js";
import {
  pickHigherRiskCode,
  treasuryAgendaRiskLabel,
} from "./domain/treasuryAgendaDayRules.js";
import type { TreasuryAgendaFetchParams } from "./treasuryAgendaApi.js";

export const TREASURY_AGENDA_PAGE_TITLE = "Agenda financeira" as const;
export const TREASURY_AGENDA_PAGE_SUBTITLE =
  "Saldo, entradas, saídas, transferências e risco por dia — consolidado, por conta ou por grupo." as const;

export const TREASURY_AGENDA_DENIED_MESSAGE =
  "Sem permissão para visualizar a agenda financeira da Central de Tesouraria." as const;

export const TREASURY_AGENDA_EMPTY_TITLE = "Sem agenda no período" as const;
export const TREASURY_AGENDA_EMPTY_DESCRIPTION =
  "Não há projeção válida ou linhas de agenda para o período. Calcule a projeção ou ajuste filtros." as const;

export const TREASURY_AGENDA_EMPTY_FILTERED_TITLE =
  "Nenhum dia no filtro" as const;
export const TREASURY_AGENDA_EMPTY_FILTERED_DESCRIPTION =
  "Ajuste período, visão, contas ou cenário para ver a agenda." as const;

export const TREASURY_AGENDA_STALE_MESSAGE =
  "Dados desatualizados: a projeção da agenda está stale. Recalcule a projeção ou atualize fontes." as const;

export type TreasuryAgendaPeriodPreset =
  | "today"
  | "7d"
  | "15d"
  | "30d"
  | "60d"
  | "90d"
  | "custom";

export const TREASURY_AGENDA_PERIOD_PRESETS: TreasuryAgendaPeriodPreset[] = [
  "today",
  "7d",
  "15d",
  "30d",
  "60d",
  "90d",
  "custom",
];

export const TREASURY_AGENDA_PERIOD_LABELS: Record<
  TreasuryAgendaPeriodPreset,
  string
> = {
  today: "Hoje",
  "7d": "7 dias",
  "15d": "15 dias",
  "30d": "30 dias",
  "60d": "60 dias",
  "90d": "90 dias",
  custom: "Personalizado",
};

export type TreasuryAgendaViewMode =
  | "consolidated"
  | "byAccount"
  | "byGroup";

export const TREASURY_AGENDA_VIEW_MODE_LABELS: Record<
  TreasuryAgendaViewMode,
  string
> = {
  consolidated: "Consolidada",
  byAccount: "Por conta",
  byGroup: "Por grupo de contas",
};

export const TREASURY_AGENDA_SCENARIO_LABELS: Record<
  TreasuryProjectionLayer,
  string
> = {
  CONTRACTUAL: "Contratual",
  PROBABLE: "Provável",
  CONFIRMED: "Confirmado",
  MANUAL: "Manual",
};

export const TREASURY_AGENDA_COLUMN_LABELS = {
  civilDate: "Dia",
  account: "Conta / grupo",
  openingBalance: "Saldo inicial",
  plannedInflows: "Entradas previstas",
  confirmedInflows: "Entradas confirmadas",
  realizedInflows: "Entradas realizadas",
  plannedOutflows: "Saídas previstas",
  programmedOutflows: "Saídas programadas",
  realizedOutflows: "Saídas realizadas",
  transfers: "Transferências",
  closingBalance: "Saldo final",
  risk: "Risco",
} as const;

export type TreasuryAgendaFilterState = {
  period: TreasuryAgendaPeriodPreset;
  baseDate: string;
  endDate: string;
  viewMode: TreasuryAgendaViewMode;
  accountId: string;
  groupKey: string;
  scenario: TreasuryProjectionLayer;
  companyCode: string;
};

export function todayCivilDateLocal(): string {
  return todayTreasuryCivilDateInSaoPaulo();
}

/** Soma dias civis em UTC civil (YYYY-MM-DD), sem depender do fuso do host. */
export function addCivilDays(civilDate: string, days: number): string {
  const [y, m, d] = civilDate.split("-").map((p) => Number(p));
  if (!y || !m || !d) return civilDate;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function isTreasuryAgendaPeriodPreset(
  value: string
): value is TreasuryAgendaPeriodPreset {
  return (TREASURY_AGENDA_PERIOD_PRESETS as string[]).includes(value);
}

export function isTreasuryAgendaViewMode(
  value: string
): value is TreasuryAgendaViewMode {
  return value === "consolidated" || value === "byAccount" || value === "byGroup";
}

export function isTreasuryAgendaScenario(
  value: string
): value is TreasuryProjectionLayer {
  return (TREASURY_PROJECTION_LAYERS as readonly string[]).includes(value);
}

export function createEmptyTreasuryAgendaFilters(
  today = todayCivilDateLocal()
): TreasuryAgendaFilterState {
  return {
    period: "7d",
    baseDate: today,
    endDate: addCivilDays(today, 6),
    viewMode: "consolidated",
    accountId: "",
    groupKey: "",
    scenario: "PROBABLE",
    companyCode: "",
  };
}

/** Resolve base/end a partir do preset (custom usa as datas do estado). */
export function resolveTreasuryAgendaPeriodRange(
  filters: Pick<TreasuryAgendaFilterState, "period" | "baseDate" | "endDate">,
  today = todayCivilDateLocal()
): { baseDate: string; endDate: string } {
  switch (filters.period) {
    case "today":
      return { baseDate: today, endDate: today };
    case "7d":
      return { baseDate: today, endDate: addCivilDays(today, 6) };
    case "15d":
      return { baseDate: today, endDate: addCivilDays(today, 14) };
    case "30d":
      return { baseDate: today, endDate: addCivilDays(today, 29) };
    case "60d":
      return { baseDate: today, endDate: addCivilDays(today, 59) };
    case "90d":
      return { baseDate: today, endDate: addCivilDays(today, 89) };
    case "custom":
    default: {
      const base = filters.baseDate.trim() || today;
      const end = filters.endDate.trim() || base;
      return base <= end
        ? { baseDate: base, endDate: end }
        : { baseDate: end, endDate: base };
    }
  }
}

export type TreasuryAgendaViewKind =
  | "denied"
  | "loading"
  | "error"
  | "empty"
  | "empty-filtered"
  | "ready";

export function resolveTreasuryAgendaViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  hasData: boolean;
  hasFilters: boolean;
}): TreasuryAgendaViewKind {
  if (!input.canView) return "denied";
  if (input.loading && !input.hasData) return "loading";
  if (input.error && !input.hasData) return "error";
  if (!input.hasData) {
    return input.hasFilters ? "empty-filtered" : "empty";
  }
  return "ready";
}

export function treasuryAgendaHasActiveFilters(
  filters: TreasuryAgendaFilterState,
  today = todayCivilDateLocal()
): boolean {
  const baseline = createEmptyTreasuryAgendaFilters(today);
  return (
    filters.period !== baseline.period ||
    filters.viewMode !== baseline.viewMode ||
    filters.accountId.trim() !== "" ||
    filters.groupKey.trim() !== "" ||
    filters.scenario !== baseline.scenario ||
    (filters.period === "custom" &&
      (filters.baseDate !== today || filters.endDate !== addCivilDays(today, 6)))
  );
}

export function resolveTreasuryAgendaCompanyCode(
  filters: TreasuryAgendaFilterState,
  accounts: TreasuryFinancialAccountDto[]
): string {
  const fromFilter = filters.companyCode.trim();
  if (fromFilter) return fromFilter;
  const first = accounts.find((a) => a.companyCode?.trim())?.companyCode?.trim();
  return first || "LAZARIOS";
}

export function buildTreasuryAgendaQuery(input: {
  filters: TreasuryAgendaFilterState;
  accounts: TreasuryFinancialAccountDto[];
  today?: string;
}): TreasuryAgendaFetchParams & { hasFilters: boolean; range: { baseDate: string; endDate: string } } {
  const today = input.today ?? todayCivilDateLocal();
  const range = resolveTreasuryAgendaPeriodRange(input.filters, today);
  const companyCode = resolveTreasuryAgendaCompanyCode(
    input.filters,
    input.accounts
  );
  const accountIds = input.filters.accountId.trim()
    ? [input.filters.accountId.trim()]
    : null;
  const consolidated = input.filters.viewMode === "consolidated";
  return {
    companyCode,
    baseDate: range.baseDate,
    endDate: range.endDate,
    scenario: input.filters.scenario,
    accountIds,
    consolidated,
    includeDayDetail: true,
    hasFilters: treasuryAgendaHasActiveFilters(input.filters, today),
    range,
  };
}

export function formatTreasuryAgendaMoney(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "—";
  try {
    return formatFinanceCurrency(Number(value));
  } catch {
    return value;
  }
}

export function formatTreasuryAgendaCivilDate(civilDate: string): string {
  const [y, m, d] = civilDate.split("-");
  if (!y || !m || !d) return civilDate;
  return `${d}/${m}/${y}`;
}

export function formatTreasuryAgendaDateTime(
  value: string | null | undefined
): string {
  if (!value) return "—";
  return formatFinanceDateTime(value);
}

export function resolveTreasuryAgendaStaleState(agenda: {
  freshness?: { hasStaleSource?: boolean } | null;
} | null): string | null {
  if (!agenda?.freshness?.hasStaleSource) return null;
  return TREASURY_AGENDA_STALE_MESSAGE;
}

export type TreasuryAgendaDisplayRow = TreasuryAgendaDayDto & {
  rowKey: string;
  groupKey: string | null;
  groupLabel: string | null;
};

const ZERO = "0.00" as TreasuryMoneyString;

function moneyOrZero(value: string | null | undefined): TreasuryMoneyString {
  if (value == null || value === "") return ZERO;
  return normalizeTreasuryMoneyString(value);
}

export function accountGroupKey(
  account: TreasuryFinancialAccountDto | undefined
): string {
  const inst = account?.institutionName?.trim();
  if (inst) return `inst:${inst}`;
  const type = account?.accountType?.trim();
  if (type) return `type:${type}`;
  return "group:outros";
}

export function accountGroupLabel(
  account: TreasuryFinancialAccountDto | undefined
): string {
  const inst = account?.institutionName?.trim();
  if (inst) return inst;
  const type = account?.accountType?.trim();
  if (type) return `Tipo ${type}`;
  return "Outros";
}

/** Enriquece linhas com código/nome da conta a partir do cadastro. */
export function enrichTreasuryAgendaDays(
  days: TreasuryAgendaDayDto[],
  accounts: TreasuryFinancialAccountDto[]
): TreasuryAgendaDisplayRow[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return days.map((day) => {
    const acc = day.accountId ? byId.get(day.accountId) : undefined;
    return {
      ...day,
      accountCode: day.accountCode ?? acc?.code ?? null,
      accountName: day.accountName ?? acc?.name ?? null,
      rowKey: `${day.civilDate}|${day.accountId ?? "all"}`,
      groupKey: day.accountId ? accountGroupKey(acc) : null,
      groupLabel: day.accountId ? accountGroupLabel(acc) : null,
    };
  });
}

function mergeDisplayRows(
  rows: TreasuryAgendaDisplayRow[]
): TreasuryAgendaDisplayRow {
  const first = rows[0]!;
  let acc = { ...first, items: [...(first.items ?? [])] };
  for (const row of rows.slice(1)) {
    acc = {
      ...acc,
      openingBalance: addTreasuryMoney(
        moneyOrZero(acc.openingBalance),
        moneyOrZero(row.openingBalance)
      ),
      plannedInflows: addTreasuryMoney(
        moneyOrZero(acc.plannedInflows),
        moneyOrZero(row.plannedInflows)
      ),
      confirmedInflows: addTreasuryMoney(
        moneyOrZero(acc.confirmedInflows),
        moneyOrZero(row.confirmedInflows)
      ),
      realizedInflows: addTreasuryMoney(
        moneyOrZero(acc.realizedInflows),
        moneyOrZero(row.realizedInflows)
      ),
      plannedOutflows: addTreasuryMoney(
        moneyOrZero(acc.plannedOutflows),
        moneyOrZero(row.plannedOutflows)
      ),
      programmedOutflows: addTreasuryMoney(
        moneyOrZero(acc.programmedOutflows),
        moneyOrZero(row.programmedOutflows)
      ),
      realizedOutflows: addTreasuryMoney(
        moneyOrZero(acc.realizedOutflows),
        moneyOrZero(row.realizedOutflows)
      ),
      transfers: addTreasuryMoney(
        moneyOrZero(acc.transfers),
        moneyOrZero(row.transfers)
      ),
      closingBalance: addTreasuryMoney(
        moneyOrZero(acc.closingBalance),
        moneyOrZero(row.closingBalance)
      ),
      riskAmount: addTreasuryMoney(
        moneyOrZero(acc.riskAmount),
        moneyOrZero(row.riskAmount)
      ),
      riskCode: pickHigherRiskCode(acc.riskCode, row.riskCode),
      inflows: addTreasuryMoney(moneyOrZero(acc.inflows), moneyOrZero(row.inflows)),
      outflows: addTreasuryMoney(
        moneyOrZero(acc.outflows),
        moneyOrZero(row.outflows)
      ),
      net: addTreasuryMoney(moneyOrZero(acc.net), moneyOrZero(row.net)),
      realized: addTreasuryMoney(
        moneyOrZero(acc.realized),
        moneyOrZero(row.realized)
      ),
      itemCount: acc.itemCount + row.itemCount,
      items: [...(acc.items ?? []), ...(row.items ?? [])],
      alerts: [...(acc.alerts ?? []), ...(row.alerts ?? [])],
    };
  }
  acc.riskLabel = treasuryAgendaRiskLabel(acc.riskCode, acc.riskAmount);
  const seen = new Set<string>();
  acc.alerts = (acc.alerts ?? []).filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
  return acc;
}

/**
 * Aplica visão consolidada / por conta / por grupo + filtro de grupo.
 * Risco e money usam helpers Decimal-string (sem float).
 */
export function buildTreasuryAgendaDisplayRows(input: {
  days: TreasuryAgendaDayDto[];
  accounts: TreasuryFinancialAccountDto[];
  viewMode: TreasuryAgendaViewMode;
  groupKeyFilter?: string;
}): TreasuryAgendaDisplayRow[] {
  const enriched = enrichTreasuryAgendaDays(input.days, input.accounts);
  if (input.viewMode === "consolidated") {
    return enriched.map((r) => ({
      ...r,
      groupKey: null,
      groupLabel: null,
      accountCode: null,
      accountName: "Consolidado",
    }));
  }
  if (input.viewMode === "byAccount") {
    return enriched;
  }

  const filtered = input.groupKeyFilter?.trim()
    ? enriched.filter((r) => r.groupKey === input.groupKeyFilter)
    : enriched;

  const byKey = new Map<string, TreasuryAgendaDisplayRow[]>();
  for (const row of filtered) {
    const gk = row.groupKey ?? "group:outros";
    const civil = row.civilDate;
    const key = `${civil}|${gk}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => {
      const [civilDate, gk] = key.split("|") as [string, string];
      const label = rows[0]?.groupLabel ?? "Outros";
      const merged = mergeDisplayRows(rows);
      return {
        ...merged,
        civilDate: civilDate as TreasuryAgendaDayDto["civilDate"],
        accountId: null,
        accountCode: null,
        accountName: label,
        groupKey: gk,
        groupLabel: label,
        rowKey: key,
      };
    });
}

export function listTreasuryAgendaGroupOptions(
  accounts: TreasuryFinancialAccountDto[]
): Array<{ key: string; label: string }> {
  const map = new Map<string, string>();
  for (const a of accounts) {
    const key = accountGroupKey(a);
    if (!map.has(key)) map.set(key, accountGroupLabel(a));
  }
  return [...map.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export type TreasuryAgendaBalanceChartPoint = {
  civilDate: string;
  label: string;
  closingBalance: number;
  closingBalanceText: string;
  riskLabel: string;
  status: "positive" | "negative" | "neutral";
};

/** Pontos do gráfico de evolução do saldo final (rótulo textual de risco incluído). */
export function buildTreasuryAgendaBalanceChartPoints(
  rows: TreasuryAgendaDisplayRow[]
): TreasuryAgendaBalanceChartPoint[] {
  const byDate = new Map<string, TreasuryAgendaDisplayRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.civilDate) ?? [];
    list.push(row);
    byDate.set(row.civilDate, list);
  }
  return [...byDate.keys()]
    .sort()
    .map((civilDate) => {
      const dayRows = byDate.get(civilDate) ?? [];
      const closing = dayRows.reduce(
        (acc, r) => addTreasuryMoney(acc, moneyOrZero(r.closingBalance)),
        ZERO
      );
      const riskCode = dayRows.reduce(
        (acc, r) => pickHigherRiskCode(acc, r.riskCode),
        "NONE"
      );
      const riskAmount = dayRows.reduce(
        (acc, r) => addTreasuryMoney(acc, moneyOrZero(r.riskAmount)),
        ZERO
      );
      const cmp = compareTreasuryMoney(closing, ZERO);
      return {
        civilDate,
        label: formatTreasuryAgendaCivilDate(civilDate),
        closingBalance: Number(closing),
        closingBalanceText: formatTreasuryAgendaMoney(closing),
        riskLabel: treasuryAgendaRiskLabel(riskCode, riskAmount),
        status:
          cmp > 0 ? "positive" : cmp < 0 ? "negative" : ("neutral" as const),
      };
    });
}
