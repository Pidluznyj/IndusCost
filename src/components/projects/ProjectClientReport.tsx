import React from "react";
import {
  PROJECT_CLIENT_REPORT_NOT_INFORMED,
  type ProjectClientReportPayload,
} from "@/src/lib/projectsClientReportShared";

type Props = {
  report: ProjectClientReportPayload;
  editable?: boolean;
  quantityDrafts?: Record<string, string>;
  quantityErrors?: Record<string, string>;
  onQuantityChange?: (productId: string, value: string) => void;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="project-client-report-section break-inside-avoid rounded-xl border border-slate-200 bg-white p-5 print:rounded-none print:border print:p-4">
      <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 print:border print:bg-white">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export function ProjectClientReport({
  report,
  editable = false,
  quantityDrafts,
  quantityErrors,
  onQuantityChange,
}: Props) {
  return (
    <article className="project-client-report-document mx-auto max-w-[1180px] bg-white p-6 print:p-0">
      <header className="mb-6 border-b border-slate-200 pb-4">
        <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{report.project.issuerName}</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{report.title}</h1>
        <div className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          <p>
            <span className="font-medium text-slate-900">Projeto:</span> {report.project.code} —{" "}
            {report.project.name}
          </p>
          <p>
            <span className="font-medium text-slate-900">Cliente:</span> {report.project.customerName}
          </p>
          <p>
            <span className="font-medium text-slate-900">Responsável comercial:</span>{" "}
            {report.project.commercialResponsibleName ?? PROJECT_CLIENT_REPORT_NOT_INFORMED}
          </p>
          <p>
            <span className="font-medium text-slate-900">Emissão:</span>{" "}
            {formatClientReportDate(report.project.issuedAt)}
          </p>
          {report.project.validUntil ? (
            <p>
              <span className="font-medium text-slate-900">Validade:</span>{" "}
              {formatClientReportDate(report.project.validUntil)}
            </p>
          ) : null}
        </div>
      </header>

      <Section title="Resumo executivo">
        <p className="text-sm leading-relaxed text-slate-700">{report.executiveSummary}</p>
      </Section>

      <div className="my-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Produtos" value={String(report.summary.productsCount)} />
        <SummaryCard
          label={report.summary.finalSetPriceLabel}
          value={formatClientReportMoney(report.summary.finalSetPrice)}
        />
        {report.summary.estimatedQuantity != null ? (
          <SummaryCard
            label="Quantidade estimada"
            value={String(report.summary.estimatedQuantity)}
          />
        ) : null}
        {report.summary.totalProposalValue != null ? (
          <SummaryCard
            label="Valor total estimado"
            value={formatClientReportMoney(report.summary.totalProposalValue)}
          />
        ) : null}
      </div>

      {report.summary.pricingPending ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Alguns produtos ainda não possuem preço comercial final salvo. Valores pendentes aparecem como
          “—”.
        </p>
      ) : null}

      <Section title="Produtos / peças">
        {editable ? (
          <p className="mb-3 text-sm text-slate-600">
            Edite a quantidade de cada item no conjunto antes de gerar a proposta.
          </p>
        ) : null}
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left print:bg-white">
                <th className="px-2 py-2 font-medium text-slate-700">Item</th>
                <th className="px-2 py-2 font-medium text-slate-700">Código/SKU</th>
                <th className="px-2 py-2 font-medium text-slate-700">Descrição</th>
                <th className="px-2 py-2 font-medium text-slate-700">Qtd/conjunto</th>
                <th className="px-2 py-2 font-medium text-slate-700">Unidade</th>
                <th className="px-2 py-2 font-medium text-slate-700">Preço unit. final</th>
                <th className="px-2 py-2 font-medium text-slate-700">Preço total</th>
                <th className="px-2 py-2 font-medium text-slate-700">Observações</th>
              </tr>
            </thead>
            <tbody>
              {report.products.map((product, index) => (
                <tr key={product.id} className="border-b border-slate-100">
                  <td className="px-2 py-2">{index + 1}</td>
                  <td className="px-2 py-2">{product.sku ?? "—"}</td>
                  <td className="px-2 py-2">{product.description}</td>
                  <td className="px-2 py-2 tabular-nums">
                    {editable ? (
                      <div className="space-y-1">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          value={quantityDrafts?.[product.id] ?? String(product.quantityPerSet)}
                          onChange={(event) => onQuantityChange?.(product.id, event.target.value)}
                          className="project-client-report-print-no-print w-20 rounded border border-slate-300 px-2 py-1 text-sm"
                          aria-label={`Qtd/conjunto — ${product.name}`}
                        />
                        {quantityErrors?.[product.id] ? (
                          <p className="project-client-report-print-no-print text-xs text-red-600">
                            {quantityErrors[product.id]}
                          </p>
                        ) : null}
                        <span className="hidden print:inline">{product.quantityPerSet}</span>
                      </div>
                    ) : (
                      product.quantityPerSet
                    )}
                  </td>
                  <td className="px-2 py-2">{product.unit}</td>
                  <td className="px-2 py-2 tabular-nums font-medium">
                    {formatClientReportMoney(product.finalUnitPrice)}
                  </td>
                  <td className="px-2 py-2 tabular-nums font-semibold">
                    {formatClientReportMoney(product.finalTotalPrice)}
                  </td>
                  <td className="px-2 py-2 text-slate-600">{product.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Totais comerciais">
        <div className="space-y-2 text-sm text-slate-700">
          <p>
            <span className="font-semibold text-slate-900">{report.summary.finalSetPriceLabel}:</span>{" "}
            {formatClientReportMoney(report.summary.finalSetPrice)}
          </p>
          {report.products.map((product) => (
            <p key={`line-${product.id}`}>
              {product.name}: {product.quantityPerSet} ×{" "}
              {formatClientReportMoney(product.finalUnitPrice)} ={" "}
              {formatClientReportMoney(product.finalTotalPrice)}
            </p>
          ))}
        </div>
      </Section>

      {(report.commercialTerms.paymentTerms ||
        report.commercialTerms.deliveryTerms ||
        report.commercialTerms.proposalValidity ||
        report.commercialTerms.freightTerms ||
        report.commercialTerms.exclusivity ||
        report.commercialTerms.notes) && (
        <Section title="Condições comerciais">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {report.commercialTerms.paymentTerms ? (
              <div>
                <dt className="font-medium text-slate-900">Condição de pagamento</dt>
                <dd className="text-slate-700">{report.commercialTerms.paymentTerms}</dd>
              </div>
            ) : null}
            {report.commercialTerms.deliveryTerms ? (
              <div>
                <dt className="font-medium text-slate-900">Prazo de entrega</dt>
                <dd className="text-slate-700">{report.commercialTerms.deliveryTerms}</dd>
              </div>
            ) : null}
            {report.commercialTerms.proposalValidity ? (
              <div>
                <dt className="font-medium text-slate-900">Validade da proposta</dt>
                <dd className="text-slate-700">{report.commercialTerms.proposalValidity}</dd>
              </div>
            ) : null}
            {report.commercialTerms.freightTerms ? (
              <div>
                <dt className="font-medium text-slate-900">Frete / Incoterm</dt>
                <dd className="text-slate-700">{report.commercialTerms.freightTerms}</dd>
              </div>
            ) : null}
            {report.commercialTerms.exclusivity ? (
              <div>
                <dt className="font-medium text-slate-900">Exclusividade</dt>
                <dd className="text-slate-700">{report.commercialTerms.exclusivity}</dd>
              </div>
            ) : null}
            {report.commercialTerms.notes ? (
              <div className="sm:col-span-2">
                <dt className="font-medium text-slate-900">Observações comerciais</dt>
                <dd className="text-slate-700">{report.commercialTerms.notes}</dd>
              </div>
            ) : null}
          </dl>
        </Section>
      )}

      <footer className="mt-8 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
        <p>{report.disclaimer}</p>
        <p className="mt-2">
          Documento gerado em {formatClientReportDate(report.generatedAt)} · {report.project.issuerName}
        </p>
      </footer>
    </article>
  );
}

function formatClientReportMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatClientReportDate(value: string | null | undefined): string {
  if (!value) return PROJECT_CLIENT_REPORT_NOT_INFORMED;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return PROJECT_CLIENT_REPORT_NOT_INFORMED;
  return parsed.toLocaleDateString("pt-BR");
}
