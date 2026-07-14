import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import { PrintSection } from "@/src/components/print/PrintSection";
import { PrintDocumentShell } from "@/src/components/print/PrintDocumentShell";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import {
  SERVICE_TERMINATION_PRINT_DOCUMENT_TITLE,
  SERVICE_TERMINATION_PRINT_FOOTER_NOTE,
  SERVICE_TERMINATION_PRINT_SUBTITLE,
  type ServiceTerminationPrintModel,
} from "@/src/lib/suppliers/supplierServiceTerminationPrint";

function money(n: number): string {
  return formatFinanceCurrency(n);
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="font-semibold text-slate-600">{label}: </span>
      {value}
    </p>
  );
}

/**
 * Relatório profissional de verbas de encerramento — layout no padrão do Pedido de Venda
 * (PrintHeader institucional + seções + tabelas + totais).
 */
export function SupplierServiceTerminationPrintDocument({
  model,
  branding,
  issuedAt,
  emitterName,
}: {
  model: ServiceTerminationPrintModel;
  branding: BrandingSettingsDTO;
  issuedAt: string;
  emitterName?: string | null;
}) {
  return (
    <PrintDocumentShell
      rootId="supplier-service-termination-print-root"
      className="service-termination-print-document sales-order-print-document proposal-compact-document proposal-print-sheet mx-auto w-full max-w-[210mm] border border-slate-300 bg-white text-slate-800 shadow-sm print:max-w-none print:border-0 print:shadow-none"
    >
      <div className="proposal-print-document-inner p-4 text-xs leading-snug md:p-5 md:text-[13px] print:p-3">
        <h1 className="sr-only">
          Encerramento de prestação de serviço — {model.personName}
        </h1>

        <PrintHeader
          branding={branding}
          documentTitle={SERVICE_TERMINATION_PRINT_DOCUMENT_TITLE}
          documentHighlight={model.documentHighlight}
          subtitle={SERVICE_TERMINATION_PRINT_SUBTITLE}
          metaLines={[
            { label: "Emitido em", value: issuedAt },
            { label: "Emitido por", value: emitterName?.trim() || "—" },
            { label: "Fornecedor", value: model.supplierName },
            { label: "Status", value: model.statusLabel },
          ]}
          className="proposal-compact-header proposal-print-section"
        />

        <PrintSection
          title="1. Identificação"
          className="proposal-compact-section proposal-print-section mt-4"
        >
          <div className="mt-2 grid gap-1 border-y border-slate-200 py-2 text-[11px] sm:grid-cols-2 sm:text-xs">
            <Kv label="Fornecedor" value={model.supplierName} />
            <Kv label="Prestador" value={model.personName} />
            <Kv label="Documento" value={model.personDocument} />
            <Kv label="Função / serviço" value={model.serviceRole} />
            <Kv label="Período do contrato" value={model.periodLabel} />
            <Kv label="Status do encerramento" value={model.statusLabel} />
          </div>
        </PrintSection>

        <PrintSection
          title="2. Base de cálculo"
          className="proposal-compact-section proposal-print-section mt-4"
        >
          <table className="mt-2 w-full border-collapse text-[11px] sm:text-xs">
            <tbody>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">Valor mensal</th>
                <td className="py-1 text-right font-mono">{money(model.monthlyServiceAmount)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">
                  Dias médios trabalhados/mês
                </th>
                <td className="py-1 text-right font-mono">{model.averageWorkedDaysPerMonth}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">Horas por dia</th>
                <td className="py-1 text-right font-mono">{model.hoursPerDay}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">Horas por mês</th>
                <td className="py-1 text-right font-mono">{model.monthlyHours}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">Valor hora</th>
                <td className="py-1 text-right font-mono">{money(model.hourlyServiceAmount)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">Valor dia</th>
                <td className="py-1 text-right font-mono">{money(model.dailyServiceAmount)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">
                  Descanso anual contratado
                </th>
                <td className="py-1 text-right font-mono">{model.restDaysPerYear} dias</td>
              </tr>
              <tr>
                <th className="py-1 text-left font-semibold text-slate-600">Modo de cálculo</th>
                <td className="py-1 text-right">{model.calcModeLabel}</td>
              </tr>
            </tbody>
          </table>
        </PrintSection>

        <PrintSection
          title="3. Cálculo proporcional e dias a mais"
          className="proposal-compact-section proposal-print-section mt-4"
        >
          <table className="mt-2 w-full border-collapse text-[11px] sm:text-xs">
            <tbody>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">Meses trabalhados</th>
                <td className="py-1 text-right font-mono">{model.workedMonths}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">Dias trabalhados</th>
                <td className="py-1 text-right font-mono">{model.workedDays}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">
                  Dias proporcionais de descanso
                </th>
                <td className="py-1 text-right font-mono">
                  {model.proportionalRestDaysLabel} dias
                </td>
              </tr>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">
                  Valor descanso proporcional
                </th>
                <td className="py-1 text-right font-mono font-semibold">
                  {money(model.proportionalRestAmount)}
                </td>
              </tr>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">Dias a mais</th>
                <td className="py-1 text-right font-mono">{model.extraWorkedDays}</td>
              </tr>
              <tr>
                <th className="py-1 text-left font-semibold text-slate-600">
                  Valor dias a mais
                </th>
                <td className="py-1 text-right font-mono font-semibold">
                  {money(model.extraWorkedAmount)}
                </td>
              </tr>
            </tbody>
          </table>
        </PrintSection>

        <PrintSection
          title="4. Comissões vinculadas e lançamentos manuais"
          flow
          className="proposal-print-items-section proposal-compact-section proposal-print-section mt-5"
        >
          {model.commissionRows.length === 0 ? (
            <p className="mt-2 text-[11px] text-slate-600 sm:text-xs">
              Nenhuma comissão vinculada ou lançada.
            </p>
          ) : (
            <div className="proposal-print-table-wrap mt-2 overflow-visible">
              <table className="proposal-compact-table w-full border-collapse border border-slate-300 text-[10px] sm:text-[11px]">
                <thead>
                  <tr className="bg-slate-100 text-[9px] uppercase tracking-wide text-slate-700 sm:text-[10px]">
                    <th className="border border-slate-300 px-1 py-1">Pedido</th>
                    <th className="border border-slate-300 px-1 py-1">Referência</th>
                    <th className="border border-slate-300 px-1 py-1">Pessoa</th>
                    <th className="border border-slate-300 px-1 py-1">Fonte</th>
                    <th className="border border-slate-300 px-1 py-1 text-right">
                      Comissão
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {model.commissionRows.map((row, idx) => (
                    <tr key={`${row.orderCode}-${idx}`} className="border-b border-slate-200">
                      <td className="px-1.5 py-1 font-mono">{row.orderCode}</td>
                      <td className="px-1.5 py-1">{row.description}</td>
                      <td className="px-1.5 py-1">{row.personName}</td>
                      <td className="px-1.5 py-1">{row.source}</td>
                      <td className="px-1.5 py-1 text-right font-mono font-semibold">
                        {money(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold">
                    <td className="border border-slate-300 px-1.5 py-1" colSpan={4}>
                      Total comissões
                    </td>
                    <td className="border border-slate-300 px-1.5 py-1 text-right font-mono">
                      {money(model.commissionReportTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </PrintSection>

        <PrintSection
          title="5. Multa e ajustes"
          className="proposal-compact-section proposal-print-section mt-4"
        >
          <table className="mt-2 w-full border-collapse text-[11px] sm:text-xs">
            <tbody>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">
                  Multa sem aviso de 30 dias
                </th>
                <td className="py-1 text-right font-mono">
                  {money(model.noticePenaltyAmount)}
                </td>
              </tr>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">Outros créditos</th>
                <td className="py-1 text-right font-mono">{money(model.otherCredits)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">Outros descontos</th>
                <td className="py-1 text-right font-mono">{money(model.otherDiscounts)}</td>
              </tr>
              {model.adjustmentNotes ? (
                <tr>
                  <th className="py-1 text-left font-semibold text-slate-600">
                    Obs. do ajuste
                  </th>
                  <td className="py-1 text-right">{model.adjustmentNotes}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </PrintSection>

        <PrintSection
          title="6. Totalização"
          className="proposal-compact-section proposal-print-section mt-4"
        >
          <table className="mt-2 w-full border-collapse border border-slate-300 text-[11px] sm:text-xs">
            <tbody>
              {model.totalizationRows.map((row) => (
                <tr
                  key={row.label}
                  className={
                    row.emphasize
                      ? "bg-slate-100 font-bold text-slate-900"
                      : "border-b border-slate-100"
                  }
                >
                  <th className="border border-slate-200 px-2 py-1.5 text-left font-semibold">
                    {row.label}
                  </th>
                  <td
                    className={`border border-slate-200 px-2 py-1.5 text-right font-mono ${
                      row.emphasize ? "text-base" : ""
                    }`}
                  >
                    {money(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PrintSection>

        {model.notes ? (
          <PrintSection
            title="Observações"
            className="proposal-compact-section proposal-print-section mt-5"
          >
            <p className="mt-2 whitespace-pre-wrap text-[11px] text-slate-700 sm:text-xs">
              {model.notes}
            </p>
          </PrintSection>
        ) : null}

        <div className="proposal-compact-footer proposal-print-section mt-6 flex flex-col justify-between gap-1 border-t border-slate-300 pt-2 text-[10px] text-slate-600 sm:flex-row sm:text-[11px]">
          <p>{branding.companyName}</p>
          <p>{SERVICE_TERMINATION_PRINT_FOOTER_NOTE}</p>
          <p>{issuedAt}</p>
        </div>
      </div>
    </PrintDocumentShell>
  );
}
