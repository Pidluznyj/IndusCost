import React, { useMemo } from "react";
import type { Customer, Proposal, ProposalItem } from "@/src/types/commercial";
import type { BrandingSettingsDTO } from "@/src/types/branding";

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

/** Número de item no padrão 00010, 00020… (referência comercial). */
function formatItemLineNo(index: number): string {
  return String((index + 1) * 10).padStart(5, "0");
}

/**
 * Fallback institucional (dados da Lazarios/Koppetel) até existir configuração
 * estruturada de endereço/CNPJ/contato no branding — não persiste em banco.
 */
const COMPANY_DOC_FALLBACK = {
  taxId: "14.055.501/0001-80",
  addressLine: "Rua Carlos Essenfelder, Boqueirão, Curitiba - PR, CEP 81730-060",
  email: "paulo@grupolazarios.com.br",
} as const;

/** Unidade comercial quando o item não traz unidade — apenas rótulo visual. */
function formatProposalUnit(unit?: string | null): string {
  const normalized = String(unit ?? "").trim().toUpperCase();
  if (!normalized) return "PC";
  if (["PEÇA", "PECA", "PÇ", "PCA"].includes(normalized)) return "PC";
  return normalized;
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

function CompactSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="proposal-compact-section-title mt-5 border-t border-slate-300 pt-2 text-[11px] font-bold uppercase tracking-wide text-slate-700 first:mt-0 first:border-t-0 first:pt-0">
      {children}
    </h2>
  );
}

/**
 * Proposta comercial para cliente: layout compacto (referência tipo ERP/PDF comercial).
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
    if (!resolvedCustomer) return null;
    const name =
      nonEmpty(resolvedCustomer.companyName) ||
      nonEmpty(resolvedCustomer.tradeName) ||
      null;
    const trade = nonEmpty(resolvedCustomer.tradeName);
    const tax = nonEmpty(resolvedCustomer.taxId);
    const stateTax = nonEmpty(resolvedCustomer.stateTaxId);
    const addr = nonEmpty(resolvedCustomer.address);
    const city = nonEmpty(resolvedCustomer.city);
    const st = nonEmpty(resolvedCustomer.state);
    const zip = nonEmpty(resolvedCustomer.zipCode);
    const phone = nonEmpty(resolvedCustomer.phone);
    const contact = nonEmpty(resolvedCustomer.contactName);
    const locParts = [city, st].filter(Boolean);
    const cityUf = locParts.length > 0 ? locParts.join(" - ") : null;
    return { name, trade, tax, stateTax, addr, cityUf, zip, phone, contact };
  }, [resolvedCustomer]);

  const freightLabel = useMemo(() => {
    const fc = nonEmpty(formData.freightCondition) ?? "";
    if (fc === "CIF") return "CIF (frete por conta do emitente)";
    if (fc === "FOB") return "FOB (frete por conta do destinatário)";
    return fc || "—";
  }, [formData.freightCondition]);

  const validityDays = safeNum(formData.validityDays, 15);
  const paymentTerms = nonEmpty(formData.paymentTerms);
  const paymentMethod = nonEmpty(formData.paymentMethod);
  const deliveryDays = formData.deliveryTimeDays;
  const deliveryLocation = nonEmpty(formData.deliveryLocation);
  const notes = nonEmpty(formData.notes);
  const responsible = nonEmpty(formData.responsible);
  const totalFreight = safeNum(formData.totalFreight);

  const deliveryLine =
    deliveryDays != null && Number.isFinite(Number(deliveryDays)) && Number(deliveryDays) > 0
      ? `${Number(deliveryDays)} dia(s)`
      : null;

  const proposalLogoSrc =
    typeof b.proposalLogoDataUrl === "string" &&
    b.proposalLogoDataUrl.trim().length > 0 &&
    b.proposalLogoDataUrl.trim().toLowerCase().startsWith("data:image/")
      ? b.proposalLogoDataUrl.trim()
      : null;
  const sloganLine = nonEmpty(b.slogan);

  const cpHeading =
    proposalNumber != null && Number.isFinite(proposalNumber)
      ? `CP ${String(Math.floor(Number(proposalNumber))).padStart(5, "0")}`
      : "Rascunho";

  return (
    <article
      lang="pt-BR"
      className="proposal-print-document proposal-compact-document proposal-print-sheet mx-auto w-full max-w-[1180px] border border-slate-300 bg-white text-slate-800 shadow-sm print:max-w-none print:border-0 print:shadow-none"
    >
      <div className="proposal-client-document-root proposal-print-document-inner p-4 text-xs leading-snug md:p-5 md:text-[13px] md:leading-normal print:p-3">
        <h1 id={titleHeadingId} className="sr-only">
          Proposta comercial {cpHeading !== "Rascunho" ? cpHeading : ""}
        </h1>

        {/* Cabeçalho compacto */}
        <header className="proposal-compact-header proposal-print-section border-b border-slate-300 pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="proposal-compact-company flex min-w-0 flex-1 gap-3">
              {proposalLogoSrc ? (
                <img
                  src={proposalLogoSrc}
                  alt={b.companyName}
                  className="h-16 w-auto max-w-[240px] shrink-0 object-contain object-left sm:h-[4.5rem] sm:max-w-[280px] md:max-w-[300px]"
                />
              ) : null}
              <div className="min-w-0 space-y-0.5 text-[11px] text-slate-700 sm:text-xs">
                <p className="text-sm font-bold leading-tight text-slate-900 sm:text-base">{b.companyName}</p>
                {sloganLine ? <p className="text-[10px] italic text-slate-500 sm:text-[11px]">{sloganLine}</p> : null}
                <p>
                  <span className="font-semibold text-slate-600">CNPJ: </span>
                  {COMPANY_DOC_FALLBACK.taxId}
                </p>
                <p className="break-words">{COMPANY_DOC_FALLBACK.addressLine}</p>
                <p>
                  <span className="font-semibold text-slate-600">E-mail: </span>
                  {COMPANY_DOC_FALLBACK.email}
                </p>
              </div>
            </div>
            <div className="proposal-compact-proposal-meta shrink-0 border-t border-slate-200 pt-2 text-[11px] sm:border-t-0 sm:border-l sm:pl-5 sm:pt-0 sm:text-xs">
              <p className="text-sm font-extrabold tracking-tight text-slate-900 sm:text-base">
                PROPOSTA: {cpHeading}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-600">Data: </span>
                {issuedAt || "—"}
              </p>
              <p className="mt-0.5">
                <span className="font-semibold text-slate-600">Vendedor: </span>
                {responsible ?? "—"}
              </p>
            </div>
          </div>
        </header>

        {/* Dados do cliente */}
        <section className="proposal-compact-section proposal-compact-client proposal-print-section mt-4">
          <CompactSectionTitle>Dados do cliente</CompactSectionTitle>
          {customerBlock?.name ? (
            <div className="mt-2 border-y border-slate-200 py-2">
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <div>
                  <p className="font-semibold text-slate-900">{customerBlock.name}</p>
                  {customerBlock.trade && customerBlock.trade !== customerBlock.name ? (
                    <p className="text-slate-600">{customerBlock.trade}</p>
                  ) : null}
                </div>
                {customerBlock.phone ? (
                  <div className="sm:text-right">
                    <span className="font-semibold text-slate-600">Tel.: </span>
                    {customerBlock.phone}
                  </div>
                ) : null}
                {customerBlock.tax ? (
                  <p>
                    <span className="font-semibold text-slate-600">CNPJ/CPF: </span>
                    {customerBlock.tax}
                  </p>
                ) : null}
                {customerBlock.stateTax ? (
                  <p className="sm:text-right">
                    <span className="font-semibold text-slate-600">Inscr. estadual: </span>
                    {customerBlock.stateTax}
                  </p>
                ) : null}
                {customerBlock.contact ? (
                  <p className="sm:col-span-2">
                    <span className="font-semibold text-slate-600">Contato: </span>
                    {customerBlock.contact}
                  </p>
                ) : null}
                {customerBlock.addr ? (
                  <p className="break-words sm:col-span-2">
                    <span className="font-semibold text-slate-600">Endereço: </span>
                    {customerBlock.addr}
                  </p>
                ) : null}
                {customerBlock.cityUf || customerBlock.zip ? (
                  <p className="sm:col-span-2">
                    {customerBlock.cityUf ? (
                      <>
                        <span className="font-semibold text-slate-600">Município/UF: </span>
                        {customerBlock.cityUf}
                      </>
                    ) : null}
                    {customerBlock.cityUf && customerBlock.zip ? " · " : null}
                    {customerBlock.zip ? (
                      <>
                        <span className="font-semibold text-slate-600">CEP: </span>
                        {customerBlock.zip}
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-2 border-y border-slate-200 py-2 text-slate-500">Cliente não informado.</p>
          )}
        </section>

        {/* Totais antes dos itens */}
        <section className="proposal-compact-section proposal-compact-totals proposal-print-section mt-4">
          <CompactSectionTitle>Totais da proposta</CompactSectionTitle>
          <div className="proposal-compact-totals-grid mt-2 border border-slate-200 bg-slate-50/80 text-[11px] sm:text-xs">
            <div className="grid grid-cols-[1fr_auto] border-b border-slate-200 px-2 py-1 sm:px-3 sm:py-1.5">
              <span className="text-slate-600">Produto / mercadorias</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">{formatMoney(totals.totalGross)}</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] border-b border-slate-200 px-2 py-1 sm:px-3 sm:py-1.5">
              <span className="text-slate-600">Desconto</span>
              <span className="font-mono font-semibold tabular-nums text-red-700">
                −{formatMoney(totals.totalDiscount)}
              </span>
            </div>
            <div className="grid grid-cols-[1fr_auto] border-b border-slate-200 px-2 py-1 sm:px-3 sm:py-1.5">
              <span className="text-slate-600">Frete</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">{formatMoney(totalFreight)}</span>
            </div>
            <div
              className="grid grid-cols-[1fr_auto] px-2 py-1.5 sm:px-3 sm:py-2"
              style={{ backgroundColor: `${b.primaryColor}14` }}
            >
              <span className="font-bold text-slate-900">Total</span>
              <span className="font-mono text-sm font-extrabold tabular-nums text-slate-900 sm:text-base">
                {formatMoney(totals.totalNet)}
              </span>
            </div>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">Tributos (ICMS, PIS, COFINS, etc.): não detalhados neste documento.</p>
        </section>

        {/* Itens — tabela principal */}
        <section className="proposal-print-items-section proposal-compact-section proposal-print-section mt-5">
          <CompactSectionTitle>Itens da proposta</CompactSectionTitle>
          <div className="proposal-print-table-wrap mt-2 overflow-visible">
            <table className="proposal-compact-table proposal-client-items-table w-full border-collapse border border-slate-300 text-left text-[10px] sm:text-[11px]">
              <thead>
                <tr className="border-b border-slate-300 bg-slate-100 text-[10px] font-bold uppercase tracking-wide text-slate-800 sm:text-[11px]">
                  <th className="proposal-col-item border-r border-slate-200 px-1.5 py-1.5 sm:px-2">Item</th>
                  <th className="proposal-col-code border-r border-slate-200 px-1.5 py-1.5 sm:px-2">Produto</th>
                  <th className="proposal-col-description border-r border-slate-200 px-1.5 py-1.5 sm:px-2">Descrição</th>
                  <th className="proposal-col-unit border-r border-slate-200 px-1.5 py-1.5 text-center sm:px-2">Un.</th>
                  <th className="proposal-col-qty border-r border-slate-200 px-1.5 py-1.5 text-right sm:px-2">Qtde</th>
                  <th className="proposal-col-unit-price border-r border-slate-200 px-1.5 py-1.5 text-right sm:px-2">Preço</th>
                  <th className="proposal-col-total border-r border-slate-200 px-1.5 py-1.5 text-right sm:px-2">Subtotal</th>
                  <th className="proposal-col-delivery px-1.5 py-1.5 text-right sm:px-2">Prazo</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-2 py-6 text-center text-slate-500">
                      Nenhum item nesta proposta.
                    </td>
                  </tr>
                ) : null}
                {items.map((item, idx) => {
                  const qty = safeNum(item.quantity);
                  const unit = safeNum(item.negotiatedPrice);
                  const lineTotal = qty * unit - safeNum(item.discountValue);
                  const sku = nonEmpty(item.Product?.sku) ?? "—";
                  const desc = nonEmpty(item.Product?.name) ?? "—";
                  const unitLabel = formatProposalUnit(item.unit);
                  const stripe = idx % 2 === 1 ? "bg-slate-50/90" : "bg-white";
                  return (
                    <tr
                      key={item.id ?? `row-${idx}`}
                      className={`proposal-print-table-row border-b border-slate-200 ${stripe}`}
                    >
                      <td className="proposal-col-item proposal-cell-item border-r border-slate-100 px-1.5 py-1 font-mono tabular-nums text-slate-600 sm:px-2 sm:py-1.5">
                        {formatItemLineNo(idx)}
                      </td>
                      <td className="proposal-col-code proposal-cell-code border-r border-slate-100 px-1.5 py-1 font-mono text-[10px] font-semibold text-slate-800 sm:px-2 sm:py-1.5 sm:text-[11px]">
                        {sku}
                      </td>
                      <td className="proposal-col-description proposal-cell-description max-w-[min(40vw,220px)] border-r border-slate-100 px-1.5 py-1 break-words text-slate-800 print:max-w-none sm:max-w-none sm:px-2 sm:py-1.5">
                        {desc}
                      </td>
                      <td className="proposal-col-unit proposal-cell-unit border-r border-slate-100 px-1.5 py-1 text-center text-slate-700 sm:px-2 sm:py-1.5">
                        {unitLabel}
                      </td>
                      <td className="proposal-col-qty proposal-cell-qty border-r border-slate-100 px-1.5 py-1 text-right font-mono tabular-nums text-slate-700 sm:px-2 sm:py-1.5">
                        {formatQty(qty)}
                      </td>
                      <td className="proposal-col-unit-price proposal-cell-money border-r border-slate-100 px-1.5 py-1 text-right font-mono tabular-nums text-slate-800 sm:px-2 sm:py-1.5">
                        {formatMoney(unit)}
                      </td>
                      <td className="proposal-col-total proposal-cell-money border-r border-slate-100 px-1.5 py-1 text-right font-mono text-[11px] font-semibold tabular-nums text-slate-900 sm:px-2 sm:py-1.5 sm:text-xs">
                        {formatMoney(lineTotal)}
                      </td>
                      <td className="proposal-col-delivery proposal-cell-delivery px-1.5 py-1 text-right text-slate-700 sm:px-2 sm:py-1.5">
                        {deliveryLine ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Condições comerciais — final */}
        <section className="proposal-compact-section proposal-compact-commercial-terms proposal-print-section mt-5">
          <CompactSectionTitle>Condições comerciais</CompactSectionTitle>
          <ul className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-[11px] text-slate-800 sm:text-xs">
            <li>
              <span className="font-semibold text-slate-600">Pagamento: </span>
              {[paymentTerms, paymentMethod].filter(Boolean).join(" · ") || "—"}
            </li>
            <li>
              <span className="font-semibold text-slate-600">Validade: </span>
              {validityDays > 0 ? `${validityDays} dia(s)` : "—"}
            </li>
            <li>
              <span className="font-semibold text-slate-600">Frete: </span>
              {freightLabel}
            </li>
            <li>
              <span className="font-semibold text-slate-600">Prazo de entrega: </span>
              {deliveryLine ?? "—"}
            </li>
            {deliveryLocation ? (
              <li>
                <span className="font-semibold text-slate-600">Local de entrega: </span>
                {deliveryLocation}
              </li>
            ) : null}
          </ul>
        </section>

        {/* Observações */}
        <section className="proposal-compact-section proposal-compact-observations proposal-print-section mt-5">
          <CompactSectionTitle>Observações sobre a proposta</CompactSectionTitle>
          <div className="mt-2 border-t border-slate-200 pt-2 text-[11px] text-slate-800 sm:text-xs">
            {notes ? (
              <p className="whitespace-pre-wrap break-words">{notes}</p>
            ) : (
              <p className="text-slate-500">Sem observações adicionais.</p>
            )}
          </div>
        </section>

        {/* Rodapé */}
        <footer className="proposal-compact-footer proposal-print-section mt-6 flex flex-col justify-between gap-1 border-t border-slate-300 pt-2 text-[10px] text-slate-600 sm:flex-row sm:text-[11px]">
          <div>
            <span className="font-semibold text-slate-700">{responsible ?? "—"}</span>
          </div>
          <div className="sm:text-right">
            <span>{issuedAt || "—"}</span>
          </div>
        </footer>
      </div>
    </article>
  );
}
