import * as XLSX from "xlsx";
import type { BillingAuditResult, BillingAuditRow } from "@/src/lib/financeBillingAuditTypes.js";

function rowToExportRecord(row: BillingAuditRow) {
  return {
    "Incluído no faturamento": row.includedInBilling ? "sim" : "não",
    "Motivo de exclusão": row.exclusionReason ?? "",
    "Código do motivo": row.exclusionReasonCode ?? "",
    Fonte: row.dataSource,
    Empresa: row.companyName ?? "",
    "CNPJ empresa": row.companyDocument ?? "",
    "Número NF": row.nfNumber ?? "",
    "Série NF": row.nfSeries ?? "",
    "Chave NF-e": row.nfKey ?? "",
    "Status NF-e": row.nfStatus ?? "",
    "Natureza da operação": row.operationNature ?? "",
    "CFOP principal": row.cfop ?? "",
    "Data emissão": row.issueDate ?? "",
    "Data processamento": row.processingDate ?? "",
    "Data competência usada": row.competenceDateUsed ?? "",
    Cliente: row.customerName ?? "",
    "CNPJ/CPF cliente": row.customerDocument ?? "",
    Vendedor: row.sellerName ?? "",
    "Pedido de venda": row.salesOrderCode ?? "",
    "Valor produtos": row.valueProducts ?? "",
    "Valor serviços": row.valueServices ?? "",
    "Valor frete": row.valueFreight ?? "",
    "Valor desconto": row.valueDiscount ?? "",
    "Valor impostos": row.valueTaxes ?? "",
    "Valor total NF": row.valueTotalNf ?? "",
    "Valor líquido": row.valueNet ?? "",
    "Valor usado no dashboard": row.valueUsedInDashboard ?? "",
    "Forma de cálculo": row.valueCalculationMode ?? "",
    Classificação: row.billingClassification ?? "",
    "Data importação/sync": row.importDate ?? row.syncedAt ?? "",
    Origem: row.originLabel ?? "",
    Observações: row.notes ?? "",
  };
}

export function buildBillingAuditWorkbook(result: BillingAuditResult): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const resumoRows = [
    { Campo: "Exportado em", Valor: result.generatedAt },
    { Campo: "Exportado por", Valor: result.exportedBy ?? "" },
    { Campo: "Fonte oficial do dashboard", Valor: result.summary.dataSourceOfficial },
    { Campo: "Data base", Valor: result.summary.dateBaseLabel },
    { Campo: "Campo de valor", Valor: result.summary.valueFieldLabel },
    { Campo: "Período", Valor: result.summary.periodLabel },
    { Campo: "De", Valor: result.summary.periodFrom },
    { Campo: "Até", Valor: result.summary.periodTo },
    { Campo: "Total dashboard", Valor: result.summary.dashboardDisplayedTotal ?? "" },
    { Campo: "Total bruto encontrado", Valor: result.summary.grossFoundTotal },
    { Campo: "Total incluído", Valor: result.summary.includedTotal },
    { Campo: "Total excluído", Valor: result.summary.excludedTotal },
    { Campo: "Qtd incluídas", Valor: result.summary.includedCount },
    { Campo: "Qtd excluídas", Valor: result.summary.excludedCount },
    { Campo: "Primeira data", Valor: result.summary.firstDate ?? "" },
    { Campo: "Última data", Valor: result.summary.lastDate ?? "" },
    { Campo: "Última sync Nomus", Valor: result.summary.lastNomusSyncAt ?? "" },
    ...result.filtersSummary.map((line) => {
      const [Campo, ...rest] = line.split(":");
      return { Campo: Campo?.trim() ?? line, Valor: rest.join(":").trim() };
    }),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), "Resumo");

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(result.includedRows.map(rowToExportRecord)),
    "Incluídas"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(result.excludedRows.map(rowToExportRecord)),
    "Excluídas"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(result.itemRows),
    "Itens"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(result.dailyTotals),
    "Totais por dia"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(result.customerTotals),
    "Totais por cliente"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(result.operationTotals),
    "Totais por CFOP"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(result.divergences),
    "Divergências"
  );

  return wb;
}

export function billingAuditWorkbookToBytes(workbook: XLSX.WorkBook): Uint8Array {
  const arr = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(arr);
}

export function financeBillingAuditExportFilename(year: number): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `faturamento-auditoria-${year}-${stamp}.xlsx`;
}

/** CSV simples (fallback) com todas as linhas oficiais. */
export function buildBillingAuditCsv(result: BillingAuditResult): string {
  const rows = [...result.includedRows, ...result.excludedRows].map(rowToExportRecord);
  if (!rows.length) return "Incluído no faturamento\n";
  const headers = Object.keys(rows[0]!);
  const lines = [
    headers.join(";"),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const v = String((r as Record<string, unknown>)[h] ?? "");
          return v.includes(";") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(";")
    ),
  ];
  return `\uFEFF${lines.join("\n")}`;
}
