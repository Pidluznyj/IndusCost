/** Classes CSS de status e valores monetários — PDF Contas a Pagar > Títulos. */

export function financeApTitlesPrintStatusBadgeClass(status: string): string {
  switch (status) {
    case "overdue":
      return "finance-ap-titles-print-status finance-ap-titles-print-status--danger";
    case "upcoming":
      return "finance-ap-titles-print-status finance-ap-titles-print-status--success";
    case "open":
    case "dueToday":
      return "finance-ap-titles-print-status finance-ap-titles-print-status--warning";
    case "settled":
      return "finance-ap-titles-print-status finance-ap-titles-print-status--settled";
    case "suspended":
      return "finance-ap-titles-print-status finance-ap-titles-print-status--muted";
    default:
      return "finance-ap-titles-print-status finance-ap-titles-print-status--unknown";
  }
}

export function financeApTitlesPrintMoneyClass(
  kind: "original" | "paid" | "open",
  status: string
): string {
  const base = "finance-ap-titles-print-money";
  if (kind === "paid" || (kind === "open" && status === "settled")) {
    return `${base} finance-ap-titles-print-money--received`;
  }
  if (status === "overdue" || status === "dueToday") {
    if (kind === "open" || kind === "original") {
      return `${base} finance-ap-titles-print-money--risk`;
    }
  }
  if (kind === "open" && (status === "open" || status === "upcoming")) {
    return `${base} finance-ap-titles-print-money--open`;
  }
  return base;
}

export function financeApTitlesPrintTotalMoneyClass(
  kind: "original" | "paid" | "open"
): string {
  const base = "finance-ap-titles-print-money finance-ap-titles-print-money--total";
  switch (kind) {
    case "paid":
      return `${base} finance-ap-titles-print-money--received`;
    case "open":
      return `${base} finance-ap-titles-print-money--open`;
    default:
      return base;
  }
}
