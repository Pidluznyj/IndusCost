import { utils, write } from "xlsx";
import type { SalesOrderFlowKanbanColumnView } from "@/src/components/commercial/SalesOrderFlowKanbanBoard";

export function exportSalesOrderFlowKanbanToXlsx(
  columns: readonly SalesOrderFlowKanbanColumnView[],
  valuesVisible: boolean
) {
  const rows = columns.flatMap((column) => 
    column.cards.map(card => {
      const row: any = {
        "Etapa Kanban": column.label,
        "Código": card.orderCode,
        "Cliente": card.customerName?.trim() || "Não informado",
        "SLA / Entrega": card.promisedDeliveryAt ? new Date(card.promisedDeliveryAt).toLocaleDateString('pt-BR') : "",
        "Dias na Etapa": card.daysInStage || 0,
        "Prioridade": card.priority === "URGENT" ? "Urgente" : card.priority === "HIGH" ? "Alta" : "Normal",
        "Atrasado": card.isOverdue ? "Sim" : "Não",
        "Bloqueado": card.isBlocked ? "Sim" : "Não",
        "Motivo do Bloqueio": card.blockReason?.trim() || "",
        "Aqui Porque (Stay Reason)": card.stayReason?.trim() || "",
        "Para Sair (Next Action)": card.missingToLeave?.trim() || card.nextAction?.trim() || "",
        "Vendedor": card.sellerName?.trim() || "",
        "Itens Concluídos": card.completedItems,
        "Itens Pendentes": card.pendingItems,
      };

      if (valuesVisible) {
        row["Valor Total"] = card.orderValue || 0;
        row["Saldo Ativo"] = card.activeResidualValue || 0;
      }

      return row;
    })
  );

  const worksheet = utils.json_to_sheet(rows);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, "Fluxo de Pedidos");
  
  // Format columns
  const wscols = [
    { wch: 25 }, // Etapa
    { wch: 12 }, // Codigo
    { wch: 30 }, // Cliente
    { wch: 15 }, // SLA
    { wch: 12 }, // Dias
    { wch: 10 }, // Prioridade
    { wch: 10 }, // Atrasado
    { wch: 10 }, // Bloqueado
    { wch: 20 }, // Motivo Bloqueio
    { wch: 40 }, // Aqui Porque
    { wch: 40 }, // Para sair
    { wch: 20 }, // Vendedor
    { wch: 15 }, // Itens Conc
    { wch: 15 }, // Itens Pend
  ];
  if (valuesVisible) {
    wscols.push({ wch: 15 }, { wch: 15 }); // Valor, Saldo
  }
  worksheet["!cols"] = wscols;

  const excelBuffer = write(workbook, { bookType: "xlsx", type: "array" });
  const data = new Blob([excelBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  const dateStr = new Date().toISOString().split("T")[0];
  link.download = `kanban_fluxo_pedidos_${dateStr}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
