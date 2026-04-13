/**
 * Agregação pura da decomposição de custo (MP / HH / HM / CIF) quando a BOM inclui
 * componentes filhos fabricados. O custo industrial unitário do filho já embute MP+HH+HM+CIF;
 * aqui separamos essas parcelas para o pai sem alterar o total.
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
  /** Linha estrutural da BOM (= CIU unitário do filho × qtd com perda) */
  structuralLine: number;
};

export function scaleChildContribution(
  child: ChildUnitAnalysis,
  requiredQty: number
): ChildScaledContribution {
  const q = Number(requiredQty);
  const safeQ = Number.isFinite(q) ? q : 0;
  return {
    material: Number(child.totalMaterialCost) * safeQ,
    hh: Number(child.totalHH_Unit) * safeQ,
    hm: Number(child.totalHM_Unit) * safeQ,
    cif: Number(child.totalCIF_Unit) * safeQ,
    structuralLine: Number(child.totalIndustrialCost) * safeQ,
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

/** Soma das linhas da BOM “estrutura” (MP direto + CIU completo dos filhos × qtd). */
export function structuralBomLineTotal(
  directMaterialTotal: number,
  childContributions: ChildScaledContribution[]
): number {
  return (
    Number(directMaterialTotal) +
    childContributions.reduce((acc, c) => acc + c.structuralLine, 0)
  );
}
