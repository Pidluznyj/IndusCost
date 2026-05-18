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

function valueToSelectKey(value: SellerNomusPickerValue, sellers: AdminSellerOption[]): string {
  if (!value.externalSellerId.trim() && !value.sellerResponsibleName.trim()) {
    return CLEAR_VALUE;
  }
  const id = value.externalSellerId.trim()
    ? Number.parseInt(value.externalSellerId.trim(), 10)
    : null;
  if (id != null && Number.isFinite(id)) {
    const match = sellers.find((s) => s.externalSellerId === id);
    if (match) return buildAdminSellerOptionKey(match);
  }
  const normalized = value.sellerResponsibleName.trim().replace(/\s+/g, " ").toUpperCase();
  if (normalized) {
    const match = sellers.find((s) => s.normalizedName === normalized);
    if (match) return buildAdminSellerOptionKey(match);
  }
  return `custom:${value.externalSellerId}:${value.sellerResponsibleName}`;
}

function formatCompactBrl(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCounts(option: AdminSellerOption): string {
  const base = `${option.ordersCount} ped. · ${option.proposalsCount} prop.`;
  const orderVal = formatCompactBrl(option.ordersValue);
  const propVal = formatCompactBrl(option.proposalsValue);
  if (!orderVal && !propVal) return base;
  const valueParts = [orderVal, propVal].filter(Boolean);
  return `${base} · ${valueParts.join(" / ")}`;
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
        sublabel: "Não filtra pedidos/propostas em Minha Gestão",
      },
    ];
    for (const seller of sellers) {
      const key = buildAdminSellerOptionKey(seller);
      const idLabel =
        seller.externalSellerId != null ? `ID Nomus ${seller.externalSellerId}` : "Sem ID — fallback por nome";
      const confidenceLabel =
        seller.confidence === "HIGH" ? "Alta confiança" : "Média confiança (sem ID Nomus)";
      rows.push({
        value: key,
        label: seller.displayName,
        sublabel: `${idLabel} · ${confidenceLabel} · ${formatCounts(seller)}`,
        searchTerms: [
          seller.displayName,
          seller.normalizedName,
          seller.responsible ?? "",
          seller.externalSellerId != null ? String(seller.externalSellerId) : "",
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
    onChange({
      externalSellerId: seller.externalSellerId != null ? String(seller.externalSellerId) : "",
      sellerResponsibleName: seller.responsible ?? "",
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
        emptyMessage="Nenhum vendedor encontrado nos pedidos/propostas."
        unknownSelectionLabel="Vínculo manual (não listado nos dados atuais)"
        searchInputPlaceholder="Nome ou ID Nomus…"
        pinOptionValues={[CLEAR_VALUE]}
        disabled={disabled || loading}
        listMaxHeight={320}
      />
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Este vínculo define quais pedidos e propostas aparecem em Minha Gestão Comercial. Sempre que
        possível, use uma opção com ID Nomus.
      </p>

      {selectedSeller ? (
        <div className="flex flex-wrap items-center gap-2">
          {selectedSeller.externalSellerId != null ? (
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
          <span className="text-[10px] text-muted-foreground">
            {formatCounts(selectedSeller)}
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
