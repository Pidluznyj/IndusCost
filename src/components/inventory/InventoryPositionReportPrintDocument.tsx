import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintDocumentShell } from "@/src/components/print/PrintDocumentShell";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import { PrintSection } from "@/src/components/print/PrintSection";
import { PrintTable } from "@/src/components/print/PrintTable";
import { formatPrintDateTime } from "@/src/lib/printBranding";
import type {
  InventoryPositionReport,
  InventoryPositionReportSection,
} from "@/src/lib/inventory/inventoryPositionReport";

function formatMoney(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatQty(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return number.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function SectionTable({
  section,
  companyName,
  emittedAt,
}: {
  section: InventoryPositionReportSection;
  companyName: string;
  emittedAt: string;
}) {
  const showSale = section.itemType !== "RAW_MATERIAL";
  const colSpan = showSale ? 8 : 6;
  return (
    <PrintTable className={showSale ? "inventory-position-report-table has-sale" : "inventory-position-report-table"}>
      <colgroup>
        <col className="col-code" />
        <col className="col-desc" />
        <col className="col-unit" />
        <col className="col-qty" />
        <col className="col-money" />
        <col className="col-money" />
        {showSale ? (
          <>
            <col className="col-money" />
            <col className="col-money" />
          </>
        ) : null}
      </colgroup>
      <thead>
        <tr className="inventory-position-report-repeat">
          <th colSpan={colSpan}>
            {companyName} · Posição de estoque · {section.title} · Emitido em {emittedAt}
          </th>
        </tr>
        <tr>
          <th className="col-code">Código</th>
          <th className="col-desc">Descrição</th>
          <th className="col-unit">Un.</th>
          <th className="col-qty">Quantidade</th>
          <th className="col-money">Custo unitário</th>
          <th className="col-money">Valor contábil</th>
          {showSale ? (
            <>
              <th className="col-money">Preço Varejo 1</th>
              <th className="col-money">Valor de venda</th>
            </>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {section.rows.length === 0 ? (
          <tr>
            <td colSpan={colSpan}>Nenhum item com saldo físico positivo.</td>
          </tr>
        ) : (
          section.rows.map((row) => (
            <tr key={`${section.itemType}-${row.itemCode}`}>
              <td className="col-code">{row.itemCode}</td>
              <td className="col-desc">{row.description}</td>
              <td className="col-unit">{row.unit}</td>
              <td className="col-qty">{formatQty(row.physicalQuantity)}</td>
              <td className="col-money">{formatMoney(row.unitCost)}</td>
              <td className="col-money">{formatMoney(row.totalCost)}</td>
              {showSale ? (
                <>
                  <td className="col-money">{formatMoney(row.unitSalePrice)}</td>
                  <td className="col-money">{formatMoney(row.totalSaleValue)}</td>
                </>
              ) : null}
            </tr>
          ))
        )}
      </tbody>
      <tfoot>
        <tr>
          <th colSpan={5}>
            Total · {section.itemCount} itens · {section.costUncoveredItems} sem custo
            {showSale ? ` · ${section.saleUncoveredItems} sem preço de venda` : ""}
          </th>
          <th className="num">{formatMoney(section.costTotal)}</th>
          {showSale ? (
            <>
              <th />
              <th className="num">{formatMoney(section.saleTotal)}</th>
            </>
          ) : null}
        </tr>
      </tfoot>
    </PrintTable>
  );
}

export function InventoryPositionReportPrintDocument({
  report,
  branding,
}: {
  report: InventoryPositionReport;
  branding: BrandingSettingsDTO;
}) {
  const emittedAt = formatPrintDateTime(report.generatedAt);
  return (
    <PrintDocumentShell
      rootId="inventory-position-report-print-root"
      className="inventory-position-report-document"
      footer={
        <p>
          {branding.companyName} · Documento gerado pelo IndusCost em {emittedAt}. Valor contábil e valor de
          venda estão identificados em separado.
        </p>
      }
    >
      <PrintHeader
        branding={branding}
        documentKind="RELATÓRIO"
        documentTitle="POSIÇÃO DE ESTOQUE"
        metaLines={[
          { label: "Emitido em", value: emittedAt },
          { label: "População", value: "Saldo físico positivo" },
          { label: "Tipos", value: "MP, componentes e produtos acabados" },
          { label: "Uso", value: "Contabilidade e Bloco K" },
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

      <PrintSection title="Como o valor foi formado">
        <ul className="inventory-position-report-notes">
          {report.methodology.map((line) => (
            <li key={line}>{line}</li>
          ))}
          {report.materialCostUnavailableReason ? <li>{report.materialCostUnavailableReason}</li> : null}
          {report.factoryCostUnavailableReason ? <li>{report.factoryCostUnavailableReason}</li> : null}
          {report.retailUnavailableReason ? <li>{report.retailUnavailableReason}</li> : null}
          {report.excludedOtherPositiveItems > 0 ? (
            <li>
              {report.excludedOtherPositiveItems} itens de outros tipos têm saldo positivo e ficam fora deste
              relatório.
            </li>
          ) : null}
        </ul>
      </PrintSection>

      {report.sections.map((section) => (
        <PrintSection key={section.itemType} title={`${section.title} · ${section.costBasisLabel}`} flow>
          <SectionTable section={section} companyName={branding.companyName} emittedAt={emittedAt} />
        </PrintSection>
      ))}

      <PrintSection title="Saldos negativos fora dos totais" flow>
        {report.negativeLines.length === 0 ? (
          <p>Nenhum saldo físico negativo.</p>
        ) : (
          <PrintTable className="inventory-position-report-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Tipo</th>
                <th>Un.</th>
                <th>Quantidade</th>
              </tr>
            </thead>
            <tbody>
              {report.negativeLines.map((line) => (
                <tr key={`${line.itemTypeLabel}-${line.itemCode}`}>
                  <td>{line.itemCode}</td>
                  <td>{line.description}</td>
                  <td>{line.itemTypeLabel}</td>
                  <td>{line.unit}</td>
                  <td className="num">{formatQty(line.physicalQuantity)}</td>
                </tr>
              ))}
            </tbody>
          </PrintTable>
        )}
      </PrintSection>
    </PrintDocumentShell>
  );
}
