import * as XLSX from "xlsx";
import { formatFinanceCalculatedStatus } from "./financeAccountsReceivableFormat.js";
import type { FinanceArOverduePayload } from "./financeAccountsReceivableOverdueTypes.js";

function numOrBlank(v: number | null | undefined): number | "" {
  if (v == null || !Number.isFinite(v)) return "";
  return v;
}

function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

function appliedFilterRows(payload: FinanceArOverduePayload) {
  return Object.entries(payload.appliedFilters)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => ({ Filtro: key, Valor: String(value) }));
}

export function financeArOverdueExportFilename(referenceDate = new Date()): string {
  const y = referenceDate.getFullYear();
  const m = String(referenceDate.getMonth() + 1).padStart(2, "0");
  const d = String(referenceDate.getDate()).padStart(2, "0");
  return `contas-a-receber-atrasados-${y}-${m}-${d}.xlsx`;
}

export function buildFinanceArOverdueExportWorkbook(
  payload: FinanceArOverduePayload,
  allTitles: FinanceArOverduePayload["overdueTitles"]
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const { summary } = payload;

  const resumoRows = [
    { Campo: "Gerado em", Valor: payload.generatedAt },
    { Campo: "Data de referência", Valor: payload.referenceDate },
    { Campo: "Total vencido", Valor: summary.totalOverdueAmount },
    { Campo: "Títulos vencidos", Valor: summary.overdueTitlesCount },
    { Campo: "Clientes em atraso", Valor: summary.overdueCustomersCount },
    { Campo: "Média dias em atraso", Valor: numOrBlank(summary.averageDaysOverdue) },
    { Campo: "Maior atraso (dias)", Valor: numOrBlank(summary.maxDaysOverdue) },
    { Campo: "Vencido acima de 30 dias", Valor: summary.over30Amount },
    { Campo: "Vencido acima de 60 dias", Valor: summary.over60Amount },
    { Campo: "Vencido acima de 90 dias", Valor: summary.over90Amount },
    {
      Campo: "Maior cliente devedor",
      Valor: summary.topOverdueCustomer
        ? `${summary.topOverdueCustomer.name} (${summary.topOverdueCustomer.amount})`
        : "",
    },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), "Resumo");

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      allTitles.map((row) => ({
        Cliente: row.customerName,
        "CNPJ/CPF": row.customerDocument ?? "",
        Documento: row.documentNumber ?? "",
        "Nº NF": row.nfeNumber ?? "",
        "Pedido/Origem": row.salesOrderNumber ?? "",
        Vencimento: formatDateBr(row.dueDate),
        "Dias em atraso": row.daysOverdue,
        "Valor original": row.amountReceivable,
        "Valor recebido": row.amountReceived,
        "Saldo em aberto": row.balanceReceivable,
        "Forma pagamento": row.paymentMethodName ?? "",
        Empresa: row.companyName ?? "",
        Status: formatFinanceCalculatedStatus(row.status),
        Origem: row.sourceLabel,
        Descrição: row.description ?? "",
      }))
    ),
    "Títulos Atrasados"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      payload.customerRanking.map((row) => ({
        Posição: row.rank,
        Cliente: row.customerName,
        "CNPJ/CPF": row.customerDocument ?? "",
        "Qtd títulos": row.titlesCount,
        "Valor vencido": row.overdueAmount,
        "Vencimento mais antigo": formatDateBr(row.oldestDueDate),
        "Maior atraso (dias)": row.maxDaysOverdue,
        "Média atraso (dias)": numOrBlank(row.averageDaysOverdue),
        "% do total": row.percentOfTotal,
      }))
    ),
    "Ranking Clientes"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      payload.agingBuckets.map((row) => ({
        Faixa: row.bucket,
        "Dias mín.": row.minDays,
        "Dias máx.": row.maxDays ?? "",
        "Qtd títulos": row.titlesCount,
        Valor: row.amount,
        "% do total": row.percent,
      }))
    ),
    "Aging"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(appliedFilterRows(payload)),
    "Filtros Aplicados"
  );

  const byCompany = new Map<string, { company: string; amount: number; count: number }>();
  for (const row of allTitles) {
    const company = row.companyName ?? "—";
    const existing = byCompany.get(company);
    if (existing) {
      existing.amount += row.balanceReceivable;
      existing.count += 1;
    } else {
      byCompany.set(company, { company, amount: row.balanceReceivable, count: 1 });
    }
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      [...byCompany.values()]
        .sort((a, b) => b.amount - a.amount)
        .map((row) => ({
          Empresa: row.company,
          "Qtd títulos": row.count,
          "Valor vencido": row.amount,
        }))
    ),
    "Por Empresa"
  );

  const byInvoice = { withNf: { count: 0, amount: 0 }, withoutNf: { count: 0, amount: 0 } };
  for (const row of allTitles) {
    const bucket = row.sourceLabel.startsWith("Com") ? byInvoice.withNf : byInvoice.withoutNf;
    bucket.count += 1;
    bucket.amount += row.balanceReceivable;
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { Origem: "Com NF", "Qtd títulos": byInvoice.withNf.count, Valor: byInvoice.withNf.amount },
      {
        Origem: "Sem NF / pré-faturamento",
        "Qtd títulos": byInvoice.withoutNf.count,
        Valor: byInvoice.withoutNf.amount,
      },
    ]),
    "Com NF x Sem NF"
  );

  return wb;
}

export function financeArOverdueWorkbookToBytes(workbook: XLSX.WorkBook): Uint8Array {
  const arr = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(arr);
}
