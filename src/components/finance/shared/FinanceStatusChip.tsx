import React from "react";
import { cn } from "@/src/lib/utils";

type Props = {
  label: string;
  className?: string;
  title?: string;
};

export function FinanceStatusChip({ label, className, title }: Props) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold",
        className
      )}
    >
      {label}
    </span>
  );
}
