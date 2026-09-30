import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
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
import {
  COMMISSION_PORTFOLIO_OUTLOOK_FIRST_MONTH,
  COMMISSION_PORTFOLIO_OUTLOOK_HISTORY_NOTE,
  COMMISSION_PORTFOLIO_OUTLOOK_NOTE,
  clampOutlookFromMonth,
  type OutlookPayload,
} from "@/src/lib/commissions/commissionPortfolioOutlook";

const STATUS_LABEL: Record<string, string> = {
  PREVISTA: "A receber",
  PARCIALMENTE_RECEBIDA: "Parcialmente recebida",
  REALIZADA: "Realizada",
  LIBERADA: "Liberada",
  PAGA: "Paga",
  VENCIDA_NAO_RECEBIDA: "Vencida, não recebida",
  CUSTOMER_EXCLUDED: "Cliente sem comissão",
  SEM_VENDEDOR: "Sem vendedor",
  CANCELADA: "Cancelada",
  INCONSISTENCIA_SEM_RECEBIMENTO: "Baixa sem recebimento",
  TITULO_NAO_ENCONTRADO: "Título não encontrado",
};

type Filters = {
  from: string;
  to: string;
  sellerId: string;
  orderCode: string;
  status: string;
  page: number;
};

// A previsão começa no primeiro mês (setembro/2026); antes dele, relatório do Nomus.
const DEFAULT_FILTERS: Filters = {
  from: COMMISSION_PORTFOLIO_OUTLOOK_FIRST_MONTH,
  to: "",
  sellerId: "",
  orderCode: "",
  status: "",
  page: 1,
};

function queryString(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.sellerId) params.set("sellerId", filters.sellerId);
  if (filters.orderCode) params.set("orderCode", filters.orderCode);
  if (filters.status) params.set("status", filters.status);
  params.set("page", String(filters.page));
  params.set("pageSize", "25");
  return params.toString();
}

export function CommissionsPortfolioOutlookPage() {
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS);
  const [data, setData] = useState<OutlookPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [persons, setPersons] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    void fetchJsonOk<{ items: Array<{ id: string; name: string }> }>(
      "/api/commissions/persons?page=1&pageSize=200&active=true"
    )
      .then((payload) => setPersons(payload.items ?? []))
      .catch(() => setPersons([]));
  }, []);

  const reload = useCallback(async (filters: Filters) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<OutlookPayload>(
        `/api/commissions/portfolio-outlook?${queryString(filters)}`
      );
      setData(payload);
    } catch (err: unknown) {
      setError(formatCommissionsApiError(err, "Não foi possível carregar a previsão de comissões."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload(applied);
  }, [applied, reload]);

  const cards = data?.cards;

  return (
    <div className="space-y-4">
      <CommissionsSectionIntro
        title="Previsão de comissões"
        description={COMMISSION_PORTFOLIO_OUTLOOK_NOTE}
        testId="commissions-outlook-intro"
      />

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const next = { ...draft, from: clampOutlookFromMonth(draft.from), page: 1 };
          setDraft(next);
          setApplied(next);
        }}
      >
        <label className="text-xs text-slate-600">
          De
          <input
            type="month"
            className={COMMISSIONS_FILTER_FIELD_CLASS}
            min={COMMISSION_PORTFOLIO_OUTLOOK_FIRST_MONTH}
            value={draft.from}
            onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
          />
        </label>
        <label className="text-xs text-slate-600">
          Até
          <input
            type="month"
            className={COMMISSIONS_FILTER_FIELD_CLASS}
            min={COMMISSION_PORTFOLIO_OUTLOOK_FIRST_MONTH}
            value={draft.to}
            onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
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
              <option value="">Todos</option>
              {persons.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
          Status
          <select
            className={COMMISSIONS_FILTER_FIELD_CLASS}
            value={draft.status}
            onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}
          >
            <option value="">Todos</option>
            {Object.entries(STATUS_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
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
      </form>
      <p className="text-xs text-slate-500" data-testid="commissions-outlook-history-note">
        {COMMISSION_PORTFOLIO_OUTLOOK_HISTORY_NOTE}
      </p>

      {error ? <CommissionsErrorBanner message={error} /> : null}
      {loading && !data ? <CommissionsLoading label="Montando a previsão…" /> : null}

      {data ? (
        <>
          <CommissionsKpiSection
            title="Comissão ainda a receber"
            eyebrow="Só o que está vinculado ao saldo dos títulos ainda em aberto. Fica no mês do vencimento."
            testId="commissions-outlook-future"
          >
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Comissão ainda a receber"
              amount={cards?.forecast ?? 0}
              amountFormat="currency"
              tone="money"
              subtitle="Vinculada ao saldo dos CRs ainda em aberto"
              helperText="Parte da comissão do pedido proporcional ao saldo que o cliente ainda não pagou. Não inclui o que já foi recebido."
              testId="commissions-outlook-card-future"
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="A vencer"
              amount={Math.max(0, (cards?.forecast ?? 0) - (cards?.overdueForecast ?? 0))}
              amountFormat="currency"
              tone="info"
              subtitle="Títulos dentro do prazo"
              helperText="Parte da comissão ainda a receber cujo título ainda não venceu."
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Vencida e não recebida"
              amount={cards?.overdueForecast ?? 0}
              amountFormat="currency"
              tone="warning"
              subtitle="Títulos vencidos em aberto"
              helperText="Parte da comissão ainda a receber cujo título já venceu. Continua no mês do vencimento."
            />
          </CommissionsKpiSection>
          {(cards?.unreconciled ?? 0) > 0 ? (
            <p className="text-sm text-amber-800" data-testid="commissions-outlook-unreconciled">
              Fora da previsão: {formatFinanceCurrency(cards?.unreconciled ?? 0)} de comissão em títulos sem saldo em
              aberto e sem evento de recebimento (desconto, baixa sem recebimento ou recebimento não sincronizado).
              Abra o título para ver o motivo.
            </p>
          ) : null}

          <CommissionsKpiSection
            title="Comissão já realizada"
            eyebrow="O cliente já pagou. Estes valores não se somam à comissão ainda a receber."
            testId="commissions-outlook-payout"
          >
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Realizada aguardando fechamento"
              amount={cards?.awaitingClosing ?? 0}
              amountFormat="currency"
              subtitle="Cliente já pagou; ainda não liberada"
              helperText="Comissão de recebimentos do período que ainda não entrou em fechamento."
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Liberada e ainda não paga"
              amount={cards?.balanceToPay ?? 0}
              amountFormat="currency"
              tone="warning"
              subtitle="Já entrou em fechamento"
              helperText="Diferença entre o que já foi liberado e o que já foi pago ao vendedor."
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              label="Paga"
              amount={cards?.paid ?? 0}
              amountFormat="currency"
              tone="success"
              subtitle="Histórico Nomus ou lote"
              helperText="Valor já pago ao vendedor pelo histórico Nomus ou por lote com status pago."
            />
          </CommissionsKpiSection>
          <p className="text-sm text-slate-600" data-testid="commissions-outlook-realized-note">
            Realizado no período: {formatFinanceCurrency(cards?.realized ?? 0)} (liberado{" "}
            {formatFinanceCurrency(cards?.released ?? 0)}). É histórico: o cliente já pagou e o valor não entra na
            comissão ainda a receber.
          </p>

          <CommissionsTableScroll>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-500">
                  <th className="px-2 py-2">Mês</th>
                  <th className="px-2 py-2">Quando</th>
                  <th className="px-2 py-2 text-right">Ainda a receber</th>
                  <th className="px-2 py-2 text-right">Já realizado (histórico)</th>
                </tr>
              </thead>
              <tbody>
                {data.months.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-slate-500">
                      Nenhum mês no filtro.
                    </td>
                  </tr>
                ) : (
                  data.months.map((month) => (
                    <tr
                      key={month.month}
                      className={
                        month.kind === "current"
                          ? "bg-slate-50 font-medium"
                          : month.kind === "past"
                            ? "text-slate-600"
                            : ""
                      }
                    >
                      <td className="px-2 py-2">{month.label}</td>
                      <td className="px-2 py-2">
                        {month.kind === "past" ? "Passado" : month.kind === "current" ? "Mês atual" : "Futuro"}
                      </td>
                      <td className="px-2 py-2 text-right font-medium">{formatFinanceCurrency(month.forecast)}</td>
                      <td className="px-2 py-2 text-right text-slate-500">{formatFinanceCurrency(month.realized)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CommissionsTableScroll>

          {data.lines.length === 0 ? (
            <CommissionsEmptyState title="Nenhuma comissão neste filtro." />
          ) : (
            <CommissionsTableScroll>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-slate-500">
                    <th className="px-2 py-2">Vendedor</th>
                    <th className="px-2 py-2">Cliente</th>
                    <th className="px-2 py-2">Pedido</th>
                    <th className="px-2 py-2">NF</th>
                    <th className="px-2 py-2">CR</th>
                    <th className="px-2 py-2">Vencimento</th>
                    <th className="px-2 py-2 text-right">Atribuída</th>
                    <th className="px-2 py-2 text-right">Realizada</th>
                    <th className="px-2 py-2 text-right">A receber</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((line) => (
                    <React.Fragment key={line.scheduleId}>
                      <tr
                        className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                        onClick={() => setOpenId((current) => (current === line.scheduleId ? null : line.scheduleId))}
                      >
                        <td className="px-2 py-2">{line.canonicalSellerName ?? "—"}</td>
                        <td className="px-2 py-2">{line.customerName}</td>
                        <td className="px-2 py-2">{line.orderCode}</td>
                        <td className="px-2 py-2">{line.nfeNumber ?? "—"}</td>
                        <td className="px-2 py-2">
                          {line.receivableCode ?? line.receivableId} · {line.installmentNumber}
                        </td>
                        <td className="px-2 py-2">
                          {line.dueDate ?? "—"}
                          {line.daysOverdue != null ? ` · ${line.daysOverdue}d` : ""}
                        </td>
                        <td className="px-2 py-2 text-right">{formatFinanceCurrency(line.allocatedCommission)}</td>
                        <td className="px-2 py-2 text-right">{formatFinanceCurrency(line.realizedCommission)}</td>
                        <td className="px-2 py-2 text-right">{formatFinanceCurrency(line.forecastCommission)}</td>
                        <td className="px-2 py-2">{STATUS_LABEL[line.status] ?? line.status}</td>
                      </tr>
                      {openId === line.scheduleId ? (
                        <tr className="bg-slate-50">
                          <td colSpan={10} className="px-3 py-3 text-xs text-slate-700">
                            <p>
                              Base do CR {formatFinanceCurrency(line.nominalAmount)} · saldo em aberto{" "}
                              {line.openPrincipal == null ? "não encontrado" : formatFinanceCurrency(line.openPrincipal)} ·
                              elegível recebido{" "}
                              {formatFinanceCurrency(line.eligibleReceived)} · liberado{" "}
                              {formatFinanceCurrency(line.releasedCommission)} · pago{" "}
                              {formatFinanceCurrency(line.paidCommission)} · saldo a pagar{" "}
                              {formatFinanceCurrency(line.balanceToPay)}
                            </p>
                            {line.inconsistency ? <p className="mt-1 text-amber-800">{line.inconsistency}</p> : null}
                            {line.receipts.length === 0 ? (
                              <p className="mt-1">Nenhum evento de recebimento.</p>
                            ) : (
                              <ul className="mt-2 space-y-1">
                                {line.receipts.map((receipt) => (
                                  <li key={receipt.externalId}>
                                    {receipt.receiptDate} · recebido {formatFinanceCurrency(receipt.receivedAmount)} ·
                                    elegível {formatFinanceCurrency(receipt.eligibleAmount)}
                                    {receipt.excessAmount > 0
                                      ? ` · excedente ${formatFinanceCurrency(receipt.excessAmount)}`
                                      : ""}{" "}
                                    · comissão {formatFinanceCurrency(receipt.realizedCommission)}
                                    {receipt.coverageSource ? ` · ${receipt.coverageSource}` : ""}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </CommissionsTableScroll>
          )}

          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              {data.totalLines} título(s) · página {data.page}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className={financeBiButtonOutlineClass}
                disabled={data.page <= 1}
                onClick={() => setApplied((current) => ({ ...current, page: current.page - 1 }))}
              >
                Anterior
              </button>
              <button
                type="button"
                className={financeBiButtonOutlineClass}
                disabled={data.page * data.pageSize >= data.totalLines}
                onClick={() => setApplied((current) => ({ ...current, page: current.page + 1 }))}
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
