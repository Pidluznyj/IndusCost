import React from "react";
import { cn } from "@/src/lib/utils";
import {
  executiveAlertBadgeClass,
  executiveAlertPanelClass,
  executiveAlertPanelTitleClass,
  executiveAlertShellClass,
  EXECUTIVE_ALERT_VARIANTS,
  type ExecutiveAlertDensity,
  type ExecutiveAlertVariant,
} from "@/src/lib/executiveAlertStyles";

export type ExecutiveAlertProps = {
  variant?: ExecutiveAlertVariant;
  density?: ExecutiveAlertDensity;
  title?: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  testId?: string;
};

export function ExecutiveAlertBadge({
  variant = "attention",
  className,
  children,
}: {
  variant?: ExecutiveAlertVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn(executiveAlertBadgeClass(variant), className)}>{children}</span>
  );
}

export function ExecutiveAlertPanel({
  variant = "attention",
  title,
  className,
  children,
}: {
  variant?: ExecutiveAlertVariant;
  title?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={executiveAlertPanelClass(variant, className)}>
      {title ? (
        <p className={executiveAlertPanelTitleClass(variant)}>{title}</p>
      ) : null}
      {children}
    </div>
  );
}

export function ExecutiveAlert({
  variant = "attention",
  density = "default",
  title,
  description,
  badge,
  icon,
  actions,
  children,
  className,
  testId,
}: ExecutiveAlertProps) {
  const tokens = EXECUTIVE_ALERT_VARIANTS[variant];
  const isInline = density === "inline";

  return (
    <section
      role="status"
      data-testid={testId}
      className={cn(executiveAlertShellClass(variant, density), className)}
    >
      {title || description || badge || icon || actions ? (
        <div
          className={cn(
            "flex gap-2",
            isInline ? "flex-col" : "flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
          )}
        >
          <div className="min-w-0 flex-1 space-y-2">
            {title || badge || icon ? (
              <div className="flex flex-wrap items-center gap-2">
                {icon ? (
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center justify-center rounded-lg",
                      isInline ? "h-6 w-6" : "h-8 w-8",
                      tokens.iconWrap
                    )}
                  >
                    {icon}
                  </span>
                ) : null}
                {title ? (
                  <h4
                    className={cn(
                      "font-semibold",
                      tokens.title,
                      isInline ? "text-xs" : "text-base"
                    )}
                  >
                    {title}
                  </h4>
                ) : null}
                {badge ? (
                  typeof badge === "string" ? (
                    <ExecutiveAlertBadge variant={variant} className={isInline ? "text-[9px]" : "text-[10px]"}>
                      {badge}
                    </ExecutiveAlertBadge>
                  ) : (
                    badge
                  )
                ) : null}
              </div>
            ) : null}
            {description ? (
              <p
                className={cn(
                  "leading-snug",
                  tokens.description,
                  isInline ? "text-[10px]" : "max-w-3xl text-sm leading-relaxed"
                )}
              >
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div
              className={cn(
                "flex shrink-0 flex-col items-stretch gap-1",
                !isInline && "lg:items-end lg:pt-1"
              )}
            >
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
