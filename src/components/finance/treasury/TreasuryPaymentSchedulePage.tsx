import React, { useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http.js";
import { TREASURY_PAYMENT_SCHEDULE_PATH } from "@/src/lib/treasury/contracts/treasuryContracts.js";

type ScheduleItem = {
  id: string;
  officialTitleId: string;
  officialExternalId: number;
  scheduledDate: string | null;
  scheduledAmount: string | null;
  status: string;
  priority: string;
  plannedAccountId: string | null;
};

/**
 * Agenda de programação de pagamentos (complementos locais com scheduledDate).
 */
export function TreasuryPaymentSchedulePage() {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchJsonOk<{ items: ScheduleItem[] }>(
          `${TREASURY_PAYMENT_SCHEDULE_PATH}?pageSize=100`
        );
        if (!cancelled) setItems(res.items ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Falha ao carregar programação."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4" data-testid="treasury-payment-schedule-page">
      <div>
        <h2 className="text-lg font-semibold">Programação de pagamentos</h2>
        <p className="text-sm text-muted-foreground">
          Intenções locais (scheduledDate). Vencimento oficial Nomus permanece
          intacto.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">Título</th>
              <th>Data programada</th>
              <th>Valor</th>
              <th>Prioridade</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border/60">
                <td className="py-2">{item.officialExternalId}</td>
                <td>{item.scheduledDate ?? "—"}</td>
                <td>{item.scheduledAmount ?? "—"}</td>
                <td>{item.priority}</td>
                <td>{item.status}</td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-muted-foreground">
                  Nenhuma programação ativa.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
