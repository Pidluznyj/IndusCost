import React, { useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http.js";
import { TREASURY_AUDIT_PATH } from "@/src/lib/treasury/contracts/treasuryContracts.js";
import type { TreasuryAuditLogDto } from "@/src/lib/treasury/contracts/treasuryAuditContracts.js";

/**
 * Consulta de auditoria append-only da Tesouraria.
 */
export function TreasuryAuditPage() {
  const [items, setItems] = useState<TreasuryAuditLogDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchJsonOk<{ items: TreasuryAuditLogDto[] }>(
          `${TREASURY_AUDIT_PATH}?pageSize=50`
        );
        if (!cancelled) setItems(res.items ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Falha ao carregar auditoria."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4" data-testid="treasury-audit-page">
      <div>
        <h2 className="text-lg font-semibold">Auditoria</h2>
        <p className="text-sm text-muted-foreground">
          Trilha append-only. Sem exclusão nem edição de eventos.
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
              <th className="py-2">Quando</th>
              <th>Ação</th>
              <th>Entidade</th>
              <th>Id</th>
              <th>Usuário</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border/60">
                <td className="py-2">{item.occurredAt}</td>
                <td>{item.action}</td>
                <td>{item.entityType}</td>
                <td className="font-mono text-xs">{item.entityId}</td>
                <td>{item.userName ?? item.userId ?? "—"}</td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-muted-foreground">
                  Nenhum evento de auditoria.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
