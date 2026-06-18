import React from "react";
import type { FinanceExecutiveReportDataQuality } from "@/src/lib/financeExecutiveReportTypes";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import {
  buildExecutiveReportStaleSyncNotices,
  EXECUTIVE_REPORT_NO_TARGET_MESSAGE,
  translateExecutiveReportWarning,
} from "@/src/lib/financeExecutiveReportUxCopy";

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
  const staleNotices = buildExecutiveReportStaleSyncNotices(dataQuality);
  const syncAt =
    domain === "ar"
      ? sync.accountsReceivableLastSyncAt
      : domain === "ap"
        ? sync.accountsPayableLastSyncAt
        : null;

  const domainWarnings = warnings
    .filter((w) => {
      const lower = w.toLowerCase();
      if (domain === "ar") return lower.includes("receber") || lower.includes(" ar");
      if (domain === "ap") return lower.includes("pagar") || lower.includes(" ap");
      return true;
    })
    .map(translateExecutiveReportWarning);

  return (
    <div className="executive-print-data-quality executive-section">
      <p className="executive-print-data-quality-title">{title}</p>
      <div className="executive-print-data-quality-grid">
        {syncAt != null ? (
          <p>
            <span>Última atualização:</span> {formatFinanceDateTime(syncAt)}
          </p>
        ) : domain !== "general" ? (
          <p>
            <span>Última atualização:</span> indisponível
          </p>
        ) : null}
        {domain === "ar" && freshness.arStaleExcluded ? (
          <p>Dados de contas a receber podem estar desatualizados.</p>
        ) : null}
        {domain === "ap" && freshness.apStaleExcluded ? (
          <p>Dados de contas a pagar podem estar desatualizados.</p>
        ) : null}
        {targetsDerived ? <p>{EXECUTIVE_REPORT_NO_TARGET_MESSAGE}</p> : null}
        {staleNotices.map((notice) => (
          <p key={notice}>{notice}</p>
        ))}
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
