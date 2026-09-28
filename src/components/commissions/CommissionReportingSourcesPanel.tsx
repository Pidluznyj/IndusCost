import React from "react";
import { ChevronDown } from "lucide-react";
import {
  COMMISSION_LAST_NOMUS_OFFICIAL_DAY_LABEL,
  COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH,
  formatCommissionYearMonthLabel,
  formatCommissionYearMonthLongLabel,
  previousCommissionYearMonth,
} from "@/src/lib/commissions/commissionCoverageCutover";
import {
  COMMISSION_LEGACY_OFFICIAL_REPORT_MISSING,
  formatLegacyOfficialReportReconciliation,
  type CommissionLegacyOfficialReportStatus,
} from "@/src/lib/commissions/commissionReceiptCoverage.shared";

export const COMMISSION_REPORTING_SOURCES_PANEL_TEST_ID = "commission-reporting-sources-panel";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("pt-BR");
}

/** Linha do painel fechado: competências do Nomus no ano e quantas têm relatório registrado. */
export function summarizeLegacyOfficialReports(
  year: number,
  legacyReports: readonly CommissionLegacyOfficialReportStatus[]
): string {
  if (legacyReports.length === 0) return `nenhuma competência do Nomus em ${year}`;
  const registered = legacyReports.filter((item) => item.registered).length;
  return `${legacyReports.length} competência(s) do Nomus em ${year} · ${registered} com relatório oficial registrado`;
}

/**
 * Separa as duas autoridades: competências até o cutover têm o Nomus como fonte oficial
 * (aqui só a situação do relatório oficial arquivado e a reconstrução técnica); a partir
 * do cutover os relatórios oficiais são os fechamentos do IndusCost.
 *
 * Fica recolhido por padrão (detalhe sob demanda): a linha do resumo já diz quantas
 * competências são do Nomus e quantas têm relatório registrado. O aviso obrigatório de
 * período não oficial é o banner da tela, que continua sempre visível.
 */
export function CommissionReportingSourcesPanel({
  year,
  legacyReports,
  onConsultLegacyMonth,
  officialDescription,
  defaultOpen = false,
}: {
  year: number;
  /** Competências pré-cutover do ano (vazio quando o ano é todo oficial IndusCost). */
  legacyReports: CommissionLegacyOfficialReportStatus[];
  onConsultLegacyMonth?: (month: number) => void;
  officialDescription: string;
  defaultOpen?: boolean;
}) {
  const lastNomus = previousCommissionYearMonth(COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH);
  const cutoverYear = COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH.year;
  return (
    <details
      className="group rounded-xl border border-border bg-card"
      open={defaultOpen}
      data-testid={COMMISSION_REPORTING_SOURCES_PANEL_TEST_ID}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden"
        data-testid="commission-reporting-sources-summary"
      >
        <span className="min-w-0">
          <span className="block text-xs font-extrabold uppercase tracking-wide text-foreground">
            Fontes oficiais dos relatórios de comissão
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Histórico Nomus até {formatCommissionYearMonthLongLabel(lastNomus)} (
            {summarizeLegacyOfficialReports(year, legacyReports)}) · Relatórios oficiais IndusCost a partir de{" "}
            {formatCommissionYearMonthLongLabel(COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
          <span className="group-open:hidden">Ver detalhes</span>
          <span className="hidden group-open:inline">Ocultar</span>
          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden />
        </span>
      </summary>
      <div
        className="grid gap-3 border-t border-border p-4 lg:grid-cols-2"
        aria-label="Fontes oficiais dos relatórios de comissão"
      >
        <div
          className="rounded-xl border-2 border-amber-300 bg-amber-50/60 p-4"
          data-testid="commission-reporting-sources-nomus"
        >
          <p className="text-xs font-extrabold uppercase tracking-wide text-amber-950">Histórico oficial Nomus</p>
          <p className="text-xs font-semibold text-amber-900">Até {formatCommissionYearMonthLongLabel(lastNomus)}</p>
          <p className="mt-1 text-sm text-amber-950">
            Para competências até {COMMISSION_LAST_NOMUS_OFFICIAL_DAY_LABEL}, a fonte oficial dos relatórios de
            comissão é o Nomus. O IndusCost mostra só a reconstrução técnica (não oficial).
          </p>
          {legacyReports.length === 0 ? (
            <p className="mt-2 text-xs text-amber-900">Nenhuma competência do histórico Nomus em {year}.</p>
          ) : (
            <ul className="mt-2 divide-y divide-amber-200 text-xs">
              {legacyReports.map((item) => (
                <li
                  key={`${item.year}-${item.month}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                  data-testid={`commission-legacy-month-${item.year}-${item.month}`}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-amber-950">
                      {formatCommissionYearMonthLabel(item)} · Fonte oficial: Nomus
                    </p>
                    {item.imports.length > 0 ? (
                      item.imports.map((imported) => (
                        <p key={imported.id} className="text-amber-900">
                          Relatório oficial Nomus registrado: SIM — {imported.filename} · importado em{" "}
                          {formatDate(imported.importedAt)} · {formatLegacyOfficialReportReconciliation(imported)}
                        </p>
                      ))
                    ) : (
                      <p className="text-amber-900">
                        Relatório oficial Nomus registrado: NÃO — {COMMISSION_LEGACY_OFFICIAL_REPORT_MISSING}
                      </p>
                    )}
                  </div>
                  {onConsultLegacyMonth ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-amber-400 bg-white px-2 py-1 text-[11px] font-semibold text-amber-950 hover:bg-amber-100"
                      onClick={() => onConsultLegacyMonth(item.month)}
                    >
                      Consultar reconstrução técnica
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div
          className="rounded-xl border border-border bg-card p-4"
          data-testid="commission-reporting-sources-induscost"
        >
          <p className="text-xs font-extrabold uppercase tracking-wide text-foreground">Relatórios oficiais IndusCost</p>
          <p className="text-xs font-semibold text-muted-foreground">
            A partir de {formatCommissionYearMonthLongLabel(COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH)}
          </p>
          <p className="mt-1 text-sm text-foreground">
            {year < cutoverYear ? "Nenhuma competência oficial do IndusCost neste ano." : officialDescription}
          </p>
        </div>
      </div>
    </details>
  );
}
