import type { PurchaseRequestRow, PurchaseRequestStatus } from "@/src/types/purchase";

const STATUS_ORDER: PurchaseRequestStatus[] = ["RASCUNHO", "ABERTA", "CANCELADA", "ENCERRADA"];

export function purchaseStatusCounts(rows: PurchaseRequestRow[]): Record<PurchaseRequestStatus, number> {
  const out: Record<PurchaseRequestStatus, number> = {
    RASCUNHO: 0,
    ABERTA: 0,
    CANCELADA: 0,
    ENCERRADA: 0,
  };
  for (const r of rows) {
    out[r.status]++;
  }
  return out;
}

export function purchaseStatusChartData(counts: Record<PurchaseRequestStatus, number>) {
  const total = STATUS_ORDER.reduce((s, k) => s + counts[k], 0);
  return STATUS_ORDER.map((key) => ({
    key,
    value: counts[key],
    pct: total > 0 ? (counts[key] / total) * 100 : 0,
  }));
}

export function totalPurchaseLines(rows: PurchaseRequestRow[]): number {
  return rows.reduce((s, r) => s + (r.items?.length ?? 0), 0);
}

export function topMaterialsByFrequency(
  rows: PurchaseRequestRow[],
  limit: number
): { code: string; description: string; count: number }[] {
  const map = new Map<string, { code: string; description: string; count: number }>();
  for (const r of rows) {
    for (const it of r.items ?? []) {
      if (it.lineType !== "MATERIA_PRIMA" || !it.materialId) continue;
      const code = it.material?.code ?? it.materialId;
      const description = it.material?.description ?? it.description ?? code;
      const cur = map.get(code) ?? { code, description, count: 0 };
      cur.count += 1;
      map.set(code, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
