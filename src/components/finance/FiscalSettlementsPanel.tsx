/**
 * UI — Apuração, guias e alocação gerencial (Financeiro > Tributos).
 * Destacados da NF (pedido) ≠ apurado ≠ pago ≠ alocado.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  formatFinanceCurrency,
  formatFinanceDate,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  FISCAL_GUIDE_TYPES,
  FISCAL_GUIDE_TYPE_LABELS,
  FISCAL_JURISDICTIONS,
  type FiscalApurationPeriodDto,
  type FiscalPaymentGuideDto,
} from "@/src/lib/finance/fiscalSettlementClient";
import {
  canManageFiscalSettlements,
  canViewFiscalSettlements,
} from "@/src/lib/finance/fiscalSettlementPermissions";
import { cn } from "@/src/lib/utils";

type InnerTab = "guides" | "apurations";

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return formatFinanceCurrency(n);
}

export function FiscalSettlementsPanel(): JSX.Element {
  const auth = useAuth();
  const canView = canViewFiscalSettlements(auth);
  const canManage = canManageFiscalSettlements(auth);
  const [innerTab, setInnerTab] = useState<InnerTab>("guides");
  const [guides, setGuides] = useState<FiscalPaymentGuideDto[]>([]);
  const [apurations, setApurations] = useState<FiscalApurationPeriodDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    taxType: "IPI",
    jurisdiction: "FEDERAL",
    guideType: "DARF",
    guideNumber: "",
    revenueCode: "",
    periodStart: "",
    periodEnd: "",
    dueDate: "",
    assessedAmount: "",
    creditsAmount: "0",
    compensationsAmount: "0",
    interestAmount: "0",
    fineAmount: "0",
    amountPaid: "0",
    accountsPayableExternalId: "",
    notes: "",
  });

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const [g, a] = await Promise.all([
        fetchJsonOk<{ ok: true; guides: FiscalPaymentGuideDto[] }>(
          "/api/finance/fiscal-settlements/guides"
        ),
        fetchJsonOk<{ ok: true; apurations: FiscalApurationPeriodDto[] }>(
          "/api/finance/fiscal-settlements/apurations"
        ),
      ]);
      setGuides(g.guides ?? []);
      setApurations(a.apurations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar tributos.");
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitGuide = async () => {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk("/api/finance/fiscal-settlements/guides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taxType: form.taxType,
          jurisdiction: form.jurisdiction,
          guideType: form.guideType,
          guideNumber: form.guideNumber || null,
          revenueCode: form.revenueCode || null,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          dueDate: form.dueDate || null,
          assessedAmount: Number(form.assessedAmount || 0),
          creditsAmount: Number(form.creditsAmount || 0),
          compensationsAmount: Number(form.compensationsAmount || 0),
          interestAmount: Number(form.interestAmount || 0),
          fineAmount: Number(form.fineAmount || 0),
          amountPaid: Number(form.amountPaid || 0),
          accountsPayableExternalId: form.accountsPayableExternalId
            ? Number(form.accountsPayableExternalId)
            : null,
          notes: form.notes || null,
        }),
      });
      setFormOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar guia.");
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return (
      <div
        className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        data-testid="fiscal-settlements-denied"
      >
        Sem permissão para apuração/guias fiscais.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="fiscal-settlements-panel">
      <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-2 text-[12px] text-sky-950">
        <strong>Camadas distintas:</strong> valores destacados na NF (pedido) não
        são automaticamente apurados nem pagos. Fonte oficial do pago = Contas a
        Pagar Nomus quando a guia estiver vinculada; alocação ao pedido é apenas
        gerencial.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <button
            type="button"
            className={cn(
              "rounded-md px-3 py-1.5 text-[12px] font-semibold",
              innerTab === "guides"
                ? "bg-white shadow ring-1 ring-[#E5E7EB]"
                : "text-[#4B5563]"
            )}
            onClick={() => setInnerTab("guides")}
            data-testid="fiscal-settlements-tab-guides"
          >
            Guias / recolhimentos
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-3 py-1.5 text-[12px] font-semibold",
              innerTab === "apurations"
                ? "bg-white shadow ring-1 ring-[#E5E7EB]"
                : "text-[#4B5563]"
            )}
            onClick={() => setInnerTab("apurations")}
            data-testid="fiscal-settlements-tab-apurations"
          >
            Apurações
          </button>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-semibold"
          >
            <RefreshCw className="h-3 w-3" /> Atualizar
          </button>
          {canManage && innerTab === "guides" ? (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="inline-flex items-center gap-1 rounded-md bg-[#1e3a8a] px-2 py-1 text-[11px] font-semibold text-white"
              data-testid="fiscal-settlements-new-guide"
            >
              <Plus className="h-3 w-3" /> Nova guia
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-[#6B7280]">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : innerTab === "guides" ? (
        <div className="overflow-x-auto rounded-xl border border-[#E5E7EB] bg-white">
          <table className="min-w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-[#E5E7EB] text-[#6B7280]">
                <th className="px-2 py-2 font-semibold">Tipo</th>
                <th className="px-2 py-2 font-semibold">Número</th>
                <th className="px-2 py-2 font-semibold">Tributo</th>
                <th className="px-2 py-2 font-semibold">Período</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold text-right">Apurado</th>
                <th className="px-2 py-2 font-semibold text-right">Devido</th>
                <th className="px-2 py-2 font-semibold text-right">Pago</th>
                <th className="px-2 py-2 font-semibold text-right">Saldo</th>
                <th className="px-2 py-2 font-semibold">AP Nomus</th>
              </tr>
            </thead>
            <tbody>
              {guides.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-3 py-8 text-center text-[#6B7280]"
                    data-testid="fiscal-settlements-guides-empty"
                  >
                    Nenhuma guia cadastrada. Cadastre DARF/GNRE/DAS… e vincule ao
                    Contas a Pagar quando o título Nomus for o pagamento.
                  </td>
                </tr>
              ) : (
                guides.map((g) => (
                  <tr
                    key={g.id}
                    className="border-b border-[#F3F4F6]"
                    data-testid={`fiscal-guide-row-${g.id}`}
                  >
                    <td className="px-2 py-1.5 font-semibold">{g.guideTypeLabel}</td>
                    <td className="px-2 py-1.5">{g.guideNumber ?? "—"}</td>
                    <td className="px-2 py-1.5">{g.taxType}</td>
                    <td className="px-2 py-1.5">
                      {formatFinanceDate(g.periodStart)} →{" "}
                      {formatFinanceDate(g.periodEnd)}
                    </td>
                    <td className="px-2 py-1.5">{g.statusLabel}</td>
                    <td className="px-2 py-1.5 text-right">
                      {money(g.assessedAmount)}
                    </td>
                    <td className="px-2 py-1.5 text-right">{money(g.amountDue)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">
                      {money(g.amountPaid)}
                    </td>
                    <td className="px-2 py-1.5 text-right">{money(g.balanceDue)}</td>
                    <td className="px-2 py-1.5">
                      {g.accountsPayableExternalId != null
                        ? `#${g.accountsPayableExternalId}`
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#E5E7EB] bg-white">
          <table className="min-w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-[#E5E7EB] text-[#6B7280]">
                <th className="px-2 py-2 font-semibold">Jurisdição</th>
                <th className="px-2 py-2 font-semibold">UF</th>
                <th className="px-2 py-2 font-semibold">Período</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold text-right">Devido</th>
                <th className="px-2 py-2 font-semibold text-right">Linhas</th>
              </tr>
            </thead>
            <tbody>
              {apurations.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-[#6B7280]"
                  >
                    Nenhuma apuração cadastrada para o período.
                  </td>
                </tr>
              ) : (
                apurations.map((p) => (
                  <tr key={p.id} className="border-b border-[#F3F4F6]">
                    <td className="px-2 py-1.5">{p.jurisdiction}</td>
                    <td className="px-2 py-1.5">{p.uf ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      {formatFinanceDate(p.periodStart)} →{" "}
                      {formatFinanceDate(p.periodEnd)}
                    </td>
                    <td className="px-2 py-1.5">{p.status}</td>
                    <td className="px-2 py-1.5 text-right">
                      {money(p.totals.amountDue)}
                    </td>
                    <td className="px-2 py-1.5 text-right">{p.lines.length}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {formOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          data-testid="fiscal-guide-form-dialog"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-sm font-bold text-[#0f172a]">Nova guia</h3>
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <label className="col-span-1">
                Tipo
                <select
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.guideType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, guideType: e.target.value }))
                  }
                >
                  {FISCAL_GUIDE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FISCAL_GUIDE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Jurisdição
                <select
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.jurisdiction}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, jurisdiction: e.target.value }))
                  }
                >
                  {FISCAL_JURISDICTIONS.map((j) => (
                    <option key={j} value={j}>
                      {j}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tributo
                <input
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.taxType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, taxType: e.target.value }))
                  }
                />
              </label>
              <label>
                Número
                <input
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.guideNumber}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, guideNumber: e.target.value }))
                  }
                />
              </label>
              <label>
                Código receita
                <input
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.revenueCode}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, revenueCode: e.target.value }))
                  }
                />
              </label>
              <label>
                AP Nomus (externalId)
                <input
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.accountsPayableExternalId}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      accountsPayableExternalId: e.target.value,
                    }))
                  }
                  placeholder="opcional"
                />
              </label>
              <label>
                Período início
                <input
                  type="date"
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.periodStart}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, periodStart: e.target.value }))
                  }
                />
              </label>
              <label>
                Período fim
                <input
                  type="date"
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.periodEnd}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, periodEnd: e.target.value }))
                  }
                />
              </label>
              <label>
                Vencimento
                <input
                  type="date"
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.dueDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, dueDate: e.target.value }))
                  }
                />
              </label>
              <label>
                Apurado
                <input
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.assessedAmount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, assessedAmount: e.target.value }))
                  }
                />
              </label>
              <label>
                Créditos
                <input
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.creditsAmount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, creditsAmount: e.target.value }))
                  }
                />
              </label>
              <label>
                Compensações
                <input
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.compensationsAmount}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      compensationsAmount: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Juros
                <input
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.interestAmount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, interestAmount: e.target.value }))
                  }
                />
              </label>
              <label>
                Multa
                <input
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.fineAmount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, fineAmount: e.target.value }))
                  }
                />
              </label>
              <label>
                Pago (manual se sem AP)
                <input
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  value={form.amountPaid}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, amountPaid: e.target.value }))
                  }
                />
              </label>
              <label className="col-span-2">
                Observações
                <textarea
                  className="mt-0.5 w-full rounded border px-2 py-1"
                  rows={2}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                />
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-[12px] font-semibold"
                onClick={() => setFormOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                className="rounded-md bg-[#1e3a8a] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                onClick={() => void submitGuide()}
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
