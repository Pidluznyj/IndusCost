import { useEffect, useState } from "react";
import {
  formatSalesOrdersLastUpdatedAtLabel,
  SALES_ORDERS_LAST_UPDATE_PATH,
  type SalesOrdersLastUpdateResponse,
} from "@/src/lib/salesOrdersLastUpdate";

export function SalesOrdersPageLastUpdateSubtitle() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(SALES_ORDERS_LAST_UPDATE_PATH, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as SalesOrdersLastUpdateResponse;
        if (cancelled) return;
        setLabel(formatSalesOrdersLastUpdatedAtLabel(payload.lastUpdatedAt));
      } catch {
        if (!cancelled) setLabel(null);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  if (!label) return null;

  return (
    <p
      className="mt-0.5 text-[11px] font-normal tracking-wide text-muted-foreground tabular-nums"
      data-testid="sales-orders-last-update"
      title={label}
    >
      {label}
    </p>
  );
}
