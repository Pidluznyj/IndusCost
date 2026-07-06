import React from "react";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/src/lib/utils";

const VARIANT = {
  info: {
    box: "border border-sky-700/55 bg-sky-50 text-sky-950 shadow-sm ring-1 ring-sky-500/20 dark:border-sky-500/45 dark:bg-sky-950/45 dark:text-sky-50 dark:ring-sky-500/30",
    icon: Info,
    iconClass: "text-sky-700 dark:text-sky-300",
  },
  warning: {
    box: "border border-amber-600/60 bg-amber-50 text-amber-950 shadow-sm ring-1 ring-amber-500/25 dark:border-amber-500/50 dark:bg-amber-950/50 dark:text-amber-50 dark:ring-amber-400/30",
    icon: AlertCircle,
    iconClass: "text-amber-800 dark:text-amber-300",
  },
  success: {
    box: "border border-emerald-600/55 bg-emerald-50 text-emerald-950 shadow-sm ring-1 ring-emerald-500/20 dark:border-emerald-500/45 dark:bg-emerald-950/50 dark:text-emerald-50 dark:ring-emerald-400/25",
    icon: CheckCircle2,
    iconClass: "text-emerald-800 dark:text-emerald-300",
  },
  destructive: {
    box: "border border-red-700/65 bg-red-50 text-red-950 shadow-sm ring-1 ring-red-500/25 dark:border-red-600/55 dark:bg-red-950/45 dark:text-red-50 dark:ring-red-500/25",
    icon: AlertTriangle,
    iconClass: "text-red-800 dark:text-red-300",
  },
} as const;

export type AppAlertVariant = keyof typeof VARIANT;

type Props = {
  variant?: AppAlertVariant;
  title?: string;
  children: React.ReactNode;
  className?: string;
  /** Ícone à esquerda; default por variant. */
  icon?: LucideIcon;
  /** Ex.: `animate-spin` quando `icon` for `Loader2`. */
  iconClassName?: string;
  showIcon?: boolean;
  /** default: compact = menor padding e texto. */
  density?: "default" | "compact";
  role?: "alert" | "status" | "none";
};

export function AppAlert({
  variant = "info",
  title,
  children,
  className,
  icon: IconOverride,
  iconClassName,
  showIcon = true,
  density = "default",
  role,
}: Props) {
  const cfg = VARIANT[variant];
  const Icon = IconOverride ?? cfg.icon;
  const resolvedRole = role ?? (variant === "destructive" ? "alert" : "status");

  return (
    <div
      {...(resolvedRole === "none" ? {} : { role: resolvedRole })}
      className={cn(
        "rounded-xl",
        density === "compact" ? "px-3 py-2.5 text-[11px] leading-snug" : "p-4 text-sm leading-relaxed",
        cfg.box,
        className
      )}
    >
      <div className="flex items-start gap-3">
        {showIcon ? (
          <Icon
            className={cn(
              "h-5 w-5 shrink-0",
              density === "compact" ? "mt-px h-4 w-4" : "mt-0.5",
              cfg.iconClass,
              iconClassName
            )}
            aria-hidden
          />
        ) : null}
        <div className="min-w-0 flex-1 space-y-1.5">
          {title ? (
            <p className={cn("font-semibold leading-snug", density === "compact" ? "text-[11px]" : "text-sm")}>
              {title}
            </p>
          ) : null}
          <div
            className={cn(
              "text-inherit [&_a]:font-medium [&_a]:text-inherit [&_a]:underline [&_a]:underline-offset-2",
              !title && density === "default" && "text-sm",
              density === "compact" && "text-[11px] leading-snug"
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
