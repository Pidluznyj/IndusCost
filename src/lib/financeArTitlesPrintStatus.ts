/** Classes CSS de status e valores monetários — PDF Contas a Receber > Títulos. */

export function financeArTitlesPrintStatusBadgeClass(status: string): string {
  switch (status) {
    case "overdue":
      return "finance-ar-titles-print-status finance-ar-titles-print-status--danger";
    case "upcoming":
      return "finance-ar-titles-print-status finance-ar-titles-print-status--success";
    case "open":
      return "finance-ar-titles-print-status finance-ar-titles-print-status--warning";
    case "dueToday":
      return "finance-ar-titles-print-status finance-ar-titles-print-status--warning";
    case "settled":
      return "finance-ar-titles-print-status finance-ar-titles-print-status--settled";
    case "suspended":
      return "finance-ar-titles-print-status finance-ar-titles-print-status--muted";
    default:
      return "finance-ar-titles-print-status finance-ar-titles-print-status--unknown";
  }
}

export function financeArTitlesPrintMoneyClass(
  kind: "original" | "received" | "open",
  status: string
): string {
  const base = "finance-ar-titles-print-money";
  if (kind === "received" || (kind === "open" && status === "settled")) {
    return `${base} finance-ar-titles-print-money--received`;
  }
  if (status === "overdue" || status === "dueToday") {
    if (kind === "open" || kind === "original") {
      return `${base} finance-ar-titles-print-money--risk`;
    }
  }
  if (kind === "open" && (status === "open" || status === "upcoming")) {
    return `${base} finance-ar-titles-print-money--open`;
  }
  return base;
}

export function financeArTitlesPrintTotalMoneyClass(
  kind: "original" | "received" | "open"
): string {
  const base = "finance-ar-titles-print-money finance-ar-titles-print-money--total";
  switch (kind) {
    case "received":
      return `${base} finance-ar-titles-print-money--received`;
    case "open":
      return `${base} finance-ar-titles-print-money--open`;
    default:
      return base;
  }
}
