/**
 * Estoque → Setores / Collector.
 *
 * Cadastro dos setores de estoque que o Collector atende pelo celular: cada
 * setor aponta para um almoxarifado e um tipo de item, define se permite
 * contagem e/ou retirada e tem um QR fixo (/collector/sector/<slug>).
 *
 * Matéria-prima, Componentes e Produto acabado aparecem na lista só para
 * consulta e QR: são setores fixos, com fluxo próprio, e não são criados,
 * editados nem inativados aqui.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Power, QrCode, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { InventoryStockSectorFormSheet } from "@/src/components/inventory/InventoryStockSectorFormSheet";
import { InventoryStockSectorQrDialog } from "@/src/components/inventory/InventoryStockSectorQrDialog";
import { appendQueryIfPresent } from "@/src/components/inventory/inventoryFilterUtils";
import { useInventoryPermissions } from "@/src/components/inventory/inventoryPermissions";
import {
  EMPTY_STOCK_SECTOR_FORM_OPTIONS,
  formatStockSectorItemType,
  formatStockSectorStrategy,
  LEGACY_STOCK_SECTOR_ROWS,
  normalizeStockSectorFormOptions,
  normalizeStockSectorListResponse,
  type LegacyStockSectorRow,
  type StockSectorFormOptions,
  type StockSectorRow,
} from "@/src/components/inventory/inventoryStockSectorForm";
import {
  formatInventoryApiError,
  InventoryEmptyState,
  InventoryErrorBanner,
  InventoryLoading,
  InventorySectionIntro,
  InventoryTableScroll,
  inventoryFilterInputClass,
  inventoryTableClassName,
} from "@/src/components/inventory/inventoryUi";

type SheetState = { mode: "closed" } | { mode: "create" } | { mode: "edit"; sector: StockSectorRow };
type QrTarget = { sectorKey: string; sectorName: string } | null;

function YesNoBadge({ value }: { value: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        value
          ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
          : "bg-slate-100 text-slate-600 ring-slate-200"
      )}
    >
      {value ? "Sim" : "Não"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const active = status === "ACTIVE";
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        active
          ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
          : "bg-slate-100 text-slate-700 ring-slate-200"
      )}
    >
      {active ? "Ativo" : "Inativo"}
    </span>
  );
}

/**
 * Tabela de setores (exportada para teste estático). Linhas fixas do Collector
 * vêm primeiro e não têm ações de edição.
 */
export function InventoryStockSectorsTable({
  rows,
  legacyRows,
  canManage,
  busyId,
  onQr,
  onEdit,
  onToggleStatus,
}: {
  rows: StockSectorRow[];
  legacyRows: readonly LegacyStockSectorRow[];
  canManage: boolean;
  busyId: string | null;
  onQr: (target: { sectorKey: string; sectorName: string }) => void;
  onEdit: (sector: StockSectorRow) => void;
  onToggleStatus: (sector: StockSectorRow) => void;
}) {
  return (
    <InventoryTableScroll>
      <table className={inventoryTableClassName()} data-testid="stock-sectors-table">
        <thead>
          <tr>
            <th scope="col">Nome</th>
            <th scope="col">Código</th>
            <th scope="col">Almoxarifado</th>
            <th scope="col">Tipo de item</th>
            <th scope="col">Strategy</th>
            <th scope="col">Contagem</th>
            <th scope="col">Retirada</th>
            <th scope="col">Status</th>
            <th scope="col">QR</th>
            <th scope="col">Ações</th>
          </tr>
        </thead>
        <tbody>
          {legacyRows.map((row) => (
            <tr key={`legacy-${row.code}`} data-testid={`stock-sector-legacy-${row.code}`}>
              <td className="font-medium text-slate-900">{row.name}</td>
              <td>{row.code}</td>
              <td className="text-slate-500">Por presença do item</td>
              <td>{formatStockSectorItemType(row.itemType)}</td>
              <td>
                <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
                  Fixo do sistema
                </span>
              </td>
              <td>
                <YesNoBadge value={row.allowsCounting} />
              </td>
              <td>
                <YesNoBadge value={row.allowsWithdrawal} />
              </td>
              <td>
                <StatusBadge status="ACTIVE" />
              </td>
              <td>
                <button
                  type="button"
                  title={`QR do setor ${row.name}`}
                  aria-label={`QR do setor ${row.name}`}
                  className="rounded p-1 hover:bg-slate-200"
                  onClick={() => onQr({ sectorKey: row.code, sectorName: row.name })}
                >
                  <QrCode className="h-4 w-4" />
                </button>
              </td>
              <td className="text-xs text-slate-500">Protegido</td>
            </tr>
          ))}
          {rows.map((row) => (
            <tr key={row.id} data-testid={`stock-sector-row-${row.code}`}>
              <td className="font-medium text-slate-900">{row.name}</td>
              <td>{row.code}</td>
              <td title={row.warehouse.name}>
                {row.warehouse.code}
                {row.warehouse.status !== "ACTIVE" ? (
                  <span className="ml-1 text-xs text-amber-700">(inativo)</span>
                ) : null}
              </td>
              <td>{formatStockSectorItemType(row.itemType)}</td>
              <td>{formatStockSectorStrategy(row.strategy)}</td>
              <td>
                <YesNoBadge value={row.allowsCounting} />
              </td>
              <td>
                <YesNoBadge value={row.allowsWithdrawal} />
              </td>
              <td>
                <StatusBadge status={row.status} />
              </td>
              <td>
                <button
                  type="button"
                  title={
                    row.status === "ACTIVE"
                      ? `QR do setor ${row.name}`
                      : "Ative o setor para emitir o QR"
                  }
                  aria-label={`QR do setor ${row.name}`}
                  disabled={row.status !== "ACTIVE"}
                  className="rounded p-1 hover:bg-slate-200 disabled:opacity-40"
                  onClick={() => onQr({ sectorKey: row.slug, sectorName: row.name })}
                  data-testid={`stock-sector-qr-${row.code}`}
                >
                  <QrCode className="h-4 w-4" />
                </button>
              </td>
              <td>
                {canManage ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Editar setor"
                      aria-label={`Editar setor ${row.name}`}
                      className="rounded p-1 hover:bg-slate-200"
                      onClick={() => onEdit(row)}
                      data-testid={`stock-sector-edit-${row.code}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title={row.status === "ACTIVE" ? "Inativar setor" : "Ativar setor"}
                      aria-label={`${row.status === "ACTIVE" ? "Inativar" : "Ativar"} setor ${row.name}`}
                      className="rounded p-1 hover:bg-slate-200 disabled:opacity-40"
                      disabled={busyId === row.id}
                      onClick={() => onToggleStatus(row)}
                      data-testid={`stock-sector-toggle-${row.code}`}
                    >
                      <Power className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-slate-500">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </InventoryTableScroll>
  );
}

export function InventoryStockSectorsTab() {
  const { canManageWarehouses } = useInventoryPermissions();
  const [rows, setRows] = useState<StockSectorRow[]>([]);
  const [options, setOptions] = useState<StockSectorFormOptions>(EMPTY_STOCK_SECTOR_FORM_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sheet, setSheet] = useState<SheetState>({ mode: "closed" });
  const [qr, setQr] = useState<QrTarget>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ page: "1", pageSize: "200" });
      appendQueryIfPresent(q, "search", search);
      if (status) q.set("status", status);
      const raw = await fetchJsonOk<unknown>(`/api/inventory/stock-sectors?${q.toString()}`);
      setRows(normalizeStockSectorListResponse(raw).rows);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Não foi possível carregar os setores. Tente novamente."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // Opções do formulário só para quem pode cadastrar (mesma guarda do servidor).
  useEffect(() => {
    if (!canManageWarehouses) return;
    let cancelled = false;
    fetchJsonOk<unknown>("/api/inventory/stock-sectors/form-options")
      .then((raw) => {
        if (!cancelled) setOptions(normalizeStockSectorFormOptions(raw));
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(formatInventoryApiError(e, "Não foi possível carregar as opções de cadastro."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canManageWarehouses]);

  const toggleStatus = async (sector: StockSectorRow) => {
    const next = sector.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    if (
      next === "INACTIVE" &&
      !window.confirm(
        `Inativar o setor ${sector.name}? O QR deixa de funcionar no celular; o histórico é preservado.`
      )
    ) {
      return;
    }
    setBusyId(sector.id);
    setError(null);
    try {
      await fetchJsonOk(`/api/inventory/stock-sectors/${sector.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      setNotice(`Setor ${sector.name} ${next === "ACTIVE" ? "ativado" : "inativado"}.`);
      await load();
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao alterar o status do setor."));
    } finally {
      setBusyId(null);
    }
  };

  const filtering = Boolean(search.trim() || status);
  // Setores fixos acompanham a lista só sem filtro (o filtro é dos configuráveis).
  const legacyRows = filtering ? [] : LEGACY_STOCK_SECTOR_ROWS;

  return (
    <div className="space-y-4" data-testid="inventory-stock-sectors-tab">
      <InventorySectionIntro
        title="Setores / Collector"
        description="Cada setor liga um almoxarifado a um tipo de item e ganha um QR fixo. No depósito, o operador lê o QR com o celular e escolhe contagem ou retirada. Criar um setor não cria itens nem saldo."
      />

      {error ? <InventoryErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
      {notice ? (
        <div
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          data-testid="stock-sectors-notice"
        >
          {notice}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
            <input
              className={cn(inventoryFilterInputClass, "w-64 pl-8")}
              placeholder="Nome, código ou slug…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="stock-sectors-search"
            />
          </div>
          <select
            className={inventoryFilterInputClass}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            data-testid="stock-sectors-filter-status"
          >
            <option value="">Todos os status</option>
            <option value="ACTIVE">Ativo</option>
            <option value="INACTIVE">Inativo</option>
          </select>
        </div>
        {canManageWarehouses ? (
          <button
            type="button"
            onClick={() => setSheet({ mode: "create" })}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
            data-testid="stock-sectors-new"
          >
            <Plus className="h-4 w-4" />
            Novo setor
          </button>
        ) : (
          <p className="text-xs text-slate-500" data-testid="stock-sectors-no-permission">
            Sem permissão para cadastrar setores.
          </p>
        )}
      </div>

      {loading ? (
        <InventoryLoading label="Carregando setores…" />
      ) : rows.length === 0 && legacyRows.length === 0 ? (
        <InventoryEmptyState
          title="Nenhum setor encontrado"
          description="Ajuste a busca ou o filtro de status."
        />
      ) : (
        <InventoryStockSectorsTable
          rows={rows}
          legacyRows={legacyRows}
          canManage={canManageWarehouses}
          busyId={busyId}
          onQr={setQr}
          onEdit={(sector) => setSheet({ mode: "edit", sector })}
          onToggleStatus={(sector) => void toggleStatus(sector)}
        />
      )}

      {sheet.mode !== "closed" ? (
        <InventoryStockSectorFormSheet
          sector={sheet.mode === "edit" ? sheet.sector : null}
          options={options}
          onClose={() => setSheet({ mode: "closed" })}
          onSaved={(saved) => {
            setNotice(
              sheet.mode === "create"
                ? `Setor ${saved.name} criado. Emita o QR para fixar na área.`
                : `Setor ${saved.name} atualizado.`
            );
            void load();
          }}
        />
      ) : null}

      {qr ? (
        <InventoryStockSectorQrDialog
          sectorKey={qr.sectorKey}
          sectorName={qr.sectorName}
          onClose={() => setQr(null)}
        />
      ) : null}
    </div>
  );
}
