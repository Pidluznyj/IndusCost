import React, { useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { fetchOk } from "@/src/lib/http";
import {
  calculateMaterialMarketQuoteNetPrice,
  DEFAULT_MATERIAL_MARKET_QUOTE_CURRENCY,
} from "@/src/lib/materialMarketQuote";
import { getMaterialMarketIntelligenceQuotesApiPath } from "@/src/lib/materialsNavigation";
import { formatCurrency } from "@/src/lib/utils";

export type MaterialMarketQuoteFormValues = {
  supplierName: string;
  quoteDate: string;
  price: string;
  currency: string;
  unit: string;
  origin: string;
  manufacturer: string;
  freightValue: string;
  taxValue: string;
  paymentTerms: string;
  proposalValidityDate: string;
  notes: string;
};

type Props = {
  materialId: string;
  defaultUnit: string;
  onCreated: () => void;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(defaultUnit: string): MaterialMarketQuoteFormValues {
  return {
    supplierName: "",
    quoteDate: todayIsoDate(),
    price: "",
    currency: DEFAULT_MATERIAL_MARKET_QUOTE_CURRENCY,
    unit: defaultUnit,
    origin: "",
    manufacturer: "",
    freightValue: "",
    taxValue: "",
    paymentTerms: "",
    proposalValidityDate: "",
    notes: "",
  };
}

export function MaterialIntelligenceMarketQuoteForm({
  materialId,
  defaultUnit,
  onCreated,
}: Props) {
  const [form, setForm] = useState<MaterialMarketQuoteFormValues>(() => emptyForm(defaultUnit));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const previewNetPrice = useMemo(() => {
    const price = Number(form.price);
    if (!Number.isFinite(price)) return null;
    const freight = form.freightValue.trim() ? Number(form.freightValue) : null;
    const tax = form.taxValue.trim() ? Number(form.taxValue) : null;
    return calculateMaterialMarketQuoteNetPrice({
      price,
      freightValue: Number.isFinite(freight ?? NaN) ? freight : null,
      taxValue: Number.isFinite(tax ?? NaN) ? tax : null,
    });
  }, [form.price, form.freightValue, form.taxValue]);

  const update = (patch: Partial<MaterialMarketQuoteFormValues>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await fetchOk(getMaterialMarketIntelligenceQuotesApiPath(materialId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierName: form.supplierName.trim(),
          quoteDate: form.quoteDate,
          price: Number(form.price),
          currency: form.currency.trim(),
          unit: form.unit.trim(),
          origin: form.origin.trim() || null,
          manufacturer: form.manufacturer.trim() || null,
          freightValue: form.freightValue.trim() ? Number(form.freightValue) : null,
          taxValue: form.taxValue.trim() ? Number(form.taxValue) : null,
          paymentTerms: form.paymentTerms.trim() || null,
          proposalValidityDate: form.proposalValidityDate.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });
      setForm(emptyForm(defaultUnit));
      setExpanded(false);
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar a cotação.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="rounded-lg border border-border bg-accent/10 p-4 space-y-3"
      data-testid="material-intelligence-market-quote-form-panel"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Registrar cotação manual</p>
          <p className="text-xs text-muted-foreground">
            Cada registro cria um novo histórico — nunca sobrescreve cotações anteriores.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-accent"
          data-testid="material-intelligence-market-quote-form-toggle"
        >
          <Plus className="h-3.5 w-3.5" />
          {expanded ? "Fechar" : "Nova cotação"}
        </button>
      </div>

      {expanded ? (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-medium">Fornecedor *</span>
              <input
                value={form.supplierName}
                onChange={(e) => update({ supplierName: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
                placeholder="Nome do fornecedor"
                required
                data-testid="material-market-quote-supplier-name"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Data da cotação *</span>
              <input
                type="date"
                value={form.quoteDate}
                onChange={(e) => update({ quoteDate: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
                required
                data-testid="material-market-quote-date"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Preço base *</span>
              <input
                type="number"
                min={0}
                step="0.000001"
                value={form.price}
                onChange={(e) => update({ price: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
                required
                data-testid="material-market-quote-price"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Moeda</span>
              <input
                value={form.currency}
                onChange={(e) => update({ currency: e.target.value.toUpperCase() })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
                data-testid="material-market-quote-currency"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Unidade *</span>
              <input
                value={form.unit}
                onChange={(e) => update({ unit: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
                required
                data-testid="material-market-quote-unit"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Frete</span>
              <input
                type="number"
                min={0}
                step="0.000001"
                value={form.freightValue}
                onChange={(e) => update({ freightValue: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
                data-testid="material-market-quote-freight"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Impostos</span>
              <input
                type="number"
                min={0}
                step="0.000001"
                value={form.taxValue}
                onChange={(e) => update({ taxValue: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
                data-testid="material-market-quote-tax"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Origem</span>
              <input
                value={form.origin}
                onChange={(e) => update({ origin: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Fabricante</span>
              <input
                value={form.manufacturer}
                onChange={(e) => update({ manufacturer: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-medium">Condições de pagamento</span>
              <input
                value={form.paymentTerms}
                onChange={(e) => update({ paymentTerms: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Validade da proposta</span>
              <input
                type="date"
                value={form.proposalValidityDate}
                onChange={(e) => update({ proposalValidityDate: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-medium">Observações</span>
              <textarea
                value={form.notes}
                onChange={(e) => update({ notes: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
          </div>

          {previewNetPrice != null ? (
            <p className="text-sm text-muted-foreground" data-testid="material-market-quote-net-preview">
              Preço líquido calculado:{" "}
              <span className="font-semibold text-foreground">
                {formatCurrency(previewNetPrice)}
              </span>
            </p>
          ) : null}

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            data-testid="material-market-quote-submit"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Registrar cotação
          </button>
        </form>
      ) : null}
    </div>
  );
}
