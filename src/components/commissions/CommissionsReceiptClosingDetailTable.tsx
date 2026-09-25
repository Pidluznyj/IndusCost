import React from "react";
import { CommissionsTableScroll } from "@/src/components/commissions/commissionsUi";
import type { CommissionsReceiptClosingLine } from "@/src/components/commissions/commissionsTypes";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import type { ReceiptClosingDetailTotals } from "@/src/lib/commissions/commissionReceiptClosingSellerFilter.shared";
import { formatReceiptClosingCanonicalSellerDisplay } from "@/src/lib/commissions/commissionReceiptSeller";
import { formatInstallmentLabel } from "@/src/lib/commissions/commissionReceiptInstallment.shared";
import {
  COMMISSION_LEDGER_INCLUSION_TYPE_LABELS,
  formatCarryoverLineTag,
} from "@/src/lib/commissions/commissionReceiptCoverage.shared";
import {
  formatCommissionReceiptLineReason,
  formatCommissionReceiptLineStatus,
} from "@/src/lib/commissions/commissionReceiptLineStatusLabels";
import { cn } from "@/src/lib/utils";

export const RECEIPT_CLOSING_DETAIL_TABLE_TEST_ID = "commissions-receipt-closing-detail-table";

/**
 * Cor da bolinha de status — mesma semântica do antigo badge: verde = comissionável,
 * cinza = exclusões (cliente, empresa do grupo, regra), âmbar = pendência (sem
 * schedule, schedule desatualizado e demais status de atenção).
 */
export function receiptClosingStatusIndicatorClass(status: string): string {
  if (status === "COMMISSIONABLE") return "bg-emerald-500";
  if (status === "CUSTOMER_EXCLUDED") return "bg-slate-500";
  if (status === "GROUP_COMPANY_EXCLUDED" || status === "EXCLUDED") return "bg-slate-400";
  if (status === "NO_SCHEDULE" || status === "STALE_SCHEDULE") return "bg-amber-500";
  return "bg-amber-500";
}

/**
 * Texto do tooltip da bolinha: status por extenso (dicionário oficial
 * `COMMISSION_RECEIPT_LINE_STATUS_LABELS`) e, quando houver, o motivo.
 */
export function receiptClosingStatusTooltip(status: string, statusReason: string | null): string {
  const label = formatCommissionReceiptLineStatus(status);
  const reason = formatCommissionReceiptLineReason(statusReason);
  return reason && reason !== label ? `${label}\n${reason}` : label;
}

/** Status compacto: bolinha colorida + tooltip + texto acessível (não depende só da cor). */
export function ReceiptClosingStatusDot({
  status,
  statusReason,
}: {
  status: string;
  statusReason: string | null;
}) {
  const label = formatCommissionReceiptLineStatus(status);
  return (
    <span
      role="img"
      aria-label={`Status: ${label}`}
      title={receiptClosingStatusTooltip(status, statusReason)}
      data-testid="commissions-receipt-closing-status-dot"
      data-status={status}
      className={cn(
        "inline-block h-2.5 w-2.5 cursor-help rounded-full align-middle",
        receiptClosingStatusIndicatorClass(status)
      )}
    />
  );
}

// Cabeçalhos longos quebram em duas linhas, alinhados pela base.
const TH = "px-2 py-2 align-bottom leading-tight";
// Colunas "encolhidas" (w-px): ficam na largura do conteúdo e a sobra da tela vai
// só para Cliente e Vendedor (menos quebra de linha nos nomes).
const FIT = "w-px";
const TD = "px-2 py-2";
const MONEY = "text-right whitespace-nowrap tabular-nums";

/**
 * Detalhamento do fechamento por recebimento. Compacto para caber sem rolagem
 * horizontal no desktop: status virou bolinha (largura de um ponto), valores não
 * quebram, cabeçalhos longos quebram em duas linhas e Cliente/Vendedor ficam com o
 * espaço restante. Em telas estreitas a rolagem horizontal continua disponível.
 */
export function CommissionsReceiptClosingDetailTable({
  rows,
  totals,
}: {
  rows: CommissionsReceiptClosingLine[];
  totals: ReceiptClosingDetailTotals;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma linha no período.</p>;
  }
  return (
    <CommissionsTableScroll testId={RECEIPT_CLOSING_DETAIL_TABLE_TEST_ID} tableClassName="text-xs">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className={cn(TH, FIT)}>NF</th>
          <th className={cn(TH, FIT)}>Pedido</th>
          <th className={cn(TH, "min-w-[9rem]")}>Cliente</th>
          <th className={cn(TH, "min-w-[7.5rem]")}>Vendedor</th>
          <th
            className={cn(TH, FIT, "whitespace-nowrap text-center")}
            title="Parcela do título entre todos os títulos da NF (ex.: 2/3)"
          >
            Parcela
          </th>
          <th className={cn(TH, FIT, "text-right")}>Valor real</th>
          <th className={cn(TH, FIT, "text-right")}>Recebido</th>
          <th className={cn(TH, FIT, "text-right")}>Base comissão</th>
          <th className={cn(TH, FIT, "text-right")}>Juros/multa ignorados</th>
          <th className={cn(TH, FIT, "text-right")}>Comissão agendada</th>
          <th className={cn(TH, FIT, "text-right")}>Comissão liberada</th>
          <th className={cn(TH, FIT, "px-1.5 text-center")}>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const ignored = row.ignoredFinancialChargesAmount ?? 0;
          const original = row.receivableOriginalAmount ?? null;
          const base = row.commissionPrincipalAmount ?? row.commissionableBaseAmount;
          // Motivo saiu da grade e virou tooltip da linha inteira: passar o
          // mouse em qualquer célula explica o status. Sem motivo, sem
          // tooltip — `undefined` não renderiza atributo. A bolinha de status
          // tem o próprio tooltip (status por extenso + motivo).
          const reasonTooltip = row.statusReason ? `${row.status}: ${row.statusReason}` : undefined;
          // Pendência de período anterior incluída neste fechamento: etiqueta na
          // célula da NF (sem coluna nova — preserva o layout Parcela/Status).
          const carryoverTag = formatCarryoverLineTag(row);
          return (
            <tr
              key={row.lineKey}
              className="border-b"
              title={reasonTooltip}
              data-status-reason={row.statusReason ?? undefined}
            >
              <td className={cn(TD, "whitespace-nowrap")}>
                {row.nfeNumber ?? "—"}
                {carryoverTag ? (
                  <span
                    className="mt-0.5 block w-fit rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-900"
                    title={
                      row.inclusionType ? COMMISSION_LEDGER_INCLUSION_TYPE_LABELS[row.inclusionType] : undefined
                    }
                    data-testid="commissions-receipt-closing-carryover-tag"
                  >
                    {carryoverTag}
                  </span>
                ) : null}
                {row.coverageNote ? (
                  // Onde os recebimentos foram contemplados (ex.: Nomus 09/2026) — explica
                  // carryover do histórico sem mudar o receiptDate.
                  <span
                    className="mt-0.5 block w-fit rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-700"
                    title={row.coverageNote.detail}
                    data-testid="commissions-receipt-closing-coverage-tag"
                  >
                    {row.coverageNote.tag}
                    <span className="sr-only"> — {row.coverageNote.detail}</span>
                  </span>
                ) : null}
              </td>
              <td className={cn(TD, "whitespace-nowrap")}>{row.orderCode ?? "—"}</td>
              <td className={TD}>{row.customerName ?? "—"}</td>
              <td className={TD}>{formatReceiptClosingCanonicalSellerDisplay(row)}</td>
              <td
                className={cn(TD, "whitespace-nowrap text-center tabular-nums")}
                data-testid="commissions-receipt-closing-installment"
              >
                {formatInstallmentLabel(row.installmentNumber, row.installmentTotal)}
              </td>
              <td className={cn(TD, MONEY)}>
                {original != null ? formatFinanceCurrency(original) : "—"}
              </td>
              <td className={cn(TD, MONEY)}>
                {row.uniqueReceivedAmount > 0 ? formatFinanceCurrency(row.uniqueReceivedAmount) : "—"}
              </td>
              <td className={cn(TD, MONEY)}>{formatFinanceCurrency(base)}</td>
              <td
                className={cn(
                  TD,
                  MONEY,
                  ignored > 0 ? "font-medium text-amber-800" : "text-muted-foreground"
                )}
                title={
                  ignored > 0
                    ? "Recebido acima do original do CR — juros/multa/acréscimos não entram na comissão"
                    : undefined
                }
              >
                {ignored > 0 ? formatFinanceCurrency(ignored) : "—"}
              </td>
              <td className={cn(TD, MONEY)}>
                {row.scheduledCommissionAmount != null
                  ? formatFinanceCurrency(row.scheduledCommissionAmount)
                  : "—"}
              </td>
              <td className={cn(TD, MONEY)}>{formatFinanceCurrency(row.releasedCommissionAmount)}</td>
              <td className={cn(TD, "px-1.5 text-center")}>
                <ReceiptClosingStatusDot status={row.status} statusReason={row.statusReason} />
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        {/*
          12 colunas: NF, Pedido, Cliente, Vendedor, Parcela (colSpan 5),
          Valor real, Recebido, Base comissão, Juros/multa ignorados,
          Comissão agendada, Comissão liberada (6 células) e Status (1).
          Soma 12 — precisa bater com o thead, senão a linha de totais
          desalinha das colunas de valor.
        */}
        <tr
          className="border-t-2 bg-muted/20 font-semibold"
          data-testid="commissions-receipt-closing-detail-totals"
        >
          <td className={TD} colSpan={5}>
            Totais ({totals.lineCount} linha{totals.lineCount === 1 ? "" : "s"})
          </td>
          <td className={cn(TD, MONEY)}>—</td>
          <td className={cn(TD, MONEY)}>{formatFinanceCurrency(totals.receivedAmount)}</td>
          <td className={cn(TD, MONEY)}>—</td>
          <td className={cn(TD, MONEY)}>—</td>
          <td className={cn(TD, MONEY)}>{formatFinanceCurrency(totals.scheduledCommissionAmount)}</td>
          <td className={cn(TD, MONEY)}>{formatFinanceCurrency(totals.releasedCommissionAmount)}</td>
          <td className={cn(TD, "px-1.5")} />
        </tr>
      </tfoot>
    </CommissionsTableScroll>
  );
}
