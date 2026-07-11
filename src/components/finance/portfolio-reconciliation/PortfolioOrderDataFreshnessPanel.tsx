import React from "react";
import { Clock } from "lucide-react";
import {
  formatFinanceDate,
  formatFinanceDateTime,
} from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioIntelligenceDataFreshnessDto } from "@/src/lib/financePortfolioReconciliationClient";

export const DRAWER_FRESHNESS_SYNC_MESSAGE =
  "Se o cliente pagou hoje ou ontem, o valor só aparecerá aqui após sincronizar o Contas a Receber e reconstruir a conciliação.";

function formatFreshnessWhen(iso: string | null | undefined): string {
  if (!iso) return "Informação não disponível";
  if (iso.length > 10) return formatFinanceDateTime(iso);
  return formatFinanceDate(iso);
}

/**
 * Bloco de frescor dos dados — só exibe o que a API já trouxe.
 */
export function PortfolioOrderDataFreshnessPanel({
  freshness,
}: {
  freshness: PortfolioIntelligenceDataFreshnessDto | null | undefined;
}) {
  if (!freshness) {
    return (
      <div
        className="rounded-[12px] border border-[#EAECF0] bg-[#F9FAFB] p-3 text-sm text-[#344054] sm:p-4"
        data-testid="portfolio-intelligence-drawer-freshness"
      >
        <div className="mb-2 flex items-center gap-2">
          <Clock className="h-4 w-4 text-[#667085]" aria-hidden />
          <h3 className="text-[16px] font-bold text-[#101828]">Frescor dos dados</h3>
        </div>
        <p className="text-[13px] text-[#667085]">
          Informações de atualização indisponíveis com os dados atuais.
        </p>
        <p
          className="mt-2 text-[12px] leading-relaxed text-[#344054]"
          data-testid="portfolio-intelligence-drawer-freshness-layman"
        >
          {DRAWER_FRESHNESS_SYNC_MESSAGE}
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-[12px] border border-[#EAECF0] bg-[#F9FAFB] p-3 text-[#344054] sm:p-4"
      data-testid="portfolio-intelligence-drawer-freshness"
    >
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4 shrink-0 text-[#667085]" aria-hidden />
        <h3 className="text-[16px] font-bold text-[#101828]">Frescor dos dados</h3>
      </div>
      <dl className="grid grid-cols-1 gap-2 text-[12px] sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-[#667085]">Última atualização da run</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {formatFreshnessWhen(freshness.runUpdatedAt ?? freshness.runFinishedAt)}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[#667085]">Última atualização do pedido</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {formatFreshnessWhen(freshness.lastOrderOrFactUpdatedAt)}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[#667085]">Última evidência de CR</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {formatFreshnessWhen(freshness.lastReceivableEvidenceAt)}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[#667085]">Última baixa encontrada</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">
            {freshness.hasSettlementEvidence && freshness.lastSettlementAt
              ? formatFreshnessWhen(freshness.lastSettlementAt)
              : "Nenhuma baixa encontrada até a última sincronização."}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[12px] leading-relaxed">
        <span className="font-semibold text-[#667085]">Fonte dos dados: </span>
        {freshness.sourceLabel}
      </p>
      {!freshness.isLatestRun ? (
        <p className="mt-2 rounded-[10px] border border-[#FEDF89] bg-[#FFFAEB] px-2.5 py-2 text-[12px] text-[#B54708]">
          Esta run não é a mais recente
          {freshness.latestRunId ? ` (${freshness.latestRunId.slice(0, 8)}…)` : ""}.
          Reabra a conciliação atual ou reconstrua após sincronizar o CR.
        </p>
      ) : null}
      <p
        className="mt-3 text-[12px] leading-relaxed text-[#344054]"
        data-testid="portfolio-intelligence-drawer-freshness-layman"
      >
        {DRAWER_FRESHNESS_SYNC_MESSAGE}
      </p>
      <p
        className="mt-1 text-[11px] leading-relaxed text-[#667085]"
        data-testid="portfolio-intelligence-drawer-freshness-sync"
      >
        {freshness.syncRebuildNotice}
      </p>
    </div>
  );
}
