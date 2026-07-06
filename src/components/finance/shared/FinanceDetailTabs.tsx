import React from "react";
import { cn } from "@/src/lib/utils";

export type FinanceDetailTab<T extends string = string> = {
  id: T;
  label: string;
  disabled?: boolean;
  title?: string;
};

type Props<T extends string> = {
  tabs: readonly FinanceDetailTab<T>[];
  activeId: T;
  onChange: (id: T) => void;
  className?: string;
};

export function FinanceDetailTabs<T extends string>({
  tabs,
  activeId,
  onChange,
  className,
}: Props<T>) {
  return (
    <nav className={cn("flex flex-wrap gap-2 border-b border-[#E5E7EB] pb-2", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          disabled={tab.disabled}
          title={tab.title}
          onClick={() => !tab.disabled && onChange(tab.id)}
          className={cn(
            "rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
            activeId === tab.id && !tab.disabled
              ? "bg-primary text-primary-foreground"
              : tab.disabled
                ? "text-muted-foreground/50 cursor-not-allowed"
                : "text-muted-foreground hover:bg-accent"
          )}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
