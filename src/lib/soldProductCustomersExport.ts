import type { SoldProductCustomersPayload } from "./soldProductCustomersTypes.js";

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildSoldProductCustomersCsv(payload: SoldProductCustomersPayload): string {
  const header = [
    "Cliente",
    "CNPJ",
    "Cidade",
    "UF",
    "Região",
    "Responsável",
    "Pedidos",
    "Quantidade",
    "Receita",
    "Preço médio",
    "Menor preço",
    "Maior preço",
    "Último preço",
    "Primeira compra",
    "Última compra",
    "Dias sem comprar",
    "Participação no produto (%)",
    "Participação no cliente (%)",
    "Carteira aberta",
    "Vencido",
    "Saúde comercial",
    "Ação sugerida",
  ];

  const rows = payload.customers.map((row) =>
    [
      row.customerName,
      row.customerCnpj ?? "",
      row.city ?? "",
      row.state ?? "",
      row.region ?? "",
      row.commercialOwner ?? "",
      row.ordersCount,
      row.quantity,
      formatMoney(row.totalRevenue),
      formatMoney(row.averageUnitPrice),
      formatMoney(row.minUnitPrice),
      formatMoney(row.maxUnitPrice),
      formatMoney(row.lastUnitPrice),
      formatDateBr(row.firstPurchaseDate),
      formatDateBr(row.lastPurchaseDate),
      row.daysSinceLastPurchase ?? "",
      row.shareOfProductRevenue,
      row.shareOfCustomerRevenue,
      formatMoney(row.openPortfolioAmount),
      formatMoney(row.overdueAmount),
      row.commercialHealth,
      row.suggestedAction,
    ]
      .map(csvEscape)
      .join(";")
  );

  return `\uFEFF${header.join(";")}\n${rows.join("\n")}\n`;
}

export function soldProductCustomersExportFilename(
  productCode: string | null,
  referenceDate = new Date()
): string {
  const y = referenceDate.getFullYear();
  const m = String(referenceDate.getMonth() + 1).padStart(2, "0");
  const d = String(referenceDate.getDate()).padStart(2, "0");
  const code = (productCode ?? "produto").replace(/[^\w.-]+/g, "_").slice(0, 40);
  return `clientes-compradores-${code}-${y}-${m}-${d}.csv`;
}
