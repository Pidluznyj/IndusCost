/**
 * Papéis gerenciais de Centro de Custo para o DRE (Planilha2 do Excel).
 * Classificação por código/nome — fail-safe: desconhecido → admin.
 */

export type DreCostCenterRole =
  | "logistics"
  | "payroll"
  | "benefits"
  | "assembly"
  | "labor"
  | "tax"
  | "raw_material"
  | "admin";

/** CCs que NÃO entram em Despesas Administrativas (nem fretes, nem pessoal). */
export const DRE_ADMIN_EXCLUDED_ROLES: ReadonlySet<DreCostCenterRole> = new Set([
  "logistics",
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

  if (/\b(logistica|frete|fretes|carreto|carretos|transporte)\b/.test(hay)) {
    return "logistics";
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
  personnel: number[];
  admin: number[];
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
    code: string;
    name: string;
    amount: number;
  }>,
  year: number,
  unclassifiedByMonth: Array<{ month: number; year: number; unclassifiedAmount: number }>
): DreCcMonthlyBucket {
  const logistics = createEmptyMonthlySeries();
  const personnel = createEmptyMonthlySeries();
  const admin = createEmptyMonthlySeries();
  const unclassified = createEmptyMonthlySeries();

  for (const row of rows) {
    if (row.year !== year) continue;
    const role = classifyDreCostCenterRole(row.code, row.name);
    const amount = Number.isFinite(row.amount) ? row.amount : 0;
    if (role === "logistics") {
      addToMonth(logistics, row.month, amount);
    } else if (DRE_PERSONNEL_ROLES.has(role)) {
      addToMonth(personnel, row.month, amount);
    } else if (!DRE_ADMIN_EXCLUDED_ROLES.has(role)) {
      addToMonth(admin, row.month, amount);
    }
    // tax / raw_material: excluídos do DRE gerencial (já no CMV / fora do escopo v1)
  }

  for (const row of unclassifiedByMonth) {
    if (row.year !== year) continue;
    addToMonth(unclassified, row.month, row.unclassifiedAmount);
  }

  return { logistics, personnel, admin, unclassified };
}
