import { useCallback, useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCommissionsApiError } from "@/src/components/commissions/commissionsUi";
import type {
  CommissionsAuditPayload,
  CommissionsDashboardPayload,
  CommissionsReleasesPayload,
} from "@/src/components/commissions/commissionsTypes";
import { buildCommissionsDashboardQueryString } from "@/src/components/commissions/dashboard/commissionsDashboardFilters";
import type { CommissionsDashboardFilters } from "@/src/components/commissions/dashboard/commissionsDashboardFilters";

export type CommissionsDashboardData = {
  dashboard: CommissionsDashboardPayload | null;
  releases: CommissionsReleasesPayload | null;
  criticalAudit: CommissionsAuditPayload | null;
};

export function useCommissionsDashboardData(filters: CommissionsDashboardFilters) {
  const queryString = buildCommissionsDashboardQueryString(filters);
  const [data, setData] = useState<CommissionsDashboardData>({
    dashboard: null,
    releases: null,
    criticalAudit: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const dashboardUrl = queryString
      ? `/api/commissions/dashboard?${queryString}`
      : "/api/commissions/dashboard";
    const releasesUrl = queryString
      ? `/api/commissions/releases?${queryString}&page=1&pageSize=100`
      : "/api/commissions/releases?page=1&pageSize=100";
    const auditUrl = "/api/commissions/audit?severity=CRITICAL&resolved=false&page=1&pageSize=5";

    try {
      const [dashboard, releases, criticalAudit] = await Promise.all([
        fetchJsonOk<CommissionsDashboardPayload>(dashboardUrl),
        fetchJsonOk<CommissionsReleasesPayload>(releasesUrl),
        fetchJsonOk<CommissionsAuditPayload>(auditUrl),
      ]);
      setData({ dashboard, releases, criticalAudit });
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível carregar o dashboard de comissões."));
      setData({ dashboard: null, releases: null, criticalAudit: null });
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
