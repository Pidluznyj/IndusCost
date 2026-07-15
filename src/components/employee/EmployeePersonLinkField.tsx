import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, UserRound, X } from "lucide-react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import type { PersonFieldKey } from "@/src/lib/canonicalPerson";
import {
  applyCompatibleFill,
  applyPersonConflictChoice,
  clearPersonSelection,
  createNewPersonSelection,
  hasActivePersonLink,
  PERSON_FIELD_LABELS,
  proposeCompatiblePersonFill,
  selectionFromResolveHit,
  type CompatiblePersonFill,
  type EmployeePersonFormSlice,
  type PersonLinkSelection,
} from "@/src/lib/employeePersonLinkUi";

export type PersonResolveHit = {
  key: string;
  displayName: string;
  socialName: string | null;
  email: string | null;
  emailMasked: string | null;
  phoneMasked: string | null;
  cpfMasked: string | null;
  origin: string;
  sourceKind: string;
  sourceEntityId: string;
  roles: string[];
  status: string;
  personId: string | null;
  linkStatus: string;
  podeVincular: boolean;
  motivoBloqueio: string | null;
  matchReason?: string;
};

type PersonConflict = {
  field: PersonFieldKey | string;
  formValue: string | null;
  personValue: string | null;
};

type Props = {
  formSlice: EmployeePersonFormSlice;
  selection: PersonLinkSelection;
  fieldResolutions?: Partial<Record<string, "form" | "person">>;
  /** Conflitos vindos do 409 no save (além do preview). */
  externalConflicts?: PersonConflict[];
  excludeEmployeeId?: string | null;
  /** Em edição de colaborador legado sem personId. */
  editingLegacyWithoutPerson?: boolean;
  inputClassName: string;
  onSelectionChange: (next: PersonLinkSelection) => void;
  onFormSliceChange: (patch: Partial<EmployeePersonFormSlice>) => void;
  onResolutionsChange: (next: Partial<Record<string, "form" | "person">>) => void;
  onConflictsChange: (conflicts: PersonConflict[]) => void;
};

const PAGE_SIZE = 10;

export function EmployeePersonLinkField({
  formSlice,
  selection,
  fieldResolutions,
  externalConflicts,
  excludeEmployeeId,
  editingLegacyWithoutPerson,
  inputClassName,
  onSelectionChange,
  onFormSliceChange,
  onResolutionsChange,
  onConflictsChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<PersonResolveHit[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedHit, setSelectedHit] = useState<PersonResolveHit | null>(null);
  const [compat, setCompat] = useState<CompatiblePersonFill | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [fillApplied, setFillApplied] = useState(false);

  const linked = hasActivePersonLink(selection);

  const search = useCallback(
    async (q: string, pageNum: number, append: boolean) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setItems([]);
        setTotal(0);
        setTotalPages(1);
        setError(null);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          q: trimmed,
          page: String(pageNum),
          limit: String(PAGE_SIZE),
        });
        if (excludeEmployeeId) qs.set("excludeEmployeeId", excludeEmployeeId);
        const data = await fetchJsonOk<{
          items: PersonResolveHit[];
          meta: { page: number; limit: number; total: number; totalPages: number };
        }>(`/api/people/resolve?${qs.toString()}`);
        setItems((prev) => (append ? [...prev, ...(data.items ?? [])] : data.items ?? []));
        setPage(data.meta?.page ?? pageNum);
        setTotal(data.meta?.total ?? 0);
        setTotalPages(data.meta?.totalPages ?? 1);
      } catch (e) {
        console.error("Erro ao resolver pessoas:", e);
        setError(
          e instanceof HttpError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Não foi possível buscar pessoas."
        );
        if (!append) setItems([]);
      } finally {
        setBusy(false);
      }
    },
    [excludeEmployeeId]
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void search(query, 1, false);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query, search]);

  const runPreview = useCallback(
    async (sel: PersonLinkSelection, hit: PersonResolveHit | null) => {
      if (!hasActivePersonLink(sel)) {
        setCompat(null);
        onConflictsChange([]);
        return;
      }
      setPreviewBusy(true);
      try {
        const preview = await fetchJsonOk<{
          personId: string;
          conflicts: PersonConflict[];
          person: {
            displayName?: string | null;
            socialName?: string | null;
            corporateEmail?: string | null;
            personalEmail?: string | null;
            cpfNormalized?: string | null;
            phoneNormalized?: string | null;
          };
        }>("/api/people/preview-employee-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personId: sel.personId,
            sourceKind: sel.personSourceKind,
            sourceId: sel.personSourceId,
            name: formSlice.name,
            socialName: formSlice.socialName,
            corporateEmail: formSlice.corporateEmail,
            personalEmail: formSlice.personalEmail,
            cpf: formSlice.cpf,
            phone: formSlice.phone,
          }),
        });
        const proposal = proposeCompatiblePersonFill(formSlice, preview.person ?? {});
        setCompat(proposal);
        onConflictsChange(preview.conflicts ?? proposal.conflicts);
        if (hit && !sel.personId && preview.personId) {
          // Origem legado materializou Person — atualiza seleção.
          onSelectionChange({
            personId: preview.personId,
            personSourceKind: null,
            personSourceId: null,
            createNewPerson: false,
          });
          setSelectedHit({ ...hit, personId: preview.personId });
        }
      } catch (e) {
        console.error("preview-employee-link", e);
        setError(
          e instanceof Error ? e.message : "Não foi possível pré-visualizar o vínculo."
        );
        onConflictsChange([]);
      } finally {
        setPreviewBusy(false);
      }
    },
    [formSlice, onConflictsChange, onSelectionChange]
  );

  const handleSelectHit = (hit: PersonResolveHit) => {
    if (!hit.podeVincular) {
      setError(hit.motivoBloqueio || "Vínculo indisponível para este registro.");
      return;
    }
    setError(null);
    setFillApplied(false);
    const sel = selectionFromResolveHit(hit);
    setSelectedHit(hit);
    onSelectionChange(sel);
    onResolutionsChange({});
  };

  const handleCreateNew = () => {
    setSelectedHit(null);
    setCompat(null);
    setFillApplied(false);
    setQuery("");
    setItems([]);
    onConflictsChange([]);
    onResolutionsChange({});
    onSelectionChange(createNewPersonSelection());
  };

  const handleClear = () => {
    setSelectedHit(null);
    setCompat(null);
    setFillApplied(false);
    setQuery("");
    setItems([]);
    onConflictsChange([]);
    onResolutionsChange({});
    onSelectionChange(
      clearPersonSelection({ keepWithoutPerson: Boolean(editingLegacyWithoutPerson) })
    );
  };

  const handleApplyCompatible = () => {
    if (!compat || Object.keys(compat.fillable).length === 0) return;
    const next = applyCompatibleFill(formSlice, compat.fillable);
    onFormSliceChange(next);
    setFillApplied(true);
    // Reavaliar conflitos após preenchimento (só vazios; conflitos permanecem).
    const again = proposeCompatiblePersonFill(next, {
      displayName: selectedHit?.displayName ?? next.name,
      socialName: next.socialName ?? selectedHit?.socialName,
      corporateEmail: next.corporateEmail,
      personalEmail: next.personalEmail,
      cpfNormalized: next.cpf,
      phoneNormalized: next.phone,
    });
    setCompat({ fillable: {}, conflicts: compat.conflicts });
    if (compat.conflicts.length === 0) onConflictsChange(again.conflicts);
  };

  const modeLabel = useMemo(() => {
    if (selection.createNewPerson && !linked) return "Criar nova pessoa canônica ao salvar";
    if (linked) return "Vinculado a pessoa existente";
    return "Sem vínculo de pessoa (legado)";
  }, [linked, selection.createNewPerson]);

  const unresolvedConflicts = useMemo(() => {
    const fromCompat = compat?.conflicts ?? [];
    const fromExternal = externalConflicts ?? [];
    const byField = new Map<string, PersonConflict>();
    for (const c of [...fromCompat, ...fromExternal]) {
      byField.set(c.field, c);
    }
    return [...byField.values()].filter((c) => !fieldResolutions?.[c.field]);
  }, [compat?.conflicts, externalConflicts, fieldResolutions]);

  // Preview ao abrir edição já vinculada
  useEffect(() => {
    if (hasActivePersonLink(selection)) {
      void runPreview(selection, null);
    }
    // somente no mount / troca de id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.personId, selection.personSourceId]);

  return (
    <div className="space-y-3 md:col-span-2 xl:col-span-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <label className="text-xs font-bold text-muted-foreground uppercase">
            Vincular pessoa existente
          </label>
          <p className="text-[11px] text-muted-foreground mt-0.5">{modeLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-background hover:bg-accent"
            onClick={handleCreateNew}
          >
            Criar nova pessoa
          </button>
          {linked && (
            <button
              type="button"
              className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-background hover:bg-accent inline-flex items-center gap-1"
              onClick={handleClear}
            >
              <X className="h-3.5 w-3.5" />
              Remover seleção
            </button>
          )}
        </div>
      </div>

      {!linked && (
        <>
          <input
            type="search"
            className={inputClassName}
            placeholder="Buscar por nome, nome social, e-mail, telefone ou CPF…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-busy={busy}
          />
          <div className="rounded-md border border-border bg-background max-h-56 overflow-y-auto">
            {busy && items.length === 0 && (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Buscando…
              </div>
            )}
            {!busy && query.trim().length >= 2 && items.length === 0 && !error && (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                Nenhuma correspondência. Você pode criar uma nova pessoa.
              </p>
            )}
            {query.trim().length > 0 && query.trim().length < 2 && (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                Digite ao menos 2 caracteres.
              </p>
            )}
            {items.map((hit) => (
              <button
                key={hit.key}
                type="button"
                disabled={!hit.podeVincular}
                onClick={() => handleSelectHit(hit)}
                className="w-full text-left px-3 py-2.5 border-b border-border last:border-0 hover:bg-accent/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-start gap-2">
                  <UserRound className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {hit.displayName}
                      {hit.socialName ? (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · {hit.socialName}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {hit.origin}
                      {hit.emailMasked ? ` · ${hit.emailMasked}` : ""}
                      {hit.roles?.length ? ` · ${hit.roles.join(", ")}` : ""}
                    </p>
                    {!hit.podeVincular && hit.motivoBloqueio && (
                      <p className="text-[11px] text-amber-800 mt-0.5">{hit.motivoBloqueio}</p>
                    )}
                    {hit.linkStatus === "possible_match" && (
                      <p className="text-[11px] text-amber-800 mt-0.5">
                        Possível correspondência — confirme os dados antes de salvar.
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))}
            {page < totalPages && (
              <button
                type="button"
                className="w-full text-xs py-2 text-primary hover:bg-accent/40"
                disabled={busy}
                onClick={() => void search(query, page + 1, true)}
              >
                {busy ? "Carregando…" : `Carregar mais (${page}/${totalPages} · ${total})`}
              </button>
            )}
          </div>
        </>
      )}

      {error && (
        <p className="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2">
          {error}
        </p>
      )}

      {linked && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
          {previewBusy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando dados da pessoa…
            </div>
          )}
          <div className="flex items-start gap-2">
            <UserRound className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold">
                {selectedHit?.displayName ||
                  formSlice.name ||
                  selection.personId ||
                  "Pessoa selecionada"}
              </p>
              {selectedHit?.socialName && (
                <p className="text-xs text-muted-foreground">
                  Nome social: {selectedHit.socialName}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {selectedHit?.origin ||
                  (selection.personId ? "Pessoa canônica" : selection.personSourceKind)}
                {selection.personId ? ` · ID ${selection.personId.slice(0, 8)}…` : ""}
              </p>
              {(selectedHit?.roles?.length ?? 0) > 0 && (
                <p className="text-xs">
                  <span className="font-medium">Papéis:</span> {selectedHit!.roles.join(", ")}
                </p>
              )}
              {selectedHit?.linkStatus === "conflict" && (
                <p className="text-xs text-amber-900 font-medium">
                  Aviso de conflito: {selectedHit.motivoBloqueio || "Vínculo bloqueado."}
                </p>
              )}
            </div>
          </div>

          {compat && Object.keys(compat.fillable).length > 0 && !fillApplied && (
            <div className="rounded-md border border-border bg-background p-2.5 space-y-2">
              <p className="text-xs font-semibold">Dados compatíveis disponíveis (campos vazios):</p>
              <ul className="text-[11px] text-muted-foreground list-disc pl-4">
                {Object.entries(compat.fillable).map(([k, v]) => {
                  const labels: Record<string, string> = {
                    name: "Nome",
                    socialName: "Nome social",
                    corporateEmail: "E-mail corporativo",
                    personalEmail: "E-mail pessoal",
                    cpf: "CPF",
                    phone: "Telefone",
                  };
                  return (
                    <li key={k}>
                      {labels[k] ?? k}: {String(v)}
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                className="text-xs px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90"
                onClick={handleApplyCompatible}
              >
                Confirmar aproveitamento dos dados
              </button>
              <p className="text-[11px] text-muted-foreground">
                Não altera campos já preenchidos. Conflitos exigem escolha explícita abaixo.
              </p>
            </div>
          )}

          {fillApplied && (
            <p className="text-[11px] text-emerald-800">Dados compatíveis aplicados ao formulário.</p>
          )}

          {unresolvedConflicts.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3">
              <p className="text-xs font-semibold text-amber-900">
                Conflitos de dados — escolha o valor a manter (não sobrescrevemos silenciosamente):
              </p>
              {unresolvedConflicts.map((c) => (
                <div key={c.field} className="text-xs space-y-1">
                  <p className="font-medium">
                    {PERSON_FIELD_LABELS[c.field as PersonFieldKey] ?? c.field}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="px-2 py-1 rounded border border-border bg-background"
                      onClick={() =>
                        onResolutionsChange({
                          ...(fieldResolutions ?? {}),
                          [c.field]: "form",
                        })
                      }
                    >
                      Manter do formulário: {c.formValue ?? "—"}
                    </button>
                    <button
                      type="button"
                      className="px-2 py-1 rounded border border-border bg-background"
                      onClick={() => {
                        onResolutionsChange({
                          ...(fieldResolutions ?? {}),
                          [c.field]: "person",
                        });
                        onFormSliceChange(
                          applyPersonConflictChoice(
                            formSlice,
                            c.field as PersonFieldKey,
                            c.personValue
                          )
                        );
                      }}
                    >
                      Usar da pessoa: {c.personValue ?? "—"}
                    </button>
                  </div>
                  {fieldResolutions?.[c.field] && (
                    <p className="text-[11px] text-muted-foreground">
                      Escolhido:{" "}
                      {fieldResolutions[c.field] === "form" ? "formulário" : "pessoa"}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Pesquisa Person, colaboradores, usuários, comissionados, motoristas e clientes PF. Não faz
        merge automático por nome semelhante. Não cria login automaticamente.
      </p>
    </div>
  );
}

/** Expõe para o submit quando a API retorna FIELD_CONFLICTS. */
export type { PersonConflict };
