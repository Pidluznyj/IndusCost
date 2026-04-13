/**
 * Composição gerencial (Open Book): explosão consolidada de MP e percentuais MP/HH/HM
 * sobre o custo industrial (MP + HH + HM), sem CIF/OPEX no denominador principal.
 */

export type ExplosionRowCore = {
  materialId: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  totalCost: number;
};

/** Mesmas fórmulas do motor em server.ts (BOM matéria-prima). */
export function directMaterialLineFromBom(
  landedCost: number,
  standardLossPct: number,
  bomQuantity: number,
  bomLossPct: number
): { requiredQty: number; matEffectiveCost: number; lineTotal: number } {
  const lc = Number(landedCost);
  const sl = Number(standardLossPct);
  const bl = Number(bomLossPct);
  const matEffectiveCost = lc / (1 - sl / 100);
  const requiredQty = Number(bomQuantity) / (1 - bl / 100);
  const lineTotal = matEffectiveCost * requiredQty;
  return { requiredQty, matEffectiveCost, lineTotal };
}

export function cloneExplosionMap(m: Map<string, ExplosionRowCore>): Map<string, ExplosionRowCore> {
  const n = new Map<string, ExplosionRowCore>();
  for (const [k, v] of m) {
    n.set(k, { ...v });
  }
  return n;
}

/** Consolida materiais iguais; `childPerUnit` é por 1 unidade do filho; `scale` = qtd do filho no pai. */
export function mergeExplosionMaps(
  into: Map<string, ExplosionRowCore>,
  childPerUnit: Map<string, ExplosionRowCore>,
  scale: number
): void {
  const s = Number(scale);
  if (!Number.isFinite(s) || s === 0) return;
  for (const [id, row] of childPerUnit) {
    const q = row.quantity * s;
    const c = row.totalCost * s;
    const existing = into.get(id);
    if (!existing) {
      into.set(id, {
        materialId: id,
        code: row.code,
        description: row.description,
        unit: row.unit,
        quantity: q,
        totalCost: c,
      });
    } else {
      existing.quantity += q;
      existing.totalCost += c;
    }
  }
}

export function addDirectMaterialRow(into: Map<string, ExplosionRowCore>, row: ExplosionRowCore): void {
  const existing = into.get(row.materialId);
  if (!existing) {
    into.set(row.materialId, { ...row });
    return;
  }
  existing.quantity += row.quantity;
  existing.totalCost += row.totalCost;
}

export function sumExplosionTotalCost(m: Map<string, ExplosionRowCore>): number {
  let t = 0;
  for (const r of m.values()) {
    t += r.totalCost;
  }
  return t;
}

export type OpenBookMaterialRow = ExplosionRowCore & {
  unitCostEffective: number;
  pctOfIndustrial: number;
  pctOfMp: number;
};

export function finalizeRowsForOpenBook(
  map: Map<string, ExplosionRowCore>,
  industrialDenominator: number,
  mpDenominator: number
): OpenBookMaterialRow[] {
  const ind = Number(industrialDenominator);
  const mpD = Number(mpDenominator);
  const rows: OpenBookMaterialRow[] = [];
  for (const r of map.values()) {
    const uc = r.quantity > 0 ? r.totalCost / r.quantity : 0;
    rows.push({
      ...r,
      unitCostEffective: uc,
      pctOfIndustrial: ind > 0 ? (r.totalCost / ind) * 100 : 0,
      pctOfMp: mpD > 0 ? (r.totalCost / mpD) * 100 : 0,
    });
  }
  rows.sort((a, b) => b.totalCost - a.totalCost);
  return rows;
}

/** % natureza = valor / (MP + HH + HM) */
export function naturePercentages(mp: number, hh: number, hm: number): {
  pctMp: number;
  pctHh: number;
  pctHm: number;
  base: number;
} {
  const m = Math.max(0, Number(mp));
  const h = Math.max(0, Number(hh));
  const k = Math.max(0, Number(hm));
  const base = m + h + k;
  if (base <= 0) {
    return { pctMp: 0, pctHh: 0, pctHm: 0, base: 0 };
  }
  return {
    pctMp: (m / base) * 100,
    pctHh: (h / base) * 100,
    pctHm: (k / base) * 100,
    base,
  };
}

export function simulateIndustrialCost(
  mp: number,
  hh: number,
  hm: number,
  incMpPct: number,
  incHhPct: number,
  incHmPct: number
): {
  baseTotal: number;
  newMp: number;
  newHh: number;
  newHm: number;
  newTotal: number;
  deltaAbs: number;
  deltaPct: number;
} {
  const m = Number(mp);
  const h = Number(hh);
  const k = Number(hm);
  const baseTotal = m + h + k;
  const fMp = 1 + Number(incMpPct) / 100;
  const fHh = 1 + Number(incHhPct) / 100;
  const fHm = 1 + Number(incHmPct) / 100;
  const newMp = m * fMp;
  const newHh = h * fHh;
  const newHm = k * fHm;
  const newTotal = newMp + newHh + newHm;
  const deltaAbs = newTotal - baseTotal;
  const deltaPct = baseTotal > 0 ? (deltaAbs / baseTotal) * 100 : 0;
  return {
    baseTotal,
    newMp,
    newHh,
    newHm,
    newTotal,
    deltaAbs,
    deltaPct,
  };
}
