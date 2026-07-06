import React, { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import type {
  CommissionsPersonsPayload,
  UnpaidReleasedCommissionRow,
} from "@/src/components/commissions/commissionsTypes";
import { CommissionsPeriodFilterFields } from "@/src/components/commissions/CommissionsPeriodFilterFields";
import {
  buildUnpaidReleasedQueryString,
  resolveCreateBatchPeriod,
} from "@/src/components/commissions/payments/commissionsPaymentsFilters";
import { fetchUnpaidReleasedCommissions } from "@/src/components/commissions/payments/useCommissionsPaymentsData";

type Props = {
  open: boolean;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (body: {
    periodStart: string;
    periodEnd: string;
    commissionPersonId: string;
    recordIds: string[];
    notes?: string | null;
  }) => Promise<void>;
};

const fieldClass =
  "w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30";

export function CommissionsPaymentCreateModal({
  open,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [persons, setPersons] = useState<Array<{ id: string; name: string }>>([]);
  const [commissionPersonId, setCommissionPersonId] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<UnpaidReleasedCommissionRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchJsonOk<CommissionsPersonsPayload>(
          "/api/commissions/persons?page=1&pageSize=200&active=true"
        );
        if (!cancelled) {
          setPersons(payload.items.map((p) => ({ id: p.id, name: p.name })));
        }
      } catch {
        if (!cancelled) setPersons([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setCommissionPersonId("");
      setYear(String(new Date().getFullYear()));
      setMonth("");
      setFrom("");
      setTo("");
      setNotes("");
      setRows([]);
      setSelected(new Set());
      setLoadError(null);
    }
  }, [open]);

  const totalSelected = useMemo(
    () =>
      rows
        .filter((row) => selected.has(row.commissionRecordId))
        .reduce((sum, row) => sum + row.availableToPay, 0),
    [rows, selected]
  );

  async function loadReleased() {
    if (!commissionPersonId) {
      setLoadError("Selecione a pessoa comissionada.");
      return;
    }
    setLoadingRows(true);
    setLoadError(null);
    try {
      const query = buildUnpaidReleasedQueryString({
        commissionPersonId,
        from,
        to,
        year,
        month,
      });
      const payload = await fetchUnpaidReleasedCommissions(query);
      setRows(payload.items);
      setSelected(new Set(payload.items.map((r) => r.commissionRecordId)));
    } catch (e: unknown) {
      setRows([]);
      setSelected(new Set());
      setLoadError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar comissões liberadas."
      );
    } finally {
      setLoadingRows(false);
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const period = resolveCreateBatchPeriod({ from, to, year, month });
    if (!period) return;
    const recordIds = rows
      .filter((row) => selected.has(row.commissionRecordId))
      .map((row) => row.commissionRecordId);
    if (recordIds.length === 0) return;
    await onSubmit({
      ...period,
      commissionPersonId,
      recordIds,
      notes: notes.trim() || null,
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-[#111827]">Novo lote de pagamento</h2>
            <p className="text-xs text-[#6B7280]">
              Somente comissões liberadas entram no lote. Pagamento é controle interno do IndusCost.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-[#6B7280] hover:bg-[#F3F4F6]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 p-5">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-xs font-medium text-[#6B7280]">Pessoa comissionada *</span>
              <select
                required
                className={fieldClass}
                value={commissionPersonId}
                onChange={(e) => setCommissionPersonId(e.target.value)}
              >
                <option value="">Selecione…</option>
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <CommissionsPeriodFilterFields
              year={year}
              month={month}
              onYearChange={setYear}
              onMonthChange={setMonth}
              allowAllYears={false}
              fieldClassName={fieldClass}
            />
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[#6B7280]">De</span>
              <input type="date" className={fieldClass} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[#6B7280]">Até</span>
              <input type="date" className={fieldClass} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>

          <button
            type="button"
            disabled={loadingRows || !commissionPersonId}
            onClick={() => void loadReleased()}
            className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50"
          >
            {loadingRows ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Carregar comissões liberadas
          </button>

          {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}

          {rows.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
              <table className="min-w-full text-sm">
                <thead className="bg-[#F9FAFB] text-left text-xs text-[#6B7280]">
                  <tr>
                    <th className="px-3 py-2" />
                    <th className="px-3 py-2">Pedido</th>
                    <th className="px-3 py-2">NF-e</th>
                    <th className="px-3 py-2">CR</th>
                    <th className="px-3 py-2 text-right">Liberado</th>
                    <th className="px-3 py-2 text-right">Disponível</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {rows.map((row) => (
                    <tr key={row.commissionRecordId}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(row.commissionRecordId)}
                          onChange={() => toggleRow(row.commissionRecordId)}
                        />
                      </td>
                      <td className="px-3 py-2">{row.orderCode ?? "—"}</td>
                      <td className="px-3 py-2">{row.nfeNumber ?? "—"}</td>
                      <td className="px-3 py-2">{row.nomusReceivableId ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {formatFinanceCurrency(row.releasedAmount)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatFinanceCurrency(row.availableToPay)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {rows.length === 0 && !loadingRows && !loadError && commissionPersonId ? (
            <p className="text-sm text-[#6B7280]">
              Nenhuma comissão liberada disponível para pagamento no período selecionado.
            </p>
          ) : null}

          <label className="block space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Observações</span>
            <textarea rows={2} className={fieldClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div className="flex items-center justify-between border-t border-[#E5E7EB] pt-4">
            <p className="text-sm font-semibold text-[#111827]">
              Total selecionado: {formatFinanceCurrency(totalSelected)}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-[#E5E7EB] px-4 py-2 text-sm">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || selected.size === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Criar lote (Rascunho)
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
