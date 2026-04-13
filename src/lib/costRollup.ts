/**
 * Agregação da decomposição (MP / HH / HM / CIF informativo) quando a BOM inclui filhos fabricados.
 * O custo consolidado do item (regra de negócio) usa só MP+HH+HM; CIF não entra na linha estrutural nem no total final.
 */

export type ChildUnitAnalysis = {
  totalMaterialCost: number;
  totalHH_Unit: number;
  totalHM_Unit: number;
  totalCIF_Unit: number;
  totalIndustrialCost: number;
};

export type ChildScaledContribution = {
  material: number;
  hh: number;
  hm: number;
  cif: number;
  /** Linha BOM (= MP+HH+HM unitário do filho × qtd; sem CIF no consolidado) */
  structuralLine: number;
};

export function scaleChildContribution(
  child: ChildUnitAnalysis,
  requiredQty: number
): ChildScaledContribution {
  const q = Number(requiredQty);
  const safeQ = Number.isFinite(q) ? q : 0;
  const mat = Number(child.totalMaterialCost);
  const hhU = Number(child.totalHH_Unit);
  const hmU = Number(child.totalHM_Unit);
  const cifU = Number(child.totalCIF_Unit);
  const lineNoCif = mat + hhU + hmU;
  return {
    material: mat * safeQ,
    hh: hhU * safeQ,
    hm: hmU * safeQ,
    cif: cifU * safeQ,
    structuralLine: lineNoCif * safeQ,
  };
}

export function aggregateParentDecomposition(
  directMaterialTotal: number,
  childContributions: ChildScaledContribution[],
  ownProcess: { hh: number; hm: number; cif: number }
): {
  totalMaterialCost: number;
  totalHH_Unit: number;
  totalHM_Unit: number;
  totalCIF_Unit: number;
} {
  let mat = Number(directMaterialTotal);
  let hh = Number(ownProcess.hh);
  let hm = Number(ownProcess.hm);
  let cif = Number(ownProcess.cif);
  for (const c of childContributions) {
    mat += c.material;
    hh += c.hh;
    hm += c.hm;
    cif += c.cif;
  }
  return {
    totalMaterialCost: mat,
    totalHH_Unit: hh,
    totalHM_Unit: hm,
    totalCIF_Unit: cif,
  };
}

/** Soma das linhas da BOM (MP direto + MP+HH+HM dos filhos × qtd). */
export function structuralBomLineTotal(
  directMaterialTotal: number,
  childContributions: ChildScaledContribution[]
): number {
  return (
    Number(directMaterialTotal) +
    childContributions.reduce((acc, c) => acc + c.structuralLine, 0)
  );
}
