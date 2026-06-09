/** Control Room — Earthy Swiss Brutalist (escopo Fluxo de Caixa). */

export const CONTROL_ROOM_COLORS = {
  background: "#FDFDFC",
  surface: "#F5F5F4",
  surfaceMuted: "#E7E5E4",
  textPrimary: "#1C1917",
  textSecondary: "#57534E",
  border: "#E7E5E4",
  borderStrong: "#D6D3D1",
  inflow: "#2C5530",
  inflowSoft: "#E8F0E9",
  outflow: "#B64230",
  outflowSoft: "#F9EBE8",
  alert: "#D07722",
  alertSoft: "#FBF3E8",
  ink: "#1C1917",
  inkSoft: "#F5F5F4",
} as const;

export const FINANCE_CASH_FLOW_CHART_HEIGHT = 300;

export const controlRoomShellClass =
  "finance-control-room min-h-screen space-y-4 pb-8 bg-[#FDFDFC] text-[#1C1917]";

export const controlRoomCardClass =
  "rounded-md border border-[#E7E5E4] bg-[#FDFDFC] shadow-none";

export const controlRoomCardSurfaceClass =
  "rounded-md border border-[#E7E5E4] bg-[#F5F5F4] shadow-none";

export const controlRoomHeaderClass = `${controlRoomCardClass} p-5 sticky top-0 z-20`;

export const controlRoomSectionClass = `${controlRoomCardSurfaceClass} overflow-hidden`;

export const controlRoomEyebrowClass =
  "font-ui text-[10px] font-bold uppercase tracking-[0.14em] text-[#57534E]";

export const controlRoomTitleClass = "font-display text-2xl font-bold tracking-tight text-[#1C1917]";

export const controlRoomSubtitleClass = "font-ui text-sm text-[#57534E] max-w-3xl leading-relaxed";

export const controlRoomKpiLabelClass =
  "font-ui text-[10px] font-bold uppercase tracking-[0.12em] text-[#57534E]";

export const controlRoomKpiValueClass = "font-mono text-2xl font-semibold tracking-tight leading-none";

export const controlRoomMetaLabelClass = "font-ui text-[#57534E]";

export const controlRoomMetaValueClass = "font-mono font-medium text-[#1C1917] tabular-nums";

export const controlRoomCaptionClass = "font-mono text-[10px] text-[#57534E] leading-snug";

export const controlRoomButtonPrimaryClass =
  "font-ui inline-flex h-8 items-center gap-1.5 rounded-md border border-[#1C1917] bg-[#1C1917] px-3 text-[11px] font-semibold text-[#FDFDFC] hover:bg-[#292524] focus:outline-none focus:ring-2 focus:ring-[#1C1917]/30 disabled:opacity-50";

export const controlRoomButtonOutlineClass =
  "font-ui inline-flex h-8 items-center gap-1.5 rounded-md border border-[#D6D3D1] bg-[#FDFDFC] px-3 text-[11px] font-semibold text-[#1C1917] hover:bg-[#F5F5F4] focus:outline-none focus:ring-2 focus:ring-[#1C1917]/20 disabled:opacity-50";

export const controlRoomButtonAccentClass =
  "font-ui inline-flex h-8 items-center gap-1.5 rounded-md border border-[#2C5530]/35 bg-[#E8F0E9] px-3 text-[11px] font-semibold text-[#2C5530] hover:bg-[#DCE8DD] focus:outline-none focus:ring-2 focus:ring-[#2C5530]/25 disabled:opacity-50";

export const controlRoomFieldClass =
  "font-ui w-full rounded-md border border-[#D6D3D1] bg-[#FDFDFC] px-2.5 py-1.5 text-sm text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#1C1917]/15";

export const controlRoomLabelClass =
  "font-ui text-[10px] font-semibold uppercase tracking-[0.1em] text-[#57534E]";

export const controlRoomTabActiveClass =
  "font-ui border-b-2 border-[#1C1917] px-3 py-2 text-sm font-semibold text-[#1C1917]";

export const controlRoomTabInactiveClass =
  "font-ui border-b-2 border-transparent px-3 py-2 text-sm font-medium text-[#57534E] hover:text-[#1C1917] hover:border-[#D6D3D1] disabled:opacity-40 disabled:cursor-not-allowed";

export const controlRoomPillClass =
  "font-mono inline-flex items-center rounded-full border border-[#D6D3D1] bg-[#F5F5F4] px-2 py-0.5 text-[10px] font-medium text-[#57534E]";
