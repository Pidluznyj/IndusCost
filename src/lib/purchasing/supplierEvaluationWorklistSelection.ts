/**
 * Seleção da worklist de avaliação de fornecedor (página atual).
 * Não altera fórmula OP-26 — só o conjunto de pedidos marcados para salvar.
 */

export function eligibleWorklistRowIds(
  rows: ReadonlyArray<{ nomusPurchaseOrderId: string; eligible: boolean }>
): string[] {
  return rows.filter((row) => row.eligible).map((row) => row.nomusPurchaseOrderId);
}

export type SelectAllCheckboxState = {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
};

export function supplierEvaluationSelectAllState(
  eligibleIds: readonly string[],
  selected: Readonly<Record<string, boolean>>
): SelectAllCheckboxState {
  if (eligibleIds.length === 0) {
    return { checked: false, indeterminate: false, disabled: true };
  }
  const selectedCount = eligibleIds.filter((id) => selected[id] === true).length;
  return {
    checked: selectedCount === eligibleIds.length,
    indeterminate: selectedCount > 0 && selectedCount < eligibleIds.length,
    disabled: false,
  };
}

/** Marca ou desmarca só os elegíveis da página; não apaga seleção de outras páginas. */
export function applySelectAllEligible(
  selected: Readonly<Record<string, boolean>>,
  eligibleIds: readonly string[],
  checked: boolean
): Record<string, boolean> {
  const next = { ...selected };
  for (const id of eligibleIds) {
    next[id] = checked;
  }
  return next;
}
