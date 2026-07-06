import * as XLSX from "xlsx";
import { formatFinanceCalculatedStatus } from "./financeAccountsReceivableFormat.js";
import type {
  FinanceArTitleListItem,
  FinanceArTitlesPayload,
  FinanceArTitlesSummary,
} from "./financeAccountsReceivableTitles.js";

function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

function originLabel(origin: string): string {
  return origin === "WITH_NFE" ? "Com NF" : "Sem NF";
}

export function financeArTitlesExportFilename(referenceDate = new Date()): string {
  const y = referenceDate.getFullYear();
  const m = String(referenceDate.getMonth() + 1).padStart(2, "0");
  const d = String(referenceDate.getDate()).padStart(2, "0");
  return `contas-a-receber-titulos-${y}-${m}-${d}.xlsx`;
}

export function buildFinanceArTitlesExportWorkbook(
  payload: FinanceArTitlesPayload,
  allItems: FinanceArTitleListItem[],
  generatedAt: string
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const { summary } = payload;

  const resumoRows = [
    { Campo: "Gerado em", Valor: generatedAt },
    { Campo: "Quantidade de títulos", Valor: summary.totalTitles },
    { Campo: "Valor original total", Valor: summary.totalOriginalValue },
    { Campo: "Valor recebido total", Valor: summary.totalReceivedValue },
    { Campo: "Valor em aberto total", Valor: summary.totalOpenValue },
    { Campo: "Valor vencido", Valor: summary.totalOverdueValue },
    { Campo: "Valor a vencer", Valor: summary.totalDueValue },
    { Campo: "Ticket médio", Valor: summary.averageTicket },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), "Resumo");

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      allItems.map((row) => ({
        Cliente: row.personName ?? "",
        "CNPJ/CPF": row.personCnpj ?? "",
        Empresa: row.companyName ?? "",
        Documento: row.sourceInvoiceNumber ?? (row.sourceInvoiceId != null ? String(row.sourceInvoiceId) : ""),
        "Pedido/NF": row.sourceInvoiceNumber ?? "",
        Descrição: row.description ?? "",
        "Data emissão": formatDateBr(row.competenceDate),
        Vencimento: formatDateBr(row.dueDate),
        "Data recebimento": formatDateBr(row.settlementDate),
        Status: formatFinanceCalculatedStatus(row.calculatedStatus),
        "Dias em atraso": row.daysOverdue,
        "Valor original": row.amountReceivable,
        "Valor recebido": row.amountReceived,
        "Valor em aberto": row.balanceReceivable,
        "Forma pagamento": row.paymentMethodName ?? "",
        Origem: originLabel(row.origin),
        Observação: row.comments ?? "",
      }))
    ),
    "Títulos"
  );

  return wb;
}

export function buildFinanceArTitlesExportBuffer(
  payload: FinanceArTitlesPayload,
  allItems: FinanceArTitleListItem[],
  generatedAt: string
): Buffer {
  const wb = buildFinanceArTitlesExportWorkbook(payload, allItems, generatedAt);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function summaryRowsForPrint(summary: FinanceArTitlesSummary) {
  return [
    { label: "Quantidade de títulos", value: summary.totalTitles },
    { label: "Valor original total", value: summary.totalOriginalValue },
    { label: "Valor recebido total", value: summary.totalReceivedValue },
    { label: "Valor em aberto total", value: summary.totalOpenValue },
    { label: "Valor vencido", value: summary.totalOverdueValue },
    { label: "Valor a vencer", value: summary.totalDueValue },
    { label: "Ticket médio", value: summary.averageTicket },
  ];
}
