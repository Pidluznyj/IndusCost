import React, { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  SearchableSelect,
  type SelectOption,
} from "@/src/components/shared/SearchableSelect";
import {
  buildAdminSellerOptionKey,
  flattenAdminSellerOptionsToNomusPicks,
  formatAdminSellerOptionCounts,
  formatAdminSellerOptionSublabel,
  type AdminSellerOption,
} from "@/src/lib/adminSellerOptionsTypes";
import { resolvePrimaryExternalSellerId } from "@/src/lib/adminUserSellerLink";

export type SellerNomusPickerValue = {
  /** ID canônico (menor da seleção) — legado / primary. */
  externalSellerId: string;
  externalSellerIds: number[];
  sellerResponsibleName: string;
};

type SellerNomusPickerProps = {
  sellers: AdminSellerOption[];
  value: SellerNomusPickerValue;
  onChange: (value: SellerNomusPickerValue) => void;
  loading?: boolean;
  disabled?: boolean;
  /** Exige pelo menos 1 ID Nomus (cadastro de vendedor). */
  requireNomusIds?: boolean;
};

const CLEAR_VALUE = "";

function buildValue(
  sellerResponsibleName: string,
  externalSellerIds: number[]
): SellerNomusPickerValue {
  const ids = [...new Set(externalSellerIds.filter((id) => Number.isFinite(id) && id > 0))].sort(
    (a, b) => a - b
  );
  const primary = resolvePrimaryExternalSellerId(ids);
  return {
    sellerResponsibleName,
    externalSellerIds: ids,
    externalSellerId: primary != null ? String(primary) : "",
  };
}

export const SellerNomusPicker: React.FC<SellerNomusPickerProps> = ({
  sellers,
  value,
  onChange,
  loading = false,
  disabled = false,
  requireNomusIds = false,
}) => {
  const [nomusSearch, setNomusSearch] = useState("");

  const responsibleOptions = useMemo((): SelectOption[] => {
    const rows: SelectOption[] = [
      {
        value: CLEAR_VALUE,
        label: "Sem responsável comercial",
        sublabel: "Obrigatório para filtrar Minha Gestão",
      },
    ];
    for (const seller of sellers) {
      const key = buildAdminSellerOptionKey(seller);
      rows.push({
        value: key,
        label: seller.displayName,
        sublabel: formatAdminSellerOptionSublabel(seller),
        searchTerms: [
          seller.displayName,
          seller.normalizedName,
          seller.sellerIdentityKey,
          seller.responsible ?? "",
          ...seller.externalSellerIds.map(String),
        ].join(" "),
      });
    }
    return rows;
  }, [sellers]);

  const selectedResponsibleKey = useMemo(() => {
    const name = value.sellerResponsibleName.trim();
    if (!name) return CLEAR_VALUE;
    const normalized = name.replace(/\s+/g, " ").toUpperCase();
    const match = sellers.find(
      (s) =>
        s.displayName.replace(/\s+/g, " ").toUpperCase() === normalized ||
        (s.responsible ?? "").replace(/\s+/g, " ").toUpperCase() === normalized ||
        s.sellerIdentityKey === name.toLowerCase() ||
        s.normalizedName === normalized
    );
    return match ? buildAdminSellerOptionKey(match) : `custom:${name}`;
  }, [value.sellerResponsibleName, sellers]);

  const selectedResponsible = useMemo(() => {
    if (!selectedResponsibleKey || selectedResponsibleKey === CLEAR_VALUE) return null;
    if (selectedResponsibleKey.startsWith("custom:")) return null;
    return sellers.find((s) => buildAdminSellerOptionKey(s) === selectedResponsibleKey) ?? null;
  }, [selectedResponsibleKey, sellers]);

  const nomusPicks = useMemo(() => flattenAdminSellerOptionsToNomusPicks(sellers), [sellers]);

  const filteredNomusPicks = useMemo(() => {
    const q = nomusSearch.trim().toLowerCase();
    if (!q) return nomusPicks;
    return nomusPicks.filter((p) => {
      const hay = `${p.externalSellerId} ${p.displayName} ${p.responsible ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [nomusPicks, nomusSearch]);

  const selectedIdSet = useMemo(() => new Set(value.externalSellerIds), [value.externalSellerIds]);

  const handleResponsibleChange = (key: string) => {
    if (!key || key === CLEAR_VALUE) {
      onChange(buildValue("", []));
      return;
    }
    const seller = sellers.find((s) => buildAdminSellerOptionKey(s) === key);
    if (!seller) return;
    const name = seller.responsible ?? seller.displayName;
    const suggestedIds =
      seller.externalSellerIds.length > 0
        ? seller.externalSellerIds
        : seller.externalSellerId != null
          ? [seller.externalSellerId]
          : [];
    // Ao trocar o responsável, sugere os IDs da identidade (substituindo seleção anterior).
    onChange(buildValue(name, suggestedIds));
  };

  const toggleNomusId = (id: number) => {
    const next = selectedIdSet.has(id)
      ? value.externalSellerIds.filter((x) => x !== id)
      : [...value.externalSellerIds, id];
    onChange(buildValue(value.sellerResponsibleName, next));
  };

  const selectAllFromResponsible = () => {
    if (!selectedResponsible) return;
    const ids =
      selectedResponsible.externalSellerIds.length > 0
        ? selectedResponsible.externalSellerIds
        : selectedResponsible.externalSellerId != null
          ? [selectedResponsible.externalSellerId]
          : [];
    onChange(buildValue(value.sellerResponsibleName, ids));
  };

  const hasCustomResponsible =
    selectedResponsibleKey.startsWith("custom:") && Boolean(value.sellerResponsibleName.trim());

  return (
    <div className="space-y-3" data-testid="seller-nomus-picker">
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground">
          Responsável comercial <span className="text-destructive">*</span>
        </label>
        <SearchableSelect
          options={responsibleOptions}
          value={hasCustomResponsible ? "" : selectedResponsibleKey}
          onChange={handleResponsibleChange}
          placeholder={loading ? "Carregando…" : "Pesquisar responsável comercial…"}
          emptyMessage="Nenhum responsável encontrado nos pedidos."
          unknownSelectionLabel="Responsável manual (não listado)"
          searchInputPlaceholder="Nome do responsável…"
          pinOptionValues={[CLEAR_VALUE]}
          disabled={disabled || loading}
          listMaxHeight={280}
        />
        {hasCustomResponsible ? (
          <p className="text-[10px] text-amber-800">
            Responsável manual: {value.sellerResponsibleName}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-xs font-semibold text-muted-foreground">
            Vendedores Nomus vinculados
            {requireNomusIds ? <span className="text-destructive"> *</span> : null}
          </label>
          {selectedResponsible && selectedResponsible.externalSellerIds.length > 1 ? (
            <button
              type="button"
              disabled={disabled}
              onClick={selectAllFromResponsible}
              className="text-[10px] font-semibold text-primary hover:underline"
            >
              Marcar IDs deste responsável ({selectedResponsible.externalSellerIds.length})
            </button>
          ) : null}
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Selecione um ou mais IDs Nomus deste login. Pessoas com vários cadastros no Nomus
          precisam de todos os IDs aqui para enxergar a carteira completa.
        </p>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={nomusSearch}
            onChange={(e) => setNomusSearch(e.target.value)}
            disabled={disabled || loading}
            placeholder="Filtrar IDs Nomus…"
            className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-2 text-xs"
          />
        </div>

        <div
          className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border/60"
          data-testid="seller-nomus-id-list"
        >
          {filteredNomusPicks.length === 0 ? (
            <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">
              {loading ? "Carregando vendedores…" : "Nenhum ID Nomus para exibir."}
            </p>
          ) : (
            filteredNomusPicks.map((pick) => {
              const checked = selectedIdSet.has(pick.externalSellerId);
              const highlighted =
                selectedResponsible != null &&
                selectedResponsible.externalSellerIds.includes(pick.externalSellerId);
              return (
                <label
                  key={pick.externalSellerId}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 px-3 py-2 text-xs hover:bg-accent/40",
                    checked && "bg-primary/5",
                    highlighted && !checked && "bg-amber-50/40"
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleNomusId(pick.externalSellerId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-foreground">
                      ID {pick.externalSellerId}
                    </span>
                    <span className="text-muted-foreground"> — {pick.displayName}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {pick.ordersCount} pedido(s)
                      {highlighted ? " · do responsável selecionado" : ""}
                    </span>
                  </span>
                </label>
              );
            })
          )}
        </div>

        {value.externalSellerIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {value.externalSellerIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
              >
                Nomus {id}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleNomusId(id)}
                  className="hover:text-foreground"
                  aria-label={`Remover ID ${id}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(buildValue(value.sellerResponsibleName, []))}
              className="text-[10px] font-semibold text-muted-foreground hover:text-foreground"
            >
              Limpar IDs
            </button>
          </div>
        ) : requireNomusIds ? (
          <p className="text-[10px] text-amber-800">
            Selecione ao menos um ID Nomus para este vendedor.
          </p>
        ) : null}

        {selectedResponsible ? (
          <p className="text-[10px] text-muted-foreground">
            {formatAdminSellerOptionCounts(selectedResponsible)}
            {selectedResponsible.mergedFragmentCount > 1
              ? ` · identidade consolida ${selectedResponsible.mergedFragmentCount} registros`
              : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
};
