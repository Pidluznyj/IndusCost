import React from "react";
import {
  salesOrderMarginSeverityBadgeClass,
  salesOrderMarginSummaryStatusBadgeClass,
} from "@/src/lib/salesOrderMarginDisplay";
import type { SalesOrderMarginSummaryPayload } from "@/src/lib/salesOrderMarginTypes";

export function SalesOrderMarginStatusBadge({
  label,
  severity,
  status,
  className = "",
}: {
  label: string;
  severity?: "success" | "warning" | "danger" | "neutral";
  status?: SalesOrderMarginSummaryPayload["status"];
  className?: string;
}) {
  const badgeClass = status
    ? salesOrderMarginSummaryStatusBadgeClass(status)
    : salesOrderMarginSeverityBadgeClass(severity);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badgeClass} ${className}`}
      data-testid="sales-order-margin-status-badge"
    >
      {label || "—"}
    </span>
  );
}
