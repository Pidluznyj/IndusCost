import React from "react";
import type { FinanceExecutiveReportDataQuality } from "@/src/lib/financeExecutiveReportTypes";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";

export function ExecutiveDataQualityAlert({
  dataQuality,
}: {
  dataQuality: FinanceExecutiveReportDataQuality;
}) {
  const { warnings, unavailableSections, targetsDerived, sync, freshness } = dataQuality;
  const hasAlerts =
    warnings.length > 0 ||
    unavailableSections.length > 0 ||
    targetsDerived ||
    freshness.arStaleExcluded ||
    freshness.apStaleExcluded;

  if (!hasAlerts) return null;

  return (
    <div
      className="rounded-xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-950 space-y-3"
      data-testid="executive-report-data-quality"
    >
      <p className="font-semibold">Qualidade e freshness dos dados</p>

      {unavailableSections.length > 0 ? (
        <p>
          Seções indisponíveis:{" "}
          <span className="font-medium">{unavailableSections.join(", ")}</span>
        </p>
      ) : null}

      {targetsDerived ? (
        <p>Metas derivadas (+30% sobre período anterior) — não há cadastro editável de metas.</p>
      ) : null}

      {freshness.arStaleExcluded || freshness.apStaleExcluded ? (
        <p>
          Bases AR/AP excluem títulos stale Nomus conforme cutoff de sync.
        </p>
      ) : null}

      <ul className="list-disc pl-5 space-y-1">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1 text-xs text-amber-900/80">
        <SyncLine label="Sync AR" value={sync.accountsReceivableLastSyncAt} />
        <SyncLine label="Sync AP" value={sync.accountsPayableLastSyncAt} />
        <SyncLine label="Sync NF-e" value={sync.nfeLastSyncAt} />
        <SyncLine label="Sync Pedidos" value={sync.salesOrdersLastSyncAt} />
      </div>
    </div>
  );
}

function SyncLine({ label, value }: { label: string; value: string | null }) {
  return (
    <p>
      <span className="font-semibold">{label}:</span>{" "}
      {value ? formatFinanceDateTime(value) : "indisponível"}
    </p>
  );
}
