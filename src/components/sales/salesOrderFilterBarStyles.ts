/**
 * Classes da barra de filtros de Pedidos de Venda (padrão executivo 2026-07) —
 * idênticas às da listagem (`SalesOrdersModule`). A tela Resultado usa estas
 * constantes para os filtros terem a mesma aparência e comportamento em todo o
 * módulo (um teste de paridade compara com a listagem).
 */
export const SALES_ORDER_FILTER_CONTROL_CLASS =
  "h-9 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground";

export const SALES_ORDER_FILTER_LABEL_CLASS =
  "mb-1 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

export const SALES_ORDER_FILTER_ACTION_BUTTON_CLASS =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50";

/** Realce do botão Pesquisar (mesmo da listagem). */
export const SALES_ORDER_FILTER_PRIMARY_ACTION_CLASS =
  "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary";
