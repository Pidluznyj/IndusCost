/**
 * Auditoria de totalizador da Caixa — modal estilo DRE Gerencial.
 *
 * Ao clicar num card totalizador (Já Recebido / Já Pago / Saldo Realizado /
 * A Receber / A Pagar / Saldo em Aberto), abre esta modal listando os
 * títulos que somam aquele valor — MESMA fonte que o card usou (data.receivables
 * / data.payables do board), filtrada em memória. Zero call novo.
 *
 * Σ das linhas = valor do card, por construção. O rodapé exibe a soma
 * conferida e um selo ✓/⚠ quando bate/diverge no centavo.
 */

import React, { useMemo } from "react";
import { createPortal } from "react-dom";
import { CostCenterDialog } from "@/src/components/finance/cost-centers/financeUnclassifiedModalUi";
import type { FinanceAccountsReceivableGridRow } from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import type { FinanceAccountsPayableGridRow } from "@/src/lib/financeAccountsPayableRulesEngine.js";
import type { TreasuryCaixaCanonicalDay } from "@/src/lib/treasury/domain/treasuryCaixaCanonicalDay.js";
import { formatCivilDate } from "@/src/lib/financeCivilDate.js";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { TitleStatusBadge } from "@/src/components/finance/treasury/TreasuryCaixaTimeline";
import { cn } from "@/src/lib/utils";

/** Identifica qual card acionou a modal — governa filtro, colunas e rótulos. */
export type TreasuryCaixaTotalizerAuditKind =
  // Totalizadores do período (cards do meio da tela) — filtram receivables/payables.
  | "totalReceived"
  | "totalPaid"
  | "netRealized"
  | "totalReceivable"
  | "totalPayable"
  | "netBalance"
  // Cards do "Movimento de hoje" — consomem canonicalDay direto (já filtrado
  // pelo motor único-de-dia, listas prontas por dimensão).
  | "todayReceivableDue"
  | "todayReceivableReceived"
  | "todayPayableDue"
  | "todayPayablePaid";

const TODAY_KINDS = new Set<TreasuryCaixaTotalizerAuditKind>([
  "todayReceivableDue",
  "todayReceivableReceived",
  "todayPayableDue",
  "todayPayablePaid",
]);

export type TreasuryCaixaTotalizerAuditModalProps = {
  kind: TreasuryCaixaTotalizerAuditKind | null;
  periodLabel: string;
  cardValue: number;
  receivables: readonly FinanceAccountsReceivableGridRow[];
  payables: readonly FinanceAccountsPayableGridRow[];
  /**
   * Dia canônico de HOJE — obrigatório para os kinds `today*` (as listas de
   * títulos já vêm prontas por dimensão do motor único-de-dia; não precisa
   * refiltrar receivables/payables por data).
   */
  canonicalToday?: TreasuryCaixaCanonicalDay | null;
  onClose: () => void;
};

type FilteredArRow = {
  externalId: number;
  personName: string | null;
  dueDate: string | null;
  settlementDate: string | null;
  calculatedStatus: string;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  auditAmount: number;
};

type FilteredApRow = {
  externalId: number;
  personName: string | null;
  dueDate: string | null;
  paymentDate: string | null;
  calculatedStatus: string;
  amountPayable: number;
  amountPaid: number;
  balancePayable: number;
  auditAmount: number;
};

const KIND_META: Record<
  TreasuryCaixaTotalizerAuditKind,
  {
    title: string;
    subtitleSuffix: string;
    tone: "receivable" | "payable" | "net";
    reconcileLabel: string;
    /** Descrição pt-BR curta do critério de inclusão para a UI. */
    criteria: string;
  }
> = {
  totalReceived: {
    title: "Já Recebido",
    subtitleSuffix: "títulos com recebimento no período",
    tone: "receivable",
    reconcileLabel: "Soma dos recebidos",
    criteria: "Contas a Receber com valor recebido > 0 no período filtrado.",
  },
  totalPaid: {
    title: "Já Pago",
    subtitleSuffix: "títulos com pagamento no período",
    tone: "payable",
    reconcileLabel: "Soma dos pagos",
    criteria: "Contas a Pagar com valor pago > 0 no período filtrado.",
  },
  netRealized: {
    title: "Saldo Realizado",
    subtitleSuffix: "recebido − pago no período",
    tone: "net",
    reconcileLabel: "Recebido − Pago",
    criteria:
      "Soma dos títulos recebidos menos soma dos títulos pagos no período — dois lados exibidos separadamente.",
  },
  totalReceivable: {
    title: "A Receber (em aberto)",
    subtitleSuffix: "títulos CR em aberto no período",
    tone: "receivable",
    reconcileLabel: "Soma do saldo em aberto",
    criteria:
      "Contas a Receber com saldo > 0, não suspensas, com vencimento no período.",
  },
  totalPayable: {
    title: "A Pagar (em aberto)",
    subtitleSuffix: "títulos CP em aberto no período",
    tone: "payable",
    reconcileLabel: "Soma do saldo em aberto",
    criteria:
      "Contas a Pagar com saldo > 0, não suspensas, com vencimento no período.",
  },
  netBalance: {
    title: "Saldo em Aberto",
    subtitleSuffix: "a receber em aberto − a pagar em aberto",
    tone: "net",
    reconcileLabel: "A Receber − A Pagar",
    criteria:
      "Diferença entre o saldo aberto de CR e o saldo aberto de CP — dois lados exibidos separadamente.",
  },
  // ── Cards do "Movimento de hoje" ────────────────────────────────────────
  todayReceivableDue: {
    title: "A Receber hoje",
    subtitleSuffix: "CR em aberto vencendo hoje",
    tone: "receivable",
    reconcileLabel: "Soma do saldo em aberto",
    criteria:
      "Contas a Receber com saldo em aberto e vencimento oficial no dia de hoje (não suspensas).",
  },
  todayReceivableReceived: {
    title: "Recebido hoje",
    subtitleSuffix: "CR baixados hoje",
    tone: "receivable",
    reconcileLabel: "Soma dos recebidos",
    criteria:
      "Contas a Receber baixadas hoje (settlementDate = hoje, respeitando a regra dos N dias de conciliação).",
  },
  todayPayableDue: {
    title: "A Pagar hoje",
    subtitleSuffix: "CP em aberto vencendo hoje",
    tone: "payable",
    reconcileLabel: "Soma do saldo em aberto",
    criteria:
      "Contas a Pagar com saldo em aberto e vencimento oficial no dia de hoje (não suspensas).",
  },
  todayPayablePaid: {
    title: "Pago hoje",
    subtitleSuffix: "CP baixados hoje",
    tone: "payable",
    reconcileLabel: "Soma dos pagos",
    criteria:
      "Contas a Pagar baixadas hoje (paymentDate/fallback dueDate, respeitando a regra dos N dias de conciliação).",
  },
};

function money(value: number): string {
  return formatPredictiveCashFlowMoney(value);
}

function centsClose(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/**
 * Para os kinds `today*`, o motor único-de-dia já entregou as listas de
 * títulos por dimensão em `canonicalDay.*Titles` — não precisa refiltrar
 * `receivables[]` por data. As listas do canonicalDay já respeitam a
 * regra dos N dias de conciliação e a exclusão de suspensos.
 */
function filterArFromCanonicalToday(
  kind: TreasuryCaixaTotalizerAuditKind,
  canonicalToday: TreasuryCaixaCanonicalDay | null | undefined
): FilteredArRow[] {
  if (!canonicalToday) return [];
  if (kind === "todayReceivableDue") {
    return canonicalToday.receivableDueTitles.map((t) => ({
      externalId: t.externalId,
      personName: t.personName,
      dueDate: t.dueDate,
      settlementDate: t.settlementDate,
      calculatedStatus: t.calculatedStatus,
      amountReceivable: t.amountReceivable,
      amountReceived: t.amountReceived,
      balanceReceivable: t.balanceReceivable,
      auditAmount: t.balanceReceivable,
    }));
  }
  if (kind === "todayReceivableReceived") {
    return canonicalToday.receivableReceivedTitles.map((t) => ({
      externalId: t.externalId,
      personName: t.personName,
      dueDate: t.dueDate,
      settlementDate: t.settlementDate,
      calculatedStatus: t.calculatedStatus,
      amountReceivable: t.amountReceivable,
      amountReceived: t.amountReceived,
      balanceReceivable: t.balanceReceivable,
      auditAmount: t.amountReceived,
    }));
  }
  return [];
}

function filterApFromCanonicalToday(
  kind: TreasuryCaixaTotalizerAuditKind,
  canonicalToday: TreasuryCaixaCanonicalDay | null | undefined
): FilteredApRow[] {
  if (!canonicalToday) return [];
  if (kind === "todayPayableDue") {
    return canonicalToday.payableDueTitles.map((t) => ({
      externalId: t.externalId,
      personName: t.personName,
      dueDate: t.dueDate,
      paymentDate: t.paymentDate,
      calculatedStatus: t.calculatedStatus,
      amountPayable: t.amountPayable,
      amountPaid: t.amountPaid,
      balancePayable: t.balancePayable,
      auditAmount: t.balancePayable,
    }));
  }
  if (kind === "todayPayablePaid") {
    return canonicalToday.payablePaidTitles.map((t) => ({
      externalId: t.externalId,
      personName: t.personName,
      dueDate: t.dueDate,
      paymentDate: t.paymentDate,
      calculatedStatus: t.calculatedStatus,
      amountPayable: t.amountPayable,
      amountPaid: t.amountPaid,
      balancePayable: t.balancePayable,
      auditAmount: t.amountPaid,
    }));
  }
  return [];
}

function filterAr(
  kind: TreasuryCaixaTotalizerAuditKind,
  rows: readonly FinanceAccountsReceivableGridRow[]
): FilteredArRow[] {
  if (kind === "totalReceived" || kind === "netRealized") {
    return rows
      .filter((r) => r.amountReceived > 0)
      .map((r) => ({
        externalId: r.externalId,
        personName: r.personName,
        dueDate: r.dueDate,
        settlementDate: r.settlementDate,
        calculatedStatus: r.calculatedStatus,
        amountReceivable: r.amountReceivable,
        amountReceived: r.amountReceived,
        balanceReceivable: r.balanceReceivable,
        auditAmount: r.amountReceived,
      }));
  }
  if (kind === "totalReceivable" || kind === "netBalance") {
    return rows
      .filter((r) => !r.suspendCollection && r.balanceReceivable > 0)
      .map((r) => ({
        externalId: r.externalId,
        personName: r.personName,
        dueDate: r.dueDate,
        settlementDate: r.settlementDate,
        calculatedStatus: r.calculatedStatus,
        amountReceivable: r.amountReceivable,
        amountReceived: r.amountReceived,
        balanceReceivable: r.balanceReceivable,
        auditAmount: r.balanceReceivable,
      }));
  }
  return [];
}

function filterAp(
  kind: TreasuryCaixaTotalizerAuditKind,
  rows: readonly FinanceAccountsPayableGridRow[]
): FilteredApRow[] {
  if (kind === "totalPaid" || kind === "netRealized") {
    return rows
      .filter((p) => p.amountPaid > 0)
      .map((p) => ({
        externalId: p.externalId,
        personName: p.personName,
        dueDate: p.dueDate,
        paymentDate: p.paymentDate,
        calculatedStatus: p.calculatedStatus,
        amountPayable: p.amountPayable,
        amountPaid: p.amountPaid,
        balancePayable: p.balancePayable,
        auditAmount: p.amountPaid,
      }));
  }
  if (kind === "totalPayable" || kind === "netBalance") {
    return rows
      .filter((p) => !p.suspendPayment && p.balancePayable > 0)
      .map((p) => ({
        externalId: p.externalId,
        personName: p.personName,
        dueDate: p.dueDate,
        paymentDate: p.paymentDate,
        calculatedStatus: p.calculatedStatus,
        amountPayable: p.amountPayable,
        amountPaid: p.amountPaid,
        balancePayable: p.balancePayable,
        auditAmount: p.balancePayable,
      }));
  }
  return [];
}

function isTwoSided(kind: TreasuryCaixaTotalizerAuditKind): boolean {
  return kind === "netRealized" || kind === "netBalance";
}

function ArTable({
  title,
  counterpartyLabel,
  amountColLabel,
  rows,
  tone,
}: {
  title: string;
  counterpartyLabel: string;
  amountColLabel: string;
  rows: FilteredArRow[];
  tone: "in";
}) {
  const total = rows.reduce((s, r) => s + r.auditAmount, 0);
  return (
    <div className={cn("rounded-xl border border-emerald-200 bg-emerald-50/40 p-3")}
      data-testid="caixa-totalizer-audit-ar-block"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">
          {title}
        </p>
        <p className="text-sm font-bold tabular-nums text-emerald-700">
          {money(total)}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="py-2 text-[11px] text-muted-foreground">
          Nenhum título compõe este total no período.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-[11px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pr-2 font-semibold">Vencimento</th>
                <th className="pr-2 font-semibold">{counterpartyLabel}</th>
                <th className="pr-2 font-semibold">Status</th>
                <th className="pr-2 text-right font-semibold">Valor</th>
                <th className="pr-2 text-right font-semibold">Recebido</th>
                <th className="pr-2 text-right font-semibold">Saldo</th>
                <th className="text-right font-semibold">{amountColLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.externalId} className="border-b border-black/5 last:border-0">
                  <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums">
                    {r.dueDate ? formatCivilDate(r.dueDate) : "—"}
                  </td>
                  <td className="max-w-[240px] truncate py-1.5 pr-2">
                    {r.personName ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2">
                    <TitleStatusBadge status={r.calculatedStatus} />
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                    {money(r.amountReceivable)}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                    {money(r.amountReceived)}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                    {money(r.balanceReceivable)}
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-right font-semibold tabular-nums text-emerald-700">
                    {money(r.auditAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ApTable({
  title,
  counterpartyLabel,
  amountColLabel,
  rows,
  tone,
}: {
  title: string;
  counterpartyLabel: string;
  amountColLabel: string;
  rows: FilteredApRow[];
  tone: "out";
}) {
  const total = rows.reduce((s, r) => s + r.auditAmount, 0);
  return (
    <div
      className={cn("rounded-xl border border-red-200 bg-red-50/40 p-3")}
      data-testid="caixa-totalizer-audit-ap-block"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-red-800">
          {title}
        </p>
        <p className="text-sm font-bold tabular-nums text-red-700">
          {money(total)}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="py-2 text-[11px] text-muted-foreground">
          Nenhum título compõe este total no período.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-[11px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pr-2 font-semibold">Vencimento</th>
                <th className="pr-2 font-semibold">{counterpartyLabel}</th>
                <th className="pr-2 font-semibold">Status</th>
                <th className="pr-2 text-right font-semibold">Valor</th>
                <th className="pr-2 text-right font-semibold">Pago</th>
                <th className="pr-2 text-right font-semibold">Saldo</th>
                <th className="text-right font-semibold">{amountColLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.externalId} className="border-b border-black/5 last:border-0">
                  <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums">
                    {r.dueDate ? formatCivilDate(r.dueDate) : "—"}
                  </td>
                  <td className="max-w-[240px] truncate py-1.5 pr-2">
                    {r.personName ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2">
                    <TitleStatusBadge status={r.calculatedStatus} />
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                    {money(r.amountPayable)}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                    {money(r.amountPaid)}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                    {money(r.balancePayable)}
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-right font-semibold tabular-nums text-red-700">
                    {money(r.auditAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function TreasuryCaixaTotalizerAuditModal({
  kind,
  periodLabel,
  cardValue,
  receivables,
  payables,
  canonicalToday = null,
  onClose,
}: TreasuryCaixaTotalizerAuditModalProps) {
  if (kind == null) return null;
  const meta = KIND_META[kind];
  const isTodayKind = TODAY_KINDS.has(kind);

  // Para today* usamos as listas já filtradas do motor único-de-dia; para
  // os totalizadores do período, filtramos em memória a mesma fonte que
  // alimenta os cards (receivables/payables do board).
  const arRows = useMemo(
    () =>
      isTodayKind
        ? filterArFromCanonicalToday(kind, canonicalToday)
        : filterAr(kind, receivables),
    [isTodayKind, kind, receivables, canonicalToday]
  );
  const apRows = useMemo(
    () =>
      isTodayKind
        ? filterApFromCanonicalToday(kind, canonicalToday)
        : filterAp(kind, payables),
    [isTodayKind, kind, payables, canonicalToday]
  );

  const arTotal = arRows.reduce((s, r) => s + r.auditAmount, 0);
  const apTotal = apRows.reduce((s, r) => s + r.auditAmount, 0);
  const detailTotal =
    kind === "totalReceived" ||
    kind === "totalReceivable" ||
    kind === "todayReceivableDue" ||
    kind === "todayReceivableReceived"
      ? arTotal
      : kind === "totalPaid" ||
          kind === "totalPayable" ||
          kind === "todayPayableDue" ||
          kind === "todayPayablePaid"
        ? apTotal
        : arTotal - apTotal;

  const totalsMatch = centsClose(detailTotal, cardValue);
  const twoSided = isTwoSided(kind);
  const rowCount = arRows.length + apRows.length;

  const subtitle = `${periodLabel} · ${rowCount} ${
    rowCount === 1 ? "título" : "títulos"
  } · ${meta.subtitleSuffix}`;

  return createPortal(
    <CostCenterDialog
      testId="caixa-totalizer-audit-modal"
      title={meta.title}
      subtitle={subtitle}
      maxWidthClass="max-w-5xl"
      stacked
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="space-y-0.5">
            <div className="font-medium text-foreground">
              {meta.reconcileLabel}:{" "}
              <span className="tabular-nums">{money(detailTotal)}</span>
              {" · "}Valor do card:{" "}
              <span className="tabular-nums">{money(cardValue)}</span>
            </div>
            <div
              className={cn(
                "text-xs",
                totalsMatch ? "text-emerald-700" : "text-amber-800"
              )}
              data-testid="caixa-totalizer-audit-reconcile"
              data-match={totalsMatch ? "true" : "false"}
            >
              {totalsMatch
                ? "✓ Detalhe fecha com o card no centavo."
                : "⚠ Divergência entre detalhe e card — reportar aos desenvolvedores."}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold hover:bg-muted"
          >
            Fechar
          </button>
        </div>
      }
    >
      <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
        <strong>Critério:</strong> {meta.criteria}
      </p>
      <div className="flex flex-col gap-3">
        {arRows.length > 0 || (twoSided && kind === "netRealized") || (twoSided && kind === "netBalance") ? (
          <ArTable
            title={arTableTitle(kind)}
            counterpartyLabel="Cliente"
            amountColLabel={arAmountColLabel(kind)}
            rows={arRows}
            tone="in"
          />
        ) : null}
        {apRows.length > 0 || (twoSided && kind === "netRealized") || (twoSided && kind === "netBalance") ? (
          <ApTable
            title={apTableTitle(kind)}
            counterpartyLabel="Fornecedor"
            amountColLabel={apAmountColLabel(kind)}
            rows={apRows}
            tone="out"
          />
        ) : null}
      </div>
    </CostCenterDialog>,
    document.body
  );
}

function arTableTitle(kind: TreasuryCaixaTotalizerAuditKind): string {
  switch (kind) {
    case "totalReceived":
      return "Recebimentos no período";
    case "totalReceivable":
      return "A Receber (saldo em aberto)";
    case "netRealized":
      return "Recebidos (+)";
    case "netBalance":
      return "A Receber (+)";
    case "todayReceivableReceived":
      return "Recebido hoje (baixados)";
    case "todayReceivableDue":
      return "A Receber hoje (em aberto vencendo)";
    default:
      return "Contas a Receber";
  }
}

function apTableTitle(kind: TreasuryCaixaTotalizerAuditKind): string {
  switch (kind) {
    case "totalPaid":
      return "Pagamentos no período";
    case "totalPayable":
      return "A Pagar (saldo em aberto)";
    case "netRealized":
      return "Pagos (−)";
    case "netBalance":
      return "A Pagar (−)";
    case "todayPayablePaid":
      return "Pago hoje (baixados)";
    case "todayPayableDue":
      return "A Pagar hoje (em aberto vencendo)";
    default:
      return "Contas a Pagar";
  }
}

function arAmountColLabel(kind: TreasuryCaixaTotalizerAuditKind): string {
  if (
    kind === "totalReceived" ||
    kind === "netRealized" ||
    kind === "todayReceivableReceived"
  ) {
    return "Auditado (Recebido)";
  }
  return "Auditado (Saldo)";
}

function apAmountColLabel(kind: TreasuryCaixaTotalizerAuditKind): string {
  if (
    kind === "totalPaid" ||
    kind === "netRealized" ||
    kind === "todayPayablePaid"
  ) {
    return "Auditado (Pago)";
  }
  return "Auditado (Saldo)";
}
