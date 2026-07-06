import React from "react";
import type { FinanceExecutiveReportDataQuality } from "@/src/lib/financeExecutiveReportTypes";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import {
  buildExecutiveReportStaleSyncNotices,
  EXECUTIVE_DATA_QUALITY_TITLE,
  EXECUTIVE_REPORT_NO_TARGET_MESSAGE,
  translateExecutiveReportUnavailableSection,
  translateExecutiveReportWarning,
} from "@/src/lib/financeExecutiveReportUxCopy";

export function ExecutiveDataQualityAlert({
  dataQuality,
}: {
  dataQuality: FinanceExecutiveReportDataQuality;
}) {
  const { warnings, unavailableSections, targetsDerived, sync, freshness } = dataQuality;
  const staleNotices = buildExecutiveReportStaleSyncNotices(dataQuality);
  const hasAlerts =
    warnings.length > 0 ||
    unavailableSections.length > 0 ||
    targetsDerived ||
    freshness.arStaleExcluded ||
    freshness.apStaleExcluded ||
    staleNotices.length > 0;

  if (!hasAlerts) return null;

  return (
    <div
      className={cn(
        financeBiCardClass,
        "border-amber-200 bg-amber-50/90 p-5 text-sm text-amber-950 space-y-3"
      )}
      data-testid="executive-report-data-quality"
    >
      <p className="font-semibold">{EXECUTIVE_DATA_QUALITY_TITLE}</p>

      {unavailableSections.length > 0 ? (
        <p>
          Partes do relatório indisponíveis:{" "}
          <span className="font-medium">
            {unavailableSections.map(translateExecutiveReportUnavailableSection).join(", ")}
          </span>
        </p>
      ) : null}

      {targetsDerived ? <p>{EXECUTIVE_REPORT_NO_TARGET_MESSAGE}</p> : null}

      {freshness.arStaleExcluded || freshness.apStaleExcluded ? (
        <p>Dados do Nomus podem estar desatualizados; registros antigos foram ignorados.</p>
      ) : null}

      {staleNotices.length > 0 ? (
        <ul className="list-disc pl-5 space-y-1">
          {staleNotices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      ) : null}

      <ul className="list-disc pl-5 space-y-1">
        {warnings.map((warning) => (
          <li key={warning}>{translateExecutiveReportWarning(warning)}</li>
        ))}
      </ul>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1 text-xs text-amber-900/80">
        <SyncLine label="Contas a receber" value={sync.accountsReceivableLastSyncAt} />
        <SyncLine label="Contas a pagar" value={sync.accountsPayableLastSyncAt} />
        <SyncLine label="Notas fiscais" value={sync.nfeLastSyncAt} />
        <SyncLine label="Pedidos de venda" value={sync.salesOrdersLastSyncAt} />
      </div>
    </div>
  );
}

function SyncLine({ label, value }: { label: string; value: string | null }) {
  return (
    <p>
      <span className="font-semibold">Última atualização — {label}:</span>{" "}
      {value ? formatFinanceDateTime(value) : "indisponível"}
    </p>
  );
}
