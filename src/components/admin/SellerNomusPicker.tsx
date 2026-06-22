import React, { useMemo } from "react";
import { X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  SearchableSelect,
  type SelectOption,
} from "@/src/components/shared/SearchableSelect";
import {
  buildAdminSellerOptionKey,
  type AdminSellerOption,
} from "@/src/lib/adminSellerOptionsTypes";
import {
  formatAdminSellerOptionCounts,
  formatAdminSellerOptionSublabel,
} from "@/src/lib/adminSellerOptions";

export type SellerNomusPickerValue = {
  externalSellerId: string;
  sellerResponsibleName: string;
};

type SellerNomusPickerProps = {
  sellers: AdminSellerOption[];
  value: SellerNomusPickerValue;
  onChange: (value: SellerNomusPickerValue) => void;
  loading?: boolean;
  disabled?: boolean;
};

const CLEAR_VALUE = "";

function sellerMatchesUserValue(seller: AdminSellerOption, value: SellerNomusPickerValue): boolean {
  const id = value.externalSellerId.trim()
    ? Number.parseInt(value.externalSellerId.trim(), 10)
    : null;
  if (id != null && Number.isFinite(id)) {
    if (seller.externalSellerIds.includes(id) || seller.externalSellerId === id) return true;
  }
  const normalized = value.sellerResponsibleName.trim().replace(/\s+/g, " ").toUpperCase();
  if (normalized && seller.normalizedName === normalized) return true;
  if (normalized && seller.sellerIdentityKey === normalized.toLowerCase()) return true;
  return false;
}

function valueToSelectKey(value: SellerNomusPickerValue, sellers: AdminSellerOption[]): string {
  if (!value.externalSellerId.trim() && !value.sellerResponsibleName.trim()) {
    return CLEAR_VALUE;
  }
  const match = sellers.find((s) => sellerMatchesUserValue(s, value));
  if (match) return buildAdminSellerOptionKey(match);
  return `custom:${value.externalSellerId}:${value.sellerResponsibleName}`;
}

export const SellerNomusPicker: React.FC<SellerNomusPickerProps> = ({
  sellers,
  value,
  onChange,
  loading = false,
  disabled = false,
}) => {
  const options = useMemo((): SelectOption[] => {
    const rows: SelectOption[] = [
      {
        value: CLEAR_VALUE,
        label: "Sem vínculo comercial",
        sublabel: "Não filtra pedidos em Minha Gestão",
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

  const selectedKey = valueToSelectKey(value, sellers);
  const selectedSeller = useMemo(() => {
    if (!selectedKey || selectedKey === CLEAR_VALUE || selectedKey.startsWith("custom:")) {
      return null;
    }
    return sellers.find((s) => buildAdminSellerOptionKey(s) === selectedKey) ?? null;
  }, [selectedKey, sellers]);

  const handleSelectChange = (key: string) => {
    if (!key || key === CLEAR_VALUE) {
      onChange({ externalSellerId: "", sellerResponsibleName: "" });
      return;
    }
    const seller = sellers.find((s) => buildAdminSellerOptionKey(s) === key);
    if (!seller) return;
    const canonicalId =
      seller.externalSellerIds[0] ?? seller.externalSellerId ?? null;
    onChange({
      externalSellerId: canonicalId != null ? String(canonicalId) : "",
      sellerResponsibleName: seller.responsible ?? seller.displayName,
    });
  };

  const hasCustomSelection =
    selectedKey.startsWith("custom:") &&
    (value.externalSellerId.trim() || value.sellerResponsibleName.trim());

  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold text-muted-foreground">
        Vendedor Nomus / Responsável comercial
      </label>
      <SearchableSelect
        options={options}
        value={hasCustomSelection ? "" : selectedKey}
        onChange={handleSelectChange}
        placeholder={loading ? "Carregando vendedores…" : "Pesquisar por nome ou ID Nomus…"}
        emptyMessage="Nenhum vendedor encontrado nos pedidos."
        unknownSelectionLabel="Vínculo manual (não listado nos dados atuais)"
        searchInputPlaceholder="Nome ou ID Nomus…"
        pinOptionValues={[CLEAR_VALUE]}
        disabled={disabled || loading}
        listMaxHeight={320}
      />
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Este vínculo define quais pedidos aparecem em Minha Gestão Comercial. Vendedores com
        vários IDs Nomus aparecem consolidados por nome. Propostas em negociação são dado auxiliar.
      </p>

      {selectedSeller ? (
        <div className="flex flex-wrap items-center gap-2">
          {selectedSeller.externalSellerIds.length > 1 ? (
            <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              IDs Nomus {selectedSeller.externalSellerIds.join(", ")}
            </span>
          ) : selectedSeller.externalSellerId != null ? (
            <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              ID Nomus {selectedSeller.externalSellerId}
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
              Sem ID — fallback por nome
            </span>
          )}
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
              selectedSeller.confidence === "HIGH"
                ? "bg-green-100 text-green-800"
                : "bg-amber-50 text-amber-800"
            )}
          >
            {selectedSeller.confidence === "HIGH" ? "Alta confiança" : "Média confiança"}
          </span>
          {selectedSeller.mergedFragmentCount > 1 ? (
            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
              Consolida {selectedSeller.mergedFragmentCount} registros Nomus
            </span>
          ) : null}
          <span className="text-[10px] text-muted-foreground">
            {formatAdminSellerOptionCounts(selectedSeller)}
            {selectedSeller.hasMergedNameFallback ? " · inclui registros sem ID" : ""}
          </span>
          <button
            type="button"
            onClick={() => onChange({ externalSellerId: "", sellerResponsibleName: "" })}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Limpar vínculo
          </button>
        </div>
      ) : hasCustomSelection ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground space-y-2">
          <p>
            Vínculo manual:{" "}
            {value.sellerResponsibleName.trim() || "—"}
            {value.externalSellerId.trim() ? ` · ID ${value.externalSellerId.trim()}` : " · sem ID"}
          </p>
          <button
            type="button"
            onClick={() => onChange({ externalSellerId: "", sellerResponsibleName: "" })}
            className="inline-flex items-center gap-1 font-semibold hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Limpar vínculo
          </button>
        </div>
      ) : null}
    </div>
  );
};
