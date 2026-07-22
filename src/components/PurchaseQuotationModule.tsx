import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, Plus, Save } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { SearchableSelect, SelectOption } from "@/src/components/shared/SearchableSelect";
import { usePermissions } from "@/src/hooks/usePermissions";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";
import {
  PURCHASE_QUOTATION_STATUS_LABEL,
  type PurchaseQuotationDetail,
  type PurchaseQuotationListRow,
  type PurchaseQuotationOfferRow,
  type PurchaseQuotationSupplierRow,
} from "@/src/types/purchasing";
import { canEditInitialOffer } from "@/src/lib/purchasing/purchaseQuotationWorkflow";

type OfferItemDraft = {
  quotationItemId: string;
  initialUnitPrice: string;
  initialQuantity: string;
  initialLeadTimeDays: string;
  initialFreightValue: string;
  initialNonRecoverableTaxes: string;
  initialExpenses: string;
  initialDiscounts: string;
  initialMinOrderQty: string;
  initialNotes: string;
};

type OfferDraft = {
  currency: string;
  initialPaymentTerms: string;
  initialDeliveryTerms: string;
  initialFreightValue: string;
  initialNonRecoverableTaxes: string;
  initialExpenses: string;
  initialDiscounts: string;
  initialMinOrderQty: string;
  initialValidityDate: string;
  initialLeadTimeDays: string;
  notes: string;
  items: OfferItemDraft[];
};

function numStr(v: string | number | null | undefined): string {
  if (v == null || v === "") return "";
  return String(v);
}

function dateInput(v: string | null | undefined): string {
  if (!v) return "";
  return String(v).slice(0, 10);
}

function emptyOfferDraft(
  demand: PurchaseQuotationDetail["items"],
  existing?: PurchaseQuotationOfferRow | null,
  currency = "BRL"
): OfferDraft {
  const byItem = new Map((existing?.items ?? []).map((i) => [i.quotationItemId, i]));
  return {
    currency: existing?.currency || currency,
    initialPaymentTerms: existing?.initialPaymentTerms || "",
    initialDeliveryTerms: existing?.initialDeliveryTerms || "",
    initialFreightValue: numStr(existing?.initialFreightValue),
    initialNonRecoverableTaxes: numStr(existing?.initialNonRecoverableTaxes),
    initialExpenses: numStr(existing?.initialExpenses),
    initialDiscounts: numStr(existing?.initialDiscounts),
    initialMinOrderQty: numStr(existing?.initialMinOrderQty),
    initialValidityDate: dateInput(existing?.initialValidityDate),
    initialLeadTimeDays: existing?.initialLeadTimeDays != null ? String(existing.initialLeadTimeDays) : "",
    notes: existing?.notes || "",
    items: demand.map((d) => {
      const ex = byItem.get(d.id);
      return {
        quotationItemId: d.id,
        initialUnitPrice: numStr(ex?.initialUnitPrice),
        initialQuantity: numStr(ex?.initialQuantity ?? d.quantity),
        initialLeadTimeDays: ex?.initialLeadTimeDays != null ? String(ex.initialLeadTimeDays) : "",
        initialFreightValue: numStr(ex?.initialFreightValue),
        initialNonRecoverableTaxes: numStr(ex?.initialNonRecoverableTaxes),
        initialExpenses: numStr(ex?.initialExpenses),
        initialDiscounts: numStr(ex?.initialDiscounts),
        initialMinOrderQty: numStr(ex?.initialMinOrderQty),
        initialNotes: ex?.initialNotes || "",
      };
    }),
  };
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold text-muted-foreground uppercase">{label}</label>
      {children}
    </div>
  );
}

function inputCls(disabled: boolean) {
  return cn(
    "w-full p-2 rounded-lg border border-border bg-background text-sm",
    disabled && "opacity-70 cursor-not-allowed"
  );
}

export function PurchaseQuotationModule() {
  const { quotationId } = useParams<{ quotationId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const permissions = usePermissions();
  const allowEdit =
    auth.hasPermission("purchases.edit") ||
    permissions.canPerformAction(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.update);
  const allowView =
    auth.hasPermission("purchases.view") ||
    permissions.canViewResource(OPERATIONS_RESOURCE_KEYS.purchases);

  const [list, setList] = useState<PurchaseQuotationListRow[]>([]);
  const [detail, setDetail] = useState<PurchaseQuotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [supplierOptions, setSupplierOptions] = useState<SelectOption[]>([]);
  const [offerDrafts, setOfferDrafts] = useState<Record<string, OfferDraft>>({});
  const [meta, setMeta] = useState({ title: "", currency: "BRL", notes: "", expiresAt: "" });
  const [rounds, setRounds] = useState<
    Array<{
      id: string;
      roundNumber: number;
      status: string;
      openedAt: string;
      closedAt: string | null;
      buyerReport: string | null;
      responsibleUserName: string | null;
      lines: Array<{
        id: string;
        offerItemId: string;
        unitPrice: string | number;
        quantity: string | number | null;
        freightValue: string | number | null;
        freightIncoterm: string | null;
        previousUnitPrice: string | number | null;
        paymentTerms: string | null;
        leadTimeDays: number | null;
      }>;
    }>
  >([]);
  const [buyerReport, setBuyerReport] = useState("");
  const [savingsMap, setSavingsMap] = useState<
    Record<
      string,
      {
        totalGain: number;
        unitGain: number | null;
        percentGain: number | null;
        initialComparableCost: number;
        negotiatedComparableCost: number;
        costIncreased: boolean;
        conditionGains: Array<{ field: string; label: string; previousValue: unknown; newValue: unknown }>;
      }
    >
  >({});
  const [negoPrices, setNegoPrices] = useState<Record<string, string>>({});
  const [negoFreightIncoterm, setNegoFreightIncoterm] = useState("FOB");


  const requestFilter = searchParams.get("purchaseRequestId") || undefined;

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const qs = requestFilter ? `?purchaseRequestId=${encodeURIComponent(requestFilter)}` : "";
      const data = await fetchJsonOk<{ rows?: PurchaseQuotationListRow[] }>(
        `/api/purchase-quotations${qs}`
      );
      setList(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao listar cotações.");
    } finally {
      setLoading(false);
    }
  }, [requestFilter]);

  const loadRounds = useCallback(async (id: string) => {
    try {
      const data = await fetchJsonOk<{ rows?: typeof rounds }>(`/api/purchase-quotations/${id}/rounds`);
      setRounds(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      setRounds([]);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const row = await fetchJsonOk<PurchaseQuotationDetail>(`/api/purchase-quotations/${id}`);
      setDetail(row);
      setMeta({
        title: row.title || "",
        currency: row.currency || "BRL",
        notes: row.notes || "",
        expiresAt: dateInput(row.expiresAt),
      });
      const drafts: Record<string, OfferDraft> = {};
      for (const s of row.suppliers) {
        const offer = s.offers[0] ?? null;
        drafts[s.id] = emptyOfferDraft(row.items, offer, row.currency);
      }
      setOfferDrafts(drafts);
      await loadRounds(id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao abrir cotação.");
      navigate("/purchases/quotations");
    } finally {
      setLoading(false);
    }
  }, [navigate, loadRounds]);

  const loadSuppliers = useCallback(async (q = "") => {
    try {
      const data = await fetchJsonOk<{
        rows?: Array<{ id: string; displayName: string; document: string | null }>;
      }>(
        `/api/purchase-quotations/official-refs/suppliers${q ? `?q=${encodeURIComponent(q)}` : ""}`
      );
      setSupplierOptions(
        (data.rows ?? []).map((s) => ({
          value: s.id,
          label: s.displayName,
          sublabel: s.document || undefined,
          searchTerms: `${s.displayName} ${s.document ?? ""}`,
        }))
      );
    } catch {
      setSupplierOptions([]);
    }
  }, []);

  useEffect(() => {
    if (!allowView) return;
    if (quotationId) void loadDetail(quotationId);
    else void loadList();
  }, [allowView, quotationId, loadDetail, loadList]);

  useEffect(() => {
    if (quotationId && allowEdit) void loadSuppliers();
  }, [quotationId, allowEdit, loadSuppliers]);

  const negotiationStarted = rounds.length > 0;
  const openRound = rounds.find((r) => r.status === "ABERTA") ?? null;

  const openNegotiation = async () => {
    if (!detail || !allowEdit) return;
    setBusy(true);
    try {
      await fetchJsonOk(`/api/purchase-quotations/${detail.id}/rounds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyerReport: buyerReport || null }),
      });
      await loadRounds(detail.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao abrir rodada.");
    } finally {
      setBusy(false);
    }
  };

  const submitRoundLines = async (offerId: string, offerItemIds: string[]) => {
    if (!detail || !openRound) return;
    const lines = offerItemIds
      .map((offerItemId) => {
        const price = negoPrices[offerItemId];
        if (price == null || price === "") return null;
        return {
          offerItemId,
          unitPrice: Number(price),
          freightIncoterm: negoFreightIncoterm,
          proposedBy: "BUYER" as const,
        };
      })
      .filter(Boolean);
    if (lines.length === 0) {
      alert("Informe ao menos um preço negociado.");
      return;
    }
    setBusy(true);
    try {
      await fetchJsonOk(`/api/purchase-quotations/${detail.id}/rounds/${openRound.id}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      await loadRounds(detail.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao registrar linhas.");
    } finally {
      setBusy(false);
    }
  };

  const closeNegotiation = async () => {
    if (!detail || !openRound) return;
    setBusy(true);
    try {
      await fetchJsonOk(`/api/purchase-quotations/${detail.id}/rounds/${openRound.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyerReport: buyerReport || null }),
      });
      await loadRounds(detail.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao fechar rodada.");
    } finally {
      setBusy(false);
    }
  };

  const refreshSavings = async (offerId: string) => {
    if (!detail) return;
    try {
      const result = await fetchJsonOk<{
        savings: (typeof savingsMap)[string];
      }>(`/api/purchase-quotations/${detail.id}/offers/${offerId}/savings`);
      setSavingsMap((prev) => ({ ...prev, [offerId]: result.savings }));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao calcular ganho.");
    }
  };

  const saveMeta = async () => {
    if (!detail || !allowEdit) return;
    setBusy(true);
    try {
      const row = await fetchJsonOk<PurchaseQuotationDetail>(`/api/purchase-quotations/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: meta.title || null,
          currency: meta.currency || "BRL",
          notes: meta.notes || null,
          expiresAt: meta.expiresAt || null,
        }),
      });
      setDetail(row);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao salvar cabeçalho.");
    } finally {
      setBusy(false);
    }
  };

  const inviteSupplier = async () => {
    if (!detail || !supplierId) return;
    setBusy(true);
    try {
      const row = await fetchJsonOk<PurchaseQuotationDetail>(
        `/api/purchase-quotations/${detail.id}/invite-supplier`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ supplierId }),
        }
      );
      setDetail(row);
      setSupplierId("");
      const drafts: Record<string, OfferDraft> = { ...offerDrafts };
      for (const s of row.suppliers) {
        if (!drafts[s.id]) drafts[s.id] = emptyOfferDraft(row.items, s.offers[0] ?? null, row.currency);
      }
      setOfferDrafts(drafts);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao convidar fornecedor.");
    } finally {
      setBusy(false);
    }
  };

  const saveOffer = async (
    supplier: PurchaseQuotationSupplierRow,
    options?: { manageBusy?: boolean }
  ): Promise<PurchaseQuotationDetail | null> => {
    if (!detail) return null;
    const draft = offerDrafts[supplier.id];
    if (!draft) return null;
    const manageBusy = options?.manageBusy !== false;
    if (manageBusy) setBusy(true);
    try {
      const payload = {
        currency: draft.currency,
        initialPaymentTerms: draft.initialPaymentTerms || null,
        initialDeliveryTerms: draft.initialDeliveryTerms || null,
        initialFreightValue: draft.initialFreightValue === "" ? null : Number(draft.initialFreightValue),
        initialNonRecoverableTaxes:
          draft.initialNonRecoverableTaxes === "" ? null : Number(draft.initialNonRecoverableTaxes),
        initialExpenses: draft.initialExpenses === "" ? null : Number(draft.initialExpenses),
        initialDiscounts: draft.initialDiscounts === "" ? null : Number(draft.initialDiscounts),
        initialMinOrderQty: draft.initialMinOrderQty === "" ? null : Number(draft.initialMinOrderQty),
        initialValidityDate: draft.initialValidityDate || null,
        initialLeadTimeDays: draft.initialLeadTimeDays === "" ? null : Number(draft.initialLeadTimeDays),
        notes: draft.notes || null,
        items: draft.items.map((it) => ({
          quotationItemId: it.quotationItemId,
          initialUnitPrice: Number(it.initialUnitPrice),
          initialQuantity: it.initialQuantity === "" ? null : Number(it.initialQuantity),
          initialLeadTimeDays: it.initialLeadTimeDays === "" ? null : Number(it.initialLeadTimeDays),
          initialFreightValue: it.initialFreightValue === "" ? null : Number(it.initialFreightValue),
          initialNonRecoverableTaxes:
            it.initialNonRecoverableTaxes === "" ? null : Number(it.initialNonRecoverableTaxes),
          initialExpenses: it.initialExpenses === "" ? null : Number(it.initialExpenses),
          initialDiscounts: it.initialDiscounts === "" ? null : Number(it.initialDiscounts),
          initialMinOrderQty: it.initialMinOrderQty === "" ? null : Number(it.initialMinOrderQty),
          initialNotes: it.initialNotes || null,
        })),
      };
      const row = await fetchJsonOk<PurchaseQuotationDetail>(
        `/api/purchase-quotations/${detail.id}/suppliers/${supplier.id}/offer`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      setDetail(row);
      return row;
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao salvar oferta.");
      return null;
    } finally {
      if (manageBusy) setBusy(false);
    }
  };

  const markReceived = async (supplier: PurchaseQuotationSupplierRow) => {
    if (!detail) return;
    setBusy(true);
    try {
      const saved = await saveOffer(supplier, { manageBusy: false });
      if (!saved) return;
      const updatedSupplier = saved.suppliers.find((s) => s.id === supplier.id);
      const offer = updatedSupplier?.offers[0];
      if (!offer) {
        alert("Salve a oferta antes de registrar a proposta recebida.");
        return;
      }
      const row = await fetchJsonOk<PurchaseQuotationDetail>(
        `/api/purchase-quotations/${detail.id}/offers/${offer.id}/mark-received`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      setDetail(row);
      const drafts: Record<string, OfferDraft> = {};
      for (const s of row.suppliers) {
        drafts[s.id] = emptyOfferDraft(row.items, s.offers[0] ?? null, row.currency);
      }
      setOfferDrafts(drafts);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao registrar proposta.");
    } finally {
      setBusy(false);
    }
  };

  const updateDraft = (supplierIdKey: string, patch: Partial<OfferDraft>) => {
    setOfferDrafts((prev) => ({
      ...prev,
      [supplierIdKey]: { ...prev[supplierIdKey], ...patch },
    }));
  };

  const updateDraftItem = (
    supplierIdKey: string,
    quotationItemId: string,
    patch: Partial<OfferItemDraft>
  ) => {
    setOfferDrafts((prev) => {
      const cur = prev[supplierIdKey];
      if (!cur) return prev;
      return {
        ...prev,
        [supplierIdKey]: {
          ...cur,
          items: cur.items.map((it) =>
            it.quotationItemId === quotationItemId ? { ...it, ...patch } : it
          ),
        },
      };
    });
  };

  if (!allowView) {
    return <p className="text-sm text-muted-foreground">Sem permissão para ver cotações.</p>;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando…
      </div>
    );
  }

  if (!quotationId) {
    return (
      <div className="space-y-4" data-testid="purchase-quotations-list">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold">Cotações por fornecedor</h3>
            <p className="text-sm text-muted-foreground">
              Coleta de propostas iniciais. Sem escolha de vencedor nesta fase.
            </p>
          </div>
          <Link to="/purchases" className="text-sm text-primary hover:underline">
            Voltar às solicitações
          </Link>
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma cotação. Encaminhe uma solicitação aprovada para cotação.
          </p>
        ) : (
          <div className="rounded-2xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Código</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">SC</th>
                  <th className="p-3">Fornecedores</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {list.map((q) => (
                  <tr key={q.id} className="border-t border-border hover:bg-accent/20">
                    <td className="p-3 font-mono">{q.code}</td>
                    <td className="p-3">{PURCHASE_QUOTATION_STATUS_LABEL[q.status]}</td>
                    <td className="p-3">
                      {q.purchaseRequest ? `#${q.purchaseRequest.number}` : "—"}
                    </td>
                    <td className="p-3">{q._count?.suppliers ?? 0}</td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => navigate(`/purchases/quotations/${q.id}`)}
                      >
                        Abrir
                      </button>
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

  if (!detail) return null;

  return (
    <div className="space-y-6" data-testid="purchase-quotation-detail">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button
            type="button"
            onClick={() => navigate("/purchases/quotations")}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Lista de cotações
          </button>
          <h3 className="text-lg font-semibold font-mono">{detail.code}</h3>
          <p className="text-sm text-muted-foreground">
            {PURCHASE_QUOTATION_STATUS_LABEL[detail.status]}
            {detail.purchaseRequest
              ? ` · SC #${detail.purchaseRequest.number}`
              : ""}
          </p>
        </div>
        {allowEdit && detail.status !== "CANCELADA" && detail.status !== "ADJUDICADA" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveMeta()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar cabeçalho
          </button>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Título">
          <input
            className={inputCls(!allowEdit)}
            disabled={!allowEdit}
            value={meta.title}
            onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))}
          />
        </Field>
        <Field label="Moeda">
          <input
            className={inputCls(!allowEdit)}
            disabled={!allowEdit}
            value={meta.currency}
            onChange={(e) => setMeta((m) => ({ ...m, currency: e.target.value }))}
          />
        </Field>
        <Field label="Validade da cotação">
          <input
            type="date"
            className={inputCls(!allowEdit)}
            disabled={!allowEdit}
            value={meta.expiresAt}
            onChange={(e) => setMeta((m) => ({ ...m, expiresAt: e.target.value }))}
          />
        </Field>
        <Field label="Observações">
          <textarea
            rows={2}
            className={inputCls(!allowEdit)}
            disabled={!allowEdit}
            value={meta.notes}
            onChange={(e) => setMeta((m) => ({ ...m, notes: e.target.value }))}
          />
        </Field>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Itens da demanda
        </h4>
        <ul className="space-y-2 text-sm">
          {detail.items.map((it) => (
            <li key={it.id} className="border-b border-border/50 pb-2">
              <span className="font-mono text-xs text-muted-foreground">#{it.lineNumber}</span>{" "}
              {it.materialCodeSnapshot ? `${it.materialCodeSnapshot} — ` : ""}
              {it.description} · {numStr(it.quantity)} {it.unit}
            </li>
          ))}
        </ul>
      </div>

      {allowEdit && detail.status !== "CANCELADA" && detail.status !== "ADJUDICADA" ? (
        <div className="rounded-2xl border border-border bg-card p-6 space-y-3" data-testid="invite-supplier">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Convidar fornecedor oficial
          </h4>
          <div className="flex flex-col md:flex-row gap-3 items-end">
            <div className="flex-1 w-full">
              <SearchableSelect
                options={supplierOptions}
                value={supplierId}
                onChange={setSupplierId}
                placeholder="Buscar fornecedor oficial…"
                remoteSearch
                onSearchTermChange={(q) => void loadSuppliers(q)}
              />
            </div>
            <button
              type="button"
              disabled={busy || !supplierId}
              onClick={() => void inviteSupplier()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Convidar
            </button>
          </div>
        </div>
      ) : null}

      {detail.suppliers.map((supplier) => {
        const offer = supplier.offers[0] ?? null;
        const locked = !canEditInitialOffer({
          offerStatus: offer?.status ?? "RASCUNHO",
          negotiationStarted,
        });
        const draft = offerDrafts[supplier.id];
        if (!draft) return null;
        return (
          <div
            key={supplier.id}
            className="rounded-2xl border border-border bg-card p-6 space-y-4"
            data-testid={`supplier-offer-${supplier.id}`}
          >
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <h4 className="font-semibold">{supplier.supplierDisplayNameSnapshot}</h4>
                <p className="text-xs text-muted-foreground">
                  {supplier.supplierDocumentSnapshot || "sem documento"} · {supplier.status}
                  {offer?.proposalReceived ? " · proposta recebida" : ""}
                  {locked ? " · oferta inicial congelada" : ""}
                </p>
              </div>
              {allowEdit && !locked ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveOffer(supplier)}
                    className="px-3 py-1.5 rounded-lg text-sm border border-border disabled:opacity-50"
                  >
                    Salvar oferta
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void markReceived(supplier)}
                    className="px-3 py-1.5 rounded-lg text-sm bg-emerald-700 text-white disabled:opacity-50"
                  >
                    Registrar proposta recebida
                  </button>
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Moeda">
                <input
                  disabled={locked || !allowEdit}
                  className={inputCls(locked || !allowEdit)}
                  value={draft.currency}
                  onChange={(e) => updateDraft(supplier.id, { currency: e.target.value })}
                />
              </Field>
              <Field label="Condição de pagamento">
                <input
                  disabled={locked || !allowEdit}
                  className={inputCls(locked || !allowEdit)}
                  value={draft.initialPaymentTerms}
                  onChange={(e) => updateDraft(supplier.id, { initialPaymentTerms: e.target.value })}
                />
              </Field>
              <Field label="Prazo / entrega">
                <input
                  disabled={locked || !allowEdit}
                  className={inputCls(locked || !allowEdit)}
                  value={draft.initialDeliveryTerms}
                  onChange={(e) => updateDraft(supplier.id, { initialDeliveryTerms: e.target.value })}
                />
              </Field>
              <Field label="Frete (cabeçalho)">
                <input
                  type="number"
                  step="any"
                  disabled={locked || !allowEdit}
                  className={inputCls(locked || !allowEdit)}
                  value={draft.initialFreightValue}
                  onChange={(e) => updateDraft(supplier.id, { initialFreightValue: e.target.value })}
                />
              </Field>
              <Field label="Impostos não recuperáveis">
                <input
                  type="number"
                  step="any"
                  disabled={locked || !allowEdit}
                  className={inputCls(locked || !allowEdit)}
                  value={draft.initialNonRecoverableTaxes}
                  onChange={(e) =>
                    updateDraft(supplier.id, { initialNonRecoverableTaxes: e.target.value })
                  }
                />
              </Field>
              <Field label="Despesas">
                <input
                  type="number"
                  step="any"
                  disabled={locked || !allowEdit}
                  className={inputCls(locked || !allowEdit)}
                  value={draft.initialExpenses}
                  onChange={(e) => updateDraft(supplier.id, { initialExpenses: e.target.value })}
                />
              </Field>
              <Field label="Descontos">
                <input
                  type="number"
                  step="any"
                  disabled={locked || !allowEdit}
                  className={inputCls(locked || !allowEdit)}
                  value={draft.initialDiscounts}
                  onChange={(e) => updateDraft(supplier.id, { initialDiscounts: e.target.value })}
                />
              </Field>
              <Field label="Lote mínimo (MOQ)">
                <input
                  type="number"
                  step="any"
                  disabled={locked || !allowEdit}
                  className={inputCls(locked || !allowEdit)}
                  value={draft.initialMinOrderQty}
                  onChange={(e) => updateDraft(supplier.id, { initialMinOrderQty: e.target.value })}
                />
              </Field>
              <Field label="Validade da proposta">
                <input
                  type="date"
                  disabled={locked || !allowEdit}
                  className={inputCls(locked || !allowEdit)}
                  value={draft.initialValidityDate}
                  onChange={(e) => updateDraft(supplier.id, { initialValidityDate: e.target.value })}
                />
              </Field>
              <Field label="Lead time (dias)">
                <input
                  type="number"
                  disabled={locked || !allowEdit}
                  className={inputCls(locked || !allowEdit)}
                  value={draft.initialLeadTimeDays}
                  onChange={(e) => updateDraft(supplier.id, { initialLeadTimeDays: e.target.value })}
                />
              </Field>
              <Field label="Observações">
                <input
                  disabled={locked || !allowEdit}
                  className={inputCls(locked || !allowEdit)}
                  value={draft.notes}
                  onChange={(e) => updateDraft(supplier.id, { notes: e.target.value })}
                />
              </Field>
            </div>

            <div className="space-y-4">
              <h5 className="text-xs font-bold uppercase text-muted-foreground">Itens da oferta</h5>
              {draft.items.map((it) => {
                const demand = detail.items.find((d) => d.id === it.quotationItemId);
                return (
                  <div
                    key={it.quotationItemId}
                    className="rounded-xl border border-border/70 bg-accent/10 p-4 grid grid-cols-1 md:grid-cols-3 gap-3"
                  >
                    <div className="md:col-span-3 text-sm font-medium">
                      {demand
                        ? `#${demand.lineNumber} ${demand.description} (${numStr(demand.quantity)} ${demand.unit})`
                        : it.quotationItemId}
                    </div>
                    <Field label="Preço unitário inicial *">
                      <input
                        type="number"
                        step="any"
                        disabled={locked || !allowEdit}
                        className={inputCls(locked || !allowEdit)}
                        value={it.initialUnitPrice}
                        onChange={(e) =>
                          updateDraftItem(supplier.id, it.quotationItemId, {
                            initialUnitPrice: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Quantidade">
                      <input
                        type="number"
                        step="any"
                        disabled={locked || !allowEdit}
                        className={inputCls(locked || !allowEdit)}
                        value={it.initialQuantity}
                        onChange={(e) =>
                          updateDraftItem(supplier.id, it.quotationItemId, {
                            initialQuantity: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Frete (item)">
                      <input
                        type="number"
                        step="any"
                        disabled={locked || !allowEdit}
                        className={inputCls(locked || !allowEdit)}
                        value={it.initialFreightValue}
                        onChange={(e) =>
                          updateDraftItem(supplier.id, it.quotationItemId, {
                            initialFreightValue: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Impostos não recuperáveis">
                      <input
                        type="number"
                        step="any"
                        disabled={locked || !allowEdit}
                        className={inputCls(locked || !allowEdit)}
                        value={it.initialNonRecoverableTaxes}
                        onChange={(e) =>
                          updateDraftItem(supplier.id, it.quotationItemId, {
                            initialNonRecoverableTaxes: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Despesas">
                      <input
                        type="number"
                        step="any"
                        disabled={locked || !allowEdit}
                        className={inputCls(locked || !allowEdit)}
                        value={it.initialExpenses}
                        onChange={(e) =>
                          updateDraftItem(supplier.id, it.quotationItemId, {
                            initialExpenses: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Descontos">
                      <input
                        type="number"
                        step="any"
                        disabled={locked || !allowEdit}
                        className={inputCls(locked || !allowEdit)}
                        value={it.initialDiscounts}
                        onChange={(e) =>
                          updateDraftItem(supplier.id, it.quotationItemId, {
                            initialDiscounts: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="MOQ">
                      <input
                        type="number"
                        step="any"
                        disabled={locked || !allowEdit}
                        className={inputCls(locked || !allowEdit)}
                        value={it.initialMinOrderQty}
                        onChange={(e) =>
                          updateDraftItem(supplier.id, it.quotationItemId, {
                            initialMinOrderQty: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Lead time (dias)">
                      <input
                        type="number"
                        disabled={locked || !allowEdit}
                        className={inputCls(locked || !allowEdit)}
                        value={it.initialLeadTimeDays}
                        onChange={(e) =>
                          updateDraftItem(supplier.id, it.quotationItemId, {
                            initialLeadTimeDays: e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Observações do item">
                      <input
                        disabled={locked || !allowEdit}
                        className={inputCls(locked || !allowEdit)}
                        value={it.initialNotes}
                        onChange={(e) =>
                          updateDraftItem(supplier.id, it.quotationItemId, {
                            initialNotes: e.target.value,
                          })
                        }
                      />
                    </Field>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div
        className="rounded-2xl border border-border bg-card p-6 space-y-4"
        data-testid="negotiation-rounds-panel"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Rodadas de negociação
            </h4>
            <p className="text-sm text-muted-foreground mt-1">
              Histórico imutável. Prazo/pagamento/lote não entram como economia monetária.
            </p>
          </div>
          {allowEdit && !openRound && detail.status !== "CANCELADA" && detail.status !== "ADJUDICADA" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void openNegotiation()}
              className="px-3 py-1.5 rounded-lg text-sm bg-violet-700 text-white disabled:opacity-50"
            >
              Abrir rodada
            </button>
          ) : null}
        </div>

        <Field label="Relato do comprador">
          <textarea
            rows={2}
            disabled={!allowEdit}
            className={inputCls(!allowEdit)}
            value={buyerReport}
            onChange={(e) => setBuyerReport(e.target.value)}
            placeholder="Registro da rodada / responsável / contexto"
          />
        </Field>

        {openRound ? (
          <div className="rounded-xl border border-amber-300/50 bg-amber-500/10 p-4 space-y-3">
            <p className="text-sm font-medium">
              Rodada #{openRound.roundNumber} aberta
              {openRound.responsibleUserName ? ` · ${openRound.responsibleUserName}` : ""}
              {" · "}
              {new Date(openRound.openedAt).toLocaleString("pt-BR")}
            </p>
            <Field label="Incoterm do frete nesta rodada">
              <select
                className={inputCls(false)}
                value={negoFreightIncoterm}
                onChange={(e) => setNegoFreightIncoterm(e.target.value)}
              >
                <option value="FOB">FOB (frete no custo comparável)</option>
                <option value="CIF">CIF (frete não soma no custo do comprador)</option>
                <option value="OTHER">OTHER</option>
              </select>
            </Field>
            {detail.suppliers.map((supplier) => {
              const offer = supplier.offers[0];
              if (!offer || offer.status !== "RECEBIDA") return null;
              return (
                <div key={supplier.id} className="space-y-2 border-t border-border/50 pt-3">
                  <p className="text-sm font-medium">{supplier.supplierDisplayNameSnapshot}</p>
                  {offer.items.map((it) => (
                    <div key={it.id} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                      <div className="md:col-span-2 text-xs text-muted-foreground">
                        Item {it.quotationItem?.lineNumber ?? "—"} · inicial{" "}
                        {numStr(it.initialUnitPrice)}
                      </div>
                      <Field label="Novo preço unitário">
                        <input
                          type="number"
                          step="any"
                          className={inputCls(false)}
                          value={negoPrices[it.id] ?? ""}
                          onChange={(e) =>
                            setNegoPrices((prev) => ({ ...prev, [it.id]: e.target.value }))
                          }
                        />
                      </Field>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitRoundLines(offer.id, offer.items.map((i) => i.id))}
                    className="px-3 py-1.5 rounded-lg text-sm border border-border disabled:opacity-50"
                  >
                    Registrar linhas (append-only)
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              disabled={busy}
              onClick={() => void closeNegotiation()}
              className="px-3 py-1.5 rounded-lg text-sm bg-slate-900 text-white disabled:opacity-50"
            >
              Fechar rodada
            </button>
          </div>
        ) : null}

        {rounds.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma rodada registrada.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {rounds.map((r) => (
              <li key={r.id} className="border-b border-border/60 pb-3">
                <div className="font-medium">
                  Rodada #{r.roundNumber} · {r.status}
                  {r.responsibleUserName ? ` · ${r.responsibleUserName}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(r.openedAt).toLocaleString("pt-BR")}
                  {r.closedAt ? ` → ${new Date(r.closedAt).toLocaleString("pt-BR")}` : ""}
                </div>
                {r.buyerReport ? <p className="mt-1 text-xs">{r.buyerReport}</p> : null}
                <ul className="mt-2 space-y-1 text-xs">
                  {r.lines.map((l) => (
                    <li key={l.id}>
                      {numStr(l.previousUnitPrice)} → {numStr(l.unitPrice)}
                      {l.freightIncoterm ? ` · ${l.freightIncoterm}` : ""}
                      {l.paymentTerms ? ` · pagto ${l.paymentTerms}` : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-3" data-testid="negotiation-savings">
          <h5 className="text-xs font-bold uppercase text-muted-foreground">Ganho comparável</h5>
          {detail.suppliers.map((supplier) => {
            const offer = supplier.offers[0];
            if (!offer || offer.status !== "RECEBIDA") return null;
            const s = savingsMap[offer.id];
            return (
              <div key={offer.id} className="rounded-lg border border-border/70 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-medium">{supplier.supplierDisplayNameSnapshot}</span>
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={() => void refreshSavings(offer.id)}
                  >
                    Calcular ganho
                  </button>
                </div>
                {s ? (
                  <div className="text-xs space-y-1">
                    <div>
                      Custo inicial: {s.initialComparableCost.toFixed(2)} · negociado:{" "}
                      {s.negotiatedComparableCost.toFixed(2)}
                    </div>
                    <div>
                      Ganho total: {s.totalGain.toFixed(2)} · unitário:{" "}
                      {s.unitGain == null ? "—" : s.unitGain.toFixed(4)} · %:{" "}
                      {s.percentGain == null ? "—" : `${s.percentGain.toFixed(2)}%`}
                      {s.costIncreased ? " · custo aumentou" : ""}
                    </div>
                    {s.conditionGains.length > 0 ? (
                      <div>
                        Ganhos de condição (não monetizados):{" "}
                        {s.conditionGains.map((c) => c.label).join("; ")}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Ainda não calculado.</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
