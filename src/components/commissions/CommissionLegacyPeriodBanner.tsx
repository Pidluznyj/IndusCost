import React from "react";
import { AlertTriangle } from "lucide-react";
import {
  COMMISSION_LEGACY_REPORT_TEXT,
  type CommissionRangeReportingAuthority,
  type CommissionReportingAuthority,
} from "@/src/lib/commissions/commissionCoverageCutover";
import {
  COMMISSION_LEGACY_OFFICIAL_REPORT_MISSING,
  formatLegacyOfficialReportReconciliation,
  type CommissionLegacyOfficialReportStatus,
} from "@/src/lib/commissions/commissionReceiptCoverage.shared";

export const COMMISSION_LEGACY_PERIOD_BANNER_TEST_ID = "commission-legacy-period-banner";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("pt-BR");
}

/**
 * Aviso obrigatório das competências do histórico oficial do Nomus (antes do
 * cutover): o que a tela mostra é reconstrução técnica, nunca o relatório oficial
 * de pagamento. Texto explícito — não depende de cor nem de ícone.
 */
export function CommissionLegacyPeriodBanner({
  authority,
  officialReport,
  showOfficialReport = false,
  className,
}: {
  authority: Pick<CommissionReportingAuthority, "isLegacyPeriod"> | CommissionRangeReportingAuthority | null | undefined;
  /** Relatório oficial do Nomus registrado para a competência (quando conhecido). */
  officialReport?: CommissionLegacyOfficialReportStatus | null;
  /** Mostra a linha "Relatório oficial registrado" mesmo sem importação. */
  showOfficialReport?: boolean;
  className?: string;
}) {
  const legacy =
    authority != null &&
    ("isLegacyPeriod" in authority ? authority.isLegacyPeriod : authority.includesLegacyPeriod);
  if (!legacy) return null;
  const text = COMMISSION_LEGACY_REPORT_TEXT;
  const imports = officialReport?.imports ?? [];
  return (
    <section
      role="note"
      aria-label={text.bannerTitle}
      className={`rounded-xl border-2 border-amber-500 bg-amber-50 p-4 text-amber-950 ${className ?? ""}`}
      data-testid={COMMISSION_LEGACY_PERIOD_BANNER_TEST_ID}
    >
      <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        {text.bannerTitle}
      </p>
      <p className="mt-1 text-sm">{text.bannerBody}</p>
      <p className="mt-2 text-sm font-semibold">{text.officialSourceLine}</p>
      <p className="mt-1 text-xs">
        {text.sellerContext} · {text.reconstructedValue} — não substitui o relatório oficial do Nomus.
      </p>
      {officialReport || showOfficialReport ? (
        <div className="mt-2 text-xs" data-testid="commission-legacy-official-report">
          {imports.length > 0 ? (
            <>
              <p className="font-semibold">Relatório oficial do Nomus registrado: SIM</p>
              <ul className="mt-0.5 list-disc pl-5">
                {imports.map((item) => (
                  <li key={item.id}>
                    {item.filename} — importado em {formatDate(item.importedAt)}
                    {item.importedBy ? ` por ${item.importedBy}` : ""} ·{" "}
                    {formatLegacyOfficialReportReconciliation(item)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              <span className="font-semibold">Relatório oficial do Nomus registrado: NÃO</span> —{" "}
              {COMMISSION_LEGACY_OFFICIAL_REPORT_MISSING}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
