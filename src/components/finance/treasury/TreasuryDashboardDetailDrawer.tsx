/**
 * Detalhe ao clicar em totais do dashboard — Overlay (não só cor).
 */

import React from "react";
import type {
  TreasuryDashboardCompositionItemDto,
  TreasuryDashboardDto,
} from "@/src/lib/treasury/contracts/index.js";
import { formatTreasuryDashboardMoney } from "@/src/lib/treasury/treasuryDashboardUi.js";
import {
  Overlay,
  OverlayBody,
  OverlayFooter,
  OverlayHeader,
  OverlaySection,
} from "@/src/components/ui/overlay";

export type TreasuryDashboardDetailDrawerProps = {
  open: boolean;
  item: TreasuryDashboardCompositionItemDto | null;
  dashboard: TreasuryDashboardDto | null;
  onClose: () => void;
};

function relatedBucketLines(
  key: string,
  dto: TreasuryDashboardDto
): Array<{ label: string; value: string }> {
  if (key.startsWith("receipts")) {
    return [
      {
        label: "Previsto",
        value: `${formatTreasuryDashboardMoney(dto.receipts.plannedAmount)} (${dto.receipts.plannedTitleCount} títulos)`,
      },
      {
        label: "Realizado",
        value: `${formatTreasuryDashboardMoney(dto.receipts.realizedAmount)} (${dto.receipts.realizedTitleCount} títulos)`,
      },
      {
        label: "Pendente",
        value: `${formatTreasuryDashboardMoney(dto.receipts.pendingAmount)} (${dto.receipts.pendingTitleCount} títulos)`,
      },
    ];
  }
  if (key.startsWith("payments")) {
    return [
      {
        label: "Previsto",
        value: `${formatTreasuryDashboardMoney(dto.payments.plannedAmount)} (${dto.payments.plannedTitleCount} títulos)`,
      },
      {
        label: "Realizado",
        value: `${formatTreasuryDashboardMoney(dto.payments.realizedAmount)} (${dto.payments.realizedTitleCount} títulos)`,
      },
      {
        label: "Pendente",
        value: `${formatTreasuryDashboardMoney(dto.payments.pendingAmount)} (${dto.payments.pendingTitleCount} títulos)`,
      },
    ];
  }
  return [];
}

export function TreasuryDashboardDetailDrawer({
  open,
  item,
  dashboard,
  onClose,
}: TreasuryDashboardDetailDrawerProps) {
  const originDetail =
    item && dashboard?.origins
      ? dashboard.origins[item.key] ?? item.origin
      : item?.origin ?? "—";

  return (
    <Overlay
      open={open}
      onClose={onClose}
      size="md"
      testId="treasury-dashboard-detail-drawer"
    >
      <OverlayHeader
        title={item?.label ?? "Detalhe"}
        subtitle="Composição detalhável do total selecionado"
        onClose={onClose}
      />
      <OverlayBody>
        {!item ? (
          <p className="text-sm text-muted-foreground">Nenhum total selecionado.</p>
        ) : (
          <>
            <OverlaySection title="Valor">
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Montante</dt>
                  <dd
                    className="font-semibold tabular-nums"
                    data-testid="treasury-dashboard-detail-amount"
                  >
                    {formatTreasuryDashboardMoney(item.amount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Títulos / contas</dt>
                  <dd className="font-semibold tabular-nums">
                    {item.titleCount == null ? "—" : String(item.titleCount)}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Origem</dt>
                  <dd
                    className="font-medium"
                    data-testid="treasury-dashboard-detail-origin"
                  >
                    {originDetail}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Chave</dt>
                  <dd className="font-mono text-xs">{item.key}</dd>
                </div>
              </dl>
            </OverlaySection>

            {dashboard && relatedBucketLines(item.key, dashboard).length > 0 ? (
              <OverlaySection title="Contexto do fluxo">
                <ul className="space-y-2 text-sm">
                  {relatedBucketLines(item.key, dashboard).map((line) => (
                    <li
                      key={line.label}
                      className="flex items-center justify-between gap-3 border-b border-border/60 pb-1"
                    >
                      <span className="text-muted-foreground">{line.label}</span>
                      <span className="font-medium tabular-nums">{line.value}</span>
                    </li>
                  ))}
                </ul>
              </OverlaySection>
            ) : null}

            {dashboard ? (
              <OverlaySection title="Posição consolidada (referência)">
                <ul className="space-y-1 text-sm">
                  <li>
                    Observado:{" "}
                    <strong className="tabular-nums">
                      {formatTreasuryDashboardMoney(dashboard.observedBalance)}
                    </strong>
                  </li>
                  <li>
                    Calculado:{" "}
                    <strong className="tabular-nums">
                      {formatTreasuryDashboardMoney(dashboard.calculatedBalance)}
                    </strong>
                  </li>
                  <li>
                    Diferença:{" "}
                    <strong className="tabular-nums">
                      {formatTreasuryDashboardMoney(dashboard.divergence)}
                    </strong>
                    {dashboard.hasDivergence
                      ? " (há divergência)"
                      : " (sem divergência)"}
                  </li>
                </ul>
              </OverlaySection>
            ) : null}
          </>
        )}
      </OverlayBody>
      <OverlayFooter testId="treasury-dashboard-detail-footer">
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
          onClick={onClose}
        >
          Fechar
        </button>
      </OverlayFooter>
    </Overlay>
  );
}
