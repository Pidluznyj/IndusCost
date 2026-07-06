import React from "react";
import { cn } from "@/src/lib/utils";
import { ManagementListPanel } from "@/src/components/CrmManagementDashboardSection";
import type { ManagementDashboardResponse } from "@/src/components/crmManagementTypes";
import {
  formatManagementRiskReason,
  managementRiskBadgeClass,
} from "@/src/components/crmManagementUi";

export type CrmManagementListsProps = {
  data: ManagementDashboardResponse;
  onSelectCustomer: (customerId: string, meta?: { displayName?: string; taxId?: string }) => void;
  formatDateTimePt: (iso: string | null | undefined) => string;
  formatDateShortPt: (iso: string | null | undefined) => string;
  formatIntelCurrency: (value: unknown) => string;
  formatNumberPt: (value: number | null | undefined) => string;
  formatIntelDaysSinceLastPurchase: (value: number | null) => string;
  formatCommercialStatusLabel: (raw: string | null | undefined) => string;
  displayLine: (v: unknown) => string;
};

export const CrmManagementLists: React.FC<CrmManagementListsProps> = ({
  data,
  onSelectCustomer,
  formatDateTimePt,
  formatDateShortPt,
  formatIntelCurrency,
  formatNumberPt,
  formatIntelDaysSinceLastPurchase,
  formatCommercialStatusLabel,
  displayLine,
}) => (
  <>
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <ManagementListPanel
        title="Clientes em risco"
        description="Prioridade comercial — alto e médio risco."
        emptyMessage="Nenhum cliente em risco no momento."
        isEmpty={data.riskCustomers.length === 0}
      >
        <ul className="space-y-1.5">
          {data.riskCustomers.map((row) => (
            <li key={row.customerId}>
              <button
                type="button"
                onClick={() =>
                  onSelectCustomer(row.customerId, { displayName: row.displayName, taxId: row.taxId })
                }
                className="w-full text-left rounded-lg border border-border/70 bg-background/80 px-3 py-2.5 hover:border-primary/40 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground line-clamp-1">{row.displayName}</p>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase",
                      managementRiskBadgeClass(row.riskLevel)
                    )}
                  >
                    {row.riskLevel}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5">{row.taxId}</p>
                {row.riskReasons.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {row.riskReasons.map((code) => (
                      <span
                        key={code}
                        className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
                      >
                        {formatManagementRiskReason(code)}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="text-[10px] text-muted-foreground mt-1.5 line-clamp-2">
                  {row.daysSinceLastPurchase !== null
                    ? `Sem compra: ${formatIntelDaysSinceLastPurchase(row.daysSinceLastPurchase)}`
                    : "Sem compra válida"}
                  {row.daysSinceLastContact !== null
                    ? ` · Sem contato: ${formatIntelDaysSinceLastPurchase(row.daysSinceLastContact)}`
                    : ""}
                  {row.openOrdersCount > 0
                    ? ` · ${row.openOrdersCount} pedido(s) em carteira · ${formatIntelCurrency(row.openOrdersValue)}`
                    : ""}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </ManagementListPanel>

      <ManagementListPanel
        title="Oportunidades / pós-venda"
        description="Ações comerciais recomendadas."
        emptyMessage="Nenhuma oportunidade destacada."
        isEmpty={data.opportunityCustomers.length === 0}
      >
        <ul className="space-y-1.5">
          {data.opportunityCustomers.map((row) => (
            <li key={row.customerId}>
              <button
                type="button"
                onClick={() =>
                  onSelectCustomer(row.customerId, { displayName: row.displayName, taxId: row.taxId })
                }
                className="w-full text-left rounded-lg border border-border/70 bg-background/80 px-3 py-2.5 hover:border-primary/40 hover:bg-accent/30 transition-colors"
              >
                <p className="text-xs font-semibold text-foreground line-clamp-1">{row.displayName}</p>
                <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5">{row.taxId}</p>
                <p className="text-[10px] text-emerald-800/90 font-medium mt-1 line-clamp-2">
                  {row.suggestedAction}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {row.daysSinceLastPurchase !== null
                    ? `Última compra: ${formatIntelDaysSinceLastPurchase(row.daysSinceLastPurchase)}`
                    : "—"}
                  {" · "}
                  12m: {formatIntelCurrency(row.totalPurchasedLast12Months)}
                  {row.openOrdersCount > 0
                    ? ` · ${row.openOrdersCount} pedido(s) em carteira`
                    : ""}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </ManagementListPanel>

      <ManagementListPanel
        title="Pedidos sem follow-up"
        description="Pedidos em carteira sem contato após atualização."
        emptyMessage="Todos os pedidos em carteira têm follow-up."
        isEmpty={data.ordersWithoutFollowUp.length === 0}
      >
        <ul className="space-y-1.5">
          {data.ordersWithoutFollowUp.map((row) => (
            <li key={row.salesOrderId}>
              <button
                type="button"
                onClick={() => onSelectCustomer(row.customerId, { displayName: row.displayName })}
                className="w-full text-left rounded-lg border border-border/70 bg-background/80 px-3 py-2.5 hover:border-primary/40 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground">{row.orderCode}</p>
                  <span className="text-[10px] font-medium text-amber-800 tabular-nums shrink-0">
                    {row.daysWithoutFollowUp}d sem follow-up
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{row.displayName}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {formatCommercialStatusLabel(row.status)} · {formatIntelCurrency(row.totalNetValue)}
                  {row.responsible ? ` · ${row.responsible}` : ""}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </ManagementListPanel>

      <ManagementListPanel
        title="Próximos follow-ups"
        description="Ações agendadas para os próximos 7 dias."
        emptyMessage="Nenhum follow-up agendado para a semana."
        isEmpty={data.upcomingFollowUps.length === 0}
      >
        <ul className="space-y-1.5">
          {data.upcomingFollowUps.map((row) => (
            <li key={row.activityId}>
              <button
                type="button"
                onClick={() => onSelectCustomer(row.customerId, { displayName: row.displayName })}
                className="w-full text-left rounded-lg border border-border/70 bg-background/80 px-3 py-2.5 hover:border-primary/40 hover:bg-accent/30 transition-colors"
              >
                <p className="text-xs font-semibold text-foreground line-clamp-1">{row.displayName}</p>
                <p className="text-[10px] text-sky-800 font-medium mt-0.5">
                  {formatDateTimePt(row.nextActionAt)}
                  {typeof row.daysUntil === "number" ? ` · em ${row.daysUntil} dia(s)` : ""}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                  {displayLine(row.nextActionDescription)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {displayLine(row.assignedTo ?? row.createdByName)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </ManagementListPanel>

      <ManagementListPanel
        title="Top clientes — 12 meses"
        description="Maior valor comprado (pedidos válidos)."
        emptyMessage="Sem compras válidas nos últimos 12 meses."
        isEmpty={data.topCustomersLast12Months.length === 0}
      >
        <ul className="space-y-1.5">
          {data.topCustomersLast12Months.map((row) => (
            <li key={row.customerId}>
              <button
                type="button"
                onClick={() =>
                  onSelectCustomer(row.customerId, { displayName: row.displayName, taxId: row.taxId })
                }
                className="w-full text-left rounded-lg border border-border/70 bg-background/80 px-3 py-2.5 hover:border-primary/40 hover:bg-accent/30 transition-colors"
              >
                <p className="text-xs font-semibold text-foreground line-clamp-1">{row.displayName}</p>
                <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5">{row.taxId}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {formatIntelCurrency(row.totalPurchasedLast12Months)} · {formatNumberPt(row.ordersCount)}{" "}
                  pedido(s)
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Última compra: {formatDateShortPt(row.lastPurchaseAt)}
                  {row.daysSinceLastContact !== null
                    ? ` · Sem contato: ${formatIntelDaysSinceLastPurchase(row.daysSinceLastContact)}`
                    : ""}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </ManagementListPanel>
    </div>

    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
      <div>
        <h4 className="text-sm font-bold text-foreground">
          Atividades recentes — últimos {data.activityBreakdown.periodDays} dias
        </h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          Distribuição por canal, motivo e responsável.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {(
          [
            ["Por canal", data.activityBreakdown.byChannel],
            ["Por motivo", data.activityBreakdown.byReason],
            ["Por responsável", data.activityBreakdown.byResponsible],
          ] as const
        ).map(([title, items]) => (
          <div key={title} className="rounded-xl border border-border/80 bg-muted/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {title}
            </p>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Sem dados no período.</p>
            ) : (
              <ul className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
                {items.map((item) => (
                  <li
                    key={`${title}-${item.key}`}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="text-foreground truncate">{item.key}</span>
                    <span className="font-semibold tabular-nums text-muted-foreground shrink-0">
                      {formatNumberPt(item.count)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  </>
);
