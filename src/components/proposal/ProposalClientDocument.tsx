import React, { useMemo } from "react";
import type { Customer, Proposal, ProposalItem } from "@/src/types/commercial";
import type { BrandingSettingsDTO } from "@/src/types/branding";

/** Conteúdo único do PDF; cabeçalho/rodapé (URL, data) vêm do navegador — desmarcar "Cabeçalhos e rodapés" no diálogo de impressão para PDF limpo. */

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

export type ProposalClientDocumentTotals = {
  totalGross: number;
  totalDiscount: number;
  totalNet: number;
};

export type ProposalClientDocumentProps = {
  formData: Partial<Proposal>;
  resolvedCustomer: Customer | null;
  proposalNumber: number | null;
  totals: ProposalClientDocumentTotals;
  branding: BrandingSettingsDTO;
  /** Data de emissão já formatada (pt-BR). */
  issuedAt: string;
  /** id do título principal para acessibilidade */
  titleHeadingId?: string;
};

/**
 * Conteúdo visual único da proposta comercial para cliente (sem modal, sem botões).
 * Não renderiza custo, margem, comissão, tabela de preço, origem, UUID, JSON nem snapshots.
 */
export function ProposalClientDocument({
  formData,
  resolvedCustomer,
  proposalNumber,
  totals,
  branding: b,
  issuedAt,
  titleHeadingId = "proposal-client-doc-title",
}: ProposalClientDocumentProps) {
  const items = useMemo(
    () => (Array.isArray(formData.items) ? formData.items : []) as ProposalItem[],
    [formData.items],
  );

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

  const proposalLogoSrc =
    typeof b.proposalLogoDataUrl === "string" &&
    b.proposalLogoDataUrl.trim().length > 0 &&
    b.proposalLogoDataUrl.trim().toLowerCase().startsWith("data:image/")
      ? b.proposalLogoDataUrl.trim()
      : null;
  const sloganLine = nonEmpty(b.slogan);

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
    <article className="proposal-print-document proposal-print-sheet mx-auto w-full max-w-[1180px] rounded-xl border border-slate-200 bg-white shadow-md md:shadow-md">
      <div className="proposal-print-document-inner p-6 md:p-10">
        <header
          className="proposal-print-section border-b-2 border-slate-200 pb-6"
          style={{ borderBottomColor: b.primaryColor }}
        >
          <div className="mb-3">
            {proposalLogoSrc ? (
              <img
                src={proposalLogoSrc}
                alt={b.companyName}
                className="max-h-[72px] max-w-[260px] w-auto object-contain object-left"
              />
            ) : (
              <p
                className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-700"
                style={{ color: b.secondaryColor }}
              >
                {b.companyName}
              </p>
            )}
            {sloganLine ? <p className="mt-1.5 text-sm text-slate-600">{sloganLine}</p> : null}
          </div>
          <h1 id={titleHeadingId} className="text-2xl font-bold text-slate-900" style={{ color: b.primaryColor }}>
            Proposta Comercial
          </h1>
          {titleLine ? <p className="mt-1 text-sm text-slate-600">{titleLine}</p> : null}
          <div className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <p>
              <span className="font-semibold text-slate-800">Proposta: </span>
              {proposalNumber != null && Number.isFinite(proposalNumber)
                ? `nº ${proposalNumber}`
                : "rascunho (sem número ainda)"}
            </p>
            <p>
              <span className="font-semibold text-slate-800">Data de emissão: </span>
              {issuedAt || "—"}
            </p>
            <p className="sm:col-span-2">
              <span className="font-semibold text-slate-800">Validade: </span>
              {validityDays > 0 ? `${validityDays} dia(s)` : "—"}
            </p>
          </div>
        </header>

        <section className="proposal-print-section mt-8 space-y-4">
          <h2
            className="text-xs font-bold uppercase tracking-wider text-slate-500 border-l-4 pl-3"
            style={{ borderLeftColor: b.primaryColor }}
          >
            Cliente
          </h2>
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

        <section className="proposal-print-section mt-8 space-y-4">
          <h2
            className="text-xs font-bold uppercase tracking-wider text-slate-500 border-l-4 pl-3"
            style={{ borderLeftColor: b.primaryColor }}
          >
            Condições comerciais
          </h2>
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

        <section className="proposal-print-items-section mt-8">
          <h2
            className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 border-l-4 pl-3"
            style={{ borderLeftColor: b.primaryColor }}
          >
            Itens
          </h2>
          <div className="proposal-print-table-wrap overflow-x-auto rounded-lg border border-slate-200 print:overflow-visible">
            <table className="w-full min-w-0 border-collapse text-sm md:min-w-[720px]">
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
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
                      Nenhum item nesta proposta.
                    </td>
                  </tr>
                ) : null}
                {items.map((item, idx) => {
                  const qty = safeNum(item.quantity);
                  const unit = safeNum(item.negotiatedPrice);
                  const discPerc = safeNum(item.discountPerc);
                  const lineTotal = qty * unit - safeNum(item.discountValue);
                  const sku = nonEmpty(item.Product?.sku) ?? "—";
                  const desc = nonEmpty(item.Product?.name) ?? "—";
                  return (
                    <tr
                      key={item.id ?? `row-${idx}`}
                      className="proposal-print-table-row border-b border-slate-100 last:border-0"
                    >
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

        <section className="proposal-print-section mt-8 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <h2
            className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500 border-l-4 pl-3"
            style={{ borderLeftColor: b.primaryColor }}
          >
            Totais
          </h2>
          <div className="max-w-full space-y-2 text-sm text-slate-800 md:max-w-xl">
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
              <span className="font-mono tabular-nums" style={{ color: b.secondaryColor }}>
                {formatMoney(totals.totalNet)}
              </span>
            </div>
          </div>
        </section>

        <section className="proposal-print-section mt-8 space-y-3">
          <h2
            className="text-xs font-bold uppercase tracking-wider text-slate-500 border-l-4 pl-3"
            style={{ borderLeftColor: b.primaryColor }}
          >
            Observações
          </h2>
          <div className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">
            {notes ? <p className="whitespace-pre-wrap">{notes}</p> : <p className="text-slate-500">Sem observações adicionais.</p>}
            <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-slate-600">
              <li>Valores sujeitos às condições comerciais descritas nesta proposta.</li>
              <li>Proposta válida pelo prazo informado.</li>
            </ul>
          </div>
        </section>

        <footer className="proposal-print-section mt-10 border-t border-slate-200 pt-6 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">Assinatura / identificação</p>
          <p className="mt-2">
            <span className="text-slate-600">Responsável comercial: </span>
            {responsible ?? "—"}
          </p>
          <p className="mt-1">
            <span className="text-slate-600">Empresa: </span>
            {companyIssuer ?? b.companyName}
          </p>
        </footer>
      </div>
    </article>
  );
}
