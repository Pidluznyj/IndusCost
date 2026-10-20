import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { InventoryAttachOfficialMaterialPanel } from "@/src/components/inventory/InventoryAttachOfficialMaterialPanel";
import {
  formatInventoryItemStatus,
  formatInventoryItemType,
  INVENTORY_ITEM_TYPE_OPTIONS,
  INVENTORY_UNIT_SUGGESTIONS,
} from "@/src/components/inventory/inventoryItemLabels";
import {
  applyDefaultWarehousePolicyToForm,
  createEmptyInventoryItemForm,
  describeDefaultWarehousePolicy,
  inventoryItemFormFromRow,
  inventoryItemFormToPayload,
  isInventoryItemFormValid,
  validateInventoryItemForm,
  type InventoryItemDefaultWarehousePolicyDto,
  type InventoryItemFormState,
} from "@/src/components/inventory/inventoryItemForm";
import { normalizeInventoryLocationListResponse } from "@/src/components/inventory/inventoryLocationForm";
import {
  normalizeInventoryBalancesResponse,
  normalizeInventoryItemRow,
  summarizeInventoryBalances,
  type InventoryItemBalanceSummary,
} from "@/src/components/inventory/inventoryItemPresentation";
import {
  formatInventoryApiError,
  formatInventoryDateTime,
  formatInventoryOperationalStatus,
  formatInventoryQuantity,
} from "@/src/components/inventory/inventoryUi";
import type {
  InventoryItemRow,
  InventoryLocationRow,
  InventoryWarehouseRow,
} from "@/src/types/inventory";

type Props = {
  itemId: string | null;
  mode: "create" | "view";
  onClose: () => void;
  onSaved: () => void;
  canManage: boolean;
};

type NextCodeSuggestion = { code: string | null; lastCode: string | null };

function FieldLabel({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-0.5 block text-xs text-slate-500">{hint}</span> : null}
      {error ? <span className="mt-0.5 block text-xs text-red-600">{error}</span> : null}
    </label>
  );
}

const OTHER_OPTION = "__other__";

/**
 * Lista suspensa nativa (mesma aparência de "Tipo do item") com a opção de digitar
 * um valor que ainda não existe. Valor fora da lista (cadastro antigo) aparece como opção.
 */
function SelectWithOther({
  value,
  options,
  onChange,
  disabled,
  className,
  emptyLabel,
  otherLabel,
  otherPlaceholder,
  fallbackValue,
  testId,
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className: string;
  /** Rótulo da opção vazia; sem ele o campo não aceita vazio. */
  emptyLabel?: string;
  otherLabel: string;
  otherPlaceholder: string;
  /** Valor assumido ao voltar para a lista sem ter digitado nada. */
  fallbackValue?: string;
  testId: string;
}) {
  const [typing, setTyping] = useState(false);

  if (typing && !disabled) {
    const backToList = () => {
      const typed = value.trim();
      // Mesma opção com outra grafia ("papelaria") assume a grafia já cadastrada.
      const known = options.find((option) => option.toLowerCase() === typed.toLowerCase());
      onChange(known ?? (typed || fallbackValue || ""));
      setTyping(false);
    };
    return (
      <div className="flex gap-2">
        <input
          autoFocus
          className={className}
          value={value}
          placeholder={otherPlaceholder}
          data-testid={`${testId}-new`}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="shrink-0 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          onClick={backToList}
          data-testid={`${testId}-back`}
        >
          Voltar à lista
        </button>
      </div>
    );
  }

  const isListed = options.includes(value);
  return (
    <select
      className={className}
      value={value}
      disabled={disabled}
      data-testid={testId}
      onChange={(e) => {
        if (e.target.value === OTHER_OPTION) {
          setTyping(true);
          onChange("");
          return;
        }
        onChange(e.target.value);
      }}
    >
      {emptyLabel != null ? <option value="">{emptyLabel}</option> : null}
      {value && !isListed ? <option value={value}>{value}</option> : null}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
      <option value={OTHER_OPTION}>{otherLabel}</option>
    </select>
  );
}

function BalanceSummaryPanel({ summary }: { summary: InventoryItemBalanceSummary }) {
  const items = [
    { label: "Saldo físico", value: summary.physicalQuantity },
    { label: "Reservado", value: summary.reservedQuantity },
    { label: "Bloqueado", value: summary.blockedQuantity },
    { label: "Quarentena", value: summary.quarantineQuantity },
    { label: "Disponível", value: summary.availableQuantity },
  ];

  return (
    <div
      className="rounded-lg border border-slate-200 bg-slate-50/80 p-4"
      data-testid="inventory-item-balance-summary"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">Resumo de saldo</h4>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
          {formatInventoryOperationalStatus(summary.operationalStatus)}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Saldos consolidados de todos os almoxarifados. Para ajustar quantidade, use movimentação de
        estoque.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-md bg-white px-3 py-2 ring-1 ring-slate-100">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {item.label}
            </p>
            <p className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">
              {formatInventoryQuantity(item.value)}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Último movimento: {formatInventoryDateTime(summary.lastMovementAt)}
      </p>
      {!summary.hasBalances ? (
        <p className="mt-2 text-xs text-amber-700">Item ainda sem saldo registrado.</p>
      ) : null}
    </div>
  );
}

/**
 * Almoxarifado × endereço padrão. O almoxarifado é o que liga o item à conferência
 * do tablet (setor STANDARD): a política do tipo vem do servidor, que também a
 * reaplica no POST/PUT — o formulário só antecipa o preenchimento e a trava.
 */
function DefaultScopeFields({
  form,
  setForm,
  errors,
  readOnly,
  policy,
  warehouses,
  locations,
  inputClass,
}: {
  form: InventoryItemFormState;
  setForm: React.Dispatch<React.SetStateAction<InventoryItemFormState>>;
  errors: ReturnType<typeof validateInventoryItemForm>;
  readOnly?: boolean;
  policy: InventoryItemDefaultWarehousePolicyDto | null;
  warehouses: readonly InventoryWarehouseRow[];
  locations: readonly InventoryLocationRow[];
  inputClass: string;
}) {
  const locked = Boolean(policy?.locked);
  const restrictToSectors = policy?.mode === "SECTOR_CHOICE" || policy?.mode === "SECTOR_FIXED";
  const allowedIds = new Set(policy?.options.map((o) => o.warehouseId) ?? []);
  const warehouseOptions = restrictToSectors
    ? warehouses.filter((w) => allowedIds.has(w.id))
    : warehouses;
  // Almoxarifado do setor ainda não carregado na lista (ou inativo): ainda aparece.
  const missingOptions = (policy?.options ?? []).filter(
    (o) => restrictToSectors && !warehouseOptions.some((w) => w.id === o.warehouseId)
  );
  const currentUnknown =
    form.defaultWarehouseId &&
    !warehouseOptions.some((w) => w.id === form.defaultWarehouseId) &&
    !missingOptions.some((o) => o.warehouseId === form.defaultWarehouseId);
  const hint = describeDefaultWarehousePolicy(policy);

  return (
    <>
      <FieldLabel
        label="Almoxarifado padrão"
        required={policy?.mode === "SECTOR_FIXED" || policy?.mode === "SECTOR_CHOICE"}
        error={errors.defaultWarehouseId}
        hint={hint}
      >
        <select
          className={inputClass}
          value={form.defaultWarehouseId}
          disabled={readOnly || locked || policy?.editable === false}
          data-testid="inventory-item-form-default-warehouse"
          onChange={(e) => {
            const defaultWarehouseId = e.target.value;
            setForm((f) => ({ ...f, defaultWarehouseId, defaultLocationId: "" }));
          }}
        >
          <option value="">{restrictToSectors ? "Selecione…" : "— Opcional —"}</option>
          {currentUnknown ? <option value={form.defaultWarehouseId}>{form.defaultWarehouseId}</option> : null}
          {warehouseOptions.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
          {missingOptions.map((o) => (
            <option key={o.warehouseId} value={o.warehouseId}>
              {o.warehouseCode} — {o.warehouseName}
            </option>
          ))}
        </select>
      </FieldLabel>
      <FieldLabel
        label="Endereço padrão"
        error={errors.defaultLocationId}
        hint={form.defaultWarehouseId ? "Opcional. Endereço ativo do almoxarifado padrão." : "Informe o almoxarifado padrão primeiro."}
      >
        <select
          className={inputClass}
          value={form.defaultLocationId}
          disabled={readOnly || !form.defaultWarehouseId || policy?.editable === false}
          data-testid="inventory-item-form-default-location"
          onChange={(e) => {
            const defaultLocationId = e.target.value;
            setForm((f) => ({ ...f, defaultLocationId }));
          }}
        >
          <option value="">— Opcional —</option>
          {form.defaultLocationId && !locations.some((l) => l.id === form.defaultLocationId) ? (
            <option value={form.defaultLocationId}>{form.defaultLocationId}</option>
          ) : null}
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code} — {l.name}
            </option>
          ))}
        </select>
      </FieldLabel>
    </>
  );
}

function InventoryItemFormFields({
  form,
  setForm,
  errors,
  readOnly,
  hideRawMaterialType,
  codeHint,
  familyHint,
  families,
  defaultScope,
}: {
  form: InventoryItemFormState;
  setForm: React.Dispatch<React.SetStateAction<InventoryItemFormState>>;
  errors: ReturnType<typeof validateInventoryItemForm>;
  readOnly?: boolean;
  hideRawMaterialType?: boolean;
  codeHint?: React.ReactNode;
  familyHint?: React.ReactNode;
  families?: readonly string[];
  defaultScope: {
    policy: InventoryItemDefaultWarehousePolicyDto | null;
    warehouses: readonly InventoryWarehouseRow[];
    locations: readonly InventoryLocationRow[];
  };
}) {
  const inputClass = cn(
    "w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300/60",
    readOnly && "bg-slate-50 text-slate-600"
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="inventory-item-form">
      <FieldLabel label="Tipo do item" required error={errors.itemType}>
        <select
          className={inputClass}
          value={form.itemType}
          disabled={readOnly}
          data-testid="inventory-item-form-type"
          onChange={(e) =>
            setForm((f) => ({ ...f, itemType: e.target.value as InventoryItemFormState["itemType"] }))
          }
        >
          <option value="">Selecione…</option>
          {INVENTORY_ITEM_TYPE_OPTIONS.filter(
            (opt) => !hideRawMaterialType || opt.value !== "RAW_MATERIAL"
          ).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldLabel>
      <FieldLabel label="Família" hint={familyHint}>
        <SelectWithOther
          className={inputClass}
          value={form.family}
          options={families ?? []}
          disabled={readOnly}
          emptyLabel="Sem família"
          otherLabel="+ Nova família…"
          otherPlaceholder="Nome da nova família"
          testId="inventory-item-form-family"
          onChange={(family) => setForm((f) => ({ ...f, family }))}
        />
      </FieldLabel>
      <FieldLabel label="Código interno" required error={errors.code} hint={codeHint}>
        <input
          className={inputClass}
          value={form.code}
          disabled={readOnly}
          data-testid="inventory-item-form-code"
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Unidade padrão" required error={errors.unit}>
        <SelectWithOther
          className={inputClass}
          value={form.unit}
          options={INVENTORY_UNIT_SUGGESTIONS}
          disabled={readOnly}
          otherLabel="Outra unidade…"
          otherPlaceholder="Ex.: PEÇA"
          fallbackValue="UN"
          testId="inventory-item-form-unit"
          onChange={(unit) => setForm((f) => ({ ...f, unit }))}
        />
      </FieldLabel>
      <FieldLabel label="Descrição" required error={errors.description}>
        <input
          className={cn(inputClass, "sm:col-span-2")}
          value={form.description}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Status">
        <select
          className={inputClass}
          value={form.status}
          disabled={readOnly}
          onChange={(e) =>
            setForm((f) => ({ ...f, status: e.target.value as InventoryItemFormState["status"] }))
          }
        >
          <option value="ACTIVE">Ativo</option>
          <option value="INACTIVE">Inativo</option>
        </select>
      </FieldLabel>
      <DefaultScopeFields
        form={form}
        setForm={setForm}
        errors={errors}
        readOnly={readOnly}
        policy={defaultScope.policy}
        warehouses={defaultScope.warehouses}
        locations={defaultScope.locations}
        inputClass={inputClass}
      />
      <FieldLabel label="Grupo">
        <input
          className={inputClass}
          value={form.group}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Fornecedor principal">
        <input
          className={inputClass}
          value={form.preferredSupplierName}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, preferredSupplierName: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Código Nomus">
        <input
          className={inputClass}
          value={form.nomusProductCode}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, nomusProductCode: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Estoque mínimo" error={errors.minimumStock}>
        <input
          type="number"
          min={0}
          step="any"
          className={inputClass}
          value={form.minimumStock}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, minimumStock: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Estoque máximo" error={errors.maximumStock}>
        <input
          type="number"
          min={0}
          step="any"
          className={inputClass}
          value={form.maximumStock}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, maximumStock: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Ponto de reposição" error={errors.reorderPoint}>
        <input
          type="number"
          min={0}
          step="any"
          className={inputClass}
          value={form.reorderPoint}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, reorderPoint: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Custo médio gerencial" error={errors.averageCost}>
        <input
          type="number"
          min={0}
          step="any"
          className={inputClass}
          value={form.averageCost}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, averageCost: e.target.value }))}
        />
      </FieldLabel>
      <FieldLabel label="Último custo conhecido" error={errors.lastKnownCost}>
        <input
          type="number"
          min={0}
          step="any"
          className={inputClass}
          value={form.lastKnownCost}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, lastKnownCost: e.target.value }))}
        />
      </FieldLabel>
      <div className="sm:col-span-2 flex flex-wrap gap-4 pt-1">
        {(
          [
            ["controlsLot", "Controla lote"],
            ["controlsExpiration", "Controla validade"],
            ["controlsLocation", "Controla localização"],
            ["controlsQuality", "Controla qualidade"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form[key]}
              disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
            />
            {label}
          </label>
        ))}
      </div>
      <FieldLabel label="Observações">
        <textarea
          className={cn(inputClass, "min-h-[80px] sm:col-span-2")}
          value={form.notes}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </FieldLabel>
    </div>
  );
}

export function InventoryItemDetailSheet({
  itemId,
  mode,
  onClose,
  onSaved,
  canManage,
}: Props) {
  const isCreate = mode === "create";
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<InventoryItemFormState>(() =>
    createEmptyInventoryItemForm()
  );
  const [errors, setErrors] = useState<ReturnType<typeof validateInventoryItemForm>>({});
  const [item, setItem] = useState<InventoryItemRow | null>(null);
  const [balanceSummary, setBalanceSummary] = useState<InventoryItemBalanceSummary | null>(null);
  const [editing, setEditing] = useState(isCreate);
  const [nextCode, setNextCode] = useState<NextCodeSuggestion | null>(null);
  const [nextCodeRefresh, setNextCodeRefresh] = useState(0);
  const [families, setFamilies] = useState<string[]>([]);
  const [warehouses, setWarehouses] = useState<InventoryWarehouseRow[]>([]);
  const [locations, setLocations] = useState<InventoryLocationRow[]>([]);
  const [defaultWarehousePolicy, setDefaultWarehousePolicy] =
    useState<InventoryItemDefaultWarehousePolicyDto | null>(null);
  /** Último código preenchido automaticamente; digitação manual nunca é sobrescrita. */
  const autoFilledCodeRef = useRef("");

  const load = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    setError(null);
    try {
      const [itemRes, balanceRes] = await Promise.all([
        fetchJsonOk<{ item: unknown }>(`/api/inventory/items/${itemId}`),
        fetchJsonOk<unknown>(`/api/inventory/items/${itemId}/balances`).catch(() => ({ rows: [] })),
      ]);
      const normalized = normalizeInventoryItemRow(itemRes.item);
      if (!normalized) throw new Error("Item não encontrado.");
      setItem(normalized);
      setForm(inventoryItemFormFromRow(normalized));
      const balances = normalizeInventoryBalancesResponse(balanceRes);
      setBalanceSummary(summarizeInventoryBalances(balances, normalized));
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao carregar item."));
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    if (isCreate) {
      setEditing(true);
      setForm(createEmptyInventoryItemForm());
      setBalanceSummary(null);
      setItem(null);
      setLoading(false);
      return;
    }
    void load();
  }, [isCreate, load]);

  useEffect(() => {
    let cancelled = false;
    fetchJsonOk<{ families?: string[] }>("/api/inventory/items/families")
      .then((res) => {
        if (!cancelled) setFamilies(Array.isArray(res.families) ? res.families : []);
      })
      .catch(() => {
        if (!cancelled) setFamilies([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Almoxarifados ativos: lista do campo "Almoxarifado padrão" (edição ou criação).
  useEffect(() => {
    if (!canManage || !editing) return;
    let cancelled = false;
    fetchJsonOk<{ rows?: InventoryWarehouseRow[] }>(
      "/api/inventory/warehouses?pageSize=200&status=ACTIVE"
    )
      .then((res) => {
        if (!cancelled) setWarehouses(Array.isArray(res.rows) ? res.rows : []);
      })
      .catch(() => {
        if (!cancelled) setWarehouses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, editing]);

  // Política do tipo: pré-preenche/trava o almoxarifado padrão (o servidor reaplica no salvar).
  const policyItemType = canManage && editing ? form.itemType : "";
  useEffect(() => {
    if (!policyItemType) {
      setDefaultWarehousePolicy(null);
      return;
    }
    let cancelled = false;
    const query = new URLSearchParams({ itemType: policyItemType });
    fetchJsonOk<{ policy: InventoryItemDefaultWarehousePolicyDto }>(
      `/api/inventory/items/default-warehouse-policy?${query.toString()}`
    )
      .then((res) => {
        if (cancelled) return;
        setDefaultWarehousePolicy(res.policy);
        setForm((f) => applyDefaultWarehousePolicyToForm(f, res.policy));
      })
      .catch(() => {
        if (!cancelled) setDefaultWarehousePolicy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [policyItemType]);

  // Endereços ativos do almoxarifado padrão escolhido.
  const scopeWarehouseId = canManage && editing ? form.defaultWarehouseId : "";
  useEffect(() => {
    if (!scopeWarehouseId) {
      setLocations([]);
      return;
    }
    let cancelled = false;
    fetchJsonOk<unknown>(`/api/inventory/warehouses/${scopeWarehouseId}/locations?status=ACTIVE`)
      .then((raw) => {
        if (!cancelled) setLocations(normalizeInventoryLocationListResponse(raw).rows);
      })
      .catch(() => {
        if (!cancelled) setLocations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [scopeWarehouseId]);

  const createItemType = isCreate && canManage ? form.itemType : "";
  const createFamily = form.family.trim();
  // Família é digitável: espera a digitação parar antes de recalcular o código.
  const [debouncedFamily, setDebouncedFamily] = useState(createFamily);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedFamily(createFamily), 300);
    return () => window.clearTimeout(timer);
  }, [createFamily]);

  useEffect(() => {
    if (!createItemType) {
      setNextCode(null);
      return;
    }
    let cancelled = false;
    const query = new URLSearchParams({ itemType: createItemType });
    if (debouncedFamily) query.set("family", debouncedFamily);
    fetchJsonOk<NextCodeSuggestion>(`/api/inventory/items/next-code?${query.toString()}`)
      .then((suggestion) => {
        if (cancelled) return;
        const previousAuto = autoFilledCodeRef.current;
        const suggested = suggestion.code ?? "";
        autoFilledCodeRef.current = suggested;
        setNextCode(suggestion);
        setForm((f) =>
          f.code.trim() && f.code !== previousAuto ? f : { ...f, code: suggested }
        );
      })
      .catch(() => {
        if (!cancelled) setNextCode(null);
      });
    return () => {
      cancelled = true;
    };
  }, [createItemType, debouncedFamily, nextCodeRefresh]);

  const familyHint = isCreate
    ? "Define a sigla do código. Ex.: Informática → ADM-INF-0001."
    : null;

  const codeHint = !createItemType || !nextCode?.code ? null : form.code.trim() === nextCode.code ? (
    nextCode.lastCode ? (
      `Próximo da sequência (último cadastrado: ${nextCode.lastCode}).`
    ) : (
      "Primeiro código desta sequência."
    )
  ) : (
    <>
      Próximo da sequência: {nextCode.code}.{" "}
      <button
        type="button"
        className="font-medium text-slate-900 underline"
        onClick={() => {
          autoFilledCodeRef.current = nextCode.code ?? "";
          setForm((f) => ({ ...f, code: nextCode.code ?? "" }));
        }}
      >
        Usar
      </button>
    </>
  );

  const save = async () => {
    if (!canManage) return;
    const validation = validateInventoryItemForm(form);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;

    setSaving(true);
    setError(null);
    try {
      const payload = inventoryItemFormToPayload(form);
      if (isCreate) {
        await fetchJsonOk("/api/inventory/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (itemId) {
        await fetchJsonOk(`/api/inventory/items/${itemId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao salvar item."));
      // Código pode ter sido usado por outro cadastro nesse meio-tempo: recalcula a sequência.
      if (isCreate) setNextCodeRefresh((n) => n + 1);
    } finally {
      setSaving(false);
    }
  };

  const inactivate = async () => {
    if (!canManage || !itemId || item?.status === "INACTIVE") return;
    if (!window.confirm("Inativar este item? O histórico será preservado.")) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/inventory/items/${itemId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "INACTIVE" }),
      });
      onSaved();
      await load();
      setEditing(false);
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Erro ao inativar item."));
    } finally {
      setSaving(false);
    }
  };

  const title = isCreate ? "Novo item" : item ? `${item.code} — ${item.description}` : "Item";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" data-testid="inventory-item-sheet">
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            {!isCreate && item ? (
              <p className="mt-0.5 text-sm text-slate-500">
                {formatInventoryItemType(item.itemType)} · {formatInventoryItemStatus(item.status)}
              </p>
            ) : null}
          </div>
          <button type="button" className="rounded p-1 hover:bg-slate-100" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {error ? (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="space-y-4">
              {!isCreate && item ? (
                <InventoryAttachOfficialMaterialPanel
                  item={item}
                  physicalQuantity={balanceSummary?.physicalQuantity ?? 0}
                  canManage={canManage}
                  onLinked={() => void load()}
                />
              ) : null}
              {!isCreate && balanceSummary ? <BalanceSummaryPanel summary={balanceSummary} /> : null}
              {!isCreate && !balanceSummary && !loading ? (
                <BalanceSummaryPanel
                  summary={summarizeInventoryBalances([], item ?? undefined)}
                />
              ) : null}

              {isCreate ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  Matéria-prima deve ser vinculada ao cadastro oficial de Suprimentos. Use a ação
                  “Vincular MP oficial”. Não crie item RAW_MATERIAL órfão nesta ficha.
                </p>
              ) : null}
              <InventoryItemFormFields
                form={form}
                setForm={setForm}
                errors={errors}
                readOnly={!editing || !canManage}
                hideRawMaterialType={isCreate}
                codeHint={codeHint}
                familyHint={familyHint}
                families={families}
                defaultScope={{ policy: defaultWarehousePolicy, warehouses, locations }}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
          <div className="flex gap-2">
            {!isCreate && canManage && item?.status === "ACTIVE" ? (
              <button
                type="button"
                disabled={saving}
                className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-50"
                onClick={() => void inactivate()}
              >
                Inativar
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
              onClick={onClose}
            >
              Fechar
            </button>
            {canManage && !isCreate && !editing ? (
              <button
                type="button"
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white"
                onClick={() => setEditing(true)}
              >
                Editar
              </button>
            ) : null}
            {canManage && editing ? (
              <button
                type="button"
                disabled={saving || !isInventoryItemFormValid(form)}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
                onClick={() => void save()}
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
