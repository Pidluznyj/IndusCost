import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import type {
  FleetAuditLogRow,
  FleetContractRow,
  FleetDocumentRow,
  FleetMaintenanceRow,
  FleetAttachmentRow,
  FleetUsageRow,
  FleetVehicleDetail,
  FleetVehicleOrigin,
  FleetVehicleStatus,
} from "@/src/types/fleet";
import { MAINTENANCE_STATUS_LABEL } from "@/src/types/fleet";
import { CONTRACT_TYPE_OPTIONS, DOCUMENT_TYPE_OPTIONS } from "@/src/types/fleet";
import {
  confirmFleetCriticalAction,
  formatFleetDateTime,
  formatFleetKm,
  formatFleetMoney,
  formatFleetApiError,
} from "@/src/components/fleet/fleetUi";
import { FLEET_AUDIT_ACTION_LABEL } from "@/src/lib/fleetUxShared";

const STATUS_LABEL: Record<FleetVehicleStatus, string> = {
  AVAILABLE: "Disponível",
  RESERVED: "Reservado",
  IN_USE: "Em uso",
  MAINTENANCE: "Manutenção",
  BLOCKED: "Bloqueado",
  CLAIMED: "Sinistrado",
  INACTIVE: "Inativo",
  RETURNED: "Devolvido",
  SOLD: "Vendido",
};

const ORIGIN_LABEL: Record<FleetVehicleOrigin, string> = {
  OWNED: "Próprio",
  RENTED: "Alugado",
  LEASING: "Leasing",
  COMODATO: "Comodato",
  THIRD_PARTY: "Terceiro",
};

const DOC_STATUS_LABEL = {
  VALID: "Válido",
  EXPIRING: "Vencendo",
  EXPIRED: "Vencido",
  REPLACED: "Substituído",
};

type SheetTab =
  | "info"
  | "contracts"
  | "documents"
  | "usage"
  | "maintenances"
  | "attachments"
  | "history";

function dateInput(v: string | null | undefined) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function formatDt(v: string | null | undefined) {
  return formatFleetDateTime(v);
}


type Props = {
  vehicleId: string;
  onClose: () => void;
  onUpdated: () => void;
  canEdit: boolean;
  canManage: boolean;
  canFinancial: boolean;
};

export function FleetVehicleDetailSheet({
  vehicleId,
  onClose,
  onUpdated,
  canEdit,
  canManage,
  canFinancial,
}: Props) {
  const [tab, setTab] = useState<SheetTab>("info");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<FleetVehicleDetail | null>(null);
  const [contracts, setContracts] = useState<FleetContractRow[]>([]);
  const [documents, setDocuments] = useState<FleetDocumentRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<FleetAuditLogRow[]>([]);
  const [usages, setUsages] = useState<FleetUsageRow[]>([]);
  const [maintenances, setMaintenances] = useState<FleetMaintenanceRow[]>([]);
  const [attachments, setAttachments] = useState<FleetAttachmentRow[]>([]);
  const [attachmentForm, setAttachmentForm] = useState({
    fileName: "",
    fileUrl: "",
    attachmentType: "OUTRO",
    notes: "",
  });

  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [contractForm, setContractForm] = useState<Record<string, string>>({});
  const [documentForm, setDocumentForm] = useState<Record<string, string>>({});
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [showContractForm, setShowContractForm] = useState(false);
  const [showDocumentForm, setShowDocumentForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, contractsRes, documentsRes, auditRes, usagesRes, maintRes, attachRes] =
        await Promise.all([
        fetchJsonOk<{ vehicle: FleetVehicleDetail }>(`/api/fleet/vehicles/${vehicleId}`),
        fetchJsonOk<{ contracts: FleetContractRow[] }>(`/api/fleet/vehicles/${vehicleId}/contracts`),
        fetchJsonOk<{ documents: FleetDocumentRow[] }>(`/api/fleet/vehicles/${vehicleId}/documents`),
        fetchJsonOk<{ auditLogs: FleetAuditLogRow[] }>(`/api/fleet/vehicles/${vehicleId}/audit`),
        fetchJsonOk<{ usages: FleetUsageRow[] }>(`/api/fleet/vehicles/${vehicleId}/usages`),
        fetchJsonOk<{ maintenances: FleetMaintenanceRow[] }>(
          `/api/fleet/vehicles/${vehicleId}/maintenances`
        ),
        fetchJsonOk<{ attachments: FleetAttachmentRow[] }>(
          `/api/fleet/attachments?vehicleId=${vehicleId}`
        ),
      ]);
      const v = detail.vehicle;
      setVehicle(v);
      setContracts(contractsRes.contracts);
      setDocuments(documentsRes.documents);
      setAuditLogs(auditRes.auditLogs);
      setUsages(usagesRes.usages);
      setMaintenances(maintRes.maintenances);
      setAttachments(attachRes.attachments);
      setEditForm({
        plate: v.plate ?? "",
        brand: v.brand,
        model: v.model,
        origin: v.origin,
        renavam: v.renavam ?? "",
        chassis: v.chassis ?? "",
        color: v.color ?? "",
        vehicleType: v.vehicleType ?? "",
        fuelType: v.fuelType ?? "",
        currentKm: String(v.currentKm),
        initialKm: String(v.initialKm ?? v.currentKm),
        unit: v.unit ?? "",
        costCenter: v.costCenter ?? "",
        notes: v.notes ?? "",
      });
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao carregar veículo."));
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (path: string, body?: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      await load();
      onUpdated();
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro na operação."));
    } finally {
      setSaving(false);
    }
  };

  const saveVehicle = async () => {
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/fleet/vehicles/${vehicleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editForm,
          currentKm: Number(editForm.currentKm) || 0,
          initialKm: Number(editForm.initialKm) || 0,
          modelYear: editForm.modelYear ? Number(editForm.modelYear) : null,
          manufactureYear: editForm.manufactureYear ? Number(editForm.manufactureYear) : null,
        }),
      });
      await load();
      onUpdated();
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao salvar."));
    } finally {
      setSaving(false);
    }
  };

  const lifecycle = (action: string) => {
    const actionMap: Record<string, Parameters<typeof confirmFleetCriticalAction>[0]> = {
      block: "vehicle.block",
      unblock: "vehicle.unblock",
      deactivate: "vehicle.deactivate",
      sell: "vehicle.sell",
      return: "vehicle.return",
    };
    const critical = actionMap[action];
    const { confirmed, reason } = critical
      ? confirmFleetCriticalAction(critical)
      : { confirmed: window.confirm("Confirma esta ação?"), reason: null };
    if (!confirmed) return;
    const paths: Record<string, string> = {
      block: `/api/fleet/vehicles/${vehicleId}/block`,
      unblock: `/api/fleet/vehicles/${vehicleId}/unblock`,
      deactivate: `/api/fleet/vehicles/${vehicleId}/deactivate`,
      sell: `/api/fleet/vehicles/${vehicleId}/sell`,
      return: `/api/fleet/vehicles/${vehicleId}/return-to-lessor`,
    };
    void runAction(paths[action]!, { reason });
  };

  const saveContract = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...contractForm,
        monthlyValue: contractForm.monthlyValue ? Number(contractForm.monthlyValue) : null,
        kmFranchise: contractForm.kmFranchise ? Number(contractForm.kmFranchise) : null,
        excessKmValue: contractForm.excessKmValue ? Number(contractForm.excessKmValue) : null,
        billingDay: contractForm.billingDay ? Number(contractForm.billingDay) : null,
      };
      if (editingContractId) {
        await fetchJsonOk(`/api/fleet/contracts/${editingContractId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetchJsonOk(`/api/fleet/vehicles/${vehicleId}/contracts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setShowContractForm(false);
      setEditingContractId(null);
      setContractForm({});
      await load();
      onUpdated();
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao salvar contrato."));
    } finally {
      setSaving(false);
    }
  };

  const saveDocument = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editingDocumentId === "replace") {
        await fetchJsonOk(`/api/fleet/documents/${documentForm.replaceId}/replace`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(documentForm),
        });
      } else if (editingDocumentId) {
        await fetchJsonOk(`/api/fleet/documents/${editingDocumentId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(documentForm),
        });
      } else {
        await fetchJsonOk(`/api/fleet/vehicles/${vehicleId}/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(documentForm),
        });
      }
      setShowDocumentForm(false);
      setEditingDocumentId(null);
      setDocumentForm({});
      await load();
      onUpdated();
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao salvar documento."));
    } finally {
      setSaving(false);
    }
  };

  const openEditContract = (c: FleetContractRow) => {
    setEditingContractId(c.id);
    setShowContractForm(true);
    setContractForm({
      supplierName: c.supplierName,
      supplierDocument: c.supplierDocument ?? "",
      contractNumber: c.contractNumber ?? "",
      contractType: c.contractType,
      startDate: dateInput(c.startDate),
      endDate: dateInput(c.endDate),
      monthlyValue: c.monthlyValue != null ? String(c.monthlyValue) : "",
      billingDay: c.billingDay != null ? String(c.billingDay) : "",
      kmFranchise: c.kmFranchise != null ? String(c.kmFranchise) : "",
      excessKmValue: c.excessKmValue != null ? String(c.excessKmValue) : "",
      status: c.status,
      notes: c.notes ?? "",
    });
  };

  const openEditDocument = (d: FleetDocumentRow) => {
    setEditingDocumentId(d.id);
    setShowDocumentForm(true);
    setDocumentForm({
      documentType: d.documentType,
      documentNumber: d.documentNumber ?? "",
      issueDate: dateInput(d.issueDate),
      expirationDate: dateInput(d.expirationDate),
      responsible: d.responsible ?? "",
      attachmentUrl: d.attachmentUrl ?? "",
      notes: d.notes ?? "",
    });
  };

  const alerts = vehicle?.alerts ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-3xl flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold">
              {vehicle?.plate ?? "—"} · {vehicle?.brand} {vehicle?.model}
            </h2>
            {vehicle && (
              <p className="text-sm text-slate-500">
                {ORIGIN_LABEL[vehicle.origin]} · {STATUS_LABEL[vehicle.status]}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {alerts.length > 0 && (
          <div className="border-b bg-amber-50 px-4 py-2 text-sm">
            {alerts.map((a, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-1",
                  a.level === "critical" ? "text-red-700" : "text-amber-800"
                )}
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {a.message}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-1 border-b px-4 py-2">
          {(
            [
              ["info", "Informações"],
              ["contracts", "Contratos"],
              ["documents", "Documentos"],
              ["usage", "Reservas / Uso"],
              ["maintenances", "Manutenções"],
              ["attachments", "Anexos"],
              ["history", "Histórico"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                tab === id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              {tab === "info" && vehicle && (
                <div className="space-y-4">
                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      {vehicle.status !== "BLOCKED" && (
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs"
                          disabled={saving}
                          onClick={() => lifecycle("block")}
                        >
                          Bloquear
                        </button>
                      )}
                      {vehicle.status === "BLOCKED" && (
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-xs"
                          disabled={saving}
                          onClick={() => lifecycle("unblock")}
                        >
                          Desbloquear
                        </button>
                      )}
                      {!["INACTIVE", "SOLD", "RETURNED"].includes(vehicle.status) && (
                        <>
                          <button
                            type="button"
                            className="rounded border px-2 py-1 text-xs"
                            disabled={saving || vehicle.status === "IN_USE"}
                            onClick={() => lifecycle("deactivate")}
                          >
                            Inativar
                          </button>
                          <button
                            type="button"
                            className="rounded border px-2 py-1 text-xs"
                            disabled={saving || vehicle.status === "IN_USE"}
                            onClick={() => lifecycle("sell")}
                          >
                            Vender
                          </button>
                          <button
                            type="button"
                            className="rounded border px-2 py-1 text-xs"
                            disabled={saving || vehicle.status === "IN_USE"}
                            onClick={() => lifecycle("return")}
                          >
                            Devolver locadora
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2 text-sm">
                    {(
                      [
                        ["plate", "Placa"],
                        ["brand", "Marca *"],
                        ["model", "Modelo *"],
                        ["renavam", "RENAVAM"],
                        ["chassis", "Chassi"],
                        ["color", "Cor"],
                        ["vehicleType", "Tipo"],
                        ["fuelType", "Combustível"],
                        ["currentKm", "Km atual"],
                        ["initialKm", "Km inicial"],
                        ["unit", "Unidade"],
                        ["costCenter", "Centro de custo"],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="block">
                        {label}
                        <input
                          className="mt-1 w-full rounded border px-2 py-1.5"
                          value={editForm[k] ?? ""}
                          disabled={!canEdit}
                          onChange={(e) => setEditForm((f) => ({ ...f, [k]: e.target.value }))}
                        />
                      </label>
                    ))}
                    <label className="block">
                      Origem
                      <select
                        className="mt-1 w-full rounded border px-2 py-1.5"
                        value={editForm.origin}
                        disabled={!canEdit}
                        onChange={(e) => setEditForm((f) => ({ ...f, origin: e.target.value }))}
                      >
                        {Object.entries(ORIGIN_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block sm:col-span-2">
                      Observações
                      <textarea
                        className="mt-1 w-full rounded border px-2 py-1.5"
                        rows={2}
                        value={editForm.notes}
                        disabled={!canEdit}
                        onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                      />
                    </label>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void saveVehicle()}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
                    >
                      Salvar informações
                    </button>
                  )}
                </div>
              )}

              {tab === "contracts" && (
                <div className="space-y-3">
                  {canEdit && (
                    <button
                      type="button"
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white"
                      onClick={() => {
                        setShowContractForm(true);
                        setEditingContractId(null);
                        setContractForm({
                          contractType:
                            vehicle?.origin === "RENTED"
                              ? "LOCACAO"
                              : vehicle?.origin === "LEASING"
                                ? "LEASING"
                                : vehicle?.origin === "COMODATO"
                                  ? "COMODATO"
                                  : "PROPRIO",
                          startDate: new Date().toISOString().slice(0, 10),
                          status: "ACTIVE",
                        });
                      }}
                    >
                      Novo contrato
                    </button>
                  )}
                  {showContractForm && (
                    <div className="rounded-lg border p-3 grid gap-2 text-sm sm:grid-cols-2">
                      <input
                        placeholder="Fornecedor *"
                        className="rounded border px-2 py-1.5 sm:col-span-2"
                        value={contractForm.supplierName ?? ""}
                        onChange={(e) =>
                          setContractForm((f) => ({ ...f, supplierName: e.target.value }))
                        }
                      />
                      <input
                        placeholder="CNPJ"
                        className="rounded border px-2 py-1.5"
                        value={contractForm.supplierDocument ?? ""}
                        onChange={(e) =>
                          setContractForm((f) => ({ ...f, supplierDocument: e.target.value }))
                        }
                      />
                      <input
                        placeholder="Nº contrato"
                        className="rounded border px-2 py-1.5"
                        value={contractForm.contractNumber ?? ""}
                        onChange={(e) =>
                          setContractForm((f) => ({ ...f, contractNumber: e.target.value }))
                        }
                      />
                      <select
                        className="rounded border px-2 py-1.5"
                        value={contractForm.contractType ?? ""}
                        onChange={(e) =>
                          setContractForm((f) => ({ ...f, contractType: e.target.value }))
                        }
                      >
                        {CONTRACT_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        className="rounded border px-2 py-1.5"
                        value={contractForm.startDate ?? ""}
                        onChange={(e) =>
                          setContractForm((f) => ({ ...f, startDate: e.target.value }))
                        }
                      />
                      <input
                        type="date"
                        className="rounded border px-2 py-1.5"
                        value={contractForm.endDate ?? ""}
                        onChange={(e) =>
                          setContractForm((f) => ({ ...f, endDate: e.target.value }))
                        }
                      />
                      {canFinancial && (
                        <>
                          <input
                            placeholder="Valor mensal"
                            className="rounded border px-2 py-1.5"
                            value={contractForm.monthlyValue ?? ""}
                            onChange={(e) =>
                              setContractForm((f) => ({ ...f, monthlyValue: e.target.value }))
                            }
                          />
                          <input
                            placeholder="Dia cobrança"
                            className="rounded border px-2 py-1.5"
                            value={contractForm.billingDay ?? ""}
                            onChange={(e) =>
                              setContractForm((f) => ({ ...f, billingDay: e.target.value }))
                            }
                          />
                          <input
                            placeholder="Franquia km"
                            className="rounded border px-2 py-1.5"
                            value={contractForm.kmFranchise ?? ""}
                            onChange={(e) =>
                              setContractForm((f) => ({ ...f, kmFranchise: e.target.value }))
                            }
                          />
                          <input
                            placeholder="R$ km excedente"
                            className="rounded border px-2 py-1.5"
                            value={contractForm.excessKmValue ?? ""}
                            onChange={(e) =>
                              setContractForm((f) => ({ ...f, excessKmValue: e.target.value }))
                            }
                          />
                        </>
                      )}
                      <textarea
                        placeholder="Observações"
                        className="rounded border px-2 py-1.5 sm:col-span-2"
                        rows={2}
                        value={contractForm.notes ?? ""}
                        onChange={(e) =>
                          setContractForm((f) => ({ ...f, notes: e.target.value }))
                        }
                      />
                      <div className="sm:col-span-2 flex gap-2">
                        <button
                          type="button"
                          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
                          disabled={saving}
                          onClick={() => void saveContract()}
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          className="rounded border px-3 py-1.5 text-sm"
                          onClick={() => setShowContractForm(false)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    {contracts.map((c) => (
                      <div key={c.id} className="rounded-lg border p-3 text-sm">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">
                            {c.contractType} — {c.supplierName}
                          </span>
                          <span className="text-slate-500">{c.status}</span>
                        </div>
                        <p className="text-slate-600 mt-1">
                          {dateInput(c.startDate)} → {c.endDate ? dateInput(c.endDate) : "—"} ·{" "}
                          {formatFleetMoney(c.monthlyValue, {
                            masked: c.financialMasked,
                            canView: canFinancial,
                          })}
                        </p>
                        {canEdit && (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              className="text-xs underline"
                              onClick={() => openEditContract(c)}
                            >
                              Editar
                            </button>
                            {c.status === "ACTIVE" && (
                              <button
                                type="button"
                                className="text-xs text-red-700 underline"
                                onClick={async () => {
                                  if (!confirm("Cancelar contrato?")) return;
                                  await fetchJsonOk(`/api/fleet/contracts/${c.id}/cancel`, {
                                    method: "PATCH",
                                  });
                                  await load();
                                }}
                              >
                                Cancelar
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {contracts.length === 0 && (
                      <p className="text-sm text-slate-500">Nenhum contrato cadastrado.</p>
                    )}
                  </div>
                </div>
              )}

              {tab === "documents" && (
                <div className="space-y-3">
                  {canEdit && (
                    <button
                      type="button"
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white"
                      onClick={() => {
                        setShowDocumentForm(true);
                        setEditingDocumentId(null);
                        setDocumentForm({ documentType: "CRLV" });
                      }}
                    >
                      Novo documento
                    </button>
                  )}
                  {showDocumentForm && (
                    <div className="rounded-lg border p-3 grid gap-2 text-sm sm:grid-cols-2">
                      <select
                        className="rounded border px-2 py-1.5"
                        value={documentForm.documentType ?? ""}
                        onChange={(e) =>
                          setDocumentForm((f) => ({ ...f, documentType: e.target.value }))
                        }
                      >
                        {DOCUMENT_TYPE_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <input
                        placeholder="Número"
                        className="rounded border px-2 py-1.5"
                        value={documentForm.documentNumber ?? ""}
                        onChange={(e) =>
                          setDocumentForm((f) => ({ ...f, documentNumber: e.target.value }))
                        }
                      />
                      <input
                        type="date"
                        className="rounded border px-2 py-1.5"
                        placeholder="Emissão"
                        value={documentForm.issueDate ?? ""}
                        onChange={(e) =>
                          setDocumentForm((f) => ({ ...f, issueDate: e.target.value }))
                        }
                      />
                      <input
                        type="date"
                        className="rounded border px-2 py-1.5"
                        placeholder="Vencimento"
                        value={documentForm.expirationDate ?? ""}
                        onChange={(e) =>
                          setDocumentForm((f) => ({ ...f, expirationDate: e.target.value }))
                        }
                      />
                      <input
                        placeholder="Responsável"
                        className="rounded border px-2 py-1.5"
                        value={documentForm.responsible ?? ""}
                        onChange={(e) =>
                          setDocumentForm((f) => ({ ...f, responsible: e.target.value }))
                        }
                      />
                      <input
                        placeholder="URL anexo"
                        className="rounded border px-2 py-1.5 sm:col-span-2"
                        value={documentForm.attachmentUrl ?? ""}
                        onChange={(e) =>
                          setDocumentForm((f) => ({ ...f, attachmentUrl: e.target.value }))
                        }
                      />
                      <div className="sm:col-span-2 flex gap-2">
                        <button
                          type="button"
                          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
                          disabled={saving}
                          onClick={() => void saveDocument()}
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          className="rounded border px-3 py-1.5 text-sm"
                          onClick={() => setShowDocumentForm(false)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    {documents.map((d) => (
                      <div
                        key={d.id}
                        className={cn(
                          "rounded-lg border p-3 text-sm",
                          d.status === "EXPIRED" && "border-red-200 bg-red-50",
                          d.status === "EXPIRING" && "border-amber-200 bg-amber-50"
                        )}
                      >
                        <div className="flex justify-between">
                          <span className="font-medium">{d.documentType}</span>
                          <span>{DOC_STATUS_LABEL[d.status]}</span>
                        </div>
                        <p className="text-slate-600 mt-1">
                          Venc.: {d.expirationDate ? dateInput(d.expirationDate) : "—"}
                          {d.documentNumber ? ` · ${d.documentNumber}` : ""}
                        </p>
                        {canEdit && d.status !== "REPLACED" && (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              className="text-xs underline"
                              onClick={() => openEditDocument(d)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="text-xs underline"
                              onClick={() => {
                                setEditingDocumentId("replace");
                                setShowDocumentForm(true);
                                setDocumentForm({
                                  replaceId: d.id,
                                  documentType: d.documentType,
                                  issueDate: new Date().toISOString().slice(0, 10),
                                });
                              }}
                            >
                              Substituir
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === "usage" && (
                <div className="space-y-2">
                  {usages.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhum uso registrado para este veículo.</p>
                  ) : (
                    usages.map((u) => (
                      <div key={u.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                        <div className="font-medium">
                          {u.driver?.name ?? "Sem motorista"} · {u.status}
                        </div>
                        <p className="mt-1 text-slate-600">
                          Retirada: {formatDt(u.checkoutAt)} · {u.checkoutKm?.toLocaleString("pt-BR") ?? "—"} km
                          {u.checkoutFuelLevel ? ` · ${u.checkoutFuelLevel}` : ""}
                        </p>
                        {u.checkinAt && (
                          <p className="text-slate-600">
                            Devolução: {formatDt(u.checkinAt)} · {u.checkinKm?.toLocaleString("pt-BR") ?? "—"} km
                            {u.kmDriven != null
                              ? ` · Rodados: ${u.kmDriven.toLocaleString("pt-BR")} km`
                              : ""}
                          </p>
                        )}
                        {u.checkoutNotes && (
                          <p className="mt-1 text-xs text-slate-500">Obs. retirada: {u.checkoutNotes}</p>
                        )}
                        {u.checkinNotes && (
                          <p className="text-xs text-slate-500">Obs. devolução: {u.checkinNotes}</p>
                        )}
                        {u.reservation && (
                          <p className="mt-1 text-xs text-slate-500">
                            Reserva: {u.reservation.status} · {formatDt(u.reservation.startDateTime)} →{" "}
                            {formatDt(u.reservation.endDateTime)}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === "maintenances" && (
                <div className="space-y-3">
                  {(canEdit || canManage) && (
                    <button
                      type="button"
                      className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
                      disabled={saving}
                      onClick={() =>
                        void runAction("/api/fleet/maintenances", {
                          vehicleId,
                          maintenanceType: "CORRETIVA",
                          priority: "MEDIA",
                          description: "Manutenção aberta pela ficha do veículo",
                          blocksVehicle: true,
                          currentKm: vehicle?.currentKm,
                        })
                      }
                    >
                      Abrir manutenção corretiva
                    </button>
                  )}
                  {maintenances.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhuma manutenção registrada.</p>
                  ) : (
                    maintenances.map((m) => (
                      <div key={m.id} className="rounded-lg border p-3 text-sm">
                        <div className="font-medium">
                          {MAINTENANCE_STATUS_LABEL[m.status]} · {m.maintenanceType} · {m.priority}
                          {m.blocksVehicle && (
                            <span className="ml-2 text-amber-700 text-xs">bloqueia veículo</span>
                          )}
                        </div>
                        <p className="mt-1">{m.description}</p>
                        <p className="text-slate-600 text-xs mt-1">
                          Aberta: {formatDt(m.openedAt)}
                          {m.scheduledAt ? ` · Agendada: ${formatDt(m.scheduledAt)}` : ""}
                          {m.completedAt ? ` · Concluída: ${formatDt(m.completedAt)}` : ""}
                        </p>
                        {m.estimatedValue != null && (
                          <p className="text-xs text-slate-500">
                            Estimado: {m.estimatedValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            {m.finalValue != null
                              ? ` · Final: ${m.finalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
                              : ""}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === "attachments" && (
                <div className="space-y-3">
                  {canManage && (
                    <div className="rounded border bg-slate-50 p-3 grid gap-2 sm:grid-cols-2">
                      <input
                        className="rounded border px-2 py-1.5 text-sm"
                        placeholder="Nome do arquivo"
                        value={attachmentForm.fileName}
                        onChange={(e) =>
                          setAttachmentForm({ ...attachmentForm, fileName: e.target.value })
                        }
                      />
                      <input
                        className="rounded border px-2 py-1.5 text-sm"
                        placeholder="URL do arquivo (sem base64)"
                        value={attachmentForm.fileUrl}
                        onChange={(e) =>
                          setAttachmentForm({ ...attachmentForm, fileUrl: e.target.value })
                        }
                      />
                      <button
                        type="button"
                        className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white sm:col-span-2"
                        disabled={saving}
                        onClick={() =>
                          void runAction("/api/fleet/attachments", {
                            vehicleId,
                            fileName: attachmentForm.fileName,
                            fileUrl: attachmentForm.fileUrl,
                            attachmentType: attachmentForm.attachmentType,
                            notes: attachmentForm.notes || null,
                          })
                        }
                      >
                        Adicionar anexo (metadados)
                      </button>
                      <p className="text-xs text-slate-500 sm:col-span-2">
                        Upload físico pendente — informe apenas URL pública do arquivo.
                      </p>
                    </div>
                  )}
                  <ul className="space-y-2 text-sm">
                    {attachments.map((a) => (
                      <li key={a.id} className="flex items-center justify-between rounded border px-3 py-2">
                        <div>
                          <a
                            href={a.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-blue-700 underline"
                          >
                            {a.fileName}
                          </a>
                          <p className="text-xs text-slate-500">
                            {a.attachmentType} · {formatDt(a.uploadedAt)}
                          </p>
                        </div>
                        {canManage && (
                          <button
                            type="button"
                            className="text-xs text-red-600"
                            disabled={saving}
                            onClick={async () => {
                              if (!confirm("Remover anexo?")) return;
                              setSaving(true);
                              try {
                                await fetchJsonOk(`/api/fleet/attachments/${a.id}/remove`, {
                                  method: "PATCH",
                                });
                                await load();
                              } catch (e: unknown) {
                                setError(formatFleetApiError(e, "Erro ao remover."));
                              } finally {
                                setSaving(false);
                              }
                            }}
                          >
                            Remover
                          </button>
                        )}
                      </li>
                    ))}
                    {attachments.length === 0 && (
                      <p className="text-slate-500">Nenhum anexo neste veículo.</p>
                    )}
                  </ul>
                </div>
              )}

              {tab === "history" && (
                <ul className="space-y-2 text-sm">
                  {auditLogs.map((log) => (
                    <li key={log.id} className="rounded border px-3 py-2">
                      <div className="font-medium flex flex-wrap items-center gap-2">
                        <span>{FLEET_AUDIT_ACTION_LABEL[log.action] ?? log.action}</span>
                        <span className="text-xs text-slate-500">{log.entityType}</span>
                      </div>
                      <div className="text-slate-600">
                        {formatDt(log.createdAt)}
                        {log.reason ? ` · ${log.reason}` : ""}
                      </div>
                      {(log.oldValue || log.newValue) && (
                        <div className="mt-1 text-xs text-slate-500 font-mono break-all">
                          {log.oldValue ?? "—"} → {log.newValue ?? "—"}
                        </div>
                      )}
                    </li>
                  ))}
                  {auditLogs.length === 0 && (
                    <p className="text-slate-500 py-6 text-center">Nenhum evento registrado para este veículo.</p>
                  )}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
