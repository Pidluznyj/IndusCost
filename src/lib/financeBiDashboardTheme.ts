/** Tokens visuais do padrão BI executivo — módulo Financeiro. */

export const FINANCE_BI_COLORS = {
  background: "#F9FAFB",
  card: "#FFFFFF",
  border: "#E5E7EB",
  textPrimary: "#111827",
  textSecondary: "#6B7280",
  primary: "#2563EB",
  risk: "#DC2626",
  warning: "#D97706",
  success: "#059669",
  info: "#2563EB",
} as const;

/** Classes Tailwind reutilizáveis (flat, sem sombra pesada). */
export const financeBiShellClass = "min-h-screen space-y-5 pb-10 bg-[#F9FAFB] text-[#111827]";
export const financeBiCardClass =
  "rounded-xl border border-[#E5E7EB] bg-white dark:bg-card shadow-none";
export const financeBiCardMutedClass =
  "rounded-xl border border-[#E5E7EB] bg-white/80 dark:bg-card/80 shadow-none";
export const financeBiHeaderClass = `${financeBiCardClass} p-6`;
export const financeBiSectionClass = `${financeBiCardMutedClass} overflow-hidden`;
export const financeBiEyebrowClass =
  "text-[10px] font-bold uppercase tracking-widest text-[#6B7280]";
export const financeBiTitleClass = "text-2xl font-extrabold tracking-tight text-[#111827]";
export const financeBiSubtitleClass = "text-sm text-[#6B7280] max-w-2xl";
export const financeBiKpiLabelClass =
  "text-[11px] font-bold uppercase tracking-widest text-[#6B7280]";
export const financeBiKpiValueClass = "text-3xl font-extrabold tracking-tight leading-none";
export const financeBiMetaLabelClass = "text-[#6B7280]";
export const financeBiMetaValueClass = "font-semibold text-[#111827] tabular-nums";

export const financeBiButtonPrimaryClass =
  "inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50";
export const financeBiButtonOutlineClass =
  "inline-flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-50";
export const financeBiButtonAccentClass =
  "inline-flex h-9 items-center gap-2 rounded-lg border border-[#2563EB]/30 bg-[#2563EB]/5 px-3 text-xs font-semibold text-[#2563EB] hover:bg-[#2563EB]/10 disabled:opacity-50";
