/** Cenários what-if (tabela Simulation) — campos numéricos podem vir como Decimal/string da API. */
export type SimulationListRow = {
  id: string;
  name: string;
  materialAdj?: unknown;
  laborAdj?: unknown;
  indirectAdj?: unknown;
  efficiencyAdj?: unknown;
  marginAdj?: unknown;
};

export type NewProductSimulationSummary = {
  id: string;
  name: string;
  status: "DRAFT" | "SAVED";
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function avgScenarioAdjustments(rows: SimulationListRow[]) {
  if (rows.length === 0) {
    return { mp: 0, hh: 0, hm: 0, eff: 0, margin: 0 };
  }
  let mp = 0;
  let hh = 0;
  let hm = 0;
  let eff = 0;
  let margin = 0;
  for (const r of rows) {
    mp += num(r.materialAdj);
    hh += num(r.laborAdj);
    hm += num(r.indirectAdj);
    eff += num(r.efficiencyAdj);
    margin += num(r.marginAdj);
  }
  const n = rows.length;
  return { mp: mp / n, hh: hh / n, hm: hm / n, eff: eff / n, margin: margin / n };
}

export function newProductSnapshotCounts(rows: NewProductSimulationSummary[]) {
  let draft = 0;
  let saved = 0;
  for (const r of rows) {
    if (r.status === "DRAFT") draft++;
    else if (r.status === "SAVED") saved++;
  }
  return { draft, saved, total: rows.length };
}
