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

function SectionTitle({
  children,
  accentColor,
  className = "",
}: {
  children: React.ReactNode;
  accentColor: string;
  className?: string;
}) {
  return (
    <h2
      className={`proposal-client-section-title text-xs font-bold uppercase tracking-wider text-slate-600 border-l-4 pl-3 ${className}`}
      style={{ borderLeftColor: accentColor }}
    >
      {children}
    </h2>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="proposal-client-card proposal-client-info-metric rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

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
      return {
        name: "—" as string,
        tax: null as string | null,
        address: null as string | null,
        cityUf: null as string | null,
        zip: null as string | null,
      };
    }
    const name =
      nonEmpty(resolvedCustomer.companyName) ||
      nonEmpty(resolvedCustomer.tradeName) ||
      "—";
    const tax = nonEmpty(resolvedCustomer.taxId);
    const addr = nonEmpty(resolvedCustomer.address);
    const city = nonEmpty(resolvedCustomer.city);
    const st = nonEmpty(resolvedCustomer.state);
    const zip = nonEmpty(resolvedCustomer.zipCode);
    const locParts = [city, st].filter(Boolean);
    const cityUf = locParts.length > 0 ? locParts.join(" / ") : null;
    const zipVal = zip;
    return { name, tax, address: addr, cityUf, zip: zipVal };
  }, [resolvedCustomer]);

  const freightLabel = useMemo(() => {
    const fc = nonEmpty(formData.freightCondition) ?? "";
    if (fc === "CIF") return "CIF (frete por conta do emitente)";
    if (fc === "FOB") return "FOB (frete por conta do destinatário)";
    return fc || "—";
  }, [formData.freightCondition]);

  const summaryMetrics = useMemo(() => {
    const distinctItems = items.length;
    const totalUnits = items.reduce((acc, it) => acc + safeNum(it.quantity), 0);
    const deliveryDays = formData.deliveryTimeDays;
    const deliveryLabel =
      deliveryDays != null && Number.isFinite(Number(deliveryDays)) && Number(deliveryDays) > 0
        ? `${Number(deliveryDays)} dia(s)`
        : "—";
    const validityDays = safeNum(formData.validityDays, 15);
    const validityLabel = validityDays > 0 ? `${validityDays} dia(s)` : "—";
    return {
      distinctItems,
      totalUnits: totalUnits > 0 ? formatQty(totalUnits) : "—",
      totalValue: formatMoney(totals.totalNet),
      validityLabel,
      freight: freightLabel,
      deliveryLabel,
    };
  }, [items, formData.deliveryTimeDays, formData.validityDays, totals.totalNet, freightLabel]);

  const proposalLogoSrc =
    typeof b.proposalLogoDataUrl === "string" &&
    b.proposalLogoDataUrl.trim().length > 0 &&
    b.proposalLogoDataUrl.trim().toLowerCase().startsWith("data:image/")
      ? b.proposalLogoDataUrl.trim()
      : null;
  const proposalSideImageSrc =
    typeof b.proposalSideImageDataUrl === "string" &&
    b.proposalSideImageDataUrl.trim().length > 0 &&
    b.proposalSideImageDataUrl.trim().toLowerCase().startsWith("data:image/")
      ? b.proposalSideImageDataUrl.trim()
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

  const proposalRefLabel =
    proposalNumber != null && Number.isFinite(proposalNumber) ? `nº ${proposalNumber}` : "rascunho (sem número ainda)";

  return (
    <article className="proposal-print-document proposal-print-sheet mx-auto w-full max-w-[1180px] overflow-visible rounded-xl border border-slate-200 bg-white text-slate-800 shadow-md md:shadow-md">
      <div className="proposal-client-document-root proposal-print-document-inner relative p-6 md:p-8 md:py-10 print:p-6">
        {proposalSideImageSrc ? (
          <div
            className="proposal-side-brand-floating pointer-events-none absolute top-1/2 z-0 hidden -translate-y-1/2 md:right-3 md:block md:w-[176px] print:right-4 print:block print:w-[168px]"
            aria-hidden
          >
            <img
              src={proposalSideImageSrc}
              alt=""
              className="mx-auto h-auto max-h-[min(82vh,720px)] w-full max-w-[176px] object-contain object-center opacity-95 print:max-h-[680px] print:max-w-[168px]"
            />
          </div>
        ) : null}

        {/* A — Cabeçalho */}
        <header className="proposal-client-hero proposal-print-section pb-6 print:pb-0">
          <div className="proposal-client-hero-row flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="proposal-client-hero-logo min-w-0 flex-1">
              {proposalLogoSrc ? (
                <img
                  src={proposalLogoSrc}
                  alt={b.companyName}
                  className="max-h-[100px] w-auto max-w-[200px] object-contain object-left sm:max-h-[112px] sm:max-w-[220px]"
                />
              ) : (
                <p
                  className="text-lg font-bold tracking-tight text-slate-900"
                  style={{ color: b.primaryColor }}
                >
                  {b.companyName}
                </p>
              )}
              {proposalLogoSrc && sloganLine ? (
                <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600">{sloganLine}</p>
              ) : !proposalLogoSrc && sloganLine ? (
                <p className="mt-1 max-w-md text-sm leading-relaxed text-slate-600">{sloganLine}</p>
              ) : null}
            </div>
            <div
              className="proposal-client-hero-card proposal-client-card w-full max-w-full shrink-0 rounded-xl border border-slate-200 bg-slate-50/90 p-4 shadow-sm lg:max-w-[460px] xl:max-w-[500px]"
            >
              <h1
                id={titleHeadingId}
                className="text-2xl font-extrabold tracking-tight text-slate-900 md:text-3xl"
                style={{ color: b.primaryColor }}
              >
                Proposta Comercial
              </h1>
              {titleLine ? <p className="mt-1 text-sm font-medium text-slate-600">{titleLine}</p> : null}
              <dl className="mt-4 space-y-2 border-t border-slate-200/80 pt-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="font-semibold text-slate-600">Proposta</dt>
                  <dd className="text-right font-semibold text-slate-900">{proposalRefLabel}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-semibold text-slate-600">Data de emissão</dt>
                  <dd className="text-right text-slate-800">{issuedAt || "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-semibold text-slate-600">Validade</dt>
                  <dd className="text-right text-slate-800">
                    {validityDays > 0 ? `${validityDays} dia(s)` : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-semibold text-slate-600">Responsável comercial</dt>
                  <dd className="text-right text-slate-800">{responsible ?? "—"}</dd>
                </div>
              </dl>
            </div>
          </div>
          <div
            className="proposal-client-hero-accent mt-6 h-1 w-full rounded-full print:mt-5"
            style={{ backgroundColor: b.primaryColor }}
            aria-hidden
          />
        </header>

        {/* C — Cliente */}
        <section className="proposal-client-section proposal-print-section mt-8 space-y-3">
          <SectionTitle accentColor={b.primaryColor}>Cliente</SectionTitle>
          <div className="proposal-client-card rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 shadow-sm">
            <p className="proposal-client-customer-name text-lg font-bold text-slate-900">{customerBlock.name}</p>
            <dl className="proposal-client-customer-grid mt-4 grid gap-3 text-sm sm:grid-cols-2">
              {customerBlock.tax ? (
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">CNPJ / CPF</dt>
                  <dd className="mt-0.5 font-medium text-slate-800">{customerBlock.tax}</dd>
                </div>
              ) : null}
              {customerBlock.address ? (
                <div className="sm:col-span-2">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Endereço</dt>
                  <dd className="mt-0.5 text-slate-800">{customerBlock.address}</dd>
                </div>
              ) : null}
              {customerBlock.cityUf ? (
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Cidade / UF</dt>
                  <dd className="mt-0.5 text-slate-800">{customerBlock.cityUf}</dd>
                </div>
              ) : null}
              {customerBlock.zip ? (
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">CEP</dt>
                  <dd className="mt-0.5 text-slate-800">{customerBlock.zip}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </section>

        {/* D — Condições comerciais */}
        <section className="proposal-client-section proposal-print-section mt-8 space-y-3">
          <SectionTitle accentColor={b.primaryColor}>Condições comerciais</SectionTitle>
          <div className="proposal-client-card proposal-client-conditions-grid grid gap-4 rounded-xl border border-slate-200 bg-white p-5 text-sm shadow-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Condição de pagamento</p>
              <p className="mt-1 font-medium text-slate-900">{paymentTerms ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Forma de pagamento</p>
              <p className="mt-1 font-medium text-slate-900">{paymentMethod ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Frete</p>
              <p className="mt-1 font-medium text-slate-900">{freightLabel}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Prazo de entrega</p>
              <p className="mt-1 font-medium text-slate-900">
                {deliveryDays != null && Number.isFinite(Number(deliveryDays)) && Number(deliveryDays) > 0
                  ? `${Number(deliveryDays)} dia(s)`
                  : "—"}
              </p>
            </div>
            <div className="sm:col-span-2 lg:col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Local de entrega</p>
              <p className="mt-1 font-medium text-slate-900">{deliveryLocation ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Validade da proposta</p>
              <p className="mt-1 font-medium text-slate-900">{validityDays > 0 ? `${validityDays} dia(s)` : "—"}</p>
            </div>
          </div>
        </section>

        {/* B — Resumo da proposta */}
        <section className="proposal-client-summary proposal-client-section proposal-print-section mt-10 space-y-4">
          <SectionTitle accentColor={b.primaryColor}>Resumo da proposta</SectionTitle>
          <p className="proposal-client-summary-lead max-w-3xl text-sm leading-relaxed text-slate-700">
            Esta proposta contempla o fornecimento dos itens listados abaixo, conforme condições comerciais acordadas entre
            as partes. Os valores apresentados consideram as quantidades, prazos e condições descritas neste documento.
          </p>
          <div className="proposal-client-summary-grid grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <InfoCard label="Itens distintos" value={String(summaryMetrics.distinctItems)} />
            <InfoCard label="Total de unidades" value={summaryMetrics.totalUnits} />
            <InfoCard label="Valor total" value={summaryMetrics.totalValue} />
            <InfoCard label="Validade" value={summaryMetrics.validityLabel} />
            <InfoCard label="Frete" value={summaryMetrics.freight} />
            <InfoCard label="Prazo de entrega" value={summaryMetrics.deliveryLabel} />
          </div>
        </section>

        {/* J — Sobre a empresa */}
        <section className="proposal-client-about proposal-client-section proposal-print-section mt-8 space-y-3">
          <SectionTitle accentColor={b.primaryColor}>Sobre a {b.companyName}</SectionTitle>
          <div className="proposal-client-card rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm leading-relaxed text-slate-700">
            A {b.companyName} atua no desenvolvimento e fornecimento de soluções em plásticos, com foco em qualidade,
            padronização e atendimento às necessidades de cada cliente.
          </div>
        </section>

        {/* E — Itens */}
        <section className="proposal-print-items-section proposal-client-section mt-10">
          <SectionTitle accentColor={b.primaryColor} className="mb-4">
            Itens
          </SectionTitle>
          <div className="proposal-print-table-wrap overflow-x-auto rounded-xl border border-slate-200 print:overflow-visible">
            <table className="proposal-client-items-table w-full min-w-0 table-auto border-collapse text-sm md:min-w-[720px] print:table-fixed">
              <thead>
                <tr
                  className="border-b-2 text-left text-slate-800"
                  style={{ borderBottomColor: b.primaryColor, backgroundColor: "rgb(241 245 249)" }}
                >
                  <th className="proposal-col-item px-3 py-3 text-xs font-bold uppercase tracking-wide">Item</th>
                  <th className="proposal-col-code px-3 py-3 text-xs font-bold uppercase tracking-wide">Código</th>
                  <th className="proposal-col-description min-w-[140px] px-3 py-3 text-xs font-bold uppercase tracking-wide">
                    Descrição
                  </th>
                  <th className="proposal-col-qty px-3 py-3 text-right text-xs font-bold uppercase tracking-wide">Qtd.</th>
                  <th className="proposal-col-unit px-3 py-3 text-right text-xs font-bold uppercase tracking-wide">
                    Valor unit.
                  </th>
                  <th className="proposal-col-discount px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-600">
                    Desc. %
                  </th>
                  <th className="proposal-col-total px-3 py-3 text-right text-xs font-bold uppercase tracking-wide">
                    Valor total
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-500">
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
                  const stripe = idx % 2 === 1 ? "bg-slate-50/70" : "bg-white";
                  return (
                    <tr
                      key={item.id ?? `row-${idx}`}
                      className={`proposal-print-table-row border-b border-slate-100 last:border-0 ${stripe}`}
                    >
                      <td className="proposal-col-item px-3 py-2.5 align-middle text-slate-600">{idx + 1}</td>
                      <td className="proposal-col-code px-3 py-2.5 align-middle font-mono text-xs font-semibold text-slate-800">
                        {sku}
                      </td>
                      <td className="proposal-col-description px-3 py-2.5 align-middle pr-4 leading-snug text-slate-800">
                        {desc}
                      </td>
                      <td className="proposal-col-qty px-3 py-2.5 align-middle text-right font-mono tabular-nums text-slate-700">
                        {formatQty(qty)}
                      </td>
                      <td className="proposal-col-unit px-3 py-2.5 align-middle text-right font-mono tabular-nums text-slate-700">
                        {formatMoney(unit)}
                      </td>
                      <td className="proposal-col-discount px-3 py-2.5 align-middle text-right font-mono text-xs tabular-nums text-slate-500">
                        {formatPercent(discPerc)}
                      </td>
                      <td className="proposal-col-total px-3 py-2.5 align-middle text-right font-mono text-sm font-bold tabular-nums text-slate-900">
                        {formatMoney(lineTotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* F — Resumo financeiro */}
        <section className="proposal-client-financial-summary proposal-print-section mt-10 space-y-3">
          <SectionTitle accentColor={b.primaryColor}>Resumo financeiro</SectionTitle>
          <div className="proposal-client-card ml-auto max-w-full rounded-xl border border-slate-200 bg-slate-50/80 p-5 shadow-sm md:max-w-md print:max-w-sm">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between gap-4 border-b border-slate-200/80 pb-2">
                <span className="text-slate-600">Subtotal (valor bruto)</span>
                <span className="font-mono font-semibold tabular-nums text-slate-900">{formatMoney(totals.totalGross)}</span>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-200/80 pb-2">
                <span className="text-slate-600">Descontos concedidos</span>
                <span className="font-mono font-semibold tabular-nums text-red-700">−{formatMoney(totals.totalDiscount)}</span>
              </div>
              <div
                className="flex flex-col gap-1 rounded-lg px-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                style={{ backgroundColor: `${b.primaryColor}12` }}
              >
                <span className="text-base font-bold text-slate-900">Valor total da proposta</span>
                <span className="text-2xl font-extrabold tabular-nums tracking-tight" style={{ color: b.secondaryColor }}>
                  {formatMoney(totals.totalNet)}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* G — Observações */}
        <section className="proposal-client-section proposal-print-section mt-10 space-y-3">
          <SectionTitle accentColor={b.primaryColor}>Observações</SectionTitle>
          <div className="proposal-client-observations proposal-client-card rounded-xl border border-slate-200 bg-white p-5 text-sm shadow-sm">
            {notes ? <p className="whitespace-pre-wrap leading-relaxed text-slate-800">{notes}</p> : <p className="text-slate-500">Sem observações adicionais.</p>}
            <ul className="proposal-client-observations-bullets mt-4 list-disc space-y-1.5 border-t border-slate-100 pt-4 pl-5 text-xs leading-relaxed text-slate-600">
              <li>Valores sujeitos às condições comerciais descritas nesta proposta.</li>
              <li>Proposta válida pelo prazo informado.</li>
              <li>Alterações de quantidade, prazo, frete ou escopo poderão exigir revisão dos valores.</li>
            </ul>
          </div>
        </section>

        {/* H — Condições gerais */}
        <section className="proposal-client-section proposal-print-section mt-10 space-y-3">
          <SectionTitle accentColor={b.primaryColor}>Condições gerais</SectionTitle>
          <div className="proposal-client-general-conditions proposal-client-card rounded-xl border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-700 shadow-sm">
            <ul className="proposal-client-general-conditions-list list-disc space-y-2 pl-5">
              <li>Esta proposta é válida pelo prazo informado neste documento.</li>
              <li>Os valores apresentados consideram as quantidades e condições comerciais descritas nesta proposta.</li>
              <li>Alterações de quantidade, prazo, frete ou escopo poderão exigir revisão dos valores.</li>
              <li>O início do atendimento do pedido está condicionado à aprovação formal desta proposta.</li>
              <li>
                Salvo condição específica, tributos, frete e demais condições seguem as regras comerciais indicadas neste
                documento.
              </li>
            </ul>
          </div>
        </section>

        {/* I — Aceite */}
        <section className="proposal-client-acceptance proposal-print-section mt-10 space-y-4">
          <SectionTitle accentColor={b.primaryColor}>Aceite da proposta</SectionTitle>
          <div className="proposal-client-card rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm leading-relaxed text-slate-800">
              Ao aprovar esta proposta, o cliente declara estar de acordo com os itens, valores e condições comerciais
              apresentados.
            </p>
            <div className="signature-lines mt-8 space-y-5 text-sm print:mt-4">
              <div>
                <p className="font-semibold text-slate-700">Nome do responsável</p>
                <div className="mt-2 border-b border-slate-400 pb-1 print:mt-1 print:pb-px">&nbsp;</div>
              </div>
              <div>
                <p className="font-semibold text-slate-700">Assinatura</p>
                <div className="mt-2 border-b border-slate-400 pb-1 print:mt-1 print:pb-px">&nbsp;</div>
              </div>
              <div className="max-w-xs">
                <p className="font-semibold text-slate-700">Data</p>
                <div className="mt-2 border-b border-slate-400 pb-1 text-slate-400 print:mt-1 print:pb-px">____/____/________</div>
              </div>
            </div>
            <div className="mt-8 border-t border-slate-200 pt-4 text-sm text-slate-700">
              <p>
                <span className="font-semibold text-slate-600">Responsável comercial: </span>
                {responsible ?? "—"}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-600">Empresa: </span>
                {companyIssuer ?? b.companyName}
              </p>
            </div>
          </div>
        </section>
      </div>
    </article>
  );
}
