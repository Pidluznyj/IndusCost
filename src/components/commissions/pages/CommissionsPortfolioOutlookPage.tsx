import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { fetchJsonOk } from "@/src/lib/http";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import { COMMISSIONS_FILTER_FIELD_CLASS } from "@/src/lib/commissionsPeriodFilter";
import type { OutlookPayload } from "@/src/lib/commissions/commissionPortfolioOutlook";

const STATUS_LABEL: Record<string, string> = {
  PREVISTA: "Prevista",
  PARCIALMENTE_RECEBIDA: "Parcialmente recebida",
  REALIZADA: "Realizada",
  LIBERADA: "Liberada",
  PAGA: "Paga",
  VENCIDA_NAO_RECEBIDA: "Vencida, não recebida",
  CUSTOMER_EXCLUDED: "Cliente sem comissão",
  SEM_VENDEDOR: "Sem vendedor",
  CANCELADA: "Cancelada",
  INCONSISTENCIA_SEM_RECEBIMENTO: "Baixa sem recebimento",
};

type Filters = {
  from: string;
  to: string;
  sellerId: string;
  orderCode: string;
  status: string;
  page: number;
};

const EMPTY_FILTERS: Filters = {
  from: "",
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
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
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
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Previsão de comissões</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Quanto já foi realizado pelo recebimento do cliente, quanto ainda está previsto pelo vencimento
          e quanto disso já foi liberado ou pago ao vendedor. A comissão continua sendo a da venda.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ ...draft, page: 1 });
        }}
      >
        <label className="text-xs text-slate-600">
          De
          <input
            type="month"
            className={COMMISSIONS_FILTER_FIELD_CLASS}
            value={draft.from}
            onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
          />
        </label>
        <label className="text-xs text-slate-600">
          Até
          <input
            type="month"
            className={COMMISSIONS_FILTER_FIELD_CLASS}
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

      {error ? <CommissionsErrorBanner message={error} /> : null}
      {loading && !data ? <CommissionsLoading label="Montando a previsão…" /> : null}

      {data ? (
        <>
          <p className="text-xs text-slate-500">{data.note}</p>
          <div className={SYSTEM_TOTALIZER_GRID_CLASS}>
            <SystemTotalizerCard
              label="Realizado no período"
              amount={cards?.realized ?? 0}
              amountFormat="currency"
              tone="success"
              subtitle="O cliente pagou. Não é o pagamento ao vendedor."
            />
            <SystemTotalizerCard
              label="Ainda previsto"
              amount={cards?.forecast ?? 0}
              amountFormat="currency"
              tone="info"
              subtitle="Ainda depende de recebimento, na data de vencimento."
            />
            <SystemTotalizerCard
              label="Total esperado"
              amount={cards?.expected ?? 0}
              amountFormat="currency"
              tone="money"
              subtitle="Realizado mais o que ainda está previsto."
            />
            <SystemTotalizerCard label="Liberado" amount={cards?.released ?? 0} amountFormat="currency" subtitle="Contemplado em fechamento ou histórico" />
            <SystemTotalizerCard label="Pago" amount={cards?.paid ?? 0} amountFormat="currency" tone="success" subtitle="Histórico Nomus ou lote pago" />
            <SystemTotalizerCard label="Saldo a pagar" amount={cards?.balanceToPay ?? 0} amountFormat="currency" tone="warning" subtitle="Liberado e ainda não pago" />
          </div>
          {(cards?.overdueForecast ?? 0) > 0 ? (
            <p className="text-sm text-amber-800">
              Vencido e ainda não recebido: {formatFinanceCurrency(cards?.overdueForecast ?? 0)}. O mês previsto
              continua sendo o do vencimento.
            </p>
          ) : null}
          {(cards?.awaitingClosing ?? 0) > 0 ? (
            <p className="text-sm text-slate-600">
              Realizado ainda fora de fechamento: {formatFinanceCurrency(cards?.awaitingClosing ?? 0)}.
            </p>
          ) : null}

          <CommissionsTableScroll>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-slate-500">
                  <th className="px-2 py-2">Mês</th>
                  <th className="px-2 py-2">Quando</th>
                  <th className="px-2 py-2 text-right">Realizado</th>
                  <th className="px-2 py-2 text-right">Previsto</th>
                  <th className="px-2 py-2 text-right">Total esperado</th>
                </tr>
              </thead>
              <tbody>
                {data.months.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-slate-500">
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
                      <td className="px-2 py-2 text-right">{formatFinanceCurrency(month.realized)}</td>
                      <td className="px-2 py-2 text-right">{formatFinanceCurrency(month.forecast)}</td>
                      <td className="px-2 py-2 text-right">{formatFinanceCurrency(month.expected)}</td>
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
                    <th className="px-2 py-2 text-right">Prevista</th>
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
                              Base do CR {formatFinanceCurrency(line.nominalAmount)} · elegível recebido{" "}
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
