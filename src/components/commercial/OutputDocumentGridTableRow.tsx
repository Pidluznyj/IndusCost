import type { ReactElement } from "react";
import { OverlayBadge } from "@/src/components/ui/overlay";
import type { OutputDocumentsListItem } from "@/src/lib/output-documents/outputDocumentsListTypes";
import {
  formatOutputDocumentDate,
  formatOutputDocumentDateTime,
  formatOutputDocumentFinancialStatusLabel,
  formatOutputDocumentLabel,
  formatOutputDocumentMoney,
  formatOutputDocumentNfe,
  formatOutputDocumentNumber,
  formatOutputDocumentOrdersCount,
  formatOutputDocumentStatusLabel,
  outputDocumentFinancialStatusTone,
  outputDocumentStatusTone,
} from "@/src/lib/outputDocumentsUi";
import { cn } from "@/src/lib/utils";

export function OutputDocumentGridTableRow({
  item,
  selected,
  onOpen,
}: {
  item: OutputDocumentsListItem;
  selected: boolean;
  onOpen: () => void;
}): ReactElement {
  const documentLabel = formatOutputDocumentNumber(item);
  return (
    <tr
      tabIndex={0}
      aria-selected={selected}
      data-selected={selected ? "true" : "false"}
      data-cancelled={item.isCancelled ? "true" : "false"}
      aria-label={`Abrir detalhe do Documento de Saída ${documentLabel}`}
      className={cn(
        "cursor-pointer border-b border-border/70 outline-none last:border-0 hover:bg-muted/30 focus-visible:bg-muted/40 data-[selected=true]:bg-primary/5",
        item.isCancelled && "bg-rose-50/40 text-muted-foreground"
      )}
      data-testid={`output-documents-row-${item.externalId}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <td className="px-3 py-2">
        <div className="whitespace-nowrap font-semibold text-foreground">
          {documentLabel}
        </div>
        <div className="text-xs text-muted-foreground">#{item.externalId}</div>
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {formatOutputDocumentDate(item.dataDocumento)}
      </td>
      <td className="px-3 py-2">
        <div
          className="max-w-[14rem] overflow-hidden text-ellipsis whitespace-nowrap"
          title={item.customerName ?? undefined}
        >
          {formatOutputDocumentLabel(item.customerName)}
        </div>
      </td>
      <td className="px-3 py-2">
        <div
          className="max-w-[10rem] overflow-hidden text-ellipsis whitespace-nowrap"
          title={item.companyName ?? undefined}
        >
          {formatOutputDocumentLabel(item.companyName)}
        </div>
      </td>
      <td className="px-3 py-2">
        <OverlayBadge tone={outputDocumentStatusTone(item)}>
          {formatOutputDocumentStatusLabel(item)}
        </OverlayBadge>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
        {formatOutputDocumentMoney(item.totalValue)}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {formatOutputDocumentOrdersCount(item.allocatedOrdersCount)}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {formatOutputDocumentNfe(item)}
      </td>
      <td className="px-3 py-2">
        <OverlayBadge tone={outputDocumentFinancialStatusTone(item.financialStatus)}>
          {formatOutputDocumentFinancialStatusLabel(item.financialStatus)}
        </OverlayBadge>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
        {formatOutputDocumentMoney(item.receivableOpenValue)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
        {formatOutputDocumentDateTime(item.syncedAt)}
      </td>
    </tr>
  );
}
