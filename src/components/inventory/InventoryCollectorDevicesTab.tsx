/**
 * Estoque → Dispositivos do Coletor.
 *
 * Tela onde um humano decide quais tablets entram no Stock Collector. Substitui
 * o cadastro manual por SQL/F12: o aparelho pede acesso sozinho, o
 * administrador confere a identidade que o Tailscale (WhoIs) reportou e
 * autoriza.
 *
 * A identidade NUNCA é digitada aqui — StableNodeID, node e login chegam
 * prontos da solicitação. O formulário coleta apenas nome amigável e
 * capacidades. Guard: operations.inventory.counts / approve, o mesmo das rotas.
 */
import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { useInventoryPermissions } from "@/src/components/inventory/inventoryPermissions";
import {
  formatInventoryApiError,
  formatInventoryDateTime,
  InventoryEmptyState,
  InventoryErrorBanner,
  InventoryLoading,
  InventorySectionIntro,
  InventoryTableScroll,
  inventoryTableClassName,
} from "@/src/components/inventory/inventoryUi";
import { UnauthorizedAccessGate } from "@/src/components/UnauthorizedAccessGate";

export type CollectorEnrollmentRow = {
  id: string;
  tailscaleStableNodeId: string;
  tailscaleNodeName: string | null;
  tailscaleLoginName: string | null;
  lastSeenIp: string | null;
  requestedSectorSlug: string | null;
  status: string;
  expired: boolean;
  requestCount: number;
  firstRequestedAt: string;
  lastRequestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  approvedDeviceId: string | null;
};

export type CollectorDeviceRow = {
  id: string;
  name: string;
  tailscaleStableNodeId: string;
  active: boolean;
  tailscaleNodeName: string | null;
  tailscaleLoginName: string | null;
  lastSeenIp: string | null;
  lastSeenAt: string | null;
  disabledAt: string | null;
  createdAt: string;
};

/** Nome sugerido: legível, derivado do que o Tailscale já sabe. */
export function suggestCollectorDeviceName(row: {
  tailscaleNodeName: string | null;
  tailscaleLoginName: string | null;
  tailscaleStableNodeId: string;
}): string {
  const node = row.tailscaleNodeName?.trim();
  if (node) return node;
  const login = row.tailscaleLoginName?.trim();
  if (login) return `Coletor ${login.split("@")[0]}`;
  return `Coletor ${row.tailscaleStableNodeId.slice(0, 8)}`;
}

const dash = (v: string | null | undefined) => (v && v.trim() ? v : "—");

type ApproveDraft = {
  enrollment: CollectorEnrollmentRow;
  name: string;
  canManageCountSessions: boolean;
  canApplyCountAdjustments: boolean;
};

export function InventoryCollectorDevicesTab() {
  const { canApproveCount } = useInventoryPermissions();
  const [enrollments, setEnrollments] = useState<CollectorEnrollmentRow[]>([]);
  const [devices, setDevices] = useState<CollectorDeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ApproveDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [enrollmentPayload, devicePayload] = await Promise.all([
        fetchJsonOk<{ enrollments: CollectorEnrollmentRow[] }>(
          "/api/inventory/collector-device-enrollments"
        ),
        fetchJsonOk<{ devices: CollectorDeviceRow[] }>("/api/inventory/collector-devices"),
      ]);
      setEnrollments(enrollmentPayload.enrollments ?? []);
      setDevices(devicePayload.devices ?? []);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao carregar dispositivos do coletor."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canApproveCount) {
      setLoading(false);
      return;
    }
    void load();
  }, [canApproveCount, load]);

  const approve = useCallback(async () => {
    if (!draft) return;
    setBusyId(draft.enrollment.id);
    setError(null);
    try {
      await fetchJsonOk(
        `/api/inventory/collector-device-enrollments/${draft.enrollment.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name,
            canManageCountSessions: draft.canManageCountSessions,
            canApplyCountAdjustments: draft.canApplyCountAdjustments,
          }),
        }
      );
      setDraft(null);
      setNotice(
        `Dispositivo "${draft.name}" autorizado. O tablet entra sozinho em até alguns segundos.`
      );
      await load();
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao autorizar dispositivo."));
    } finally {
      setBusyId(null);
    }
  }, [draft, load]);

  const reject = useCallback(
    async (row: CollectorEnrollmentRow) => {
      setBusyId(row.id);
      setError(null);
      try {
        await fetchJsonOk(`/api/inventory/collector-device-enrollments/${row.id}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        setNotice("Solicitação recusada.");
        await load();
      } catch (e: unknown) {
        setError(formatInventoryApiError(e, "Erro ao recusar solicitação."));
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const setDeviceActive = useCallback(
    async (row: CollectorDeviceRow, active: boolean) => {
      setBusyId(row.id);
      setError(null);
      try {
        await fetchJsonOk(`/api/inventory/collector-devices/${row.id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active }),
        });
        setNotice(active ? "Dispositivo reativado." : "Dispositivo desativado.");
        await load();
      } catch (e: unknown) {
        setError(
          formatInventoryApiError(
            e,
            active ? "Erro ao reativar dispositivo." : "Erro ao desativar dispositivo."
          )
        );
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  if (!canApproveCount) {
    return <UnauthorizedAccessGate forceDenied intendedPath="/inventory/collector-devices" />;
  }

  const pending = enrollments.filter((e) => e.status === "PENDING" && !e.expired);
  const expired = enrollments.filter((e) => e.status === "PENDING" && e.expired);
  const rejected = enrollments.filter((e) => e.status === "REJECTED");
  const activeDevices = devices.filter((d) => d.active);
  const inactiveDevices = devices.filter((d) => !d.active);

  return (
    <div className="space-y-6">
      <InventorySectionIntro
        title="Dispositivos do Coletor"
        description={
          "Tablets que pedem acesso ao Stock Collector aparecem aqui. A identidade é " +
          "confirmada pelo Tailscale — confira o node e o login antes de autorizar. " +
          "Solicitar acesso não libera nada: só a autorização abaixo libera."
        }
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          {pending.length > 0
            ? `${pending.length} solicitação(ões) aguardando decisão.`
            : "Nenhuma solicitação aguardando decisão."}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50"
          data-testid="collector-devices-refresh"
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </div>

      {error ? <InventoryErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? (
        <div
          className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100"
          data-testid="collector-devices-notice"
        >
          {notice}
        </div>
      ) : null}

      {loading ? (
        <InventoryLoading label="Carregando dispositivos…" />
      ) : (
        <>
          <section className="space-y-3" data-testid="collector-enrollments-pending">
            <h3 className="text-base font-semibold text-slate-100">Aguardando autorização</h3>
            {pending.length === 0 ? (
              <InventoryEmptyState
                title="Nenhuma solicitação pendente"
                description="Quando um tablet novo abrir o Collector, a solicitação aparece aqui."
              />
            ) : (
              <InventoryTableScroll>
                <table className={inventoryTableClassName()}>
                  <thead>
                    <tr>
                      <th>Node (Tailscale)</th>
                      <th>Login</th>
                      <th>IP</th>
                      <th>Setor pedido</th>
                      <th>Primeira tentativa</th>
                      <th>Última tentativa</th>
                      <th>Tentativas</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((row) => (
                      <tr key={row.id}>
                        <td className="font-medium text-slate-100">
                          {dash(row.tailscaleNodeName)}
                          <span className="block font-mono text-xs text-slate-500">
                            {row.tailscaleStableNodeId}
                          </span>
                        </td>
                        <td>{dash(row.tailscaleLoginName)}</td>
                        <td className="font-mono text-xs">{dash(row.lastSeenIp)}</td>
                        <td>{dash(row.requestedSectorSlug)}</td>
                        <td>{formatInventoryDateTime(row.firstRequestedAt)}</td>
                        <td>{formatInventoryDateTime(row.lastRequestedAt)}</td>
                        <td className="text-right">{row.requestCount}</td>
                        <td>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() =>
                                setDraft({
                                  enrollment: row,
                                  name: suggestCollectorDeviceName(row),
                                  canManageCountSessions: true,
                                  canApplyCountAdjustments: true,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                              data-testid={`collector-enrollment-approve-${row.id}`}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              Autorizar
                            </button>
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() => void reject(row)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-700 px-3 py-1.5 text-sm text-red-200 disabled:opacity-50"
                              data-testid={`collector-enrollment-reject-${row.id}`}
                            >
                              <XCircle className="h-4 w-4" />
                              Recusar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </InventoryTableScroll>
            )}
          </section>

          <section className="space-y-3" data-testid="collector-devices-active">
            <h3 className="text-base font-semibold text-slate-100">Dispositivos autorizados</h3>
            {activeDevices.length === 0 ? (
              <InventoryEmptyState
                title="Nenhum dispositivo autorizado"
                description="Autorize uma solicitação para liberar o primeiro tablet."
              />
            ) : (
              <InventoryTableScroll>
                <table className={inventoryTableClassName()}>
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Node (Tailscale)</th>
                      <th>Login</th>
                      <th>Último acesso</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeDevices.map((row) => (
                      <tr key={row.id}>
                        <td className="font-medium text-slate-100">{row.name}</td>
                        <td>
                          {dash(row.tailscaleNodeName)}
                          <span className="block font-mono text-xs text-slate-500">
                            {row.tailscaleStableNodeId}
                          </span>
                        </td>
                        <td>{dash(row.tailscaleLoginName)}</td>
                        <td>{formatInventoryDateTime(row.lastSeenAt)}</td>
                        <td>
                          <button
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() => void setDeviceActive(row, false)}
                            className="rounded-lg border border-red-700 px-3 py-1.5 text-sm text-red-200 disabled:opacity-50"
                            data-testid={`collector-device-disable-${row.id}`}
                          >
                            Desativar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </InventoryTableScroll>
            )}
          </section>

          {inactiveDevices.length > 0 ? (
            <section className="space-y-3" data-testid="collector-devices-inactive">
              <h3 className="text-base font-semibold text-slate-100">Dispositivos desativados</h3>
              <InventoryTableScroll>
                <table className={inventoryTableClassName()}>
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Node (Tailscale)</th>
                      <th>Desativado em</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inactiveDevices.map((row) => (
                      <tr key={row.id}>
                        <td className="font-medium text-slate-100">{row.name}</td>
                        <td>
                          {dash(row.tailscaleNodeName)}
                          <span className="block font-mono text-xs text-slate-500">
                            {row.tailscaleStableNodeId}
                          </span>
                        </td>
                        <td>{formatInventoryDateTime(row.disabledAt)}</td>
                        <td>
                          <button
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() => void setDeviceActive(row, true)}
                            className="rounded-lg border border-emerald-700 px-3 py-1.5 text-sm text-emerald-200 disabled:opacity-50"
                            data-testid={`collector-device-enable-${row.id}`}
                          >
                            Reativar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </InventoryTableScroll>
            </section>
          ) : null}

          {expired.length > 0 || rejected.length > 0 ? (
            <section className="space-y-3" data-testid="collector-enrollments-history">
              <h3 className="text-base font-semibold text-slate-100">
                Solicitações expiradas e recusadas
              </h3>
              <InventoryTableScroll>
                <table className={inventoryTableClassName()}>
                  <thead>
                    <tr>
                      <th>Node (Tailscale)</th>
                      <th>Login</th>
                      <th>Situação</th>
                      <th>Última tentativa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...expired, ...rejected].map((row) => (
                      <tr key={row.id}>
                        <td className="font-medium text-slate-100">
                          {dash(row.tailscaleNodeName)}
                          <span className="block font-mono text-xs text-slate-500">
                            {row.tailscaleStableNodeId}
                          </span>
                        </td>
                        <td>{dash(row.tailscaleLoginName)}</td>
                        <td>{row.status === "REJECTED" ? "Recusada" : "Expirada"}</td>
                        <td>{formatInventoryDateTime(row.lastRequestedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </InventoryTableScroll>
            </section>
          ) : null}
        </>
      )}

      {draft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6"
            data-testid="collector-enrollment-approve-modal"
          >
            <h3 className="text-lg font-semibold text-slate-100">Autorizar dispositivo</h3>
            <p className="mt-2 text-sm text-slate-400">
              Confirme que este é mesmo o tablet que deve contar estoque. A identidade abaixo
              veio do Tailscale e não pode ser editada.
            </p>

            <dl className="mt-4 space-y-1 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Node</dt>
                <dd className="text-slate-100">{dash(draft.enrollment.tailscaleNodeName)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Login</dt>
                <dd className="text-slate-100">{dash(draft.enrollment.tailscaleLoginName)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">StableNodeID</dt>
                <dd className="font-mono text-xs text-slate-300">
                  {draft.enrollment.tailscaleStableNodeId}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">IP</dt>
                <dd className="font-mono text-xs text-slate-300">
                  {dash(draft.enrollment.lastSeenIp)}
                </dd>
              </div>
            </dl>

            <label className="mt-4 block text-sm text-slate-300">
              Nome do dispositivo
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                data-testid="collector-enrollment-approve-name"
              />
            </label>

            <div className="mt-4 space-y-2 text-sm text-slate-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.canManageCountSessions}
                  onChange={(e) =>
                    setDraft({ ...draft, canManageCountSessions: e.target.checked })
                  }
                  data-testid="collector-enrollment-approve-manage"
                />
                Pode abrir e encerrar conferências
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.canApplyCountAdjustments}
                  onChange={(e) =>
                    setDraft({ ...draft, canApplyCountAdjustments: e.target.checked })
                  }
                  data-testid="collector-enrollment-approve-adjust"
                />
                Pode aplicar ajustes de divergência
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200"
                data-testid="collector-enrollment-approve-cancel"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void approve()}
                disabled={!draft.name.trim() || busyId === draft.enrollment.id}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                data-testid="collector-enrollment-approve-confirm"
              >
                {busyId === draft.enrollment.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Autorizar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
