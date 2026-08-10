import { useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileSpreadsheet, Loader2, Printer } from "lucide-react";
import { fetchSalesOrderFlowList, type SalesOrderFlowClientQuery } from "@/src/lib/salesOrderFlowClient";
import { resolveSalesOrderFlowVisibleKanbanStages } from "@/src/lib/salesOrderFlowKanbanPagination";
import { buildSalesOrderFlowKanbanColumnViews } from "@/src/components/commercial/SalesOrderFlowKanbanBoard";
import { exportSalesOrderFlowKanbanToXlsx } from "@/src/lib/salesOrderFlowExport";
import { SalesOrderFlowPrintDocument } from "@/src/components/commercial/SalesOrderFlowPrintDocument";
import type { SalesOrderFlowUiFilters } from "@/src/lib/salesOrderFlowUi";
import { salesOrderFlowFiltersToClientQuery } from "@/src/lib/salesOrderFlowUi";
import { cn } from "@/src/lib/utils";
import { triggerBrowserPrint } from "@/src/lib/usePrintDocument";
import type { BrandingSettingsDTO } from "@/src/types/branding";

const PRESSABLE_CLASS =
  "transition-transform duration-150 [transition-timing-function:var(--ease-out-strong)] active:scale-[0.97]";

type Props = {
  filters: SalesOrderFlowUiFilters;
  branding: BrandingSettingsDTO;
};

export function SalesOrderFlowKanbanExportButtons({ filters, branding }: Props) {
  const [exportingTo, setExportingTo] = useState<"excel" | "print" | null>(null);
  const [printPayload, setPrintPayload] = useState<{
    columns: any;
    valuesVisible: boolean;
    generatedAt: string;
  } | null>(null);

  const fetchFullBoardData = async (signal: AbortSignal) => {
    const baseQuery = salesOrderFlowFiltersToClientQuery(filters);
    const stages = resolveSalesOrderFlowVisibleKanbanStages(filters.stages);
    
    // Fetch all with high limit to ensure we get everything
    const payload = await fetchSalesOrderFlowList(
      {
        ...baseQuery,
        stages,
        limit: 10000, 
      },
      signal
    );

    // Convert raw columns to ColumnViews format expected by export/print
    const columnStates: Record<string, any> = {};
    for (const col of payload.columns) {
      columnStates[col.stage] = {
        stage: col.stage,
        status: "ready",
        total: col.total,
        cards: col.cards,
        hasMore: false,
        loadingMore: false,
      };
    }

    // Use fake indicators just to pass the stages (we don't strictly need accurate totals for the export body, 
    // but we map the stages properly)
    const fakeIndicators = payload.columns.map(c => ({
      stage: c.stage,
      label: c.stage, // We could map the label if we want, but KanbanBoard will fallback to stage name
      orderCount: c.total,
      orderValue: null,
      activeResidualValue: null,
      activeOrderCount: c.total,
      blockedCount: 0,
      overdueCount: 0,
      inconsistentCount: 0,
    }));

    const columnsView = buildSalesOrderFlowKanbanColumnViews({
      stages,
      columns: columnStates,
      indicators: fakeIndicators,
    });
    
    // Fix the labels for the export using existing mapping if possible
    // For simplicity, we just let it use the raw stage if label isn't mapped 
    // (though buildSalesOrderFlowKanbanColumnViews usually handles it via indicator labels, which we faked. 
    // Wait, let's just use the hardcoded mapping for the export).
    const labels: Record<string, string> = {
      WAITING_RELEASE: "Aguardando liberação",
      WAITING_PRODUCTION_ORDER: "Aguardando OP",
      IN_PRODUCTION: "Em produção",
      WAITING_OUTPUT_DOCUMENT: "Aguardando documento de saída",
      WAITING_NFE: "Aguardando NF-e",
      SHIPPED_COMPLETED: "Enviado / concluído"
    };

    const finalColumns = columnsView.map(c => ({
      ...c,
      label: labels[c.stage] || c.stage
    }));

    return {
      columns: finalColumns,
      valuesVisible: payload.valuesVisible
    };
  };

  const handleExportExcel = async () => {
    setExportingTo("excel");
    const controller = new AbortController();
    try {
      const data = await fetchFullBoardData(controller.signal);
      exportSalesOrderFlowKanbanToXlsx(data.columns, data.valuesVisible);
    } catch (e) {
      console.error("Failed to export Excel", e);
      alert("Falha ao exportar planilha.");
    } finally {
      setExportingTo(null);
    }
  };

  const handlePrint = async () => {
    setExportingTo("print");
    const controller = new AbortController();
    try {
      const data = await fetchFullBoardData(controller.signal);
      setPrintPayload({
        columns: data.columns,
        valuesVisible: data.valuesVisible,
        generatedAt: new Date().toISOString(),
      });
      // Wait for React to render the portal
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.body.classList.add("sales-orders-print-route");
          
          const cleanup = () => {
            document.body.classList.remove("sales-orders-print-route");
            setPrintPayload(null);
            window.removeEventListener("afterprint", cleanup);
          };
          
          window.addEventListener("afterprint", cleanup);
          
          triggerBrowserPrint();
          
          // Fallback seguro em caso de falha do evento afterprint (1 minuto)
          setTimeout(cleanup, 60000);
        });
      });
    } catch (e) {
      console.error("Failed to prepare print", e);
      alert("Falha ao preparar impressão.");
    } finally {
      setExportingTo(null);
    }
  };

  return (
    <>
      <div className="flex gap-1.5 ml-2">
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent sm:text-sm",
            PRESSABLE_CLASS
          )}
          onClick={handlePrint}
          disabled={exportingTo !== null}
          title="Imprimir layout do Kanban"
        >
          {exportingTo === "print" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Printer className="h-3.5 w-3.5 text-slate-500" />
          )}
          <span className="hidden sm:inline">Imprimir</span>
        </button>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent sm:text-sm",
            PRESSABLE_CLASS
          )}
          onClick={handleExportExcel}
          disabled={exportingTo !== null}
          title="Baixar planilha (XLSX) completa"
        >
          {exportingTo === "excel" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
          )}
          <span className="hidden sm:inline">Excel</span>
        </button>
      </div>
      
      {printPayload
        ? createPortal(
            <SalesOrderFlowPrintDocument
              columns={printPayload.columns}
              branding={branding}
              generatedAt={printPayload.generatedAt}
              valuesVisible={printPayload.valuesVisible}
            />,
            document.body
          )
        : null}
    </>
  );
}
