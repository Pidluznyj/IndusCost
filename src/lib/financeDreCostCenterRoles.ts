/**
 * Papéis gerenciais de Centro de Custo para o DRE (Planilha2 do Excel).
 * Classificação por código/nome — fail-safe: desconhecido → admin.
 */

export type DreCostCenterRole =
  | "logistics"
  | "packaging"
  | "payroll"
  | "benefits"
  | "assembly"
  | "labor"
  | "tax"
  | "raw_material"
  | "admin";

/** CCs que NÃO entram em Despesas Administrativas. */
export const DRE_ADMIN_EXCLUDED_ROLES: ReadonlySet<DreCostCenterRole> = new Set([
  "logistics",
  "packaging",
  "payroll",
  "benefits",
  "assembly",
  "labor",
  "tax",
  "raw_material",
]);

/** Pessoal informativo (não entra no resultado operacional). */
export const DRE_PERSONNEL_ROLES: ReadonlySet<DreCostCenterRole> = new Set([
  "payroll",
  "benefits",
  "assembly",
  "labor",
]);

export type FinanceDreCostCenterRoleRow = {
  costCenterId: string;
  code: string;
  name: string;
  role: DreCostCenterRole;
  /** Gasto no mês em destaque */
  highlightAmount: number;
  /** Gasto YTD até o mês em destaque */
  ytdAmount: number;
};

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Classifica um CC pelo código/nome. Ordem: matches mais específicos primeiro.
 */
export function classifyDreCostCenterRole(code: string, name: string): DreCostCenterRole {
  const hay = normalizeToken(`${code} ${name}`);

  if (
    /\b(logistica|frete|fretes|carreto|carretos|transporte|expedicao|expedicao e entrega|entrega|shipping|despacho)\b/.test(
      hay
    )
  ) {
    return "logistics";
  }
  if (/\b(embalagem|embalagens|packing|packaging)\b/.test(hay)) {
    return "packaging";
  }
  if (/\b(materia prima|mp|raw material)\b/.test(hay)) {
    return "raw_material";
  }
  if (/\b(imposto|impostos|tributo|tributos|fiscal)\b/.test(hay)) {
    return "tax";
  }
  if (/\b(folha|salario|salarios|pro labore|prolabore)\b/.test(hay)) {
    return "payroll";
  }
  if (/\b(beneficio|beneficios|vale transporte|assistencia medica|plano de saude)\b/.test(hay)) {
    return "benefits";
  }
  if (/\b(montagem)\b/.test(hay)) {
    return "assembly";
  }
  if (/\b(mao de obra|mod|hand labor)\b/.test(hay)) {
    return "labor";
  }
  return "admin";
}

export type DreCcMonthlyBucket = {
  logistics: number[];
  packaging: number[];
  personnel: number[];
  admin: number[];
  tax: number[];
  rawMaterial: number[];
  unclassified: number[];
};

export function createEmptyMonthlySeries(): number[] {
  return Array.from({ length: 12 }, () => 0);
}

export function addToMonth(series: number[], month: number, amount: number): void {
  if (month < 1 || month > 12 || !Number.isFinite(amount)) return;
  series[month - 1] += amount;
}

/**
 * Agrega gastos mensais por papel DRE a partir da série oficial byCostCenter.
 */
export function bucketCostCenterSpendByDreRole(
  rows: Array<{
    month: number;
    year: number;
    costCenterId?: string;
    code: string;
    name: string;
    amount: number;
  }>,
  year: number,
  unclassifiedByMonth: Array<{ month: number; year: number; unclassifiedAmount: number }>,
  highlightMonth: number
): {
  buckets: DreCcMonthlyBucket;
  roleRows: FinanceDreCostCenterRoleRow[];
} {
  const logistics = createEmptyMonthlySeries();
  const packaging = createEmptyMonthlySeries();
  const personnel = createEmptyMonthlySeries();
  const admin = createEmptyMonthlySeries();
  const tax = createEmptyMonthlySeries();
  const rawMaterial = createEmptyMonthlySeries();
  const unclassified = createEmptyMonthlySeries();

  type Acc = {
    costCenterId: string;
    code: string;
    name: string;
    role: DreCostCenterRole;
    byMonth: number[];
  };
  const byCc = new Map<string, Acc>();

  for (const row of rows) {
    if (row.year !== year) continue;
    const role = classifyDreCostCenterRole(row.code, row.name);
    const amount = Number.isFinite(row.amount) ? row.amount : 0;
    if (role === "logistics") addToMonth(logistics, row.month, amount);
    else if (role === "packaging") addToMonth(packaging, row.month, amount);
    else if (DRE_PERSONNEL_ROLES.has(role)) addToMonth(personnel, row.month, amount);
    else if (role === "tax") addToMonth(tax, row.month, amount);
    else if (role === "raw_material") addToMonth(rawMaterial, row.month, amount);
    else if (!DRE_ADMIN_EXCLUDED_ROLES.has(role)) addToMonth(admin, row.month, amount);

    const key = row.costCenterId || `${row.code}::${row.name}`;
    const current = byCc.get(key) ?? {
      costCenterId: key,
      code: row.code,
      name: row.name,
      role,
      byMonth: createEmptyMonthlySeries(),
    };
    addToMonth(current.byMonth, row.month, amount);
    byCc.set(key, current);
  }

  for (const row of unclassifiedByMonth) {
    if (row.year !== year) continue;
    addToMonth(unclassified, row.month, row.unclassifiedAmount);
  }

  const end = Math.min(12, Math.max(1, highlightMonth));
  const roleRows: FinanceDreCostCenterRoleRow[] = [...byCc.values()]
    .map((row) => {
      let ytd = 0;
      for (let i = 0; i < end; i += 1) ytd += row.byMonth[i] ?? 0;
      return {
        costCenterId: row.costCenterId,
        code: row.code,
        name: row.name,
        role: row.role,
        highlightAmount: Math.round((row.byMonth[highlightMonth - 1] ?? 0) * 100) / 100,
        ytdAmount: Math.round(ytd * 100) / 100,
      };
    })
    .filter((row) => row.ytdAmount > 0.009 || row.highlightAmount > 0.009)
    .sort((a, b) => b.ytdAmount - a.ytdAmount);

  return {
    buckets: { logistics, packaging, personnel, admin, tax, rawMaterial, unclassified },
    roleRows,
  };
}
