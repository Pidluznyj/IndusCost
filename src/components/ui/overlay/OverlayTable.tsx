import React from "react";
import { cn } from "@/src/lib/utils";
import { OVERLAY_TABLE_HEAD } from "@/src/lib/overlay/overlayTypography";

/**
 * Tabela densa para overlays. Vem com o combo canônico:
 * - Cabeçalho `bg-slate-50` com `text-[10px] uppercase`
 * - `divide-y` sutil entre linhas
 * - Hover azul bem leve (`hover:bg-primary/5`)
 * - Célula compacta (`px-4 py-3 text-sm`)
 * - `sticky` header opcional
 *
 * Uso: substitui `<table>` bruto — mantém a API padrão de tabelas HTML.
 *
 * ```tsx
 * <OverlayTable stickyHeader>
 *   <OverlayTable.Head>
 *     <OverlayTable.Row>
 *       <OverlayTable.HeadCell>Código</OverlayTable.HeadCell>
 *       <OverlayTable.HeadCell align="right">Valor</OverlayTable.HeadCell>
 *     </OverlayTable.Row>
 *   </OverlayTable.Head>
 *   <OverlayTable.Body>
 *     {rows.map((r) => (
 *       <OverlayTable.Row key={r.id}>
 *         <OverlayTable.Cell mono>{r.code}</OverlayTable.Cell>
 *         <OverlayTable.Cell align="right">{formatCurrency(r.value)}</OverlayTable.Cell>
 *       </OverlayTable.Row>
 *     ))}
 *   </OverlayTable.Body>
 * </OverlayTable>
 * ```
 */
export type OverlayTableProps = React.TableHTMLAttributes<HTMLTableElement> & {
  stickyHeader?: boolean;
  /** Wrapper aplica overflow-x auto. Default: `true`. */
  scroll?: boolean;
};

function OverlayTableRoot({
  stickyHeader = false,
  scroll = true,
  className,
  children,
  ...rest
}: OverlayTableProps): JSX.Element {
  const table = (
    <table
      {...rest}
      className={cn(
        "w-full border-collapse text-sm",
        stickyHeader && "[&>thead]:sticky [&>thead]:top-0 [&>thead]:z-10",
        className
      )}
    >
      {children}
    </table>
  );
  if (!scroll) return table;
  return (
    <div className="min-w-0 overflow-x-auto rounded-[var(--radius-overlay-inner)] border border-[color:var(--color-overlay-border)]">
      {table}
    </div>
  );
}

function OverlayTableHead({
  className,
  ...rest
}: React.HTMLAttributes<HTMLTableSectionElement>): JSX.Element {
  return (
    <thead
      {...rest}
      className={cn(
        "bg-[color:var(--color-overlay-surface-muted)]",
        className
      )}
    />
  );
}

function OverlayTableBody({
  className,
  ...rest
}: React.HTMLAttributes<HTMLTableSectionElement>): JSX.Element {
  return (
    <tbody
      {...rest}
      className={cn("divide-y divide-slate-100", className)}
    />
  );
}

function OverlayTableRow({
  className,
  interactive = false,
  ...rest
}: React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }): JSX.Element {
  return (
    <tr
      {...rest}
      className={cn(
        interactive && "cursor-pointer hover:bg-primary/5",
        className
      )}
    />
  );
}

type CellAlign = "left" | "right" | "center";
const ALIGN: Record<CellAlign, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

function OverlayTableHeadCell({
  className,
  align = "left",
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: CellAlign }): JSX.Element {
  return (
    <th
      {...rest}
      className={cn(
        "px-4 py-2.5",
        ALIGN[align],
        OVERLAY_TABLE_HEAD,
        className
      )}
    />
  );
}

function OverlayTableCell({
  className,
  align = "left",
  mono = false,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  align?: CellAlign;
  /** Aplica `font-mono text-xs tabular-nums` — para códigos/SKUs/valores. */
  mono?: boolean;
}): JSX.Element {
  return (
    <td
      {...rest}
      className={cn(
        "px-4 py-3 text-sm text-foreground",
        ALIGN[align],
        mono && "font-mono text-xs tabular-nums",
        className
      )}
    />
  );
}

export const OverlayTable = Object.assign(OverlayTableRoot, {
  Head: OverlayTableHead,
  Body: OverlayTableBody,
  Row: OverlayTableRow,
  HeadCell: OverlayTableHeadCell,
  Cell: OverlayTableCell,
});
