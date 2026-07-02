import React, { useState } from "react";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import { COMMISSIONS_EXCEPTIONS_MANAGE_PERMISSIONS } from "@/src/lib/commissionsPermissions";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import type { CommissionsExceptionItem } from "@/src/components/commissions/commissionsTypes";

type ExceptionsPayload = {
  rows: CommissionsExceptionItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export function CommissionsExceptionsPage() {
  const auth = useAuth();
  const canManage = auth.hasAnyPermission([...COMMISSIONS_EXCEPTIONS_MANAGE_PERMISSIONS]);
  const [data, setData] = useState<ExceptionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    customerName: "",
    customerExternalId: "",
    reason: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
  });

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<ExceptionsPayload>(
        "/api/commissions/exceptions?page=1&pageSize=100"
      );
      setData(payload);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível carregar exceções."));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void reload();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    try {
      await fetchJsonOk("/api/commissions/exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: form.customerName.trim(),
          customerExternalId: form.customerExternalId
            ? Number(form.customerExternalId)
            : null,
          reason: form.reason.trim(),
          startDate: form.startDate,
          endDate: form.endDate || null,
          active: true,
        }),
      });
      setShowForm(false);
      setForm({
        customerName: "",
        customerExternalId: "",
        reason: "",
        startDate: new Date().toISOString().slice(0, 10),
        endDate: "",
      });
      await reload();
    } catch (err: unknown) {
      setError(formatCommissionsApiError(err, "Não foi possível salvar a exceção."));
    }
  }

  async function toggleActive(id: string) {
    if (!canManage) return;
    try {
      await fetchJsonOk(`/api/commissions/exceptions/${id}/toggle-active`, { method: "PATCH" });
      await reload();
    } catch (err: unknown) {
      setError(formatCommissionsApiError(err, "Não foi possível alterar a exceção."));
    }
  }

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-5" data-testid="commissions-exceptions-page">
      <CommissionsSectionIntro
        title="Exceções / Clientes sem Comissão"
        description="Decisões explícitas e auditáveis para clientes, produtos ou vendedores que não geram comissão. Não é erro — é regra de negócio registrada."
      />

      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" className={financeBiButtonOutlineClass} onClick={() => void reload()}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Atualizar
        </button>
        {canManage ? (
          <button
            type="button"
            className={financeBiButtonOutlineClass}
            onClick={() => setShowForm((v) => !v)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nova exceção
          </button>
        ) : null}
      </div>

      {error ? <CommissionsErrorBanner message={error} onRetry={() => void reload()} /> : null}

      {showForm && canManage ? (
        <form onSubmit={handleCreate} className="rounded-xl border p-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Cliente (nome)
            <input
              className="mt-1 w-full rounded-md border px-2 py-1.5"
              value={form.customerName}
              onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
              required
            />
          </label>
          <label className="text-sm">
            ID externo Nomus (opcional)
            <input
              className="mt-1 w-full rounded-md border px-2 py-1.5"
              value={form.customerExternalId}
              onChange={(e) => setForm((f) => ({ ...f, customerExternalId: e.target.value }))}
            />
          </label>
          <label className="text-sm md:col-span-2">
            Motivo (obrigatório)
            <input
              className="mt-1 w-full rounded-md border px-2 py-1.5"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Ex.: Cliente antigo sem comissão"
              required
            />
          </label>
          <label className="text-sm">
            Vigência inicial
            <input
              type="date"
              className="mt-1 w-full rounded-md border px-2 py-1.5"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              required
            />
          </label>
          <label className="text-sm">
            Vigência final (opcional)
            <input
              type="date"
              className="mt-1 w-full rounded-md border px-2 py-1.5"
              value={form.endDate}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
            />
          </label>
          <div className="md:col-span-2">
            <button type="submit" className={financeBiButtonOutlineClass}>
              Salvar exceção
            </button>
          </div>
        </form>
      ) : null}

      {loading && !data ? <CommissionsLoading label="Carregando exceções…" /> : null}

      {!loading && rows.length === 0 ? (
        <CommissionsEmptyState
          title="Nenhuma exceção cadastrada"
          description="Clientes sem comissão aparecerão aqui quando cadastrados."
        />
      ) : null}

      {rows.length > 0 ? (
        <CommissionsTableScroll>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Vendedor</th>
                <th className="px-3 py-2">Produto</th>
                <th className="px-3 py-2">Motivo</th>
                <th className="px-3 py-2">Vigência</th>
                <th className="px-3 py-2">Status</th>
                {canManage ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-3 py-2">{row.customerName ?? row.customerExternalId ?? "—"}</td>
                  <td className="px-3 py-2">{row.commissionPersonName ?? "Todos"}</td>
                  <td className="px-3 py-2">{row.productCode ?? "Todos"}</td>
                  <td className="px-3 py-2">{row.reason}</td>
                  <td className="px-3 py-2">
                    {new Date(row.startDate).toLocaleDateString("pt-BR")}
                    {row.endDate
                      ? ` → ${new Date(row.endDate).toLocaleDateString("pt-BR")}`
                      : ""}
                  </td>
                  <td className="px-3 py-2">{row.active ? "Ativa" : "Inativa"}</td>
                  {canManage ? (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-xs font-semibold text-primary hover:underline"
                        onClick={() => void toggleActive(row.id)}
                      >
                        {row.active ? "Inativar" : "Ativar"}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </CommissionsTableScroll>
      ) : null}
    </div>
  );
}
