import { useCallback, useState } from "react";
import { HttpError } from "../http.js";
import {
  EMPTY_COST_TO_CASH_FILTERS,
  fetchCostToCashTrace,
  hasCostToCashSearchCriteria,
  type CostToCashTraceApiPayload,
  type CostToCashTraceSearchFilters,
} from "./costToCashTraceClient.js";

export function useCostToCashTraceSearch() {
  const [draftFilters, setDraftFilters] = useState<CostToCashTraceSearchFilters>({
    ...EMPTY_COST_TO_CASH_FILTERS,
  });
  const [appliedFilters, setAppliedFilters] = useState<CostToCashTraceSearchFilters | null>(null);
  const [data, setData] = useState<CostToCashTraceApiPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const updateDraft = useCallback((patch: Partial<CostToCashTraceSearchFilters>) => {
    setDraftFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const search = useCallback(async (filters: CostToCashTraceSearchFilters) => {
    if (!hasCostToCashSearchCriteria(filters)) {
      setValidationError(
        "Informe SKU, pedido, NF, título AR ou cliente com ano para pesquisar."
      );
      return;
    }
    if (filters.customer?.trim() && !filters.year?.trim()) {
      setValidationError("Filtro por cliente exige ano.");
      return;
    }

    setValidationError(null);
    setAppliedFilters({ ...filters });
    setLoading(true);
    setError(null);

    try {
      const payload = await fetchCostToCashTrace(filters);
      setData(payload);
    } catch (err) {
      const message =
        err instanceof HttpError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Erro ao consultar rastreabilidade.";
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const submit = useCallback(() => {
    void search(draftFilters);
  }, [draftFilters, search]);

  const reset = useCallback(() => {
    setDraftFilters({ ...EMPTY_COST_TO_CASH_FILTERS });
    setAppliedFilters(null);
    setData(null);
    setError(null);
    setValidationError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    draftFilters,
    appliedFilters,
    data,
    loading,
    error,
    validationError,
    updateDraft,
    submit,
    reset,
    search,
    clearError,
  };
}
