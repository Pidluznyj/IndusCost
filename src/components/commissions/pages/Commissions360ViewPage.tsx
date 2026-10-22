/**
 * Comissões › Visão 360° — leitura gerencial (pago, realizado, previsto, potencial e
 * conciliação de CRs). Não grava nada: só GET /api/commissions/visao-360.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Loader2, RefreshCw } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import {
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { fetchJsonOk } from "@/src/lib/http";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import { COMMISSIONS_FILTER_FIELD_CLASS } from "@/src/lib/commissionsPeriodFilter";
import { COMMISSIONS_SECTION_PATHS } from "@/src/lib/commissionsNavigation";
import {
  COMMISSION_360_CR_STATUS_META,
  COMMISSION_360_DESCRIPTION,
  COMMISSION_360_LEGACY_SECTION_TITLE,
  COMMISSION_360_NATURE_LABELS,
  COMMISSION_360_POTENTIAL_STATUS_LABELS,
  COMMISSION_360_RELEASED_STATUS_LABELS,
  COMMISSION_360_SECTIONS,
  COMMISSION_360_TITLE,
  buildCommission360ClientQuery,
  type Commission360CrStatus,
  type Commission360Payload,
  type Commission360Section,
} from "@/src/lib/commissions/commission360View.shared";

type Filters = {
  fromMonth: string;
  toMonth: string;
  sellerId: string;
  customer: string;
  orderCode: string;
  section: Commission360Section;
  crStatus: string;
  page: number;
};

/** Período vazio: o servidor usa 12 meses para trás e 12 para frente. */
const DEFAULT_FILTERS: Filters = {
  fromMonth: "",
  toMonth: "",
  sellerId: "all",
  customer: "",
  orderCode: "",
  section: "reconciliation",
  crStatus: "all",
  page: 1,
};

const money = (value: number | null | undefined) => (value == null ? "—" : formatFinanceCurrency(value));
const TH = "px-2 py-2 text-left text-xs font-semibold uppercase text-slate-500";
const TH_RIGHT = `${TH} text-right`;
const TD = "px-2 py-2 align-top";
const TD_RIGHT = `${TD} text-right tabular-nums`;

const COMPACT_BRL = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

const CHART_COLORS = {
  paid: "#059669",
  realized: "#2563EB",
  forecast: "#D97706",
};

/**
 * Série principal: só o motor oficial. Pago/realizado são null antes de 10/2026 (sem barra, e o
 * tooltip mostra "fora da série"); o legado nunca é desenhado aqui — ver LegacySection.
 */
function Commission360Chart({ months }: { months: Commission360Payload["months"] }) {
  const data = months.map((row) => ({
    label: row.label,
    official: row.official,
    "Pago (confirmado)": row.paidConfirmed,
    "Realizado (recebimentos)": row.realized,
    "Previsto sobre CRs": row.forecast,
  }));
  return (
    <div className="h-72 w-full rounded-xl border border-border p-2" data-testid="commissions-360-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={72} tickFormatter={(value: number) => COMPACT_BRL.format(value)} />
          <Tooltip
            formatter={(value: number | null, name: string) =>
              value == null ? ["fora da série oficial (antes de 10/2026)", name] : [formatFinanceCurrency(value), name]
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {/* Histórico: barras sólidas. Estimativa: linha tracejada. Nunca empilhados. */}
          <Bar dataKey="Pago (confirmado)" fill={CHART_COLORS.paid} isAnimationActive={false} />
          <Bar dataKey="Realizado (recebimentos)" fill={CHART_COLORS.realized} isAnimationActive={false} />
          <Line
            type="linear"
            dataKey="Previsto sobre CRs"
            stroke={CHART_COLORS.forecast}
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={{ r: 2 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Histórico legado / Ajustes retroativos: nada daqui integra a série principal. */
function LegacySection({ legacy }: { legacy: Commission360Payload["legacySection"] }) {
  const totals = legacy.totals;
  const rows: Array<[string, string]> = [
    [`Relatórios do Nomus (${totals.nomusLegacyCoveredCount} recebimento(s)) — sem confirmação de desembolso`, money(totals.nomusLegacyCovered)],
    ["Comissão de recebimentos legados (competência natural antes de 10/2026 ou cobertos pelo Nomus)", money(totals.legacyRealized)],
    ["Recebimentos legados ainda sem cobertura (pendência de competência antiga)", money(totals.legacyAwaitingClosing)],
    ["Ajustes retroativos liberados em fechamentos oficiais (LEGACY_CARRYOVER, ajuste manual)", money(totals.retroactiveReleased)],
    ["Ajustes retroativos liberados e não pagos", money(totals.retroactiveNotPaid)],
    [`Lotes pagos de competência legada ou atravessando o corte (${totals.legacyPaymentsCount})`, money(totals.legacyPayments)],
    [`Previsão de títulos vencidos antes de 09/2026 (${totals.forecastBeforeStartCount})`, money(totals.forecastBeforeStart)],
  ];
  return (
    <details className="rounded-xl border border-dashed border-border px-4 py-3" data-testid="commissions-360-legacy">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">
        {legacy.title} — não integra a série principal
      </summary>
      <p className="mt-2 text-xs text-slate-500">{legacy.note}</p>
      <ul className="mt-2 space-y-1 text-sm text-slate-700" data-testid="commissions-360-legacy-totals">
        {rows.map(([label, value]) => (
          <li key={label} className="flex justify-between gap-4">
            <span>{label}</span>
            <span className="tabular-nums">{value}</span>
          </li>
        ))}
      </ul>
      {legacy.byMonth.length > 0 ? (
        <CommissionsTableScroll testId="commissions-360-legacy-months">
          <thead>
            <tr>
              <th className={TH}>Competência natural</th>
              <th className={TH_RIGHT}>Relatório Nomus</th>
              <th className={TH_RIGHT}>Recebimentos legados</th>
              <th className={TH_RIGHT}>Ajuste retroativo liberado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {legacy.byMonth.map((row) => (
              <tr key={row.month}>
                <td className={TD}>{row.label}</td>
                <td className={TD_RIGHT}>{money(row.nomusLegacyCovered)}</td>
                <td className={TD_RIGHT}>{money(row.legacyRealized)}</td>
                <td className={TD_RIGHT}>{money(row.retroactiveReleased)}</td>
              </tr>
            ))}
          </tbody>
        </CommissionsTableScroll>
      ) : null}
      {legacy.bySeller.length > 0 ? (
        <CommissionsTableScroll testId="commissions-360-legacy-sellers">
          <thead>
            <tr>
              <th className={TH}>Vendedor</th>
              <th className={TH_RIGHT}>Relatório Nomus</th>
              <th className={TH_RIGHT}>Recebimentos legados</th>
              <th className={TH_RIGHT}>Pendência antiga</th>
              <th className={TH_RIGHT}>Ajuste retroativo</th>
              <th className={TH_RIGHT}>Lotes legados pagos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {legacy.bySeller.map((row) => (
              <tr key={row.key}>
                <td className={TD}>{row.sellerName}</td>
                <td className={TD_RIGHT}>{money(row.nomusLegacyCovered)}</td>
                <td className={TD_RIGHT}>{money(row.legacyRealized)}</td>
                <td className={TD_RIGHT}>{money(row.legacyAwaitingClosing)}</td>
                <td className={TD_RIGHT}>{money(row.retroactiveReleased)}</td>
                <td className={TD_RIGHT}>{money(row.legacyPayments)}</td>
              </tr>
            ))}
          </tbody>
        </CommissionsTableScroll>
      ) : null}
      {legacy.payments.length > 0 ? (
        <CommissionsTableScroll testId="commissions-360-legacy-payments">
          <thead>
            <tr>
              <th className={TH}>Data do pagamento</th>
              <th className={TH}>Vendedor</th>
              <th className={TH}>Lote</th>
              <th className={TH_RIGHT}>Pago</th>
              <th className={TH}>Por que fica fora</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {legacy.payments.map((row) => (
              <tr key={`${row.batchId}|${row.reason}`}>
                <td className={TD}>{row.paymentDate ?? "—"}</td>
                <td className={TD}>{row.sellerName}</td>
                <td className={`${TD} font-mono text-xs`}>{row.batchId}</td>
                <td className={TD_RIGHT}>{money(row.amountPaid)}</td>
                <td className={`${TD} text-xs`}>{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </CommissionsTableScroll>
      ) : null}
      {legacy.retroactiveLines.length > 0 ? (
        <CommissionsTableScroll testId="commissions-360-legacy-retroactive">
          <thead>
            <tr>
              <th className={TH}>Fechamento</th>
              <th className={TH}>Competência natural</th>
              <th className={TH}>Vendedor</th>
              <th className={TH}>Tipo</th>
              <th className={TH_RIGHT}>Liberado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {legacy.retroactiveLines.map((row) => (
              <tr key={`${row.competence}|${row.naturalMonth}|${row.sellerName}|${row.inclusionType}`}>
                <td className={TD}>{row.competence}</td>
                <td className={TD}>{row.naturalMonth ?? "—"}</td>
                <td className={TD}>{row.sellerName}</td>
                <td className={TD}>{row.inclusionType}</td>
                <td className={TD_RIGHT}>{money(row.released)}</td>
              </tr>
            ))}
          </tbody>
        </CommissionsTableScroll>
      ) : null}
    </details>
  );
}

function Pagination({
  detail,
  onPage,
}: {
  detail: Commission360Payload["detail"];
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between text-sm text-slate-600">
      <span>
        {detail.totalRows} registro(s) · página {detail.page}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className={financeBiButtonOutlineClass}
          disabled={detail.page <= 1}
          onClick={() => onPage(detail.page - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          className={financeBiButtonOutlineClass}
          disabled={detail.page * detail.pageSize >= detail.totalRows}
          onClick={() => onPage(detail.page + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}

function DiagnosticTable({ data }: { data: Commission360Payload }) {
  const rows: Array<[string, (col: Commission360Payload["diagnostic"][number]) => string]> = [
    ["Quantidade de CRs", (col) => String(col.crCount)],
    ["Saldo financeiro em aberto", (col) => money(col.openBalance)],
    ["Saldo elegível identificado", (col) => money(col.eligibleBalance)],
    ["Saldo coberto por schedule", (col) => money(col.coveredBalance)],
    ["Saldo sem schedule / sem cobertura", (col) => money(col.uncoveredBalance)],
    ["Saldo excluído legitimamente", (col) => money(col.excludedBalance)],
    ["Comissão alocada", (col) => money(col.allocatedCommission)],
    ["Comissão futura calculada", (col) => money(col.forecastCommission)],
    ["Comissão potencial sem cobertura confirmada", (col) => money(col.potentialUncoveredCommission)],
    ["Diferenças de conciliação (saldo)", (col) => money(col.differenceBalance)],
    ["Comissão futura de PVs com alocação acima do pedido (R1)", (col) => money(col.forecastOnOverAllocatedOrders)],
    ["Excesso de alocação dos PVs (R1, não conciliado)", (col) => money(col.orderOverAllocationExcess)],
  ];
  return (
    <section className="space-y-2" data-testid="commissions-360-diagnostic">
      <h3 className="text-sm font-semibold text-foreground">Diagnóstico — CRs com vencimento em novembro e dezembro de 2026</h3>
      <p className="text-xs text-slate-500">
        População: todos os títulos da origem com vencimento no mês (não só os que têm schedule). Valores do ambiente
        consultado; a comissão potencial sem cobertura não entra na previsão.
      </p>
      <CommissionsTableScroll>
        <thead>
          <tr>
            <th className={TH}>Indicador</th>
            {data.diagnostic.map((col) => (
              <th key={col.month} className={TH_RIGHT}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(([label, pick]) => (
            <tr key={label}>
              <td className={TD}>{label}</td>
              {data.diagnostic.map((col) => (
                <td key={col.month} className={TD_RIGHT}>
                  {pick(col)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </CommissionsTableScroll>
      {data.diagnostic.at(-1)?.byStatus.length ? (
        <ul className="grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
          {data.diagnostic.at(-1)!.byStatus.map((row) => (
            <li key={row.status}>
              {COMMISSION_360_CR_STATUS_META[row.status].label}: {row.count} CR(s) · {money(row.openBalance)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function DetailSection({
  data,
  onPage,
}: {
  data: Commission360Payload;
  onPage: (page: number) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const detail = data.detail;
  if (detail.totalRows === 0) return <CommissionsEmptyState title="Nenhum registro neste filtro." />;

  if (detail.section === "paid") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-slate-500">{COMMISSION_360_NATURE_LABELS.CONFIRMADO}: lotes com status pago.</p>
        <CommissionsTableScroll testId="commissions-360-paid-table">
          <thead>
            <tr>
              <th className={TH}>Data do pagamento</th>
              <th className={TH}>Vendedor</th>
              <th className={TH}>Lote</th>
              <th className={TH_RIGHT}>Itens</th>
              <th className={TH_RIGHT}>Pago</th>
              <th className={TH}>Observação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(detail.payments ?? []).map((row) => (
              <tr key={row.batchId}>
                <td className={TD}>{row.paymentDate ?? "—"}</td>
                <td className={TD}>{row.sellerName}</td>
                <td className={`${TD} font-mono text-xs`}>{row.batchId}</td>
                <td className={TD_RIGHT}>{row.itemCount}</td>
                <td className={TD_RIGHT}>{money(row.amountPaid)}</td>
                <td className={`${TD} text-xs text-amber-800`}>{row.notes ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </CommissionsTableScroll>
        <p className="text-xs text-slate-500">
          {COMMISSION_360_NATURE_LABELS.LEGADO}: relatórios do Nomus importados — fora da série principal (ver{" "}
          {COMMISSION_360_LEGACY_SECTION_TITLE}).
        </p>
        <CommissionsTableScroll testId="commissions-360-legacy-table">
          <thead>
            <tr>
              <th className={TH}>Competência</th>
              <th className={TH}>Vendedor</th>
              <th className={TH}>Título</th>
              <th className={TH}>Recebimento</th>
              <th className={TH_RIGHT}>Comissão do relatório</th>
              <th className={TH}>Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(detail.legacy ?? []).map((row) => (
              <tr key={row.coverageId}>
                <td className={TD}>{row.competence ?? "—"}</td>
                <td className={TD}>{row.sellerName}</td>
                <td className={TD}>{row.receivableId}</td>
                <td className={TD}>{row.receiptExternalId ?? "—"}</td>
                <td className={TD_RIGHT}>{money(row.coveredCommissionAmount)}</td>
                <td className={`${TD} text-xs`}>
                  {row.supersededByConfirmedPayment
                    ? "Também em lote pago (vale o lote)"
                    : row.coveredCommissionAmount == null
                      ? "Relatório sem valor de comissão"
                      : "Sem confirmação de desembolso"}
                </td>
              </tr>
            ))}
          </tbody>
        </CommissionsTableScroll>
        <Pagination detail={detail} onPage={onPage} />
      </div>
    );
  }

  if (detail.section === "realized") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          B1 — Realizada aguardando fechamento (posição atual, por título).{" "}
          <Link className="underline" to={COMMISSIONS_SECTION_PATHS.monthlyClosing}>
            Abrir Fechamento do mês
          </Link>
        </p>
        <CommissionsTableScroll testId="commissions-360-realized-table">
          <thead>
            <tr>
              <th className={TH}>Vendedor</th>
              <th className={TH}>Cliente</th>
              <th className={TH}>Pedido</th>
              <th className={TH}>CR · parcela</th>
              <th className={TH}>Último recebimento</th>
              <th className={TH_RIGHT}>Realizada</th>
              <th className={TH_RIGHT}>Aguardando fechamento</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(detail.realized ?? []).map((row) => (
              <tr key={row.scheduleId}>
                <td className={TD}>{row.sellerName}</td>
                <td className={TD}>{row.customerName}</td>
                <td className={TD}>{row.orderCode}</td>
                <td className={TD}>
                  {row.receivableId} · {row.installmentNumber}
                </td>
                <td className={TD}>{row.lastReceiptDate ?? "—"}</td>
                <td className={TD_RIGHT}>{money(row.realizedCommission)}</td>
                <td className={TD_RIGHT}>{money(row.awaitingClosing)}</td>
              </tr>
            ))}
          </tbody>
        </CommissionsTableScroll>
        <p className="text-xs text-slate-500">
          B2 — Liberada em fechamento oficial (CLOSED, a partir de 10/2026) e ainda não paga.{" "}
          <Link className="underline" to={COMMISSIONS_SECTION_PATHS.closings}>
            Abrir Fechamentos
          </Link>
        </p>
        <CommissionsTableScroll testId="commissions-360-released-table">
          <thead>
            <tr>
              <th className={TH}>Competência</th>
              <th className={TH}>Vendedor</th>
              <th className={TH}>Fechamento</th>
              <th className={TH_RIGHT}>Liberada operacional</th>
              <th className={TH_RIGHT}>Ajuste retroativo</th>
              <th className={TH_RIGHT}>Paga com vínculo</th>
              <th className={TH_RIGHT}>Não paga</th>
              <th className={TH_RIGHT}>Não conciliada</th>
              <th className={TH}>Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(detail.released ?? []).map((row) => (
              <tr key={row.key}>
                <td className={TD}>{row.competence}</td>
                <td className={TD}>{row.sellerName}</td>
                <td className={`${TD} font-mono text-xs`}>{row.closingId}</td>
                <td className={TD_RIGHT}>{money(row.releasedOperational)}</td>
                <td className={`${TD_RIGHT} text-slate-500`}>{money(row.releasedAdjustment)}</td>
                <td className={TD_RIGHT}>{money(row.paid)}</td>
                <td className={TD_RIGHT}>{money(row.releasedNotPaid)}</td>
                <td className={TD_RIGHT}>{money(row.unreconciledAmount)}</td>
                <td className={`${TD} text-xs`}>
                  {COMMISSION_360_RELEASED_STATUS_LABELS[row.status]}
                  {row.overpaidAmount > 0 ? ` · excesso ${money(row.overpaidAmount)}` : ""}
                  {row.candidateBatchIds.length > 0 ? ` · lote(s) ${row.candidateBatchIds.join(", ")}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </CommissionsTableScroll>
        {(detail.unmatchedPayments ?? []).length > 0 ? (
          <>
            <p className="text-xs text-amber-800">
              Lotes pagos sem vínculo com fechamento: não abatem a liberada de nenhuma competência.
            </p>
            <CommissionsTableScroll testId="commissions-360-unmatched-payments-table">
              <thead>
                <tr>
                  <th className={TH}>Lote</th>
                  <th className={TH}>Vendedor</th>
                  <th className={TH}>Período</th>
                  <th className={TH}>Pagamento</th>
                  <th className={TH_RIGHT}>Valor</th>
                  <th className={TH}>Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(detail.unmatchedPayments ?? []).map((row) => (
                  <tr key={row.batchId}>
                    <td className={`${TD} font-mono text-xs`}>{row.batchId}</td>
                    <td className={TD}>{row.sellerName}</td>
                    <td className={TD}>
                      {row.periodStart} a {row.periodEnd}
                    </td>
                    <td className={TD}>{row.paymentDate ?? "—"}</td>
                    <td className={TD_RIGHT}>{money(row.amount)}</td>
                    <td className={`${TD} text-xs`}>{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </CommissionsTableScroll>
          </>
        ) : null}
        <Pagination detail={detail} onPage={onPage} />
      </div>
    );
  }

  if (detail.section === "forecast") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Mesmo cálculo da aba{" "}
          <Link className="underline" to={COMMISSIONS_SECTION_PATHS.portfolioOutlook}>
            Previsão
          </Link>
          . "Fora da previsão" é comissão que o saldo do título não sustenta.
        </p>
        <CommissionsTableScroll testId="commissions-360-forecast-table">
          <thead>
            <tr>
              <th className={TH}>Vencimento</th>
              <th className={TH}>Vendedor</th>
              <th className={TH}>Cliente</th>
              <th className={TH}>Pedido</th>
              <th className={TH}>CR · parcela</th>
              <th className={TH_RIGHT}>Saldo aberto</th>
              <th className={TH_RIGHT}>Alocada</th>
              <th className={TH_RIGHT}>Prevista</th>
              <th className={TH_RIGHT}>Fora da previsão</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(detail.forecast ?? []).map((row) => (
              <tr key={row.scheduleId}>
                <td className={TD}>{row.dueDate ?? "—"}</td>
                <td className={TD}>{row.sellerName}</td>
                <td className={TD}>{row.customerName}</td>
                <td className={TD}>{row.orderCode}</td>
                <td className={TD}>
                  {row.receivableCode ?? row.receivableId} · {row.installmentNumber}
                </td>
                <td className={TD_RIGHT}>{money(row.openPrincipal)}</td>
                <td className={TD_RIGHT}>{money(row.allocatedCommission)}</td>
                <td className={TD_RIGHT}>{money(row.forecastCommission)}</td>
                <td className={TD_RIGHT}>{row.unreconciledCommission > 0 ? money(row.unreconciledCommission) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </CommissionsTableScroll>
        <Pagination detail={detail} onPage={onPage} />
      </div>
    );
  }

  if (detail.section === "potential") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Comissão do snapshot oficial proporcional à quantidade ainda não faturada de cada item. Sem vencimento
          financeiro.{" "}
          <Link className="underline" to={COMMISSIONS_SECTION_PATHS.orderProvision}>
            Abrir Provisão por pedido
          </Link>
        </p>
        <CommissionsTableScroll testId="commissions-360-potential-table">
          <thead>
            <tr>
              <th className={TH}>Pedido</th>
              <th className={TH}>Venda</th>
              <th className={TH}>Cliente</th>
              <th className={TH}>Vendedor</th>
              <th className={TH_RIGHT}>Comissão total</th>
              <th className={TH_RIGHT}>Parte faturada</th>
              <th className={TH_RIGHT}>Já em schedules</th>
              <th className={TH_RIGHT}>Potencial</th>
              <th className={TH}>Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(detail.potential ?? []).map((row) => (
              <React.Fragment key={row.salesOrderId}>
                <tr
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => setOpenKey((current) => (current === row.salesOrderId ? null : row.salesOrderId))}
                >
                  <td className={TD}>{row.orderCode ?? row.salesOrderId}</td>
                  <td className={TD}>{row.saleDate ?? "—"}</td>
                  <td className={TD}>{row.customerName}</td>
                  <td className={TD}>{row.sellerName}</td>
                  <td className={TD_RIGHT}>{money(row.totalCommission)}</td>
                  <td className={TD_RIGHT}>{money(row.invoicedCommission)}</td>
                  <td className={TD_RIGHT}>{money(row.alreadyScheduledCommission)}</td>
                  <td className={TD_RIGHT}>{money(row.pendingCommission)}</td>
                  <td className={TD}>
                    {COMMISSION_360_POTENTIAL_STATUS_LABELS[row.status]}
                    {row.toReconcileItemCount > 0 ? ` · ${row.toReconcileItemCount} item(ns) a conciliar` : ""}
                    {row.overAllocatedCommission > 0
                      ? ` · alocado ${money(row.overAllocatedCommission)} acima da comissão do pedido (não conciliado)`
                      : ""}
                  </td>
                </tr>
                {openKey === row.salesOrderId ? (
                  <tr className="bg-slate-50">
                    <td colSpan={9} className="px-3 py-3 text-xs text-slate-700">
                      <ul className="space-y-1">
                        {row.items.map((item) => (
                          <li key={item.salesOrderItemId}>
                            {item.productName ?? item.salesOrderItemId} · pedida {item.orderedQuantity ?? "—"} ·
                            faturada {item.invoicedQuantity ?? "—"} · pendente {item.pendingQuantity ?? "—"} · comissão{" "}
                            {money(item.totalCommission)} → pendente {money(item.pendingCommission)} ·{" "}
                            {COMMISSION_360_POTENTIAL_STATUS_LABELS[item.status]}
                            {item.reason ? ` — ${item.reason}` : ""}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </CommissionsTableScroll>
        <Pagination detail={detail} onPage={onPage} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <CommissionsTableScroll testId="commissions-360-reconciliation-table">
        <thead>
          <tr>
            <th className={TH}>Vencimento</th>
            <th className={TH}>Título / NF-e</th>
            <th className={TH}>Cliente</th>
            <th className={TH}>Pedido</th>
            <th className={TH}>Vendedor</th>
            <th className={TH_RIGHT}>Saldo aberto</th>
            <th className={TH}>Classificação</th>
            <th className={TH_RIGHT}>Prevista</th>
            <th className={TH_RIGHT}>Potencial sem cobertura</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {(detail.receivables ?? []).map((row) => {
            const key = String(row.receivableId);
            return (
              <React.Fragment key={key}>
                <tr
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => setOpenKey((current) => (current === key ? null : key))}
                >
                  <td className={TD}>{row.dueDate ?? "—"}</td>
                  <td className={TD}>
                    {row.receivableId}
                    {row.invoiceNumber ? ` · NF ${row.invoiceNumber}` : ""}
                  </td>
                  <td className={TD}>{row.customerName ?? "—"}</td>
                  <td className={TD}>{row.orderCode ?? "—"}</td>
                  <td className={TD}>{row.sellerName ?? "—"}</td>
                  <td className={TD_RIGHT}>{money(row.openBalance)}</td>
                  <td className={TD}>{COMMISSION_360_CR_STATUS_META[row.status].label}</td>
                  <td className={TD_RIGHT}>{money(row.forecastCommission)}</td>
                  <td className={TD_RIGHT}>{money(row.potentialUncoveredCommission)}</td>
                </tr>
                {openKey === key ? (
                  <tr className="bg-slate-50">
                    <td colSpan={9} className="px-3 py-3 text-xs text-slate-700">
                      <p>{row.reason}</p>
                      <p className="mt-1">
                        Nominal {money(row.nominalAmount)} · alocada {money(row.allocatedCommission)} · realizada{" "}
                        {money(row.realizedCommission)} · fora da previsão {money(row.unreconciledCommission)}
                      </p>
                      <p className="mt-1 font-mono">
                        NF-e (id Nomus) {row.sourceInvoiceId ?? "—"} · PV {row.salesOrderId ?? "—"} · schedules{" "}
                        {row.scheduleIds.join(", ") || "—"} · snapshots {row.snapshotIds.join(", ") || "—"}
                      </p>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </CommissionsTableScroll>
      <Pagination detail={detail} onPage={onPage} />
    </div>
  );
}

export function Commissions360ViewPage() {
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS);
  const [data, setData] = useState<Commission360Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [persons, setPersons] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    void fetchJsonOk<{ items: Array<{ id: string; name: string }> }>(
      "/api/commissions/persons?page=1&pageSize=200&active=true"
    )
      .then((payload) => setPersons(payload.items ?? []))
      .catch(() => setPersons([]));
  }, []);

  const reload = useCallback(async (filters: Filters, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<Commission360Payload>(
        `/api/commissions/visao-360?${buildCommission360ClientQuery(filters)}`,
        { signal }
      );
      setData(payload);
    } catch (err: unknown) {
      if (signal?.aborted) return;
      setError(formatCommissionsApiError(err, "Não foi possível carregar a Visão 360° de comissões."));
      setData(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(applied, controller.signal);
    return () => controller.abort();
  }, [applied, reload]);

  const cards = data?.cards;
  const csvHref = `/api/commissions/visao-360/conciliacao.csv?${buildCommission360ClientQuery(applied)}`;

  return (
    <div className="space-y-4">
      <CommissionsSectionIntro
        title={COMMISSION_360_TITLE}
        description={COMMISSION_360_DESCRIPTION}
        testId="commissions-360-intro"
      />

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const next = { ...draft, page: 1 };
          setDraft(next);
          setApplied(next);
        }}
      >
        <label className="text-xs text-slate-600">
          De
          <input
            type="month"
            className={COMMISSIONS_FILTER_FIELD_CLASS}
            value={draft.fromMonth}
            onChange={(event) => setDraft((current) => ({ ...current, fromMonth: event.target.value }))}
          />
        </label>
        <label className="text-xs text-slate-600">
          Até
          <input
            type="month"
            className={COMMISSIONS_FILTER_FIELD_CLASS}
            value={draft.toMonth}
            onChange={(event) => setDraft((current) => ({ ...current, toMonth: event.target.value }))}
          />
        </label>
        {data?.sellerLocked ? null : (
          <label className="text-xs text-slate-600">
            Vendedor
            <select
              className={COMMISSIONS_FILTER_FIELD_CLASS}
              value={draft.sellerId}
              onChange={(event) => setDraft((current) => ({ ...current, sellerId: event.target.value }))}
            >
              <option value="all">Todos</option>
              {persons.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs text-slate-600">
          Cliente
          <input
            className={COMMISSIONS_FILTER_FIELD_CLASS}
            value={draft.customer}
            placeholder="Nome do cliente"
            onChange={(event) => setDraft((current) => ({ ...current, customer: event.target.value }))}
          />
        </label>
        <label className="text-xs text-slate-600">
          Pedido
          <input
            className={COMMISSIONS_FILTER_FIELD_CLASS}
            value={draft.orderCode}
            placeholder="Código do PV"
            onChange={(event) => setDraft((current) => ({ ...current, orderCode: event.target.value }))}
          />
        </label>
        <label className="text-xs text-slate-600">
          Indicador
          <select
            className={COMMISSIONS_FILTER_FIELD_CLASS}
            value={draft.section}
            onChange={(event) =>
              setDraft((current) => ({ ...current, section: event.target.value as Commission360Section }))
            }
          >
            {COMMISSION_360_SECTIONS.map((section) => (
              <option key={section.id} value={section.id}>
                {section.label}
              </option>
            ))}
          </select>
        </label>
        {draft.section === "reconciliation" ? (
          <label className="text-xs text-slate-600">
            Status do CR
            <select
              className={COMMISSIONS_FILTER_FIELD_CLASS}
              value={draft.crStatus}
              onChange={(event) => setDraft((current) => ({ ...current, crStatus: event.target.value }))}
            >
              <option value="all">Todos</option>
              {(Object.keys(COMMISSION_360_CR_STATUS_META) as Commission360CrStatus[]).map((status) => (
                <option key={status} value={status}>
                  {COMMISSION_360_CR_STATUS_META[status].label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className={financeBiButtonOutlineClass}>
          Filtrar
        </button>
        <button
          type="button"
          className={financeBiButtonOutlineClass}
          onClick={() => void reload(applied)}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar
        </button>
        <a className={financeBiButtonOutlineClass} href={csvHref} data-testid="commissions-360-export">
          <Download className="h-4 w-4" />
          Conciliação (CSV)
        </a>
      </form>

      {error ? <CommissionsErrorBanner message={error} /> : null}
      {loading && !data ? <CommissionsLoading label="Montando a Visão 360°…" /> : null}

      {data ? (
        <>
          <p className="text-xs text-slate-500" data-testid="commissions-360-read-only">
            {data.readOnlyNote} Período: {data.filters.fromMonth} a {data.filters.toMonth}.
          </p>

          <CommissionsKpiSection
            title="Indicadores"
            eyebrow="Cada card é uma natureza econômica diferente: não some os cards entre si."
            testId="commissions-360-cards"
          >
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Pago efetivamente"
              amount={cards?.paidConfirmed ?? 0}
              amountFormat="currency"
              tone="success"
              subtitle={`${cards?.paidConfirmedCount ?? 0} lote(s) pago(s) no período`}
              helperText="Só lotes pagos de competência a partir de 10/2026, pela data do pagamento. Pagamentos de competência legada ficam em Histórico legado / Ajustes retroativos."
              testId="commissions-360-card-paid"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Realizada aguardando fechamento"
              amount={cards?.realizedAwaitingClosing ?? 0}
              amountFormat="currency"
              subtitle="Posição atual"
              helperText="Comissão de recebimentos reais ainda sem cobertura de fechamento."
              testId="commissions-360-card-awaiting"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Liberada e ainda não paga"
              amount={cards?.releasedNotPaid ?? 0}
              amountFormat="currency"
              tone="warning"
              subtitle={`Não conciliada: ${money(cards?.releasedUnreconciled ?? 0)} · lotes sem vínculo: ${cards?.unmatchedPaymentsCount ?? 0}`}
              helperText="Fechamentos CLOSED a partir de 10/2026 menos pagamentos com vínculo provado. Liberada coberta por lote sem vínculo fica como não conciliada (não somada). Posição atual."
              testId="commissions-360-card-released"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Prevista sobre CRs"
              amount={cards?.forecastOnReceivables ?? 0}
              amountFormat="currency"
              tone="info"
              subtitle="Saldo aberto de CRs com schedule, por vencimento"
              helperText="Mesmo cálculo da aba Previsão. Títulos sem schedule não entram: veja a conciliação."
              testId="commissions-360-card-forecast"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Potencial em PVs pendentes"
              amount={cards?.potentialOnOrders ?? 0}
              amountFormat="currency"
              tone="info"
              subtitle={`${cards?.potentialToReconcileCount ?? 0} item(ns) a conciliar`}
              helperText="Parte da comissão do snapshot ligada à quantidade ainda não faturada. Sem vencimento."
              testId="commissions-360-card-potential"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="CRs sem cobertura de comissão"
              amount={cards?.uncoveredReceivablesBalance ?? 0}
              amountFormat="currency"
              tone="warning"
              subtitle={`${cards?.uncoveredReceivablesCount ?? 0} título(s) com saldo no período`}
              helperText="Saldo em aberto de títulos sem vínculo, sem snapshot ou sem schedule. Não é comissão."
              testId="commissions-360-card-uncovered"
            />
          </CommissionsKpiSection>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Evolução mensal — motor oficial</h3>
            <p className="text-xs text-slate-500" data-testid="commissions-360-series-note">
              {data.series.note}
            </p>
            <Commission360Chart months={data.months} />
          </section>

          <section className="space-y-2" data-testid="commissions-360-funnel">
            <h3 className="text-sm font-semibold text-foreground">Conciliação dos CRs do período</h3>
            <p className="text-sm text-slate-700">
              CRs operacionais {data.funnel.operationalCount} ({money(data.funnel.operationalBalance)}) → comissionáveis{" "}
              {data.funnel.commissionableCount} ({money(data.funnel.commissionableBalance)}) → cobertos por schedule{" "}
              {data.funnel.coveredCount} ({money(data.funnel.coveredBalance)}) → comissão futura{" "}
              {money(data.funnel.forecastCommission)} · diferenças {data.funnel.differenceCount} (
              {money(data.funnel.differenceBalance)})
            </p>
          </section>

          <DiagnosticTable data={data} />

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Por vendedor</h3>
            <CommissionsTableScroll testId="commissions-360-seller-table">
              <thead>
                <tr>
                  <th className={TH}>Vendedor</th>
                  <th className={TH_RIGHT}>Pago</th>
                  <th className={TH_RIGHT}>Aguardando fechamento</th>
                  <th className={TH_RIGHT}>Liberada não paga</th>
                  <th className={TH_RIGHT}>Prevista</th>
                  <th className={TH_RIGHT}>Potencial</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.bySeller.length === 0 ? (
                  <tr>
                    <td className={TD} colSpan={6}>
                      Nenhum vendedor no filtro.
                    </td>
                  </tr>
                ) : (
                  data.bySeller.map((row) => (
                    <tr key={row.key}>
                      <td className={TD}>{row.sellerName}</td>
                      <td className={TD_RIGHT}>{money(row.paidConfirmed)}</td>
                      <td className={TD_RIGHT}>{money(row.realizedAwaitingClosing)}</td>
                      <td className={TD_RIGHT}>{money(row.releasedNotPaid)}</td>
                      <td className={TD_RIGHT}>{money(row.forecast)}</td>
                      <td className={TD_RIGHT}>{money(row.potential)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </CommissionsTableScroll>
          </section>

          <LegacySection legacy={data.legacySection} />

          <section className="space-y-2">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Detalhe da Visão 360°">
              {COMMISSION_360_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={applied.section === section.id}
                  className={
                    applied.section === section.id
                      ? "rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
                      : "rounded-lg px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:bg-accent"
                  }
                  onClick={() => {
                    setDraft((current) => ({ ...current, section: section.id, page: 1 }));
                    setApplied((current) => ({ ...current, section: section.id, page: 1 }));
                  }}
                  data-testid={`commissions-360-section-${section.id}`}
                >
                  {section.label}
                </button>
              ))}
            </div>
            <DetailSection data={data} onPage={(page) => setApplied((current) => ({ ...current, page }))} />
          </section>

          <details className="rounded-xl border border-border px-4 py-3 text-xs text-slate-600" data-testid="commissions-360-sources">
            <summary className="cursor-pointer font-semibold text-foreground">Fontes oficiais e limitações</summary>
            <ul className="mt-2 space-y-1">
              {data.sources.map((source) => (
                <li key={source.indicator}>
                  <strong>{source.indicator}</strong> ({COMMISSION_360_NATURE_LABELS[source.nature]}): {source.source}.{" "}
                  {source.rule}
                  {source.limitation ? ` Limitação: ${source.limitation}` : ""}
                </li>
              ))}
            </ul>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {data.limitations.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
    </div>
  );
}
