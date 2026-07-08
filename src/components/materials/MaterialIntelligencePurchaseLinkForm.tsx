import React, { useMemo, useState } from "react";
import { Link2, Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { MaterialMarketQuoteApiItem } from "@/src/lib/materialMarketQuote";
import type { MaterialMarketPurchaseLinkApiItem } from "@/src/lib/materialMarketPurchaseLink";
import {
  computeMaterialMarketPurchaseEstimatedSavings,
  MATERIAL_MARKET_PURCHASE_SAVINGS_FORMULA,
} from "@/src/lib/materialMarketPurchaseLink";
import { getMaterialMarketIntelligencePurchaseLinksApiPath } from "@/src/lib/materialsNavigation";
import { formatCurrency } from "@/src/lib/utils";

type Props = {
  materialId: string;
  quote: MaterialMarketQuoteApiItem;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolvePreviewReference(quote: MaterialMarketQuoteApiItem): number | null {
  if (quote.netPriceBrl != null && Number(quote.netPriceBrl) > 0) {
    return Number(quote.netPriceBrl);
  }
  if (quote.currency.trim().toUpperCase() === "BRL" && Number(quote.netPrice) > 0) {
    return Number(quote.netPrice);
  }
  return null;
}

export function MaterialIntelligencePurchaseLinkForm({
  materialId,
  quote,
  open,
  onClose,
  onCreated,
}: Props) {
  const [supplierName, setSupplierName] = useState(quote.supplierName ?? "");
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [quantityPurchased, setQuantityPurchased] = useState("1");
  const [negotiatedPrice, setNegotiatedPrice] = useState(
    String(quote.netPriceBrl ?? quote.netPrice ?? "")
  );
  const [purchaseDate, setPurchaseDate] = useState(todayIsoDate());
  const [choiceReason, setChoiceReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewSavings = useMemo(() => {
    const qty = Number(quantityPurchased);
    const neg = Number(negotiatedPrice);
    const ref = resolvePreviewReference(quote);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(neg) || neg < 0 || ref == null) {
      return null;
    }
    return computeMaterialMarketPurchaseEstimatedSavings({
      referenceUnitPriceBrl: ref,
      negotiatedPrice: neg,
      quantityPurchased: qty,
    });
  }, [negotiatedPrice, quantityPurchased, quote]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await fetchJsonOk<MaterialMarketPurchaseLinkApiItem>(
        getMaterialMarketIntelligencePurchaseLinksApiPath(materialId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quoteId: quote.id,
            supplierName,
            purchaseOrderNumber: purchaseOrderNumber.trim() || undefined,
            purchaseOrderId: purchaseOrderId.trim() || undefined,
            quantityPurchased: Number(quantityPurchased),
            negotiatedPrice: Number(negotiatedPrice),
            purchaseDate,
            choiceReason: choiceReason.trim() || undefined,
          }),
        }
      );
      onCreated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Não foi possível vincular a compra.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-3"
      data-testid={`material-market-purchase-link-form-${quote.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">Vincular compra à cotação</p>
        <button type="button" className="rounded p-1 text-muted-foreground hover:bg-accent" onClick={onClose} aria-label="Fechar">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Registro manual — sem dependência de pedido de compra formal. Economia:{" "}
        <code className="text-[10px]">{MATERIAL_MARKET_PURCHASE_SAVINGS_FORMULA}</code>
      </p>
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => void handleSubmit(e)}>
        <label className="block text-[11px] font-semibold sm:col-span-2">
          Fornecedor *
          <input className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} required data-testid="material-market-purchase-link-supplier" />
        </label>
        <label className="block text-[11px] font-semibold">
          Nº pedido de compra
          <input className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs" value={purchaseOrderNumber} onChange={(e) => setPurchaseOrderNumber(e.target.value)} placeholder="Opcional (manual)" data-testid="material-market-purchase-link-po-number" />
        </label>
        <label className="block text-[11px] font-semibold">
          ID pedido (UUID opcional)
          <input className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs" value={purchaseOrderId} onChange={(e) => setPurchaseOrderId(e.target.value)} placeholder="Sem FK formal" data-testid="material-market-purchase-link-po-id" />
        </label>
        <label className="block text-[11px] font-semibold">
          Quantidade *
          <input type="number" min="0" step="any" className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs" value={quantityPurchased} onChange={(e) => setQuantityPurchased(e.target.value)} required data-testid="material-market-purchase-link-qty" />
        </label>
        <label className="block text-[11px] font-semibold">
          Preço negociado (BRL) *
          <input type="number" min="0" step="any" className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs" value={negotiatedPrice} onChange={(e) => setNegotiatedPrice(e.target.value)} required data-testid="material-market-purchase-link-price" />
        </label>
        <label className="block text-[11px] font-semibold">
          Data da compra *
          <input type="date" className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required data-testid="material-market-purchase-link-date" />
        </label>
        <label className="block text-[11px] font-semibold sm:col-span-2">
          Motivo da escolha
          <textarea className="mt-1 w-full min-h-[64px] rounded border border-border bg-background px-2 py-1.5 text-xs" value={choiceReason} onChange={(e) => setChoiceReason(e.target.value)} placeholder="Por que esta cotação/fornecedor foi escolhida…" data-testid="material-market-purchase-link-reason" />
        </label>
        {previewSavings ? (
          <p className={`sm:col-span-2 text-xs font-semibold ${previewSavings.hasSavings ? "text-emerald-800" : "text-muted-foreground"}`} data-testid="material-market-purchase-link-savings-preview">
            Economia estimada: {formatCurrency(previewSavings.estimatedSavings)} BRL
            {previewSavings.hasSavings ? "" : " (sem economia positiva)"}
          </p>
        ) : null}
        {error ? (
          <p className="sm:col-span-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-900">{error}</p>
        ) : null}
        <div className="sm:col-span-2 flex gap-2">
          <button type="submit" disabled={submitting} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60" data-testid="material-market-purchase-link-submit">
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
            Salvar vínculo
          </button>
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
