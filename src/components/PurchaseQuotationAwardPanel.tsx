import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";
import type { PurchaseQuotationDetail } from "@/src/types/purchasing";

type AwardRow = {
  id: string;
  status: string;
  mode: string;
  justification: string;
  responsibleUserName: string | null;
  approverUserName: string | null;
  submittedAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  currency: string;
  initialComparableTotal: string | number | null;
  awardedComparableTotal: string | number | null;
  totalGain: string | number | null;
  percentGain: string | number | null;
  evidenceCountSnapshot: number;
  finalRoundId: string | null;
  commercialConditionsJson: unknown;
  allocations: Array<{
    id: string;
    offerId: string;
    quotationItemId: string;
    supplierNameSnapshot: string;
    quantityAwarded: string | number;
    unitPriceAwarded: string | number;
    lineTotalAwarded: string | number;
  }>;
  rejections: Array<{
    id: string;
    offerId: string;
    supplierNameSnapshot: string;
    reason: string;
  }>;
  history: Array<{
    id: string;
    action: string;
    reason: string | null;
    userName: string | null;
    createdAt: string;
  }>;
  finalRound?: { id: string; roundNumber: number; status: string } | null;
};

function money(v: string | number | null | undefined, currency = "BRL"): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

type Props = {
  quotationId: string;
  /** Oferta pré-selecionada na comparação (modo SINGLE). */
  preferredOfferId?: string | null;
  onChanged?: () => void;
};

export function PurchaseQuotationAwardPanel({ quotationId, preferredOfferId, onChanged }: Props) {
  const auth = useAuth();
  const permissions = usePermissions();
  const allowEdit =
    auth.hasPermission("purchases.edit") ||
    permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.update);
  const allowApprove =
    auth.hasPermission("purchases.approve") ||
    permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.approve);

  const [detail, setDetail] = useState<PurchaseQuotationDetail | null>(null);
  const [award, setAward] = useState<AwardRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"SINGLE" | "SPLIT">("SINGLE");
  const [justification, setJustification] = useState("");
  const [notes, setNotes] = useState("");
  const [singleOfferId, setSingleOfferId] = useState("");
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  /** SPLIT: key = `${offerId}:${quotationItemId}` → qty */
  const [splitQty, setSplitQty] = useState<Record<string, string>>({});
  const [approveNotes, setApproveNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [q, awards] = await Promise.all([
        fetchJsonOk<PurchaseQuotationDetail>(`/api/purchase-quotations/${quotationId}`),
        fetchJsonOk<{ current: AwardRow | null }>(`/api/purchase-quotations/${quotationId}/awards`),
      ]);
      setDetail(q);
      setAward(awards.current);
      if (preferredOfferId) setSingleOfferId(preferredOfferId);
      else {
        const winner = q.suppliers.find((s) => s.offers[0]?.status === "VENCEDORA");
        if (winner?.offers[0]) setSingleOfferId(winner.offers[0].id);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao carregar adjudicação.");
    } finally {
      setLoading(false);
    }
  }, [quotationId, preferredOfferId]);

  useEffect(() => {
    void load();
  }, [load]);

  const receivedOffers =
    detail?.suppliers
      .map((s) => ({ supplier: s, offer: s.offers[0] }))
      .filter((x) => x.offer && (x.offer.status === "RECEBIDA" || x.offer.status === "VENCEDORA")) ??
    [];

  const closedRound = detail?.rounds
    ?.filter((r) => r.status === "FECHADA")
    .sort((a, b) => b.roundNumber - a.roundNumber)[0];

  const buildSingleAllocations = () => {
    if (!detail || !singleOfferId) return [];
    const entry = receivedOffers.find((x) => x.offer!.id === singleOfferId);
    if (!entry?.offer) return [];
    return detail.items.map((item) => {
      const oi = entry.offer!.items.find((i) => i.quotationItemId === item.id);
      const offered = oi?.initialQuantity != null ? Number(oi.initialQuantity) : Number(item.quantity);
      const demand = Number(item.quantity);
      return {
        offerId: singleOfferId,
        quotationItemId: item.id,
        quantityAwarded: Math.min(offered, demand),
      };
    });
  };

  const buildSplitAllocations = () => {
    if (!detail) return [];
    const out: Array<{ offerId: string; quotationItemId: string; quantityAwarded: number }> = [];
    for (const [key, raw] of Object.entries(splitQty)) {
      const qty = Number(raw);
      if (!raw || !Number.isFinite(qty) || qty <= 0) continue;
      const [offerId, quotationItemId] = key.split(":");
      if (!offerId || !quotationItemId) continue;
      out.push({ offerId, quotationItemId, quantityAwarded: qty });
    }
    return out;
  };

  const buildRejections = (winnerIds: Set<string>) => {
    return receivedOffers
      .filter((x) => x.offer && !winnerIds.has(x.offer.id))
      .map((x) => ({
        offerId: x.offer!.id,
        reason: (rejectionReasons[x.offer!.id] || "Não selecionado na adjudicação.").trim(),
      }))
      .filter((r) => r.reason.length >= 5);
  };

  const submitAward = async () => {
    if (!detail || !allowEdit) return;
    const allocations = mode === "SINGLE" ? buildSingleAllocations() : buildSplitAllocations();
    const winnerIds = new Set<string>(allocations.map((a) => a.offerId));
    setBusy(true);
    try {
      await fetchJsonOk(`/api/purchase-quotations/${quotationId}/awards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          justification,
          finalRoundId: closedRound?.id ?? null,
          allocations,
          rejections: buildRejections(winnerIds),
          notes: notes || null,
        }),
      });
      await load();
      onChanged?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao submeter adjudicação.");
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!award || !allowApprove) return;
    setBusy(true);
    try {
      await fetchJsonOk(`/api/purchase-quotations/${quotationId}/awards/${award.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: approveNotes || null }),
      });
      await load();
      onChanged?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao aprovar.");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!award || !allowApprove) return;
    if (rejectReason.trim().length < 5) {
      alert("Informe o motivo da rejeição (mín. 5 caracteres).");
      return;
    }
    setBusy(true);
    try {
      await fetchJsonOk(`/api/purchase-quotations/${quotationId}/awards/${award.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      await load();
      onChanged?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao rejeitar.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando adjudicação…
      </div>
    );
  }

  const pending = award?.status === "PENDENTE_APROVACAO";
  const approved = award?.status === "APROVADA";
  const canSubmit =
    allowEdit &&
    !pending &&
    !approved &&
    detail?.status !== "ADJUDICADA" &&
    detail?.status !== "CANCELADA";

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4" data-testid="quotation-award-panel">
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Adjudicação e aprovação
        </h4>
        <p className="text-xs text-muted-foreground mt-1">
          Registra fornecedor(es), rodada final, justificativa, responsável, aprovador, evidências,
          condições e ganho. Sem emissão de pedido nem recebimento nesta etapa.
        </p>
      </div>

      {award ? (
        <div className="space-y-3 rounded-xl border border-border/70 p-4 bg-muted/20">
          <div className="flex flex-wrap gap-3 text-sm">
            <span>
              Status: <strong>{award.status}</strong>
            </span>
            <span>Modo: {award.mode}</span>
            <span>
              Responsável: {award.responsibleUserName || "—"} ·{" "}
              {new Date(award.submittedAt).toLocaleString("pt-BR")}
            </span>
            {award.approverUserName ? (
              <span>
                Aprovador: {award.approverUserName}
                {award.decidedAt ? ` · ${new Date(award.decidedAt).toLocaleString("pt-BR")}` : ""}
              </span>
            ) : null}
            {award.finalRound ? <span>Rodada final: #{award.finalRound.roundNumber}</span> : null}
          </div>
          <p className="text-sm whitespace-pre-wrap">{award.justification}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <div>Inicial: {money(award.initialComparableTotal, award.currency)}</div>
            <div>Adjudicado: {money(award.awardedComparableTotal, award.currency)}</div>
            <div>
              Ganho: {money(award.totalGain, award.currency)}
              {award.percentGain != null ? ` (${Number(award.percentGain).toFixed(1)}%)` : ""}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Evidências no pacote: {award.evidenceCountSnapshot}
          </p>
          <div>
            <h5 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
              Alocações (item × qtd)
            </h5>
            <ul className="text-sm space-y-1">
              {award.allocations.map((a) => (
                <li key={a.id}>
                  {a.supplierNameSnapshot}: qtd {Number(a.quantityAwarded)} @{" "}
                  {money(a.unitPriceAwarded, award.currency)} = {money(a.lineTotalAwarded, award.currency)}
                </li>
              ))}
            </ul>
          </div>
          {award.rejections.length > 0 ? (
            <div>
              <h5 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                Rejeitados
              </h5>
              <ul className="text-sm space-y-1">
                {award.rejections.map((r) => (
                  <li key={r.id}>
                    {r.supplierNameSnapshot}: {r.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {award.history.length > 0 ? (
            <div>
              <h5 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                Auditoria
              </h5>
              <ol className="text-xs space-y-1">
                {award.history.map((h) => (
                  <li key={h.id}>
                    {new Date(h.createdAt).toLocaleString("pt-BR")} · {h.action}
                    {h.userName ? ` · ${h.userName}` : ""}
                    {h.reason ? ` — ${h.reason}` : ""}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {pending && allowApprove ? (
            <div className="space-y-2 border-t border-border pt-3">
              <label className="block text-sm space-y-1">
                <span className="text-xs text-muted-foreground">Notas do aprovador</span>
                <textarea
                  rows={2}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm"
                  value={approveNotes}
                  onChange={(e) => setApproveNotes(e.target.value)}
                />
              </label>
              <label className="block text-sm space-y-1">
                <span className="text-xs text-muted-foreground">Motivo se rejeitar</span>
                <textarea
                  rows={2}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </label>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void approve()}
                  className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm disabled:opacity-50"
                >
                  Aprovar adjudicação
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void reject()}
                  className="px-4 py-2 rounded-lg border border-border text-sm disabled:opacity-50"
                >
                  Rejeitar
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {canSubmit ? (
        <div className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={mode === "SINGLE"}
                onChange={() => setMode("SINGLE")}
              />
              Único vencedor
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={mode === "SPLIT"}
                onChange={() => setMode("SPLIT")}
              />
              Divisão entre fornecedores
            </label>
          </div>

          {mode === "SINGLE" ? (
            <label className="block text-sm space-y-1">
              <span className="text-xs text-muted-foreground">Fornecedor vencedor</span>
              <select
                className="w-full border border-border rounded-lg px-3 py-2 text-sm"
                value={singleOfferId}
                onChange={(e) => setSingleOfferId(e.target.value)}
              >
                <option value="">Selecione…</option>
                {receivedOffers.map((x) => (
                  <option key={x.offer!.id} value={x.offer!.id}>
                    {x.supplier.supplierDisplayNameSnapshot}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="space-y-3 overflow-x-auto">
              <p className="text-xs text-muted-foreground">
                Informe quantidade por item e fornecedor (soma deve fechar a demanda).
              </p>
              <table className="w-full text-sm min-w-[640px]">
                <thead className="text-xs uppercase text-muted-foreground text-left">
                  <tr>
                    <th className="p-2">Item</th>
                    <th className="p-2">Demanda</th>
                    {receivedOffers.map((x) => (
                      <th key={x.offer!.id} className="p-2">
                        {x.supplier.supplierDisplayNameSnapshot}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail?.items.map((item) => (
                    <tr key={item.id} className="border-t border-border/60">
                      <td className="p-2">{item.description}</td>
                      <td className="p-2">{Number(item.quantity)}</td>
                      {receivedOffers.map((x) => {
                        const key = `${x.offer!.id}:${item.id}`;
                        return (
                          <td key={key} className="p-2">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              className="w-24 border border-border rounded px-2 py-1"
                              value={splitQty[key] ?? ""}
                              onChange={(e) =>
                                setSplitQty((prev) => ({ ...prev, [key]: e.target.value }))
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="space-y-2">
            <h5 className="text-xs font-semibold uppercase text-muted-foreground">
              Motivo dos não escolhidos
            </h5>
            {receivedOffers
              .filter((x) => mode === "SINGLE" && x.offer!.id !== singleOfferId)
              .map((x) => (
                <label key={x.offer!.id} className="block text-sm space-y-1">
                  <span className="text-xs text-muted-foreground">
                    {x.supplier.supplierDisplayNameSnapshot}
                  </span>
                  <input
                    className="w-full border border-border rounded-lg px-3 py-1.5 text-sm"
                    value={rejectionReasons[x.offer!.id] ?? ""}
                    onChange={(e) =>
                      setRejectionReasons((prev) => ({
                        ...prev,
                        [x.offer!.id]: e.target.value,
                      }))
                    }
                    placeholder="Motivo da rejeição…"
                  />
                </label>
              ))}
          </div>

          <label className="block text-sm space-y-1">
            <span className="text-xs text-muted-foreground">Justificativa da adjudicação</span>
            <textarea
              rows={3}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Decisão humana justificada (mín. 10 caracteres)…"
            />
          </label>
          <label className="block text-sm space-y-1">
            <span className="text-xs text-muted-foreground">Observações</span>
            <textarea
              rows={2}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {closedRound ? (
            <p className="text-xs text-muted-foreground">
              Rodada final prevista: #{closedRound.roundNumber}
            </p>
          ) : (
            <p className="text-xs text-amber-800">
              Sem rodada fechada — adjudicação usará preços iniciais das ofertas.
            </p>
          )}
          <button
            type="button"
            disabled={busy || (mode === "SINGLE" && !singleOfferId)}
            onClick={() => void submitAward()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Submeter para aprovação
          </button>
        </div>
      ) : null}
    </div>
  );
}
