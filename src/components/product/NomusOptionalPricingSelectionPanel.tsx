import React, { useCallback, useState } from "react";
import {
  Loader2,
  RefreshCw,
  Settings2,
  ChevronDown,
  ChevronRight,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { useNomusParentCodeResolver } from "@/src/hooks/useNomusParentCodeResolver";
import { useNomusMaintenanceWorkspaceSync } from "@/src/hooks/useNomusMaintenanceWorkspaceSync";
import type { NomusMaintenanceWorkspaceProps } from "@/src/lib/nomusMaintenanceWorkspaceTypes";
import type { PricingOptionalStatus } from "@/src/lib/nomusOptionalPricingSelection";

type ListResponse = {
  generatedAt: string;
  total: number;
  rows: Array<{
    parentCode: string;
    parentDescription?: string | null;
    indusProductId?: string | null;
    optionalItemsCount: number;
    unassignedOptionalItemsCount: number;
    groupsCount: number;
    pendingGroupsCount: number;
    staleGroupsCount: number;
    pricingOptionalStatus: PricingOptionalStatus;
  }>;
};

type DetailResponse = {
  parentCode: string;
  parentDescription?: string | null;
  indusProductId?: string | null;
  selectedList?: { listaMateriaisNome?: string | null } | null;
  requiredNomusItems: Array<{
    componentCode: string;
    componentDescription?: string | null;
    plannedQuantity: number | null;
  }>;
  unassignedOptionalItems: Array<{
    componentCode: string;
    componentDescription?: string | null;
    plannedQuantity: number | null;
    nomusSourceLineIds: number[];
  }>;
  groups: Array<{
    id: string;
    groupName: string;
    selectionMode: "EXACTLY_ONE" | "OPTIONAL_ONE" | "MULTIPLE";
    notes?: string | null;
    selectedNone: boolean;
    status: string;
    choices: Array<{
      id: string;
      componentCode: string;
      componentDescription?: string | null;
      plannedQuantity: number | null;
      isSelectedForPricing: boolean;
      isStale: boolean;
    }>;
  }>;
  status: PricingOptionalStatus;
  warnings: string[];
};

const STATUS_LABEL: Record<PricingOptionalStatus, string> = {
  PENDING: "Pendente",
  RESOLVED: "Resolvido",
  NO_OPTIONALS: "Sem opcionais",
  STALE: "Desatualizado",
};

const STATUS_CLASS: Record<PricingOptionalStatus, string> = {
  PENDING: "bg-amber-100 text-amber-900",
  RESOLVED: "bg-green-100 text-green-800",
  NO_OPTIONALS: "bg-muted text-muted-foreground",
  STALE: "bg-orange-100 text-orange-900",
};

const MODE_LABEL = {
  EXACTLY_ONE: "Exatamente um",
  OPTIONAL_ONE: "Opcional: zero ou um",
  MULTIPLE: "Múltiplos",
} as const;

const MODE_HELP: Record<keyof typeof MODE_LABEL, string> = {
  EXACTLY_ONE:
    "Use quando uma opção obrigatoriamente substitui a outra. Ex.: Anel fino OU Anel grosso.",
  OPTIONAL_ONE: "Use quando o item pode entrar ou não no preço. Ex.: Porca/acessório opcional.",
  MULTIPLE: "Use quando mais de um item opcional pode entrar ao mesmo tempo.",
};

const GROUP_STATUS_HINT: Record<string, string> = {
  PENDING:
    "Este grupo ainda não tem uma seleção salva. Escolha uma opção e clique em 'Salvar seleção'.",
  RESOLVED: "Este grupo já possui seleção válida para precificação.",
  STALE:
    "Este grupo está desatualizado em relação à BOM atual do Nomus. Revise as opções.",
};

const HOW_TO_ACT_STEPS = [
  "Agrupe apenas itens que representam escolhas entre si, como Anel Fino OU Anel Grosso.",
  "Se apenas um item opcional pode ou não entrar no preço, crie um grupo separado com modo 'Opcional: zero ou um'.",
  "Depois de criar o grupo, selecione qual item entra na precificação e clique em 'Salvar seleção'.",
  "Itens opcionais sem grupo ou grupos sem seleção deixam o produto como pendente.",
] as const;

function formatUnassignedHint(count: number): string {
  if (count === 1) {
    return "Existe 1 item opcional ainda sem grupo. Crie um grupo para ele ou revise se ele deve entrar na precificação.";
  }
  return `Existem ${count} itens opcionais ainda sem grupo. Crie um grupo para eles ou revise se devem entrar na precificação.`;
}

function getCreateGroupBlockReason(
  mode: "EXACTLY_ONE" | "OPTIONAL_ONE" | "MULTIPLE",
  selectedCount: number,
  groupName: string
): string | null {
  if (!groupName.trim()) return "Informe o nome do grupo.";
  if (selectedCount === 0) {
    return "Selecione ao menos um item para formar o grupo (marque as caixas abaixo).";
  }
  if (mode === "EXACTLY_ONE" && selectedCount < 2) {
    return "Para 'Exatamente um', selecione pelo menos duas opções alternativas. Para um único item opcional, use 'Opcional: zero ou um'.";
  }
  return null;
}

function filterDetailWarnings(warnings: string[]): string[] {
  return warnings.filter((w) => !/não pertence\(m\) a nenhum grupo ativo/i.test(w));
}

function formatQty(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

type NomusOptionalPricingSelectionPanelProps = NomusMaintenanceWorkspaceProps & {
  onOpenProduct?: (productId: string) => void;
  disabled?: boolean;
};

export const NomusOptionalPricingSelectionPanel: React.FC<NomusOptionalPricingSelectionPanelProps> = ({
  disabled = false,
  selectedParentCode,
  selectedParentDescription,
  selectedIndusProductId,
  onWorkspaceParentChange,
}) => {
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | PricingOptionalStatus>("");
  const [list, setList] = useState<ListResponse | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [requiredOpen, setRequiredOpen] = useState(false);

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMode, setNewGroupMode] = useState<"EXACTLY_ONE" | "OPTIONAL_ONE" | "MULTIPLE">(
    "EXACTLY_ONE"
  );
  const [selectedForNewGroup, setSelectedForNewGroup] = useState<Set<string>>(new Set());
  const [savingGroupId, setSavingGroupId] = useState<string | null>(null);

  const [groupSelectionDraft, setGroupSelectionDraft] = useState<
    Record<string, { choiceIds: Set<string>; selectedNone: boolean }>
  >({});
  const { resolveThen, pickerModal, notFoundMessage } = useNomusParentCodeResolver();
  const { reportWorkspaceSelection } = useNomusMaintenanceWorkspaceSync({
    selectedParentCode,
    selectedParentDescription,
    selectedIndusProductId,
    onWorkspaceParentChange,
    setLocalCode: setSearch,
  });

  const fetchList = useCallback(
    async (resolvedSearch: string) => {
      const params = new URLSearchParams({ limit: "200", offset: "0" });
      if (resolvedSearch.trim()) params.set("search", resolvedSearch.trim());
      if (statusFilter) params.set("status", statusFilter);
      const result = await fetchJsonOk<ListResponse>(
        `/api/nomus/bom-optionals/pricing-selection?${params.toString()}`
      );
      setList(result);
    },
    [statusFilter]
  );

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const term = search.trim();
      if (!term) {
        await fetchList("");
        return;
      }

      const outcome = await resolveThen(term, async (code, option) => {
        setLoading(true);
        setSearch(code);
        reportWorkspaceSelection(code, option);
        try {
          await fetchList(code);
        } finally {
          setLoading(false);
        }
      });
      if (!outcome.ok && outcome.reason === "none") {
        setList(null);
        setError(notFoundMessage);
      }
    } catch (e) {
      setList(null);
      setError(e instanceof Error ? e.message : "Erro ao carregar lista.");
    } finally {
      setLoading(false);
    }
  }, [fetchList, notFoundMessage, resolveThen, search]);

  const loadDetail = useCallback(async (parentCode: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ parentCode });
      const result = await fetchJsonOk<DetailResponse>(
        `/api/nomus/bom-optionals/pricing-selection/detail?${params.toString()}`
      );
      setDetail(result);
      const draft: Record<string, { choiceIds: Set<string>; selectedNone: boolean }> = {};
      for (const g of result.groups) {
        draft[g.id] = {
          choiceIds: new Set(g.choices.filter((c) => c.isSelectedForPricing).map((c) => c.id)),
          selectedNone: g.selectedNone,
        };
      }
      setGroupSelectionDraft(draft);
      setSelectedForNewGroup(new Set());
      setNewGroupName("");
    } catch (e) {
      setDetail(null);
      setError(e instanceof Error ? e.message : "Erro ao carregar detalhe.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openConfigure = (parentCode: string) => {
    setSearch(parentCode);
    reportWorkspaceSelection(parentCode);
    void loadDetail(parentCode);
  };

  const closeDetail = () => {
    setDetail(null);
    setGroupSelectionDraft({});
  };

  const toggleNewGroupCode = (code: string) => {
    setSelectedForNewGroup((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const createGroupBlockReason = getCreateGroupBlockReason(
    newGroupMode,
    selectedForNewGroup.size,
    newGroupName
  );

  const createGroup = async () => {
    if (!detail) return;
    const blockReason = getCreateGroupBlockReason(
      newGroupMode,
      selectedForNewGroup.size,
      newGroupName
    );
    if (blockReason) {
      setError(blockReason);
      return;
    }
    setError(null);
    try {
      await fetchJsonOk(`/api/nomus/bom-optionals/pricing-selection/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentCode: detail.parentCode,
          groupName: newGroupName.trim(),
          selectionMode: newGroupMode,
          componentCodes: [...selectedForNewGroup],
        }),
      });
      await loadDetail(detail.parentCode);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao criar grupo.");
    }
  };

  const saveGroupSelection = async (groupId: string, mode: DetailResponse["groups"][0]["selectionMode"]) => {
    if (!detail) return;
    const draft = groupSelectionDraft[groupId];
    if (!draft) return;
    setSavingGroupId(groupId);
    setError(null);
    try {
      let body: Record<string, unknown> = {};
      if (mode === "EXACTLY_ONE") {
        const id = [...draft.choiceIds][0];
        if (!id) {
          setError("Selecione exatamente uma opção.");
          setSavingGroupId(null);
          return;
        }
        body = { selectedChoiceId: id };
      } else if (mode === "OPTIONAL_ONE") {
        if (draft.selectedNone) body = { selectedNone: true };
        else {
          const id = [...draft.choiceIds][0];
          if (!id) {
            setError("Selecione uma opção ou marque 'não considerar nenhum'.");
            setSavingGroupId(null);
            return;
          }
          body = { selectedChoiceId: id };
        }
      } else {
        if (draft.selectedNone) body = { selectedNone: true };
        else if (draft.choiceIds.size === 0) {
          setError("Selecione ao menos uma opção ou marque 'não considerar nenhum'.");
          setSavingGroupId(null);
          return;
        } else body = { selectedChoiceIds: [...draft.choiceIds] };
      }

      await fetchJsonOk(`/api/nomus/bom-optionals/pricing-selection/groups/${groupId}/selection`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await loadDetail(detail.parentCode);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar seleção.");
    } finally {
      setSavingGroupId(null);
    }
  };

  const deactivateGroup = async (groupId: string) => {
    if (!detail) return;
    if (!window.confirm("Desativar este grupo? A seleção deixará de valer para precificação.")) return;
    try {
      await fetchJsonOk(`/api/nomus/bom-optionals/pricing-selection/groups/${groupId}`, {
        method: "DELETE",
      });
      await loadDetail(detail.parentCode);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao desativar grupo.");
    }
  };

  const summary = list
    ? {
        products: list.total,
        pending: list.rows.filter((r) => r.pricingOptionalStatus === "PENDING").length,
        resolved: list.rows.filter((r) => r.pricingOptionalStatus === "RESOLVED").length,
        unassigned: list.rows.reduce((s, r) => s + r.unassignedOptionalItemsCount, 0),
        stale: list.rows.filter((r) => r.pricingOptionalStatus === "STALE").length,
      }
    : null;

  return (
    <div className="rounded-xl border border-dashed border-primary/30 bg-card/50 p-4 space-y-4">
      <div>
        <h4 className="text-sm font-bold flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" />
          Opcionais de Precificação
        </h4>
        <p className="text-[11px] text-muted-foreground mt-1 max-w-3xl">
          Defina quais itens opcionais do Nomus entram no custo/preço. Itens opcionais não são
          considerados automaticamente. A seleção é salva por grupo e não altera ProductBOM nesta
          fase.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1">
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">
            Busca SKU / descrição
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ex.: 610.73BA"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase text-muted-foreground">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | PricingOptionalStatus)}
            className="mt-1 h-9 rounded-lg border border-border bg-background px-3 text-xs min-w-[140px]"
          >
            <option value="">Todos</option>
            <option value="PENDING">Pendentes</option>
            <option value="RESOLVED">Resolvidos</option>
            <option value="STALE">Desatualizados</option>
          </select>
        </div>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => void loadList()}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Carregar
        </button>
      </div>

      {error ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      ) : null}

      {summary && list ? (
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 text-xs">
          {[
            { label: "Com opcionais", value: summary.products },
            { label: "Pendentes", value: summary.pending },
            { label: "Resolvidos", value: summary.resolved },
            { label: "Sem grupo", value: summary.unassigned },
            { label: "Desatualizados", value: summary.stale },
          ].map((c) => (
            <div key={c.label} className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">{c.label}</p>
              <p className="font-bold mt-1 tabular-nums">{c.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {list && !detail ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">SKU</th>
                <th className="text-left px-3 py-2">Descrição</th>
                <th className="text-right px-3 py-2">Opcionais</th>
                <th className="text-right px-3 py-2">Grupos</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Ação</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhum produto encontrado para a busca informada. Tente o SKU completo.
                  </td>
                </tr>
              ) : (
                list.rows.map((row) => (
                  <tr key={row.parentCode} className="border-t border-border/60">
                    <td className="px-3 py-2 font-medium">{row.parentCode}</td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate">
                      {row.parentDescription ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.optionalItemsCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.groupsCount}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                          STATUS_CLASS[row.pricingOptionalStatus]
                        )}
                      >
                        {STATUS_LABEL[row.pricingOptionalStatus]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => openConfigure(row.parentCode)}
                        className="text-[10px] font-semibold text-primary hover:underline"
                      >
                        Configurar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {detail ? (
        <div className="rounded-xl border border-border bg-background p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h5 className="text-sm font-bold">{detail.parentCode}</h5>
              {detail.parentDescription ? (
                <p className="text-xs text-muted-foreground mt-0.5">{detail.parentDescription}</p>
              ) : null}
              {detail.selectedList?.listaMateriaisNome ? (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Lista Nomus: {detail.selectedList.listaMateriaisNome}
                </p>
              ) : null}
              <span
                className={cn(
                  "inline-flex mt-2 rounded-full px-2 py-0.5 text-[10px] font-bold",
                  STATUS_CLASS[detail.status]
                )}
              >
                {STATUS_LABEL[detail.status]}
              </span>
            </div>
            <button type="button" onClick={closeDetail} className="p-2 rounded-lg hover:bg-accent">
              <X className="h-4 w-4" />
            </button>
          </div>

          {detailLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {filterDetailWarnings(detail.warnings).length > 0 ? (
                <ul className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 list-disc list-inside">
                  {filterDetailWarnings(detail.warnings).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : null}

              <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2.5 text-[11px] text-blue-950 space-y-1.5">
                <p className="font-bold text-xs">Como atuar</p>
                <ol className="list-decimal list-inside space-y-1">
                  {HOW_TO_ACT_STEPS.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>

              <button
                type="button"
                onClick={() => setRequiredOpen((v) => !v)}
                className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                {requiredOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Itens obrigatórios Nomus ({detail.requiredNomusItems.length})
              </button>
              {requiredOpen ? (
                <div className="text-[11px] text-muted-foreground border border-border rounded-lg p-2 max-h-32 overflow-y-auto">
                  {detail.requiredNomusItems.map((i) => (
                    <div key={i.componentCode} className="py-0.5">
                      {i.componentCode} — {i.componentDescription ?? "—"} — qtd {formatQty(i.plannedQuantity)}
                    </div>
                  ))}
                </div>
              ) : null}

              {detail.unassignedOptionalItems.length > 0 ? (
                <div className="space-y-2 rounded-lg border border-fuchsia-200 bg-fuchsia-50/40 p-3">
                  <div>
                    <p className="text-xs font-bold text-fuchsia-950">
                      Opcionais disponíveis para agrupar
                    </p>
                    <p className="text-[11px] text-fuchsia-900/90 mt-1">
                      Passo 1 — Marque os itens que são alternativas entre si (ou um único item, se
                      for o caso) e crie o grupo. Isso ainda não define o que entra no preço.
                    </p>
                    <p className="text-[11px] text-fuchsia-800 mt-1.5">
                      {formatUnassignedHint(detail.unassignedOptionalItems.length)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    {detail.unassignedOptionalItems.map((item) => (
                      <label
                        key={item.componentCode}
                        className="flex items-start gap-2 text-xs cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedForNewGroup.has(item.componentCode)}
                          onChange={() => toggleNewGroupCode(item.componentCode)}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="font-semibold">{item.componentCode}</span>
                          {item.componentDescription ? ` — ${item.componentDescription}` : ""}
                          <span className="text-muted-foreground"> — qtd {formatQty(item.plannedQuantity)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 items-end pt-2">
                    <div className="flex-1 min-w-[140px]">
                      <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                        Nome do grupo
                      </label>
                      <input
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="Ex.: Anel da torneira"
                        className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs"
                      />
                    </div>
                    <div className="min-w-[200px] flex-1">
                      <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                        Modo
                      </label>
                      <select
                        value={newGroupMode}
                        onChange={(e) =>
                          setNewGroupMode(e.target.value as typeof newGroupMode)
                        }
                        className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs"
                      >
                        <option value="EXACTLY_ONE">Exatamente um</option>
                        <option value="OPTIONAL_ONE">Opcional: zero ou um</option>
                        <option value="MULTIPLE">Múltiplos</option>
                      </select>
                      <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
                        {MODE_HELP[newGroupMode]}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={createGroupBlockReason != null}
                      onClick={() => void createGroup()}
                      className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed self-end"
                    >
                      Criar grupo com selecionados
                    </button>
                  </div>
                  {createGroupBlockReason ? (
                    <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                      {createGroupBlockReason}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {detail.groups.length > 0 ? (
                <p className="text-xs font-bold text-foreground pt-1 border-t border-border/60">
                  Grupos criados — Passo 2: seleção para precificação
                </p>
              ) : null}

              {detail.groups.map((group) => {
                const draft = groupSelectionDraft[group.id] ?? {
                  choiceIds: new Set<string>(),
                  selectedNone: false,
                };
                const isRadio = group.selectionMode !== "MULTIPLE";
                return (
                  <div
                    key={group.id}
                    className="rounded-lg border border-border p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold">{group.groupName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {MODE_LABEL[group.selectionMode]} · Status: {group.status}
                        </p>
                        {GROUP_STATUS_HINT[group.status] ? (
                          <p className="text-[11px] text-muted-foreground mt-1 max-w-xl">
                            {GROUP_STATUS_HINT[group.status]}
                          </p>
                        ) : null}
                        {group.selectionMode === "EXACTLY_ONE" ? (
                          <p className="text-[11px] text-foreground/80 mt-1">
                            Escolha apenas uma opção abaixo para precificação.
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void deactivateGroup(group.id)}
                        className="inline-flex items-center gap-1 text-[10px] text-red-700 hover:underline"
                      >
                        <Trash2 className="h-3 w-3" />
                        Desativar
                      </button>
                    </div>
                    <div className="space-y-1">
                      {group.choices.map((choice) => (
                        <label
                          key={choice.id}
                          className={cn(
                            "flex items-start gap-2 text-xs cursor-pointer rounded px-1 py-0.5",
                            choice.isStale && "bg-orange-50"
                          )}
                        >
                          <input
                            type={isRadio ? "radio" : "checkbox"}
                            name={isRadio ? `group-${group.id}` : undefined}
                            checked={draft.choiceIds.has(choice.id)}
                            onChange={() => {
                              setGroupSelectionDraft((prev) => {
                                const current = prev[group.id] ?? {
                                  choiceIds: new Set<string>(),
                                  selectedNone: false,
                                };
                                const nextIds = new Set(current.choiceIds);
                                if (isRadio) {
                                  nextIds.clear();
                                  nextIds.add(choice.id);
                                } else if (nextIds.has(choice.id)) nextIds.delete(choice.id);
                                else nextIds.add(choice.id);
                                return {
                                  ...prev,
                                  [group.id]: { choiceIds: nextIds, selectedNone: false },
                                };
                              });
                            }}
                            className="mt-0.5"
                          />
                          <span>
                            {choice.componentCode}
                            {choice.componentDescription ? ` — ${choice.componentDescription}` : ""}
                            <span className="text-muted-foreground">
                              {" "}
                              — qtd {formatQty(choice.plannedQuantity)}
                            </span>
                            {choice.isStale ? (
                              <span className="text-orange-700 font-semibold"> (desatualizado)</span>
                            ) : null}
                          </span>
                        </label>
                      ))}
                      {group.selectionMode !== "EXACTLY_ONE" ? (
                        <label className="flex items-center gap-2 text-xs cursor-pointer font-medium">
                          <input
                            type="checkbox"
                            checked={draft.selectedNone}
                            onChange={(e) => {
                              setGroupSelectionDraft((prev) => ({
                                ...prev,
                                [group.id]: {
                                  choiceIds: new Set(),
                                  selectedNone: e.target.checked,
                                },
                              }));
                            }}
                          />
                          Não considerar nenhum
                        </label>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={savingGroupId === group.id}
                      onClick={() => void saveGroupSelection(group.id, group.selectionMode)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
                    >
                      {savingGroupId === group.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      Salvar seleção
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      ) : null}

      {pickerModal}
    </div>
  );
};

