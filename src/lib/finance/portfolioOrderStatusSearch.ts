/**
 * Busca inteligente — Status Pedidos (Conciliação de Carteira).
 *
 * Filtra pedidos já consolidados (uma linha por pedido) por cliente, pedido,
 * NF ou documento de saída. Não recalcula conciliação.
 */

export type OrderStatusSearchMatchedBy =
  | "CUSTOMER"
  | "SALES_ORDER"
  | "NFE"
  | "STOCK_DOCUMENT"
  | "PRODUCT";

export type OrderStatusSearchMatch = {
  matchedBy: OrderStatusSearchMatchedBy;
  matchedText: string;
};

export type NormalizedOrderStatusSearch = {
  raw: string;
  /** Texto normalizado (trim, espaços colapsados, lower). */
  text: string;
  /** Apenas dígitos extraídos do termo (após strip de prefixo). */
  digits: string | null;
  /** Número inteiro positivo se `digits` for parseável. */
  asNumber: number | null;
  kindHint: OrderStatusSearchMatchedBy | null;
  /** Variantes digitais (com e sem zeros à esquerda). */
  digitVariants: string[];
  /** true se o termo é elegível para matching (≥ 2 chars / ≥ 3 dígitos). */
  usable: boolean;
};

const PREFIX_RULES: Array<{
  re: RegExp;
  kind: OrderStatusSearchMatchedBy;
}> = [
  { re: /^(pd|pedido)\b[\s.\-:]*/i, kind: "SALES_ORDER" },
  { re: /^(nf|nfe|nota)\b[\s.\-:]*/i, kind: "NFE" },
  { re: /^(doc|documento)\b[\s.\-:]*/i, kind: "STOCK_DOCUMENT" },
];

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function digitVariantsOf(digits: string): string[] {
  if (!digits) return [];
  const out = new Set<string>([digits]);
  const stripped = digits.replace(/^0+/, "");
  if (stripped && stripped.length >= 3) out.add(stripped);
  return [...out];
}

export function normalizeOrderStatusSearch(
  input: string | null | undefined
): NormalizedOrderStatusSearch | null {
  if (input == null) return null;
  const raw = collapseSpaces(String(input));
  if (!raw) return null;

  let rest = raw;
  let kindHint: OrderStatusSearchMatchedBy | null = null;
  for (const rule of PREFIX_RULES) {
    if (rule.re.test(rest)) {
      kindHint = rule.kind;
      rest = rest.replace(rule.re, "").trim();
      break;
    }
  }

  const text = collapseSpaces(rest).toLowerCase();
  const digits = onlyDigits(rest) || onlyDigits(raw) || null;
  const asNumber =
    digits && digits.length >= 3 && /^\d+$/.test(digits)
      ? Number(digits)
      : null;
  const digitVariants = digits ? digitVariantsOf(digits) : [];

  // Texto curto (<2) ou só dígitos curtos (<3) sem hint → não aplica.
  const hasSafeText = text.length >= 2 && /[a-zà-ü]/i.test(text);
  const hasSafeDigits = Boolean(digits && digits.length >= 3);
  const usable = hasSafeText || hasSafeDigits || (kindHint != null && hasSafeDigits);

  return {
    raw,
    text: text || raw.toLowerCase(),
    digits,
    asNumber: Number.isFinite(asNumber) ? asNumber : null,
    kindHint,
    digitVariants,
    usable,
  };
}

function normalizeAlnum(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function digitsOf(value: string | null | undefined): string {
  return onlyDigits(value ?? "");
}

export type OrderStatusSearchableRow = {
  orderCode: string | null;
  customerName: string | null;
  externalCustomerId: number | null;
  nfeNumbers: string[];
  stockDocumentExternalIds?: number[];
  productTokens?: string[];
};

/**
 * Tenta casar a busca com uma linha de pedido consolidada.
 * Prioridade: hint de prefixo → pedido → NF → documento → cliente → produto.
 */
export function matchOrderStatusSearch(
  row: OrderStatusSearchableRow,
  search: NormalizedOrderStatusSearch
): OrderStatusSearchMatch | null {
  if (!search.usable) return null;

  const orderCode = row.orderCode ?? "";
  const orderAlnum = normalizeAlnum(orderCode);
  const orderDigits = digitsOf(orderCode);
  const orderDigitVars = digitVariantsOf(orderDigits);

  const trySalesOrder = (): OrderStatusSearchMatch | null => {
    if (search.text && orderAlnum.includes(normalizeAlnum(search.text))) {
      return { matchedBy: "SALES_ORDER", matchedText: orderCode || search.raw };
    }
    if (search.digitVariants.length > 0 && orderDigits) {
      for (const d of search.digitVariants) {
        if (orderDigits === d || orderDigitVars.includes(d) || orderDigits.endsWith(d)) {
          // endsWith só se o termo tiver ≥ 4 dígitos (evita "86" em tudo).
          if (orderDigits.endsWith(d) && d.length < 4 && orderDigits !== d) continue;
          return {
            matchedBy: "SALES_ORDER",
            matchedText: orderCode || `PD ${d}`,
          };
        }
      }
    }
    return null;
  };

  const tryNfe = (): OrderStatusSearchMatch | null => {
    for (const nfe of row.nfeNumbers ?? []) {
      const nfeDigits = digitsOf(nfe);
      const nfeAlnum = normalizeAlnum(nfe);
      if (search.text && nfeAlnum && nfeAlnum.includes(normalizeAlnum(search.text))) {
        return { matchedBy: "NFE", matchedText: `NF ${nfe}` };
      }
      for (const d of search.digitVariants) {
        if (nfeDigits === d || nfeDigits === d.replace(/^0+/, "") || digitVariantsOf(nfeDigits).includes(d)) {
          return { matchedBy: "NFE", matchedText: `NF ${nfe}` };
        }
      }
    }
    return null;
  };

  const tryStockDocument = (): OrderStatusSearchMatch | null => {
    const ids = row.stockDocumentExternalIds ?? [];
    if (search.asNumber != null && ids.includes(search.asNumber)) {
      return {
        matchedBy: "STOCK_DOCUMENT",
        matchedText: `Documento ${search.asNumber}`,
      };
    }
    for (const id of ids) {
      const idDigits = String(id);
      for (const d of search.digitVariants) {
        if (idDigits === d || idDigits === d.replace(/^0+/, "")) {
          return {
            matchedBy: "STOCK_DOCUMENT",
            matchedText: `Documento ${id}`,
          };
        }
      }
    }
    return null;
  };

  const tryCustomer = (): OrderStatusSearchMatch | null => {
    const nameNorm = normalizeAlnum(row.customerName);
    const needleNorm = normalizeAlnum(search.text);
    if (
      needleNorm.length >= 2 &&
      /[a-z]/i.test(needleNorm) &&
      nameNorm.includes(needleNorm)
    ) {
      return {
        matchedBy: "CUSTOMER",
        matchedText: row.customerName?.trim() || search.raw,
      };
    }
    if (
      search.asNumber != null &&
      row.externalCustomerId != null &&
      row.externalCustomerId === search.asNumber
    ) {
      return {
        matchedBy: "CUSTOMER",
        matchedText: String(row.externalCustomerId),
      };
    }
    return null;
  };

  const tryProduct = (): OrderStatusSearchMatch | null => {
    if (search.text.length < 2) return null;
    const needle = search.text;
    const hit = (row.productTokens ?? []).find(
      (t) => t.includes(needle) || needle.includes(t)
    );
    if (!hit) return null;
    return { matchedBy: "PRODUCT", matchedText: hit };
  };

  const ordered: Array<() => OrderStatusSearchMatch | null> = [];
  if (search.kindHint === "SALES_ORDER") {
    ordered.push(trySalesOrder, tryNfe, tryStockDocument, tryCustomer, tryProduct);
  } else if (search.kindHint === "NFE") {
    ordered.push(tryNfe, trySalesOrder, tryStockDocument, tryCustomer, tryProduct);
  } else if (search.kindHint === "STOCK_DOCUMENT") {
    ordered.push(tryStockDocument, trySalesOrder, tryNfe, tryCustomer, tryProduct);
  } else if (search.digitVariants.length > 0 && !/[a-zà-ü]/i.test(search.text)) {
    // Termo numérico puro: pedido/NF/doc primeiro, cliente só por externalId.
    ordered.push(trySalesOrder, tryNfe, tryStockDocument, tryCustomer, tryProduct);
  } else {
    ordered.push(tryCustomer, trySalesOrder, tryNfe, tryStockDocument, tryProduct);
  }

  for (const fn of ordered) {
    const hit = fn();
    if (hit) return hit;
  }
  return null;
}

export function rowMatchesOrderStatusSearch(
  row: OrderStatusSearchableRow,
  searchRaw: string | null | undefined
): OrderStatusSearchMatch | null {
  const normalized = normalizeOrderStatusSearch(searchRaw);
  if (!normalized) return null;
  if (!normalized.usable) return null;
  return matchOrderStatusSearch(row, normalized);
}
