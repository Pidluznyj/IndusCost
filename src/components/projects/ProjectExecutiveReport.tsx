import React from "react";
import {
  formatExecutiveReportDate,
  formatExecutiveReportMoney,
  formatExecutiveReportPercent,
  PROJECT_EXECUTIVE_REPORT_NOT_INFORMED,
  PROJECT_EXECUTIVE_REPORT_TITLE,
  type ProjectExecutiveReportPayload,
} from "@/src/lib/projectsExecutiveReport";

type Props = {
  report: ProjectExecutiveReportPayload;
};

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`project-executive-report-section break-inside-avoid rounded-xl border border-slate-200 bg-white p-5 print:rounded-none print:border print:p-4 ${className ?? ""}`}
    >
      <h2 className="project-executive-report-section-title mb-3 text-base font-semibold text-slate-900">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 print:border print:bg-white">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
}) {
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="project-executive-report-table w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left print:bg-white">
            {headers.map((header) => (
              <th key={header} className="px-2 py-2 font-medium text-slate-700">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-slate-100">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-2 py-2 align-top text-slate-800">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CheckboxLine({ label }: { label: string }) {
  return (
    <p className="text-sm text-slate-800">
      <span className="mr-2 inline-block h-4 w-4 border border-slate-400 align-middle" />
      {label}
    </p>
  );
}

export function ProjectExecutiveReport({ report }: Props) {
  const { project, executiveSummary, economicAnalysis } = report;

  return (
    <div className="project-executive-report-document mx-auto w-full max-w-[1180px] bg-white text-slate-900 shadow-sm print:max-w-none print:shadow-none">
      <header className="project-executive-report-header border-b border-slate-200 px-6 py-5 print:px-0">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">IndusCost</p>
        <h1 className="mt-1 text-2xl font-bold">{PROJECT_EXECUTIVE_REPORT_TITLE}</h1>
        <table className="mt-4 w-full text-sm">
          <tbody>
            <tr>
              <th className="w-40 py-1 pr-3 text-left font-medium text-slate-600">Projeto</th>
              <td className="py-1 pr-6">
                {project.code} — {project.name}
              </td>
              <th className="w-40 py-1 pr-3 text-left font-medium text-slate-600">Cliente</th>
              <td className="py-1">{project.customerName}</td>
            </tr>
            <tr>
              <th className="py-1 pr-3 text-left font-medium text-slate-600">Status</th>
              <td className="py-1 pr-6">{project.statusLabel}</td>
              <th className="py-1 pr-3 text-left font-medium text-slate-600">Tipo</th>
              <td className="py-1">{project.typeLabel}</td>
            </tr>
            <tr>
              <th className="py-1 pr-3 text-left font-medium text-slate-600">Data de emissão</th>
              <td className="py-1 pr-6">{formatExecutiveReportDate(report.generatedAt)}</td>
              <th className="py-1 pr-3 text-left font-medium text-slate-600">Versão</th>
              <td className="py-1">{project.versionLabel}</td>
            </tr>
            <tr>
              <th className="py-1 pr-3 text-left font-medium text-slate-600">Responsável comercial</th>
              <td className="py-1 pr-6">
                {project.commercialOwner ?? PROJECT_EXECUTIVE_REPORT_NOT_INFORMED}
              </td>
              <th className="py-1 pr-3 text-left font-medium text-slate-600">Responsável técnico</th>
              <td className="py-1">
                {project.technicalOwner ?? PROJECT_EXECUTIVE_REPORT_NOT_INFORMED}
              </td>
            </tr>
          </tbody>
        </table>
      </header>

      <div className="space-y-5 px-6 py-5 print:space-y-4 print:px-0">
        <Section title="Objetivo / Escopo">
          <p className="text-sm leading-relaxed text-slate-700">{report.scope.objective}</p>
          {report.scope.notes ? (
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-medium">Observações gerais:</span> {report.scope.notes}
            </p>
          ) : null}
        </Section>

        <Section title="Resumo executivo financeiro">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SummaryCard
              label="Custo base dos itens"
              value={formatExecutiveReportMoney(executiveSummary.baseItemsCost)}
              hint="Soma unitária antes da amortização"
            />
            <SummaryCard
              label="Investimento em moldes"
              value={formatExecutiveReportMoney(executiveSummary.moldsTotal)}
            />
            <SummaryCard
              label="Outros custos"
              value={formatExecutiveReportMoney(executiveSummary.otherCostsTotal)}
            />
            <SummaryCard
              label="Investimento total"
              value={formatExecutiveReportMoney(executiveSummary.investmentTotal)}
            />
            <SummaryCard
              label="Valor repassado via amortização"
              value={formatExecutiveReportMoney(executiveSummary.amortizedToCustomer)}
            />
            <SummaryCard
              label="Valor absorvido internamente"
              value={formatExecutiveReportMoney(executiveSummary.absorbedInternally)}
            />
            <SummaryCard
              label="Custo final dos itens com amortização"
              value={formatExecutiveReportMoney(executiveSummary.finalItemsCost)}
            />
            <SummaryCard
              label="Custo total do projeto"
              value={formatExecutiveReportMoney(executiveSummary.totalProjectCost)}
            />
            <SummaryCard
              label="Itens pendentes de custo"
              value={String(executiveSummary.pendingItemsCount)}
            />
          </div>
        </Section>

        <Section title="Decisão solicitada">
          <p className="text-sm leading-relaxed text-slate-800">{report.decision.text}</p>
          {report.decision.warnings.map((warning) => (
            <p key={warning} className="mt-2 text-sm font-medium text-amber-800">
              {warning}
            </p>
          ))}
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            <CheckboxLine label="Aprovado" />
            <CheckboxLine label="Reprovado" />
            <CheckboxLine label="Revisar custos" />
            <CheckboxLine label="Revisar amortização" />
            <CheckboxLine label="Revisar preço/margem" />
          </div>
        </Section>

        <Section title="Itens do projeto">
          {report.items.length === 0 ? (
            <p className="text-sm text-slate-600">Nenhum item principal cadastrado.</p>
          ) : (
            <DataTable
              headers={[
                "Item",
                "Tipo",
                "Origem",
                "Custo base unit.",
                "Amort. unit.",
                "Custo final unit.",
                "Qtd. base",
                "Custo total est.",
                "Status",
              ]}
              rows={report.items.map((item) => [
                item.name,
                item.typeLabel,
                item.originLabel,
                formatExecutiveReportMoney(item.baseUnitCost),
                formatExecutiveReportMoney(item.unitAmortizedCost),
                formatExecutiveReportMoney(item.finalUnitCost),
                item.baseQuantity.toLocaleString("pt-BR"),
                formatExecutiveReportMoney(item.estimatedTotalCost),
                item.statusLabel,
              ])}
            />
          )}
        </Section>

        <Section title="Moldes">
          {report.molds.length === 0 ? (
            <p className="text-sm text-slate-600">Nenhum molde cadastrado.</p>
          ) : (
            <DataTable
              headers={[
                "Molde",
                "Status",
                "Descrição",
                "Custo total",
                "% repassado",
                "Valor repassado",
                "Valor absorvido",
                "Status amortização",
                "Itens impactados",
              ]}
              rows={report.molds.map((mold) => [
                mold.name,
                mold.statusLabel,
                mold.description,
                formatExecutiveReportMoney(mold.totalCost),
                formatExecutiveReportPercent(mold.passThroughPercent),
                formatExecutiveReportMoney(mold.passThroughAmount),
                formatExecutiveReportMoney(mold.absorbedAmount),
                mold.amortizationStatus,
                mold.impactedItems.join(", ") || "—",
              ])}
            />
          )}
        </Section>

        <Section title="Outros custos">
          {report.otherCosts.length === 0 ? (
            <p className="text-sm text-slate-600">Nenhum outro custo cadastrado.</p>
          ) : (
            <DataTable
              headers={[
                "Descrição",
                "Grupo",
                "Fornecedor",
                "Custo total",
                "% repassado",
                "Valor repassado",
                "Valor absorvido",
                "Status amortização",
                "Observação",
              ]}
              rows={report.otherCosts.map((row) => [
                row.description,
                row.groupLabel,
                row.supplierName ?? "—",
                formatExecutiveReportMoney(row.totalCost),
                formatExecutiveReportPercent(row.passThroughPercent),
                formatExecutiveReportMoney(row.passThroughAmount),
                formatExecutiveReportMoney(row.absorbedAmount),
                row.amortizationStatus,
                row.notes ?? "—",
              ])}
            />
          )}
        </Section>

        <Section title="Memória de amortização">
          {report.amortizationMemory.length === 0 ? (
            <p className="text-sm text-slate-600">Amortização não configurada.</p>
          ) : (
            <>
              <DataTable
                headers={[
                  "Fonte do custo",
                  "Tipo",
                  "Item impactado",
                  "% repassado",
                  "% distribuição",
                  "Valor alocado",
                  "Qtd. base",
                  "Custo unit. amortizado",
                ]}
                rows={report.amortizationMemory.map((row) => [
                  row.sourceLabel,
                  row.sourceTypeLabel,
                  row.targetItemLabel,
                  formatExecutiveReportPercent(row.passThroughPercent),
                  formatExecutiveReportPercent(row.allocationPercent),
                  formatExecutiveReportMoney(row.allocatedAmount),
                  row.amortizationQuantity.toLocaleString("pt-BR"),
                  formatExecutiveReportMoney(row.unitAmortizedCost),
                ])}
              />
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SummaryCard
                  label="Total repassado via amortização"
                  value={formatExecutiveReportMoney(executiveSummary.amortizedToCustomer)}
                />
                <SummaryCard
                  label="Total absorvido internamente"
                  value={formatExecutiveReportMoney(executiveSummary.absorbedInternally)}
                />
                <SummaryCard
                  label="Total não distribuído"
                  value={formatExecutiveReportMoney(executiveSummary.totalUnallocatedAmortization)}
                />
                <SummaryCard
                  label="Status geral da amortização"
                  value={executiveSummary.overallAmortizationStatus}
                />
              </div>
            </>
          )}
        </Section>

        <Section title="Resultado econômico / comercial">
          {economicAnalysis.pending ? (
            <p className="text-sm text-slate-700">{economicAnalysis.message}</p>
          ) : (
            <>
              {economicAnalysis.pricingItems.map((item) => (
                <div key={item.targetItemId} className="mb-5">
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">
                    {item.displayName}
                    <span className="ml-2 font-normal text-slate-500">
                      · qtde {item.quantity.toLocaleString("pt-BR")}
                    </span>
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <SummaryCard
                      label="Custo final unitário"
                      value={formatExecutiveReportMoney(item.finalUnitCost)}
                    />
                    <SummaryCard
                      label="Preço sem amortização"
                      value={formatExecutiveReportMoney(item.suggestedPriceWithoutAmortization)}
                    />
                    <SummaryCard
                      label="Preço com amortização"
                      value={formatExecutiveReportMoney(
                        item.suggestedPriceWithAmortization ?? item.suggestedPrice
                      )}
                    />
                    <SummaryCard
                      label="Regra fiscal"
                      value={item.fiscalRuleName ?? "—"}
                    />
                    <SummaryCard
                      label="Impostos %"
                      value={formatExecutiveReportPercent(item.taxPercent)}
                    />
                    <SummaryCard
                      label="Valor impostos (total)"
                      value={formatExecutiveReportMoney(item.taxAmount)}
                    />
                    <SummaryCard
                      label="Margem desejada"
                      value={formatExecutiveReportPercent(item.targetMarginPercent)}
                    />
                    <SummaryCard
                      label="Valor margem (total)"
                      value={formatExecutiveReportMoney(item.marginAmount)}
                    />
                    <SummaryCard
                      label="Receita s/ amortização"
                      value={formatExecutiveReportMoney(item.revenueWithoutAmortization)}
                    />
                    <SummaryCard
                      label="Receita c/ amortização"
                      value={formatExecutiveReportMoney(item.revenueWithAmortization)}
                    />
                    <SummaryCard
                      label="Retorno da amortização"
                      value={formatExecutiveReportMoney(item.amortizationReturn)}
                    />
                    <SummaryCard
                      label="Lucro bruto estimado"
                      value={formatExecutiveReportMoney(item.estimatedGrossProfit)}
                    />
                  </div>
                </div>
              ))}

              {economicAnalysis.portfolio.productCount > 0 ? (
                <div className="mt-2">
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">
                    Totais do portfólio
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <SummaryCard
                      label="Receita total s/ amortização"
                      value={formatExecutiveReportMoney(
                        economicAnalysis.portfolio.totalRevenueWithoutAmortization
                      )}
                    />
                    <SummaryCard
                      label="Receita total c/ amortização"
                      value={formatExecutiveReportMoney(
                        economicAnalysis.portfolio.totalRevenueWithAmortization
                      )}
                    />
                    <SummaryCard
                      label="Retorno total da amortização"
                      value={formatExecutiveReportMoney(
                        economicAnalysis.portfolio.totalAmortizationReturn
                      )}
                    />
                    <SummaryCard
                      label="Custo total dos produtos"
                      value={formatExecutiveReportMoney(economicAnalysis.portfolio.totalCost)}
                    />
                    <SummaryCard
                      label="Lucro bruto total estimado"
                      value={formatExecutiveReportMoney(
                        economicAnalysis.portfolio.totalEstimatedGrossProfit
                      )}
                    />
                    <SummaryCard
                      label="Quantidade total"
                      value={
                        economicAnalysis.portfolio.totalQuantity != null
                          ? economicAnalysis.portfolio.totalQuantity.toLocaleString("pt-BR")
                          : "—"
                      }
                    />
                  </div>
                </div>
              ) : null}

              {economicAnalysis.pricingItems.length > 0 ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="project-executive-report-table w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left">
                        <th className="px-2 py-2">Item</th>
                        <th className="px-2 py-2">Qtde</th>
                        <th className="px-2 py-2">Custo unit.</th>
                        <th className="px-2 py-2">Preço s/ amort.</th>
                        <th className="px-2 py-2">Preço c/ amort.</th>
                        <th className="px-2 py-2">Retorno amort.</th>
                        <th className="px-2 py-2">Lucro bruto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {economicAnalysis.pricingItems.map((item) => (
                        <tr key={item.targetItemId} className="border-b border-slate-100">
                          <td className="px-2 py-2">{item.displayName}</td>
                          <td className="px-2 py-2">{item.quantity.toLocaleString("pt-BR")}</td>
                          <td className="px-2 py-2">
                            {formatExecutiveReportMoney(item.finalUnitCost)}
                          </td>
                          <td className="px-2 py-2">
                            {formatExecutiveReportMoney(item.suggestedPriceWithoutAmortization)}
                          </td>
                          <td className="px-2 py-2">
                            {formatExecutiveReportMoney(
                              item.suggestedPriceWithAmortization ?? item.suggestedPrice
                            )}
                          </td>
                          <td className="px-2 py-2">
                            {formatExecutiveReportMoney(item.amortizationReturn)}
                          </td>
                          <td className="px-2 py-2">
                            {formatExecutiveReportMoney(item.estimatedGrossProfit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </Section>

        <Section title="Riscos e observações">
          <div className="space-y-3 text-sm text-slate-700">
            <div>
              <p className="font-medium text-slate-900">Riscos técnicos</p>
              {report.risks.technicalRisks.length > 0 ? (
                <ul className="mt-1 list-disc pl-5">
                  {report.risks.technicalRisks.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-slate-600">Nenhum risco técnico registrado.</p>
              )}
            </div>
            <div>
              <p className="font-medium text-slate-900">Alertas automáticos</p>
              {report.risks.automaticAlerts.length > 0 ? (
                <ul className="mt-1 list-disc pl-5">
                  {report.risks.automaticAlerts.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-slate-600">Nenhum alerta automático.</p>
              )}
            </div>
            {report.risks.notes ? (
              <p>
                <span className="font-medium text-slate-900">Observações:</span> {report.risks.notes}
              </p>
            ) : null}
          </div>
        </Section>

        <Section title="Aprovação / assinaturas" className="page-break-before">
          <div className="grid gap-4 md:grid-cols-2">
            <p className="text-sm">
              <span className="font-medium">Elaborado por:</span> {report.approval.preparedBy}
            </p>
            <p className="text-sm">
              <span className="font-medium">Revisado por:</span> {report.approval.reviewedBy}
            </p>
            <p className="text-sm">
              <span className="font-medium">Aprovado por:</span> {report.approval.approvedBy}
            </p>
            <p className="text-sm">
              <span className="font-medium">Data:</span> ____________________
            </p>
          </div>
          <p className="mt-4 text-sm">
            <span className="font-medium">Assinatura:</span> ________________________________________
          </p>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <CheckboxLine label="Aprovado" />
            <CheckboxLine label="Reprovado" />
            <CheckboxLine label="Revisar" />
          </div>
          <p className="mt-4 text-xs text-slate-500">{report.technicalAnnex.message}</p>
        </Section>
      </div>
    </div>
  );
}
