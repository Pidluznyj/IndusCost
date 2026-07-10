import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import type { ProposalInternalManagementPdfDocument } from "@/src/lib/proposalInternalManagementPdf";
import { PROPOSAL_INTERNAL_MANAGEMENT_PDF_CONFIDENTIAL_MARK } from "@/src/lib/proposalInternalManagementPdf";

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const [intPart, dec = "00"] = abs.toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${grouped},${dec}`;
}

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2).replace(".", ",")}%`;
}

function num(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits).replace(".", ",");
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="proposal-compact-section-title mt-5 border-t border-slate-300 pt-2 text-[11px] font-bold uppercase tracking-wide text-slate-700 first:mt-0 first:border-t-0 first:pt-0">
      {children}
    </h2>
  );
}

type Props = {
  document: ProposalInternalManagementPdfDocument;
  branding: BrandingSettingsDTO;
};

/**
 * Layout visual alinhado à proposta cliente (PrintHeader + seções compactas),
 * com grids gerenciais internos. Não usar no PDF cliente.
 */
export function ProposalInternalManagementDocument({ document: doc, branding }: Props) {
  return (
    <article
      lang="pt-BR"
      className="proposal-print-document proposal-compact-document proposal-print-sheet mx-auto w-full max-w-[1180px] border border-slate-300 bg-white text-slate-800 shadow-sm print:max-w-none print:border-0 print:shadow-none"
      data-testid="proposal-internal-management-document"
    >
      <div className="proposal-print-document-inner p-4 text-xs leading-snug md:p-5 md:text-[13px] md:leading-normal print:p-3">
        <PrintHeader
          branding={branding}
          documentKind="RELATÓRIO GERENCIAL INTERNO"
          documentTitle="PROPOSTA"
          documentHighlight={doc.proposalCode}
          metaLines={[
            { label: "Data", value: doc.issuedAtLabel },
            { label: "Vendedor", value: doc.responsible },
          ]}
          subtitle={PROPOSAL_INTERNAL_MANAGEMENT_PDF_CONFIDENTIAL_MARK}
          className="proposal-compact-header proposal-print-section"
        />

        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-950">
          Documento interno e confidencial. Não compartilhar com clientes.
        </div>

        <section className="proposal-compact-section mt-4">
          <SectionTitle>Dados do cliente</SectionTitle>
          <div className="mt-2 border-y border-slate-200 py-2">
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <div>
                <p className="font-semibold text-slate-900">{doc.customerName}</p>
                {doc.customerTradeName && doc.customerTradeName !== doc.customerName ? (
                  <p className="text-slate-600">{doc.customerTradeName}</p>
                ) : null}
              </div>
              {doc.customerPhone ? (
                <div className="sm:text-right">
                  <span className="font-semibold text-slate-600">Tel.: </span>
                  {doc.customerPhone}
                </div>
              ) : null}
              {doc.customerDocument ? (
                <p>
                  <span className="font-semibold text-slate-600">CNPJ/CPF: </span>
                  {doc.customerDocument}
                </p>
              ) : null}
              {doc.customerAddress ? (
                <p className="sm:col-span-2">
                  <span className="font-semibold text-slate-600">Endereço: </span>
                  {doc.customerAddress}
                </p>
              ) : null}
              {doc.customerCityUf || doc.customerZip ? (
                <p className="sm:col-span-2">
                  {doc.customerCityUf ? (
                    <>
                      <span className="font-semibold text-slate-600">Município/UF: </span>
                      {doc.customerCityUf}
                    </>
                  ) : null}
                  {doc.customerCityUf && doc.customerZip ? " · " : null}
                  {doc.customerZip ? (
                    <>
                      <span className="font-semibold text-slate-600">CEP: </span>
                      {doc.customerZip}
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="mt-4">
          <SectionTitle>Resumo gerencial da proposta</SectionTitle>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {[
              ["Valor de venda", money(doc.totals.net)],
              ["Custo total", money(doc.totals.cost)],
              [
                "Custo matéria-prima",
                doc.totals.materialCost != null ? money(doc.totals.materialCost) : "Pendente",
              ],
              [
                "Custo fabricação",
                doc.totals.fabricationCost != null
                  ? money(doc.totals.fabricationCost)
                  : "Pendente",
              ],
              ["Impostos", money(doc.totals.taxes)],
              [
                "Comissão",
                doc.totals.commission > 0 ? money(doc.totals.commission) : "Pendente",
              ],
              ["Margem R$", money(doc.totals.marginValue)],
              ["Margem %", pct(doc.totals.marginPerc)],
              ["Markup", doc.totals.markup != null ? num(doc.totals.markup, 4) : "—"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {label}
                </p>
                <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">{value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-5">
          <SectionTitle>Itens — visão comercial</SectionTitle>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-[11px]">
              <thead>
                <tr className="bg-slate-100 text-slate-700">
                  <th className="border border-slate-300 px-2 py-1.5">Item</th>
                  <th className="border border-slate-300 px-2 py-1.5">Produto</th>
                  <th className="border border-slate-300 px-2 py-1.5">Descrição</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-right">Qtde</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-right">Preço venda</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-right">Receita</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((item) => (
                  <tr key={item.lineNo} className="odd:bg-white even:bg-slate-50/80">
                    <td className="border border-slate-200 px-2 py-1">{item.lineNo}</td>
                    <td className="border border-slate-200 px-2 py-1">{item.code}</td>
                    <td className="border border-slate-200 px-2 py-1">{item.name}</td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">
                      {num(item.quantity, 0)} {item.unit}
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">
                      {money(item.unitPrice)}
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums font-semibold">
                      {money(item.totalPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-5">
          <SectionTitle>Itens — visão gerencial</SectionTitle>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-[11px]">
              <thead>
                <tr className="bg-slate-100 text-slate-700">
                  <th className="border border-slate-300 px-2 py-1.5">Item</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-right">MP</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-right">Fabricação</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-right">Impostos</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-right">Comissão</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-right">Custo total</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-right">Margem R$</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-right">Margem %</th>
                  <th className="border border-slate-300 px-2 py-1.5 text-right">Markup</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((item) => (
                  <tr key={`g-${item.lineNo}`} className="odd:bg-white even:bg-slate-50/80">
                    <td className="border border-slate-200 px-2 py-1">{item.lineNo}</td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">
                      {item.materialTotal != null ? money(item.materialTotal) : "Pendente"}
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">
                      {item.fabricationTotal != null
                        ? money(item.fabricationTotal)
                        : "Pendente"}
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">
                      {money(item.taxesValue)}
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">
                      {item.commissionPending && !(item.commissionValue > 0)
                        ? "Pendente"
                        : money(item.commissionValue)}
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">
                      {money(item.totalCost)}
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">
                      {money(item.marginValue)}
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">
                      {pct(item.marginPerc)}
                    </td>
                    <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">
                      {item.markup != null ? num(item.markup, 2) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-5">
          <SectionTitle>Observações gerenciais</SectionTitle>
          {doc.pendencies.length === 0 ? (
            <p className="mt-2 text-slate-700">
              Nenhuma pendência crítica identificada nos dados da proposta.
            </p>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-800">
              {doc.pendencies.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {doc.internalNotes ? (
            <p className="mt-2">
              <span className="font-semibold">Notas internas: </span>
              {doc.internalNotes}
            </p>
          ) : null}
          {doc.commercialNotes ? (
            <p className="mt-1">
              <span className="font-semibold">Notas comerciais: </span>
              {doc.commercialNotes}
            </p>
          ) : null}
        </section>

        <p className="mt-6 border-t border-slate-200 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {PROPOSAL_INTERNAL_MANAGEMENT_PDF_CONFIDENTIAL_MARK}
        </p>
      </div>
    </article>
  );
}
