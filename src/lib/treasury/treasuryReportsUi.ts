/**
 * Constantes e helpers de UI — Central de Relatórios da Tesouraria.
 */

import {
  TREASURY_PROJECTION_LAYERS,
  TREASURY_REPORT_KEYS,
  todayTreasuryCivilDateInSaoPaulo,
  type TreasuryProjectionLayer,
  type TreasuryReportKey,
} from "./contracts/treasuryContracts.js";

export type TreasuryReportExportFormat = "csv" | "xlsx" | "pdf";

export const TREASURY_REPORTS_PAGE_TITLE = "Central de Relatórios" as const;
export const TREASURY_REPORTS_PAGE_SUBTITLE =
  "Consulte, imprima e exporte relatórios de caixa da Tesouraria." as const;

export const TREASURY_REPORTS_DENIED_MESSAGE =
  "Sem permissão para visualizar relatórios da Tesouraria." as const;

export const TREASURY_REPORTS_EXPORT_DENIED_MESSAGE =
  "Sem permissão para exportar relatórios da Tesouraria." as const;

export const TREASURY_REPORTS_EMPTY_TITLE = "Selecione um relatório" as const;
export const TREASURY_REPORTS_EMPTY_DESCRIPTION =
  "Escolha o tipo de relatório e o período para visualizar os resultados." as const;

export const TREASURY_REPORT_LABELS: Record<TreasuryReportKey, string> = {
  "daily-position": "Posição diária",
  "cash-bridge": "Ponte de caixa",
  "planned-vs-actual": "Previsto versus realizado",
  delinquency: "Inadimplência",
  promises: "Promessas",
  predictability: "Previsibilidade",
  "position-by-account": "Posição por conta",
  exceptions: "Exceções",
  reconciliations: "Conciliações",
  "projection-by-scenario": "Projeção por cenário",
};

export const TREASURY_REPORT_OPTION_LIST = TREASURY_REPORT_KEYS.map((key) => ({
  key,
  label: TREASURY_REPORT_LABELS[key],
}));

export type TreasuryReportsFilterState = {
  reportKey: TreasuryReportKey;
  from: string;
  to: string;
  accountIds: string;
  scenario: TreasuryProjectionLayer;
  status: string;
  severity: string;
  search: string;
  companyCode: string;
};

export function todayCivilDateLocal(): string {
  return todayTreasuryCivilDateInSaoPaulo();
}

export function createEmptyTreasuryReportsFilters(): TreasuryReportsFilterState {
  const today = todayCivilDateLocal();
  return {
    reportKey: "daily-position",
    from: today,
    to: today,
    accountIds: "",
    scenario: "PROBABLE",
    status: "",
    severity: "",
    search: "",
    companyCode: "",
  };
}

export function isTreasuryReportsScenario(
  value: string
): value is TreasuryProjectionLayer {
  return (TREASURY_PROJECTION_LAYERS as readonly string[]).includes(value);
}

export function isTreasuryReportsReportKey(
  value: string
): value is TreasuryReportKey {
  return (TREASURY_REPORT_KEYS as readonly string[]).includes(value);
}

export type TreasuryReportsViewKind =
  | "denied"
  | "loading"
  | "error"
  | "empty"
  | "ready";

export function resolveTreasuryReportsViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  hasData: boolean;
}): TreasuryReportsViewKind {
  if (!input.canView) return "denied";
  if (input.loading) return "loading";
  if (input.error) return "error";
  if (!input.hasData) return "empty";
  return "ready";
}

export function formatTreasuryReportGeneratedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function describeTreasuryReportsFilters(
  filters: TreasuryReportsFilterState
): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [
    {
      label: "Relatório",
      value: TREASURY_REPORT_LABELS[filters.reportKey],
    },
    { label: "Período de", value: filters.from },
    { label: "Período até", value: filters.to },
    { label: "Cenário", value: filters.scenario },
  ];
  if (filters.accountIds.trim()) {
    out.push({ label: "Contas", value: filters.accountIds.trim() });
  }
  if (filters.status.trim()) {
    out.push({ label: "Status", value: filters.status.trim() });
  }
  if (filters.severity.trim()) {
    out.push({ label: "Severidade", value: filters.severity.trim() });
  }
  if (filters.search.trim()) {
    out.push({ label: "Busca", value: filters.search.trim() });
  }
  if (filters.companyCode.trim()) {
    out.push({ label: "Empresa", value: filters.companyCode.trim() });
  }
  return out;
}
