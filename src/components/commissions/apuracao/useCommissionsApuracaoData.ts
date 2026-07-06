import { useCallback, useState } from "react";
import { useCommissionsFetch } from "@/src/components/commissions/useCommissionsFetch";
import {
  buildCommissionsApuracaoQueryString,
  type CommissionsApuracaoFilters,
} from "@/src/components/commissions/apuracao/commissionsApuracaoFilters";
import type { CommissionApuracaoLineStatus } from "@/src/lib/commissions/commissionApuracao";

export type CommissionApuracaoLine = {
  lineId: string;
  recordId: string;
  commissionPersonName: string;
  customerName: string | null;
  orderCode: string | null;
  nfeNumber: string | null;
  receivableCode: string | null;
  productCode: string | null;
  duplicateAmount: number;
  calculationBase: number;
  ratePercent: number;
  commissionCalculated: number;
  commissionReleased: number;
  commissionPaid: number;
  balance: number;
  commercialTierName: string | null;
  ruleName: string | null;
  apuracaoStatus: CommissionApuracaoLineStatus;
  blockReason: string | null;
  isPayable: boolean;
  outOfTablePrice: boolean;
};

export type CommissionApuracaoPayload = {
  totals: {
    duplicateAmountTotal: number;
    calculationBaseTotal: number;
    commissionCalculatedTotal: number;
    commissionReleasedTotal: number;
    commissionPaidTotal: number;
    balanceTotal: number;
    linesOkCount: number;
    divergenceCount: number;
    blockedCount: number;
    payableCount: number;
    nomusReferenceBase: number | null;
    nomusReferenceCommission: number | null;
    nomusDiffAmount: number | null;
    nomusDiffPercent: number | null;
  };
  lines: CommissionApuracaoLine[];
  diagnostics: {
    recordsInPeriod: number;
    recordsConfirmedStatus: number;
    recordsForecastOnly: number;
    recordsWithoutConfirmedAt: number;
    periodBasis: string;
    message: string | null;
  };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export function useCommissionsApuracaoData(filters: CommissionsApuracaoFilters) {
  const qs = buildCommissionsApuracaoQueryString(filters);
  return useCommissionsFetch<CommissionApuracaoPayload>(
    `/api/commissions/apuracao?${qs}`,
    "Não foi possível carregar a apuração de comissões."
  );
}

export function useApuracaoExport(filters: CommissionsApuracaoFilters) {
  const [exporting, setExporting] = useState(false);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const qs = buildCommissionsApuracaoQueryString(filters);
      const res = await fetch(`/api/commissions/apuracao/export?${qs}`, {
        credentials: "include",
        headers: { Accept: "text/csv" },
      });
      if (!res.ok) throw new Error("Falha ao exportar CSV.");
      const csv = await res.text();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `apuracao-comissao-${filters.year || "periodo"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [filters]);

  return { exportCsv, exporting };
}
