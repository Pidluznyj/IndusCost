import React from "react";
import type { FinanceExecutiveReportDataQuality } from "@/src/lib/financeExecutiveReportTypes";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";

export function ExecutivePrintDataQualityNote({
  title,
  dataQuality,
  domain,
}: {
  title: string;
  dataQuality: FinanceExecutiveReportDataQuality;
  domain: "ar" | "ap" | "general";
}) {
  const { sync, freshness, warnings, targetsDerived } = dataQuality;
  const syncAt =
    domain === "ar"
      ? sync.accountsReceivableLastSyncAt
      : domain === "ap"
        ? sync.accountsPayableLastSyncAt
        : null;

  const domainWarnings = warnings.filter((w) => {
    const lower = w.toLowerCase();
    if (domain === "ar") return lower.includes("receber") || lower.includes(" ar");
    if (domain === "ap") return lower.includes("pagar") || lower.includes(" ap");
    return true;
  });

  return (
    <div className="executive-print-data-quality executive-section">
      <p className="executive-print-data-quality-title">{title}</p>
      <div className="executive-print-data-quality-grid">
        {syncAt != null ? (
          <p>
            <span>Última sync:</span> {formatFinanceDateTime(syncAt)}
          </p>
        ) : (
          <p>
            <span>Última sync:</span> indisponível
          </p>
        )}
        {domain === "ar" && freshness.arStaleExcluded ? (
          <p>Títulos stale Nomus excluídos (freshness AR).</p>
        ) : null}
        {domain === "ap" && freshness.apStaleExcluded ? (
          <p>Títulos stale Nomus excluídos (freshness AP).</p>
        ) : null}
        {targetsDerived ? <p>Metas derivadas (+30%) — sem cadastro editável.</p> : null}
      </div>
      {domainWarnings.length > 0 ? (
        <ul className="executive-print-data-quality-warnings">
          {domainWarnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
