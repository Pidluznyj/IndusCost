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
 * Tabelas analíticas largas devem usar `layout="fixed"` + `colWidths` (ou
 * `minWidth`) para o conteúdo nunca invadir a coluna vizinha: o wrapper já
 * oferece `overflow-x-auto`.
 *
 * Uso: substitui `<table>` bruto — mantém a API padrão de tabelas HTML.
 *
 * ```tsx
 * <OverlayTable stickyHeader layout="fixed" colWidths={[160, 220, 120]}>
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
  /**
   * Largura mínima da tabela em px. Em viewports menores o wrapper rola
   * horizontalmente em vez de comprimir colunas até ficarem ilegíveis.
   */
  minWidth?: number;
  /** `fixed` + colgroup impede que texto de uma célula pinte sobre a vizinha. */
  layout?: "auto" | "fixed";
  /** Larguras determinísticas das colunas (px). Implica `layout="fixed"`. */
  colWidths?: ReadonlyArray<number>;
};

function OverlayTableRoot({
  stickyHeader = false,
  scroll = true,
  minWidth,
  layout,
  colWidths,
  className,
  children,
  style,
  ...rest
}: OverlayTableProps): JSX.Element {
  const resolvedLayout = layout ?? (colWidths && colWidths.length > 0 ? "fixed" : "auto");
  const colTotal = colWidths && colWidths.length > 0 ? colWidths.reduce((sum, width) => sum + width, 0) : 0;
  const resolvedMinWidth =
    minWidth ?? (scroll === false ? 0 : colTotal > 0 ? colTotal : undefined);
  const fitToContainer = resolvedMinWidth === 0;
  const table = (
    <table
      {...rest}
      style={{ minWidth: resolvedMinWidth, ...style }}
      className={cn(
        "w-full border-collapse text-sm",
        fitToContainer && "max-w-full",
        resolvedLayout === "fixed" &&
          "table-fixed [&_td]:overflow-hidden [&_th]:align-top [&_td]:align-top [&_th]:overflow-hidden [&_th]:whitespace-normal [&_th]:break-words",
        stickyHeader && "[&>thead]:sticky [&>thead]:top-0 [&>thead]:z-10",
        className
      )}
    >
      {colWidths && colWidths.length > 0 ? (
        <colgroup>
          {colWidths.map((width, index) => (
            <col
              key={index}
              style={{
                width: fitToContainer && colTotal > 0 ? `${(width / colTotal) * 100}%` : width,
              }}
            />
          ))}
        </colgroup>
      ) : null}
      {children}
    </table>
  );
  return (
    <div
      className={cn(
        "min-w-0 rounded-[var(--radius-overlay-inner)] border border-[color:var(--color-overlay-border)]",
        scroll ? "overflow-x-auto" : "overflow-x-hidden"
      )}
    >
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
        "hover:bg-primary/5",
        interactive && "cursor-pointer",
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
  nowrap = false,
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement> & {
  align?: CellAlign;
  nowrap?: boolean;
}): JSX.Element {
  return (
    <th
      {...rest}
      className={cn(
        "px-4 py-2.5",
        ALIGN[align],
        OVERLAY_TABLE_HEAD,
        nowrap && "whitespace-nowrap",
        className
      )}
    />
  );
}

function OverlayTableCell({
  className,
  align = "left",
  mono = false,
  nowrap,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  align?: CellAlign;
  /** Aplica `font-mono text-xs tabular-nums` — para códigos/SKUs/valores. */
  mono?: boolean;
  /** Impede quebra; default `true` quando `mono` (colunas numéricas alinhadas). */
  nowrap?: boolean;
}): JSX.Element {
  const resolvedNowrap = nowrap ?? mono;
  return (
    <td
      {...rest}
      className={cn(
        "px-4 py-3 text-sm text-foreground",
        ALIGN[align],
        mono && "font-mono text-xs tabular-nums",
        resolvedNowrap && "whitespace-nowrap",
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
