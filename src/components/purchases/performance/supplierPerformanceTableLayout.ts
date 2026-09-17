/**
 * Larguras determinísticas (px) das tabelas analíticas da Performance.
 * A hierarquia importa mais do que o pixel exato: nomes longos recebem a
 * coluna mais larga; números ficam estreitos e não comprimem.
 */
export const TABLE_CLAMPED_TEXT_CLASS =
  "block max-w-full overflow-hidden break-words leading-5 line-clamp-2";

export const MATERIAL_RISK_COL_WIDTHS = [100, 270, 150, 125, 330, 110, 75, 190] as const;
export const RANKING_COL_WIDTHS = [48, 330, 80, 120, 80, 80, 80, 80, 150, 80] as const;
/** Proporções da tabela macro (sem scroll horizontal). Pilares ficam no detalhe da linha. */
export const CLASSIFICATION_COL_WIDTHS = [280, 150, 120, 150, 90, 130, 160] as const;
export const MATRIX_COL_WIDTHS = [220, 110, 280, 140, 90, 80, 80, 110, 130, 130, 110] as const;
export const DISPERSION_COL_WIDTHS = [240, 70, 90, 240, 240, 140, 110] as const;
export const PRICE_INCREASE_COL_WIDTHS = [240, 280, 70, 190, 190, 140, 110] as const;
export const ADVANCED_METRIC_COL_WIDTHS = [280, 130, 220, 420] as const;
export const SCORECARD_MATERIALS_COL_WIDTHS = [240, 130, 140, 90, 80, 80, 120, 130, 130, 110] as const;
export const EVIDENCE_COL_WIDTHS = [120, 120, 120, 80, 80, 110, 100, 90, 140, 80, 150, 150, 200] as const;
export const MATERIAL_SUPPLIERS_COL_WIDTHS = [280, 140, 120, 80, 120, 130, 130, 110, 110] as const;
export const MATERIAL_DISPERSION_COL_WIDTHS = [70, 250, 250, 140, 110] as const;
export const MONTHLY_HISTORY_COL_WIDTHS = [140, 160, 90, 120] as const;
