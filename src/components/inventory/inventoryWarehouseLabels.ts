/**
 * Almoxarifados sugeridos — referência visual; não são criados automaticamente.
 */
import { INVENTORY_DEFAULT_WAREHOUSE_CODES } from "@/src/types/inventory";

export type SuggestedInventoryWarehouse = {
  code: string;
  name: string;
  description: string;
};

export const SUGGESTED_INVENTORY_WAREHOUSES: SuggestedInventoryWarehouse[] = [
  { code: "MP", name: "Matéria-prima", description: "Almoxarifado de matérias-primas." },
  { code: "COMPONENTES", name: "Componentes", description: "Componentes e semiacabados." },
  { code: "PA", name: "Produto acabado", description: "Produtos acabados prontos para expedição." },
  { code: "EMBALAGEM", name: "Embalagens", description: "Embalagens e materiais de embalagem." },
  { code: "PRODUCAO", name: "Produção", description: "Materiais em processo produtivo." },
  { code: "QUALIDADE", name: "Qualidade / Quarentena", description: "Itens em análise ou quarentena." },
  { code: "MANUTENCAO", name: "Manutenção", description: "Suprimentos de manutenção." },
  { code: "ADMINISTRATIVO", name: "Administrativo / Facility", description: "Suprimentos administrativos." },
  { code: "EXPEDICAO", name: "Expedição", description: "Área de expedição e separação." },
  { code: "SUCATA", name: "Sucata / Refugo", description: "Refugo e sucata." },
];

/** Valida que sugestões espelham constante documentada no schema. */
export const SUGGESTED_WAREHOUSE_CODES = INVENTORY_DEFAULT_WAREHOUSE_CODES;

export const INVENTORY_WAREHOUSE_STATUS_LABELS = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
} as const;

export function formatInventoryWarehouseStatus(status: string): string {
  return INVENTORY_WAREHOUSE_STATUS_LABELS[status as keyof typeof INVENTORY_WAREHOUSE_STATUS_LABELS] ?? status;
}
