import React, { useEffect, useMemo, useState } from "react";
import { Printer, X } from "lucide-react";
import type { Customer, Proposal, ProposalItem } from "@/src/types/commercial";

function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatMoney(value: unknown): string {
  const n = safeNum(value);
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: unknown): string {
  const n = safeNum(value);
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function formatQty(value: unknown): string {
  const n = safeNum(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function nonEmpty(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

export type ProposalClientPreviewTotals = {
  totalGross: number;
  totalDiscount: number;
  totalNet: number;
};

export type ProposalClientPreviewProps = {
  open: boolean;
  onClose: () => void;
  formData: Partial<Proposal>;
  resolvedCustomer: Customer | null;
  /** Número da proposta quando já persistida; null em rascunho novo. */
  proposalNumber: number | null;
  totals: ProposalClientPreviewTotals;
};

/**
 * Pré-visualização comercial da proposta para envio ao cliente.
 * Não exibe custos, margens, comissões, tabelas, snapshots nem identificadores técnicos.
 */
export function ProposalClientPreview({
  open,
  onClose,
  formData,
  resolvedCustomer,
  proposalNumber,
  totals,
}: ProposalClientPreviewProps) {
  const [emissionDate, setEmissionDate] = useState("");

  useEffect(() => {
    if (open) {
      setEmissionDate(new Date().toLocaleDateString("pt-BR"));
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  /** Na impressão, oculta o restante da aplicação e mantém só este painel (modal = .proposal-print-page). */
  useEffect(() => {
    if (!open) return;
    const style = document.createElement("style");
    style.setAttribute("data-proposal-client-preview-print", "1");
    style.textContent = `@media print {
      #root, #root * { visibility: hidden !important; }
      .proposal-print-page,
      .proposal-print-page * { visibility: visible !important; }
      .proposal-print-page {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        height: auto !important;
        overflow: visible !important;
        background: #fff !important;
      }
    }`;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [open]);

  const items = useMemo(() => (Array.isArray(formData.items) ? formData.items : []) as ProposalItem[], [formData.items]);

  const customerBlock = useMemo(() => {
    if (!resolvedCustomer) {
      return { name: "—", tax: null as string | null, addressLines: [] as string[] };
    }
    const name =
      nonEmpty(resolvedCustomer.companyName) ||
      nonEmpty(resolvedCustomer.tradeName) ||
      "—";
    const tax = nonEmpty(resolvedCustomer.taxId);
    const lines: string[] = [];
    const addr = nonEmpty(resolvedCustomer.address);
    const city = nonEmpty(resolvedCustomer.city);
    const st = nonEmpty(resolvedCustomer.state);
    const zip = nonEmpty(resolvedCustomer.zipCode);
    if (addr) lines.push(addr);
    const locParts = [city, st].filter(Boolean);
    if (locParts.length > 0) lines.push(locParts.join(" / "));
    if (zip) lines.push(`CEP: ${zip}`);
    return { name, tax, addressLines: lines };
  }, [resolvedCustomer]);

  const freightLabel = useMemo(() => {
    const fc = nonEmpty(formData.freightCondition) ?? "";
    if (fc === "CIF") return "CIF (frete por conta do emitente)";
    if (fc === "FOB") return "FOB (frete por conta do destinatário)";
    return fc || "—";
  }, [formData.freightCondition]);

  if (!open) return null;

  const validityDays = safeNum(formData.validityDays, 15);
  const paymentTerms = nonEmpty(formData.paymentTerms);
  const paymentMethod = nonEmpty(formData.paymentMethod);
  const deliveryDays = formData.deliveryTimeDays;
  const deliveryLocation = nonEmpty(formData.deliveryLocation);
  const notes = nonEmpty(formData.notes);
  const responsible = nonEmpty(formData.responsible);
  const companyIssuer = nonEmpty(formData.companyIssuer);
  const titleLine = nonEmpty(formData.title);

  return (
    <div
      className="proposal-print-page fixed inset-0 z-[100] flex flex-col overflow-hidden bg-slate-200/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proposal-client-preview-title"
    >
      <div className="proposal-print-no-print shrink-0 border-b border-border bg-card px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-accent"
            >
              <X className="h-4 w-4" aria-hidden />
              Voltar para edição
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90"
            >
              <Printer className="h-4 w-4" aria-hidden />
              Imprimir / Salvar PDF
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Somente visualização — não altera a proposta.</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <article className="proposal-print-sheet proposal-print-break mx-auto max-w-[210mm] rounded-xl border border-slate-200 bg-white p-8 shadow-md">
          <header className="proposal-print-break border-b border-slate-200 pb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Lazarios Koppetel</p>
            <h1 id="proposal-client-preview-title" className="mt-2 text-2xl font-bold text-slate-900">
              Proposta Comercial
            </h1>
            {titleLine ? <p className="mt-1 text-sm text-slate-600">{titleLine}</p> : null}
            <div className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
              <p>
                <span className="font-semibold text-slate-800">Proposta: </span>
                {proposalNumber != null && Number.isFinite(proposalNumber) ? `nº ${proposalNumber}` : "rascunho (sem número ainda)"}
              </p>
              <p>
                <span className="font-semibold text-slate-800">Data de emissão: </span>
                {emissionDate || "—"}
              </p>
              <p className="sm:col-span-2">
                <span className="font-semibold text-slate-800">Validade: </span>
                {validityDays > 0 ? `${validityDays} dia(s)` : "—"}
              </p>
            </div>
          </header>

          <section className="proposal-print-break mt-8 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Cliente</h2>
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-800">
              <p className="text-base font-semibold text-slate-900">{customerBlock.name}</p>
              {customerBlock.tax ? <p className="mt-1">CNPJ / CPF: {customerBlock.tax}</p> : null}
              {customerBlock.addressLines.length > 0 ? (
                <div className="mt-2 space-y-0.5 text-slate-700">
                  {customerBlock.addressLines.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section className="proposal-print-break mt-8 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Condições comerciais</h2>
            <div className="grid gap-3 rounded-lg border border-slate-200 p-4 text-sm text-slate-800 sm:grid-cols-2">
              <p>
                <span className="font-semibold">Condição de pagamento: </span>
                {paymentTerms ?? "—"}
              </p>
              <p>
                <span className="font-semibold">Forma de pagamento: </span>
                {paymentMethod ?? "—"}
              </p>
              <p>
                <span className="font-semibold">Frete: </span>
                {freightLabel}
              </p>
              <p>
                <span className="font-semibold">Prazo de entrega: </span>
                {deliveryDays != null && Number.isFinite(Number(deliveryDays)) && Number(deliveryDays) > 0
                  ? `${Number(deliveryDays)} dia(s)`
                  : "—"}
              </p>
              <p className="sm:col-span-2">
                <span className="font-semibold">Local de entrega: </span>
                {deliveryLocation ?? "—"}
              </p>
            </div>
          </section>

          <section className="proposal-print-break mt-8">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Itens</h2>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-700">
                    <th className="px-3 py-2 font-semibold">Item</th>
                    <th className="px-3 py-2 font-semibold">Código</th>
                    <th className="px-3 py-2 font-semibold">Descrição</th>
                    <th className="px-3 py-2 text-right font-semibold">Qtd.</th>
                    <th className="px-3 py-2 text-right font-semibold">Valor unit.</th>
                    <th className="px-3 py-2 text-right font-semibold">Desc. %</th>
                    <th className="px-3 py-2 text-right font-semibold">Valor total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const qty = safeNum(item.quantity);
                    const unit = safeNum(item.negotiatedPrice);
                    const discPerc = safeNum(item.discountPerc);
                    const lineTotal = qty * unit - safeNum(item.discountValue);
                    const sku = nonEmpty(item.Product?.sku) ?? "—";
                    const desc = nonEmpty(item.Product?.name) ?? "—";
                    return (
                      <tr key={item.id ?? `row-${idx}`} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-2 text-slate-600">{idx + 1}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-800">{sku}</td>
                        <td className="px-3 py-2 text-slate-800">{desc}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatQty(qty)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(unit)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatPercent(discPerc)}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-slate-900">
                          {formatMoney(lineTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="proposal-print-break mt-8 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Totais</h2>
            <div className="max-w-md space-y-2 text-sm text-slate-800">
              <div className="flex justify-between gap-4">
                <span>Subtotal (valor bruto)</span>
                <span className="font-mono font-medium tabular-nums">{formatMoney(totals.totalGross)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Descontos concedidos</span>
                <span className="font-mono font-medium tabular-nums text-red-700">−{formatMoney(totals.totalDiscount)}</span>
              </div>
              <div className="flex justify-between gap-4 border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
                <span>Valor total da proposta</span>
                <span className="font-mono tabular-nums">{formatMoney(totals.totalNet)}</span>
              </div>
            </div>
          </section>

          <section className="proposal-print-break mt-8 space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Observações</h2>
            <div className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
              {notes ? <p className="whitespace-pre-wrap">{notes}</p> : <p className="text-slate-500">Sem observações adicionais.</p>}
              <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-slate-600">
                <li>Valores sujeitos às condições comerciais descritas nesta proposta.</li>
                <li>Proposta válida pelo prazo informado.</li>
              </ul>
            </div>
          </section>

          <footer className="proposal-print-break mt-10 border-t border-slate-200 pt-6 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Assinatura / identificação</p>
            <p className="mt-2">
              <span className="text-slate-600">Responsável comercial: </span>
              {responsible ?? "—"}
            </p>
            <p className="mt-1">
              <span className="text-slate-600">Empresa: </span>
              {companyIssuer ?? "Lazarios Koppetel"}
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}
