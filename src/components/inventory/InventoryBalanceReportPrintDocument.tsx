import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintDocumentShell } from "@/src/components/print/PrintDocumentShell";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import { PrintSection } from "@/src/components/print/PrintSection";
import { PrintTable } from "@/src/components/print/PrintTable";
import { formatPrintDateTime } from "@/src/lib/printBranding";
import type { InventoryBalanceReport } from "@/src/lib/inventory/inventoryBalanceReport";

function formatQty(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }).replace(", ", " ");
}

/**
 * PDF do relatório de saldos (Estoque › Saldos). Mesma casca, classes e folha de
 * estilo da posição de estoque, para os dois relatórios saírem com a mesma cara.
 */
export function InventoryBalanceReportPrintDocument({
  report,
  branding,
}: {
  report: InventoryBalanceReport;
  branding: BrandingSettingsDTO;
}) {
  const emittedAt = formatPrintDateTime(report.generatedAt);
  const colSpan = 6;
  const totals = [
    `${report.itemCount} itens`,
    report.zeroItems > 0 ? `${report.zeroItems} zerados` : null,
    report.negativeItems > 0 ? `${report.negativeItems} negativos` : null,
  ].filter((part): part is string => part != null);

  return (
    <PrintDocumentShell
      rootId="inventory-position-report-print-root"
      className="inventory-position-report-document"
      footer={
        <p>
          {branding.companyName} · Documento gerado pelo IndusCost em {emittedAt}.
        </p>
      }
    >
      <PrintHeader
        branding={branding}
        documentKind="RELATÓRIO"
        documentTitle="SALDOS DE ESTOQUE"
        metaLines={[
          { label: "Emitido em", value: emittedAt },
          { label: "Itens", value: String(report.itemCount) },
          { label: "Ordem", value: "Maior saldo para o menor" },
          { label: "Uso", value: "Análise de compra" },
        ]}
        subtitle={report.purpose}
      />

      <PrintSection title="Filtros utilizados">
        <PrintTable className="inventory-position-report-meta">
          <tbody>
            {report.filters.map((filter) => (
              <tr key={filter.label}>
                <th>{filter.label}</th>
                <td>{filter.value}</td>
              </tr>
            ))}
          </tbody>
        </PrintTable>
      </PrintSection>

      <PrintSection title="Como ler">
        <ul className="inventory-position-report-notes">
          {report.notes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </PrintSection>

      <PrintSection title="Saldo por item" flow>
        <PrintTable className="inventory-position-report-table is-balance">
          <colgroup>
            <col className="col-code" />
            <col className="col-desc" />
            <col className="col-unit" />
            <col className="col-qty" />
            <col className="col-date" />
            <col className="col-date" />
          </colgroup>
          <thead>
            <tr className="inventory-position-report-repeat">
              <th colSpan={colSpan}>
                {branding.companyName} · Saldos de estoque · Emitido em {emittedAt}
              </th>
            </tr>
            <tr>
              <th className="col-code">Código</th>
              <th className="col-desc">Descrição</th>
              <th className="col-unit">Un.</th>
              <th className="col-qty">Saldo</th>
              <th className="col-date">Última contagem</th>
              <th className="col-date">Última movimentação</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan}>Nenhum item com saldo registrado para os filtros informados.</td>
              </tr>
            ) : (
              report.rows.map((row) => (
                <tr key={row.itemCode}>
                  <td className="col-code">{row.itemCode}</td>
                  <td className="col-desc">{row.description}</td>
                  <td className="col-unit">{row.unit}</td>
                  <td className={row.physicalQuantity < 0 ? "col-qty is-negative" : "col-qty"}>
                    {formatQty(row.physicalQuantity)}
                  </td>
                  <td className="col-date">{formatDate(row.lastCountAt)}</td>
                  <td className="col-date">{formatDate(row.lastMovementAt)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={colSpan}>Total · {totals.join(" · ")}</th>
            </tr>
          </tfoot>
        </PrintTable>
      </PrintSection>
    </PrintDocumentShell>
  );
}
