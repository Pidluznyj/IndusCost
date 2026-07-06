/** Grupo canônico de unidade de medida para rankings e totais de quantidade. */
export type MaterialUnitGroup = {
  unitKey: string;
  unitLabel: string;
};

const UNIT_ALIASES: Record<string, MaterialUnitGroup> = {
  kg: { unitKey: "kg", unitLabel: "KG" },
  kgs: { unitKey: "kg", unitLabel: "KG" },
  quilograma: { unitKey: "kg", unitLabel: "KG" },
  quilogramas: { unitKey: "kg", unitLabel: "KG" },
  g: { unitKey: "g", unitLabel: "G" },
  gr: { unitKey: "g", unitLabel: "G" },
  grama: { unitKey: "g", unitLabel: "G" },
  gramas: { unitKey: "g", unitLabel: "G" },
  t: { unitKey: "t", unitLabel: "T" },
  ton: { unitKey: "t", unitLabel: "T" },
  tonelada: { unitKey: "t", unitLabel: "T" },
  toneladas: { unitKey: "t", unitLabel: "T" },
  un: { unitKey: "un", unitLabel: "UN" },
  und: { unitKey: "un", unitLabel: "UN" },
  unid: { unitKey: "un", unitLabel: "UN" },
  unidade: { unitKey: "un", unitLabel: "UN" },
  unidades: { unitKey: "un", unitLabel: "UN" },
  pc: { unitKey: "un", unitLabel: "UN" },
  pcs: { unitKey: "un", unitLabel: "UN" },
  pç: { unitKey: "un", unitLabel: "UN" },
  peca: { unitKey: "un", unitLabel: "UN" },
  peça: { unitKey: "un", unitLabel: "UN" },
  pecas: { unitKey: "un", unitLabel: "UN" },
  peças: { unitKey: "un", unitLabel: "UN" },
  m: { unitKey: "m", unitLabel: "M" },
  mt: { unitKey: "m", unitLabel: "M" },
  metro: { unitKey: "m", unitLabel: "M" },
  metros: { unitKey: "m", unitLabel: "M" },
  mm: { unitKey: "mm", unitLabel: "MM" },
  milimetro: { unitKey: "mm", unitLabel: "MM" },
  milímetro: { unitKey: "mm", unitLabel: "MM" },
  "m2": { unitKey: "m2", unitLabel: "M²" },
  "m²": { unitKey: "m2", unitLabel: "M²" },
  "metro quadrado": { unitKey: "m2", unitLabel: "M²" },
  l: { unitKey: "l", unitLabel: "L" },
  lt: { unitKey: "l", unitLabel: "L" },
  litro: { unitKey: "l", unitLabel: "L" },
  litros: { unitKey: "l", unitLabel: "L" },
  ml: { unitKey: "ml", unitLabel: "ML" },
  cx: { unitKey: "cx", unitLabel: "CX" },
  caixa: { unitKey: "cx", unitLabel: "CX" },
  caixas: { unitKey: "cx", unitLabel: "CX" },
  rol: { unitKey: "rol", unitLabel: "ROL" },
  rolo: { unitKey: "rol", unitLabel: "ROL" },
  rolos: { unitKey: "rol", unitLabel: "ROL" },
};

function slugUnitKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

/** Normaliza unidade cadastrada para agrupar rankings/totais de quantidade. */
export function normalizeMaterialUnitKey(unit: string | null | undefined): MaterialUnitGroup {
  const raw = (unit ?? "").trim();
  if (!raw) {
    return { unitKey: "__unknown__", unitLabel: "Sem unidade" };
  }
  const normalized = raw.toLowerCase().replace(/\s+/g, " ");
  const alias = UNIT_ALIASES[normalized];
  if (alias) return alias;
  const slug = slugUnitKey(raw);
  return { unitKey: slug || "__unknown__", unitLabel: raw.toUpperCase() };
}
