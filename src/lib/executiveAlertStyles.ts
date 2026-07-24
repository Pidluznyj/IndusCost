/**
 * Paleta executiva reutilizável para alertas claros, legíveis e consistentes.
 * Fundos claros preservados no dark mode para contraste adequado.
 */
import { cn } from "@/src/lib/utils";

export type ExecutiveAlertVariant = "attention" | "warning" | "danger" | "success" | "info";

export type ExecutiveAlertDensity = "default" | "compact" | "inline";

export const EXECUTIVE_ALERT_LABEL_CLASS = "text-[#64748B]";
export const EXECUTIVE_ALERT_VALUE_CLASS = "text-[#111827]";
export const EXECUTIVE_ALERT_VALUE_POSITIVE_CLASS = "text-[#047857]";
export const EXECUTIVE_ALERT_VALUE_NEGATIVE_CLASS = "text-[#B91C1C]";

type VariantTokens = {
  shell: string;
  title: string;
  description: string;
  badge: string;
  iconWrap: string;
  panel: string;
  panelTitle: string;
};

export const EXECUTIVE_ALERT_VARIANTS: Record<ExecutiveAlertVariant, VariantTokens> = {
  attention: {
    shell: "border-[#F59E0B] bg-[#FFFBEB] dark:border-[#FBBF24] dark:bg-[#FFFBEB]",
    title: "text-[#92400E]",
    description: "text-[#78350F]",
    badge: "border-[#FBBF24] bg-[#FDE68A] text-[#92400E]",
    iconWrap: "bg-[#FDE68A] text-[#92400E]",
    panel: "border-[#FCD34D] bg-white dark:border-[#FCD34D] dark:bg-white",
    panelTitle: "text-[#92400E]",
  },
  warning: {
    shell: "border-[#F59E0B] bg-[#FFFBEB] dark:border-[#FBBF24] dark:bg-[#FFFBEB]",
    title: "text-[#92400E]",
    description: "text-[#78350F]",
    badge: "border-[#FBBF24] bg-[#FDE68A] text-[#92400E]",
    iconWrap: "bg-[#FDE68A] text-[#92400E]",
    panel: "border-[#FCD34D] bg-white dark:border-[#FCD34D] dark:bg-white",
    panelTitle: "text-[#92400E]",
  },
  danger: {
    shell: "border-[#FCA5A5] bg-[#FEF2F2] dark:border-[#FCA5A5] dark:bg-[#FEF2F2]",
    title: "text-[#991B1B]",
    description: "text-[#991B1B]",
    badge: "border-[#FCA5A5] bg-[#FEE2E2] text-[#991B1B]",
    iconWrap: "bg-[#FEE2E2] text-[#991B1B]",
    panel: "border-[#FCA5A5] bg-white dark:border-[#FCA5A5] dark:bg-white",
    panelTitle: "text-[#991B1B]",
  },
  success: {
    shell: "border-[#059669] bg-[#D1FAE5] dark:border-[#34D399] dark:bg-[#D1FAE5]",
    title: "text-[#064E3B]",
    description: "text-[#065F46]",
    badge: "border-[#059669] bg-[#A7F3D0] text-[#064E3B]",
    iconWrap: "bg-[#A7F3D0] text-[#064E3B]",
    panel: "border-[#6EE7B7] bg-white dark:border-[#6EE7B7] dark:bg-white",
    panelTitle: "text-[#064E3B]",
  },
  info: {
    shell: "border-[#CBD5E1] bg-[#F8FAFC] dark:border-[#CBD5E1] dark:bg-[#F8FAFC]",
    title: "text-[#334155]",
    description: "text-[#334155]",
    badge: "border-[#CBD5E1] bg-[#F1F5F9] text-[#334155]",
    iconWrap: "bg-[#F1F5F9] text-[#334155]",
    panel: "border-[#CBD5E1] bg-white dark:border-[#CBD5E1] dark:bg-white",
    panelTitle: "text-[#334155]",
  },
};

export function executiveAlertShellClass(
  variant: ExecutiveAlertVariant,
  density: ExecutiveAlertDensity = "default"
): string {
  const tokens = EXECUTIVE_ALERT_VARIANTS[variant];
  return cn(
    "border shadow-sm",
    tokens.shell,
    density === "inline" && "rounded-lg p-2",
    density === "compact" && "rounded-xl p-3",
    density === "default" && "rounded-2xl p-5"
  );
}

export function executiveAlertBadgeClass(variant: ExecutiveAlertVariant): string {
  const tokens = EXECUTIVE_ALERT_VARIANTS[variant];
  return cn(
    "inline-flex w-fit items-center rounded-full border px-2 py-0.5 font-semibold",
    tokens.badge
  );
}

export function executiveAlertPanelClass(
  variant: ExecutiveAlertVariant = "attention",
  className?: string
): string {
  return cn(
    "rounded-xl border p-4 shadow-sm",
    EXECUTIVE_ALERT_VARIANTS[variant].panel,
    className
  );
}

export function executiveAlertPanelTitleClass(variant: ExecutiveAlertVariant = "attention"): string {
  return cn(
    "mb-3 text-[11px] font-bold uppercase tracking-wider",
    EXECUTIVE_ALERT_VARIANTS[variant].panelTitle
  );
}

export function executiveAlertValueClass(
  tone: "default" | "positive" | "negative" = "default"
): string {
  if (tone === "positive") return EXECUTIVE_ALERT_VALUE_POSITIVE_CLASS;
  if (tone === "negative") return EXECUTIVE_ALERT_VALUE_NEGATIVE_CLASS;
  return EXECUTIVE_ALERT_VALUE_CLASS;
}

export function frozenCostTraceToExecutiveVariant(
  status: string
): ExecutiveAlertVariant {
  switch (status) {
    case "ATUALIZADO":
      return "success";
    case "PENDENTE_PUBLICACAO":
    case "CUSTO_DIVERGENTE":
      return "attention";
    case "SNAPSHOT_TECNICO_SEM_IMPACTO":
      return "info";
    case "SEM_CUSTO_CONGELADO":
    case "SEM_CUSTO":
      return "info";
    default:
      return "info";
  }
}

export function executiveAlertInlineTextClass(variant: ExecutiveAlertVariant): string {
  return cn("text-[10px] leading-snug", EXECUTIVE_ALERT_VARIANTS[variant].description);
}
