import * as XLSX from "xlsx";
import type { SoldProductsDashboardPayload } from "@/src/lib/salesProductRankingTypes.js";
import { soldProductsFilterSummaryLines } from "@/src/lib/salesProductRankingFilters.js";

function numOrBlank(v: number | null | undefined): number | "" {
  if (v == null || !Number.isFinite(v)) return "";
  return v;
}

export function buildSalesProductRankingExportWorkbook(
  payload: SoldProductsDashboardPayload
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const { summary, filters } = payload;

  const resumoRows = [
    { Campo: "Gerado em", Valor: payload.generatedAt },
    { Campo: "Período", Valor: filters.periodLabel },
    { Campo: "Tipo de data", Valor: filters.dateBasisLabel },
    { Campo: "Status pedido", Valor: filters.orderStatusLabel },
    { Campo: "Tipo de cliente", Valor: filters.customerScopeLabel },
    { Campo: "Empresa", Valor: filters.companyLabel },
    { Campo: "Ordenação", Valor: filters.sortByLabel },
    { Campo: "Top N", Valor: filters.topNLabel },
    { Campo: "Quantidade total vendida", Valor: summary.totalQuantity },
    { Campo: "Valor total vendido", Valor: summary.totalAmount },
    { Campo: "Produtos vendidos", Valor: summary.productsCount },
    { Campo: "Clientes compradores", Valor: summary.customersCount },
    { Campo: "Pedidos considerados", Valor: summary.ordersCount },
    { Campo: "Preço médio geral", Valor: numOrBlank(summary.averageUnitPrice) },
    {
      Campo: "Produto mais vendido (qtd)",
      Valor: summary.topProductByQuantity
        ? `${summary.topProductByQuantity.productCode ?? ""} ${summary.topProductByQuantity.productName}`.trim()
        : "",
    },
    {
      Campo: "Produto maior valor",
      Valor: summary.topProductByAmount
        ? `${summary.topProductByAmount.productCode ?? ""} ${summary.topProductByAmount.productName}`.trim()
        : "",
    },
    ...soldProductsFilterSummaryLines(filters).map((line) => {
      const idx = line.indexOf(":");
      if (idx < 0) return { Campo: line, Valor: "" };
      return { Campo: line.slice(0, idx).trim(), Valor: line.slice(idx + 1).trim() };
    }),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), "Resumo");

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      payload.ranking.map((r) => ({
        Posição: r.rank,
        "Código produto": r.productCode ?? "",
        Produto: r.productName,
        "Quantidade vendida": r.quantitySold,
        "Valor vendido": r.amountSold,
        "Preço médio": numOrBlank(r.averageUnitPrice),
        "Qtd pedidos": r.ordersCount,
        "Qtd clientes": r.customersCount,
        "Última venda": r.lastSaleDate ?? "",
        "% participação (qtd)": r.quantitySharePercent,
        "% participação (valor)": r.amountSharePercent,
      }))
    ),
    "Ranking"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      payload.customerMix.map((r) => ({
        Produto: r.productName,
        "Código produto": r.productCode ?? "",
        Cliente: r.customerName,
        "CNPJ/CPF": r.customerTaxId ?? "",
        Quantidade: r.quantitySold,
        Valor: r.amountSold,
        "% no produto": r.customerSharePercent,
      }))
    ),
    "Produto x Cliente"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      payload.monthlyEvolution.map((r) => ({
        Produto: r.productName,
        "Código produto": r.productCode ?? "",
        Ano: r.year,
        Mês: r.month,
        Quantidade: r.quantitySold,
        Valor: r.amountSold,
      }))
    ),
    "Evolução Mensal"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      payload.detailRows.map((r) => ({
        "Data pedido": r.orderDate,
        Pedido: r.orderCode,
        Cliente: r.customerName,
        "CNPJ/CPF": r.customerTaxId ?? "",
        Vendedor: r.sellerName ?? "",
        Empresa: r.companyLabel ?? "",
        "Código produto": r.productCode ?? "",
        Produto: r.productName,
        Quantidade: r.quantity,
        "Valor unitário": r.unitPrice,
        "Valor total": r.lineAmount,
        Status: r.orderStatusLabel,
      }))
    ),
    "Detalhamento"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      soldProductsFilterSummaryLines(filters).map((line) => {
        const idx = line.indexOf(":");
        if (idx < 0) return { Filtro: line, Valor: "" };
        return { Filtro: line.slice(0, idx).trim(), Valor: line.slice(idx + 1).trim() };
      })
    ),
    "Filtros Aplicados"
  );

  return wb;
}

export function soldProductsRankingWorkbookToBytes(workbook: XLSX.WorkBook): Uint8Array {
  const arr = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(arr);
}

export function soldProductsRankingExportFilename(referenceDate = new Date()): string {
  const stamp = referenceDate.toISOString().slice(0, 10);
  return `produtos-vendidos-${stamp}.xlsx`;
}
