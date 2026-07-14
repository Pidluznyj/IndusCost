/**
 * Overlay Design System — Typography & spacing constants
 * ---------------------------------------------------------------------------
 * Classes canônicas usadas em popups, dialogs, drawers e telas de detalhe
 * que abrem sobrepostas ao conteúdo.
 *
 * Se você precisa customizar visualmente um overlay, importe daqui em vez
 * de replicar as classes — assim mudanças no design system se propagam.
 *
 * Ver `docs/design-system/overlay.md`.
 */

/** Eyebrow acima do título (contexto/módulo). Ex.: "Financeiro · Conciliação". */
export const OVERLAY_EYEBROW =
  "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

/** Título principal do overlay. */
export const OVERLAY_TITLE = "text-lg font-bold tracking-tight text-foreground";

/** Título grande em overlays de nível "prominence" (auditoria, dashboards). */
export const OVERLAY_TITLE_LG = "text-2xl font-bold tracking-tight text-foreground";

/** Subtítulo/descrição abaixo do título. */
export const OVERLAY_SUBTITLE = "text-xs text-muted-foreground";

/**
 * Label em modo alta densidade (uppercase 10px). Usar em painéis analíticos,
 * KPI cards, tabelas densas, forms de auditoria.
 */
export const OVERLAY_LABEL_DENSE =
  "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

/**
 * Label em modo padrão (sentence case, 13px). Usar em forms de cadastro/edição
 * onde a legibilidade prevalece sobre a densidade.
 */
export const OVERLAY_LABEL = "text-sm font-medium text-foreground";

/** Valor em KPI card (font-black para máximo contraste tipográfico). */
export const OVERLAY_KPI_VALUE =
  "text-2xl font-black tabular-nums text-foreground";

/** Valor secundário/menor em painéis. */
export const OVERLAY_KPI_VALUE_SM =
  "text-lg font-bold tabular-nums text-foreground";

/** Códigos, SKUs, IDs — sempre monoespaçado para alinhamento. */
export const OVERLAY_MONO = "font-mono text-xs";

/** Cabeçalho de tabela densa. */
export const OVERLAY_TABLE_HEAD =
  "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

/** Célula de tabela padrão. */
export const OVERLAY_TABLE_CELL = "px-4 py-3 text-sm text-foreground";
