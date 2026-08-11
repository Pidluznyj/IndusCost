/**
 * Conciliação Bancária — aba "Conciliação por Títulos".
 * Puramente apresentacional: recebe o view-model pronto do backend
 * (`/cash-support/title-grid`) e desenha. Nenhum cálculo de dinheiro aqui.
 */

import React, { useMemo, useState } from "react";
import { cn } from "@/src/lib/utils";
import { formatTreasuryBankMoney } from "@/src/lib/treasury/treasuryBankMovementsUi.js";
import type {
  CashSupportReconciliationCards,
  CashSupportTitleGridRow,
  CashSupportTitleStatus,
  CashSupportUnexplainedMovement,
} from "@/src/lib/treasury/domain/cashSupportTitleGrid.js";

function money(value: string | null): string {
  if (value == null) return "—";
  return formatTreasuryBankMoney(value);
}

/** "2026-07-21" → "21/07/26" (datas civis já validadas no backend). */
function civilDateBr(value: string | null): string {
  if (!value) return "—";
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(2, 4)}`;
}

const STATUS_STYLE: Record<
  CashSupportTitleStatus,
  { dot: string; text: string; bg: string; label: string }
> = {
  AUTO_MATCHED: {
    dot: "bg-[#059669]",
    text: "text-[#065F46]",
    bg: "bg-[#ECFDF5] border-[#A7F3D0]",
    label: "Automático",
  },
  MANUAL_MATCHED: {
    dot: "bg-[#2563EB]",
    text: "text-[#1E40AF]",
    bg: "bg-[#EFF6FF] border-[#BFDBFE]",
    label: "Manual",
  },
  REVIEW: {
    dot: "bg-[#D97706]",
    text: "text-[#92400E]",
    bg: "bg-[#FFFBEB] border-[#FDE68A]",
    label: "Revisar",
  },
  UNRECONCILED: {
    dot: "bg-[#94A3B8]",
    text: "text-[#475569]",
    bg: "bg-[#F8FAFC] border-[#CBD5E1]",
    label: "Não conciliado",
  },
  DIVERGENCE: {
    dot: "bg-[#DC2626]",
    text: "text-[#991B1B]",
    bg: "bg-[#FEF2F2] border-[#FECACA]",
    label: "Divergência",
  },
  PARTIAL: {
    dot: "bg-[#7C3AED]",
    text: "text-[#5B21B6]",
    bg: "bg-[#F5F3FF] border-[#DDD6FE]",
    label: "Parcial",
  },
};

export function CashSupportTitleStatusBadge({ status }: { status: CashSupportTitleStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        s.bg,
        s.text
      )}
      data-testid={`title-status-${status}`}
    >
      <span className={cn("h-2 w-2 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

function CardBox({
  label,
  value,
  className,
  testId,
}: {
  label: string;
  value: string;
  className?: string;
  testId: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3" data-testid={testId}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold tabular-nums", className)}>{value}</p>
    </div>
  );
}

export function CashSupportReconciliationCardsRow({
  cards,
}: {
  cards: CashSupportReconciliationCards;
}) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
      <CardBox label="Títulos no período" value={String(cards.totalTitles)} testId="card-total-titles" />
      <CardBox
        label="Conciliados (auto)"
        value={String(cards.autoMatchedCount)}
        className="text-[#059669]"
        testId="card-auto"
      />
      <CardBox
        label="Conciliados (manual)"
        value={String(cards.manualMatchedCount)}
        className="text-[#2563EB]"
        testId="card-manual"
      />
      <CardBox
        label="Para revisar"
        value={String(cards.reviewCount)}
        className="text-[#D97706]"
        testId="card-review"
      />
      <CardBox
        label="Parciais / divergentes"
        value={`${cards.partialCount} / ${cards.divergenceCount}`}
        className="text-[#7C3AED]"
        testId="card-partial-divergence"
      />
      <CardBox
        label="Não conciliados"
        value={String(cards.unreconciledCount)}
        className="text-[#475569]"
        testId="card-unreconciled"
      />
      <CardBox
        label="Mov. sem explicação"
        value={`${cards.unexplainedMovementsCount} · ${money(cards.unexplainedMovementsTotal)}`}
        className="text-[#DC2626] text-base"
        testId="card-unexplained"
      />
    </div>
  );
}

function BankLegCell({ leg }: { leg: CashSupportTitleGridRow["bankLegs"][number] | undefined }) {
  if (!leg) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="min-w-0">
      <p className="truncate text-[12px] font-medium tabular-nums">
        {money(leg.allocatedAmount)}
      </p>
      <p className="truncate text-[10px] text-muted-foreground">
        {civilDateBr(leg.bankDate)}
        {leg.accountName ? ` · ${leg.accountName}` : ""}
      </p>
    </div>
  );
}

export type CashSupportTitleGridTabProps = {
  loading?: boolean;
  error?: string | null;
  titleRows: CashSupportTitleGridRow[];
  unexplainedMovements: CashSupportUnexplainedMovement[];
  cards: CashSupportReconciliationCards | null;
};

export function CashSupportTitleGridTab({
  loading = false,
  error = null,
  titleRows,
  unexplainedMovements,
  cards,
}: CashSupportTitleGridTabProps) {
  const [statusFilter, setStatusFilter] = useState<CashSupportTitleStatus | "">("");
  const [tipoFilter, setTipoFilter] = useState<"CR" | "CP" | "">("");

  const filtered = useMemo(
    () =>
      titleRows.filter(
        (r) =>
          (statusFilter === "" || r.status === statusFilter) &&
          (tipoFilter === "" || r.tipo === tipoFilter)
      ),
    [titleRows, statusFilter, tipoFilter]
  );

  if (error) {
    return (
      <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm text-[#991B1B]">
        {error}
      </div>
    );
  }

  return (
    <div data-testid="title-grid-tab">
      {cards ? <CashSupportReconciliationCardsRow cards={cards} /> : null}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          value={tipoFilter}
          onChange={(e) => setTipoFilter(e.target.value as "CR" | "CP" | "")}
          data-testid="title-grid-tipo-filter"
        >
          <option value="">CR + CP</option>
          <option value="CR">Só CR (receber)</option>
          <option value="CP">Só CP (pagar)</option>
        </select>
        <select
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as CashSupportTitleStatus | "")}
          data-testid="title-grid-status-filter"
        >
          <option value="">Todos os status</option>
          <option value="AUTO_MATCHED">Automático</option>
          <option value="MANUAL_MATCHED">Manual</option>
          <option value="REVIEW">Revisar</option>
          <option value="PARTIAL">Parcial</option>
          <option value="DIVERGENCE">Divergência</option>
          <option value="UNRECONCILED">Não conciliado</option>
        </select>
        <span className="text-[11px] text-muted-foreground">
          {filtered.length} de {titleRows.length} título(s)
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[880px] text-left text-xs">
          <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2 py-2">Tipo</th>
              <th className="px-2 py-2">Título</th>
              <th className="px-2 py-2">Cliente/Fornecedor</th>
              <th className="px-2 py-2">Venc.</th>
              <th className="px-2 py-2 text-right">Valor</th>
              <th className="px-2 py-2">Banco 1</th>
              <th className="px-2 py-2">Banco 2</th>
              <th className="px-2 py-2">Outros</th>
              <th className="px-2 py-2 text-right">Diferença</th>
              <th className="px-2 py-2">Conciliação</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                  Carregando títulos…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                  Nenhum título no período/filtro.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const extraLegs = Math.max(0, row.bankLegs.length - 2);
                return (
                  <tr
                    key={row.titleKeyLabel}
                    className="border-t border-border/60 align-top hover:bg-muted/30"
                    data-testid={`title-row-${row.externalId}`}
                  >
                    <td className="px-2 py-2">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-bold",
                          row.tipo === "CR"
                            ? "bg-[#ECFDF5] text-[#065F46]"
                            : "bg-[#FEF2F2] text-[#991B1B]"
                        )}
                      >
                        {row.tipo}
                      </span>
                    </td>
                    <td className="px-2 py-2 font-mono text-[11px]">{row.externalId}</td>
                    <td className="max-w-[180px] truncate px-2 py-2" title={row.counterparty ?? ""}>
                      {row.counterparty ?? "—"}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{civilDateBr(row.dueDate)}</td>
                    <td className="px-2 py-2 text-right font-medium tabular-nums">
                      {money(row.titleAmount)}
                    </td>
                    <td className="px-2 py-2">
                      <BankLegCell leg={row.bankLegs[0]} />
                    </td>
                    <td className="px-2 py-2">
                      <BankLegCell leg={row.bankLegs[1]} />
                    </td>
                    <td className="px-2 py-2">
                      {extraLegs > 0 ? (
                        <span
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold"
                          title={row.bankLegs
                            .slice(2)
                            .map((l) => `${money(l.allocatedAmount)} em ${civilDateBr(l.bankDate)}`)
                            .join(" · ")}
                        >
                          +{extraLegs}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2 text-right tabular-nums",
                        row.difference !== "0.00" && "font-semibold text-[#B45309]"
                      )}
                    >
                      {money(row.difference)}
                      {row.hasJustifiedDifference ? (
                        <p
                          className="text-[10px] font-normal text-muted-foreground"
                          title="Diferença explicada por desconto/juros/tarifa no match"
                        >
                          just.: {money(row.justifiedDifference)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <CashSupportTitleStatusBadge status={row.status} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <section className="mt-4" data-testid="unexplained-movements">
        <h3 className="mb-1 text-sm font-semibold">
          Movimentos sem explicação
          <span className="ml-2 text-[11px] font-normal text-muted-foreground">
            entradas/saídas do extrato ainda não vinculadas a nenhum título
          </span>
        </h3>
        {unexplainedMovements.length === 0 ? (
          <p className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            Nenhum movimento pendente de explicação no período. ✔
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Data</th>
                  <th className="px-2 py-2">Direção</th>
                  <th className="px-2 py-2">Descrição</th>
                  <th className="px-2 py-2">Conta</th>
                  <th className="px-2 py-2 text-right">Valor</th>
                  <th className="px-2 py-2 text-right">Sem explicação</th>
                  <th className="px-2 py-2">Melhor candidato</th>
                </tr>
              </thead>
              <tbody>
                {unexplainedMovements.map((m) => (
                  <tr key={m.bankMovementId} className="border-t border-border/60">
                    <td className="px-2 py-1.5 tabular-nums">{civilDateBr(m.bankDate)}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={cn(
                          "text-[10px] font-bold",
                          m.direction === "IN" ? "text-[#059669]" : "text-[#DC2626]"
                        )}
                      >
                        {m.direction === "IN" ? "ENTRADA" : "SAÍDA"}
                      </span>
                    </td>
                    <td className="max-w-[220px] truncate px-2 py-1.5" title={m.description ?? ""}>
                      {m.description ?? "—"}
                    </td>
                    <td className="px-2 py-1.5">{m.accountName ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(m.bankAmount)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-[#B45309]">
                      {money(m.residualAmount)}
                    </td>
                    <td className="px-2 py-1.5">
                      {m.bestSuggestionKey ? (
                        <span className="text-[11px]">
                          score {m.bestSuggestionScore} ({m.bestSuggestionConfidence}) — ver aba
                          Revisar Sugestões
                        </span>
                      ) : (
                        <span className="text-muted-foreground">sem candidato</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
