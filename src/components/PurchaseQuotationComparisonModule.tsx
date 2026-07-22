import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";
import { PURCHASE_QUOTATION_STATUS_LABEL } from "@/src/types/purchasing";

type ComparisonAlert = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
};

type ComparisonRow = {
  offerId: string;
  supplierName: string;
  supplierDocument: string | null;
  offerStatus: string;
  currency: string;
  initialUnitPriceAvg: number | null;
  negotiatedUnitPriceAvg: number | null;
  initialComparableCost: number | null;
  negotiatedComparableCost: number | null;
  totalGain: number | null;
  percentGain: number | null;
  freightValue: number | null;
  freightIncoterm: string | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  minOrderQty: number | null;
  validityDate: string | null;
  quantityOffered: number | null;
  quantityDemanded: number | null;
  evidenceCount: number;
  hasNegotiatedRound: boolean;
  isWinner: boolean;
  alerts: ComparisonAlert[];
  comparable: boolean;
};

type ComparisonPayload = {
  quotation: {
    id: string;
    code: string;
    status: string;
    currency: string;
    title: string | null;
    selectionNote: string;
  };
  cards: {
    initialTotal: number | null;
    negotiatedTotal: number | null;
    gainedTotal: number | null;
    currency: string | null;
    comparableOfferCount: number;
    incomparableOfferCount: number;
  };
  rows: ComparisonRow[];
  timeline: Array<{
    roundId: string;
    roundNumber: number;
    status: string;
    openedAt: string;
    closedAt: string | null;
    responsibleUserName: string | null;
    buyerReport: string | null;
    lineCount: number;
  }>;
  winner: ComparisonRow | null;
  informativeLowestCostOfferIds: string[];
};

function money(v: number | null | undefined, currency = "BRL"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
  } catch {
    return v.toFixed(2);
  }
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

export function PurchaseQuotationComparisonModule() {
  const { quotationId } = useParams<{ quotationId: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const permissions = usePermissions();
  const allowEdit =
    auth.hasPermission("purchases.edit") ||
    permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.update);
  const allowView =
    auth.hasPermission("purchases.view") ||
    permissions.canViewResource(OPERATIONS_RESOURCE_KEYS.purchases);

  const [data, setData] = useState<ComparisonPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [onlyComparable, setOnlyComparable] = useState(false);
  const [onlyWithEvidence, setOnlyWithEvidence] = useState(false);
  const [selectionJustification, setSelectionJustification] = useState("");
  const [buyerReport, setBuyerReport] = useState("");
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!quotationId || !allowView) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status) params.set("status", status);
      if (onlyComparable) params.set("onlyComparable", "1");
      if (onlyWithEvidence) params.set("onlyWithEvidence", "1");
      const qs = params.toString();
      const row = await fetchJsonOk<ComparisonPayload>(
        `/api/purchase-quotations/${quotationId}/comparison${qs ? `?${qs}` : ""}`
      );
      setData(row);
      if (row.winner) setSelectedOfferId(row.winner.offerId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao carregar comparação.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [quotationId, allowView, q, status, onlyComparable, onlyWithEvidence]);

  useEffect(() => {
    void load();
  }, [load]);

  const markWinner = async () => {
    if (!data || !selectedOfferId || !allowEdit) return;
    if (selectionJustification.trim().length < 10) {
      alert("Justificativa humana obrigatória (mín. 10 caracteres). Não escolha só pelo menor preço.");
      return;
    }
    if (!buyerReport.trim()) {
      alert("Relato do comprador obrigatório.");
      return;
    }
    setBusy(true);
    try {
      await fetchJsonOk(`/api/purchase-quotations/${data.quotation.id}/offers/${selectedOfferId}/mark-winner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyerReport: buyerReport.trim(),
          selectionJustification: selectionJustification.trim(),
          autoPickByLowestPrice: false,
        }),
      });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao registrar escolha.");
    } finally {
      setBusy(false);
    }
  };

  if (!allowView) {
    return <p className="text-sm text-muted-foreground">Sem permissão para ver comparação.</p>;
  }

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando comparação…
      </div>
    );
  }

  if (!data) return null;

  const currency = data.cards.currency || data.quotation.currency || "BRL";
  const lowestId = data.informativeLowestCostOfferIds[0] ?? null;

  return (
    <div className="space-y-6" data-testid="purchase-quotation-comparison">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button
            type="button"
            onClick={() => navigate(`/purchases/quotations/${data.quotation.id}`)}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar à cotação
          </button>
          <h3 className="text-lg font-semibold font-mono">{data.quotation.code}</h3>
          <p className="text-sm text-muted-foreground">
            {PURCHASE_QUOTATION_STATUS_LABEL[
              data.quotation.status as keyof typeof PURCHASE_QUOTATION_STATUS_LABEL
            ] ?? data.quotation.status}
            {data.quotation.title ? ` · ${data.quotation.title}` : ""}
          </p>
          <p className="text-xs text-amber-800 mt-1 max-w-2xl">{data.quotation.selectionNote}</p>
        </div>
        <Link
          to={`/purchases/quotations/${data.quotation.id}`}
          className="text-sm text-primary hover:underline"
        >
          Detalhe / evidências
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="comparison-summary-cards">
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Valor inicial
          </p>
          <p className="text-2xl font-semibold mt-2">{money(data.cards.initialTotal, currency)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.cards.comparableOfferCount} oferta(s) comparável(is)
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Valor negociado
          </p>
          <p className="text-2xl font-semibold mt-2">{money(data.cards.negotiatedTotal, currency)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
            Ganho conquistado
          </p>
          <p className="text-2xl font-semibold mt-2 text-emerald-900">
            {money(data.cards.gainedTotal, currency)}
          </p>
          {data.cards.incomparableOfferCount > 0 ? (
            <p className="text-xs text-amber-800 mt-1">
              {data.cards.incomparableOfferCount} fora da base comparável
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 flex flex-wrap gap-3 items-end">
        <label className="text-sm space-y-1">
          <span className="text-xs text-muted-foreground">Busca</span>
          <input
            className="block border border-border rounded-lg px-3 py-1.5 text-sm min-w-[12rem]"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Fornecedor, pagamento…"
          />
        </label>
        <label className="text-sm space-y-1">
          <span className="text-xs text-muted-foreground">Status oferta</span>
          <select
            className="block border border-border rounded-lg px-3 py-1.5 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Todos</option>
            <option value="RASCUNHO">Rascunho</option>
            <option value="RECEBIDA">Recebida</option>
            <option value="VENCEDORA">Vencedora</option>
            <option value="DESCARTADA">Descartada</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyComparable}
            onChange={(e) => setOnlyComparable(e.target.checked)}
          />
          Só comparáveis
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyWithEvidence}
            onChange={(e) => setOnlyWithEvidence(e.target.checked)}
          />
          Com evidência
        </label>
        <button
          type="button"
          className="text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-muted"
          onClick={() => void load()}
        >
          Aplicar filtros
        </button>
      </div>

      <div className="rounded-2xl border border-border overflow-x-auto">
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-2">Escolha</th>
              <th className="p-2">Fornecedor</th>
              <th className="p-2">Preço inicial</th>
              <th className="p-2">Preço negociado</th>
              <th className="p-2">Custo comp. inicial</th>
              <th className="p-2">Custo comp. final</th>
              <th className="p-2">Ganho R$</th>
              <th className="p-2">Ganho %</th>
              <th className="p-2">Frete</th>
              <th className="p-2">Prazo</th>
              <th className="p-2">Pagamento</th>
              <th className="p-2">Lote mín.</th>
              <th className="p-2">Validade</th>
              <th className="p-2">Qtd atendida</th>
              <th className="p-2">Evidências</th>
              <th className="p-2">Alertas</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={16} className="p-4 text-muted-foreground">
                  Nenhuma oferta com os filtros atuais.
                </td>
              </tr>
            ) : (
              data.rows.map((row) => {
                const isLowest = lowestId === row.offerId;
                return (
                  <tr
                    key={row.offerId}
                    className={cn(
                      "border-t border-border/60",
                      row.isWinner && "bg-emerald-50/50",
                      !row.comparable && "opacity-80"
                    )}
                  >
                    <td className="p-2">
                      {allowEdit && row.offerStatus === "RECEBIDA" ? (
                        <input
                          type="radio"
                          name="winner"
                          checked={selectedOfferId === row.offerId}
                          onChange={() => setSelectedOfferId(row.offerId)}
                          aria-label={`Selecionar ${row.supplierName}`}
                        />
                      ) : row.isWinner ? (
                        <span className="text-xs font-medium text-emerald-800">Vencedor</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{row.supplierName}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.supplierDocument || "—"} · {row.offerStatus}
                        {isLowest ? " · menor custo (informativo)" : ""}
                      </div>
                    </td>
                    <td className="p-2">{money(row.initialUnitPriceAvg, row.currency)}</td>
                    <td className="p-2">{money(row.negotiatedUnitPriceAvg, row.currency)}</td>
                    <td className="p-2">{money(row.initialComparableCost, row.currency)}</td>
                    <td className="p-2">{money(row.negotiatedComparableCost, row.currency)}</td>
                    <td className="p-2">{money(row.totalGain, row.currency)}</td>
                    <td className="p-2">{pct(row.percentGain)}</td>
                    <td className="p-2">
                      {money(row.freightValue, row.currency)}
                      <div className="text-xs text-muted-foreground">{row.freightIncoterm || "—"}</div>
                    </td>
                    <td className="p-2">{row.leadTimeDays != null ? `${row.leadTimeDays}d` : "—"}</td>
                    <td className="p-2 max-w-[8rem] truncate" title={row.paymentTerms || undefined}>
                      {row.paymentTerms || "—"}
                    </td>
                    <td className="p-2">{row.minOrderQty ?? "—"}</td>
                    <td className="p-2">{row.validityDate || "—"}</td>
                    <td className="p-2">
                      {row.quantityOffered ?? "—"}
                      {row.quantityDemanded != null ? (
                        <div className="text-xs text-muted-foreground">demanda {row.quantityDemanded}</div>
                      ) : null}
                    </td>
                    <td className="p-2">{row.evidenceCount}</td>
                    <td className="p-2">
                      {row.alerts.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <ul className="space-y-1 max-w-[14rem]">
                          {row.alerts.map((a) => (
                            <li
                              key={`${row.offerId}-${a.code}`}
                              className={cn(
                                "text-xs rounded px-1.5 py-0.5",
                                a.severity === "error" && "bg-red-100 text-red-900",
                                a.severity === "warning" && "bg-amber-100 text-amber-900",
                                a.severity === "info" && "bg-slate-100 text-slate-800"
                              )}
                            >
                              {a.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card p-5 space-y-3" data-testid="comparison-timeline">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Linha do tempo das rodadas
          </h4>
          {data.timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma rodada registrada.</p>
          ) : (
            <ol className="space-y-3">
              {data.timeline.map((r) => (
                <li key={r.roundId} className="border-l-2 border-border pl-3">
                  <div className="text-sm font-medium">
                    Rodada {r.roundNumber} · {r.status}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.openedAt).toLocaleString("pt-BR")}
                    {r.closedAt ? ` → ${new Date(r.closedAt).toLocaleString("pt-BR")}` : ""}
                    {r.responsibleUserName ? ` · ${r.responsibleUserName}` : ""}
                    {` · ${r.lineCount} linha(s)`}
                  </div>
                  {r.buyerReport ? (
                    <p className="text-sm mt-1 whitespace-pre-wrap">{r.buyerReport}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">Sem relato nesta rodada.</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 space-y-3" data-testid="comparison-human-selection">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Escolha humana (justificada)
          </h4>
          <p className="text-xs text-muted-foreground">
            O menor custo na tabela é apenas informativo. A escolha do vencedor exige justificativa
            registrada — não há auto-seleção por preço.
          </p>
          <label className="block text-sm space-y-1">
            <span className="text-xs text-muted-foreground">Relato do comprador</span>
            <textarea
              rows={3}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              value={buyerReport}
              onChange={(e) => setBuyerReport(e.target.value)}
              disabled={!allowEdit || Boolean(data.winner)}
              placeholder="Contexto da negociação e decisão…"
            />
          </label>
          <label className="block text-sm space-y-1">
            <span className="text-xs text-muted-foreground">Justificativa da escolha</span>
            <textarea
              rows={3}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm"
              value={selectionJustification}
              onChange={(e) => setSelectionJustification(e.target.value)}
              disabled={!allowEdit || Boolean(data.winner)}
              placeholder="Por que este fornecedor (prazo, qualidade, risco…), não só preço."
            />
          </label>
          {allowEdit && !data.winner ? (
            <button
              type="button"
              disabled={busy || !selectedOfferId}
              onClick={() => void markWinner()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Registrar escolha do vencedor
            </button>
          ) : data.winner ? (
            <p className="text-sm text-emerald-800">
              Vencedor registrado: <strong>{data.winner.supplierName}</strong>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
