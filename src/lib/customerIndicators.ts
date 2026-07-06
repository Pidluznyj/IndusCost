/**
 * Agregações somente leitura para o dashboard de clientes (base principal: SalesOrder).
 */

const UF_ORDER = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

const UF_SET = new Set<string>(UF_ORDER);

/** Nome do estado (sem acento, minúsculo) → sigla UF */
const FULL_NAME_TO_UF: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceara: "CE",
  "distrito federal": "DF",
  "espirito santo": "ES",
  goias: "GO",
  maranhao: "MA",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  "minas gerais": "MG",
  para: "PA",
  paraiba: "PB",
  parana: "PR",
  pernambuco: "PE",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};

export type CustomerIndicatorInput = {
  id: string;
  state: string | null;
  status: string;
  segment: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  createdAt: Date;
  /** Pedidos válidos (status NOT IN CANCELLED/ERROR). */
  salesOrderCount: number;
  /** @deprecated Secundário — propostas em negociação. */
  negotiationProposalCount?: number;
};

export type CustomerIndicatorsResponse = {
  semantics: { label: string };
  summary: {
    totalCustomers: number;
    activeCount: number;
    inactiveCount: number;
    withSalesOrderCount: number;
    /** @deprecated Use withSalesOrderCount. Mantido por compatibilidade. */
    withProposalCount?: number;
    withNegotiationProposalCount: number;
    withoutStateCount: number;
    withEmailCount: number;
    withPhoneCount: number;
    withAddressCount: number;
    newLast30Days: number;
  };
  /** Contagem por UF ou buckets especiais (—, Outros). */
  byState: Array<{ key: string; label: string; count: number }>;
  /** Top segmentos (string vazia = “Sem segmento”). */
  topSegments: Array<{ segment: string; count: number }>;
};

function slugNoAccent(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Normaliza texto de estado para sigla UF quando possível; caso contrário agrupa em OUTROS.
 * Vazio → "—" (exibição como “Não informado”).
 */
export function normalizeBrazilUf(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "—";
  const t = raw.trim().toUpperCase().replace(/\s+/g, " ");
  if (t.length === 2 && UF_SET.has(t)) return t;
  const slug = slugNoAccent(raw);
  const fromFull = FULL_NAME_TO_UF[slug];
  if (fromFull) return fromFull;
  return "OUTROS";
}

function labelForStateKey(key: string): string {
  if (key === "—") return "Não informado";
  if (key === "OUTROS") return "Outros (texto não reconhecido como UF)";
  if (UF_SET.has(key)) return key;
  return key;
}

export function buildCustomerIndicatorsPayload(rows: CustomerIndicatorInput[]): CustomerIndicatorsResponse {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  let activeCount = 0;
  let inactiveCount = 0;
  let withSalesOrderCount = 0;
  let withNegotiationProposalCount = 0;
  let withoutStateCount = 0;
  let withEmailCount = 0;
  let withPhoneCount = 0;
  let withAddressCount = 0;
  let newLast30Days = 0;

  const byStateMap = new Map<string, number>();
  const segmentMap = new Map<string, number>();

  for (const r of rows) {
    if (r.status === "ACTIVE") activeCount++;
    else inactiveCount++;

    if (r.salesOrderCount > 0) withSalesOrderCount++;
    if ((r.negotiationProposalCount ?? 0) > 0) withNegotiationProposalCount++;

    if (r.email != null && String(r.email).trim() !== "") withEmailCount++;
    if (r.phone != null && String(r.phone).trim() !== "") withPhoneCount++;
    if (r.address != null && String(r.address).trim() !== "") withAddressCount++;

    const created = r.createdAt instanceof Date ? r.createdAt.getTime() : new Date(r.createdAt).getTime();
    if (created >= thirtyDaysAgo) newLast30Days++;

    const rawState = r.state;
    if (rawState == null || String(rawState).trim() === "") {
      withoutStateCount++;
    }

    const uf = normalizeBrazilUf(rawState);
    byStateMap.set(uf, (byStateMap.get(uf) ?? 0) + 1);

    const segKey = r.segment != null && String(r.segment).trim() !== "" ? String(r.segment).trim() : "—";
    segmentMap.set(segKey, (segmentMap.get(segKey) ?? 0) + 1);
  }

  const byState: Array<{ key: string; label: string; count: number }> = [];

  for (const uf of UF_ORDER) {
    const c = byStateMap.get(uf);
    if (c != null && c > 0) {
      byState.push({ key: uf, label: labelForStateKey(uf), count: c });
    }
  }
  const dash = byStateMap.get("—") ?? 0;
  if (dash > 0) {
    byState.push({ key: "—", label: labelForStateKey("—"), count: dash });
  }
  const outros = byStateMap.get("OUTROS") ?? 0;
  if (outros > 0) {
    byState.push({ key: "OUTROS", label: labelForStateKey("OUTROS"), count: outros });
  }

  byState.sort((a, b) => b.count - a.count);

  const topSegments = [...segmentMap.entries()]
    .map(([segment, count]) => ({ segment: segment === "—" ? "Sem segmento" : segment, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return {
    semantics: {
      label:
        "Indicadores derivados do cadastro de clientes e pedidos de venda válidos (leitura; não altera dados).",
    },
    summary: {
      totalCustomers: rows.length,
      activeCount,
      inactiveCount,
      withSalesOrderCount,
      withProposalCount: withSalesOrderCount,
      withNegotiationProposalCount,
      withoutStateCount,
      withEmailCount,
      withPhoneCount,
      withAddressCount,
      newLast30Days,
    },
    byState,
    topSegments,
  };
}
