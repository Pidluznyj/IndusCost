// src/lib/importer/ProductConfig.ts
import { ImportEntityConfig } from "./types";

export const ProductImportConfig: ImportEntityConfig = {
  entityName: "Product",
  columns: [
    {
      key: "sku",
      label: "SKU",
      type: "string",
      required: true,
      description: "Código único do produto/componente",
      example: "PRD-001"
    },
    {
      key: "name",
      label: "Nome",
      type: "string",
      required: true,
      description: "Nome do item",
      example: "Eixo de Transmissão"
    },
    {
      key: "description",
      label: "Descrição",
      type: "string",
      required: false,
      description: "Descrição detalhada",
      example: "Eixo em aço 1045 com tratamento térmico"
    },
    {
      key: "type",
      label: "Tipo",
      type: "string",
      required: true,
      description: "PRODUCT ou COMPONENT",
      example: "PRODUCT",
      validation: (val) => ["PRODUCT", "COMPONENT"].includes(val) ? null : "Tipo inválido. Use PRODUCT ou COMPONENT."
    },
    {
      key: "version",
      label: "Versão",
      type: "string",
      required: false,
      description: "Versão da engenharia",
      example: "1.0.0"
    },
    {
      key: "defaultLotSize",
      label: "Lote Padrão",
      type: "decimal",
      required: false,
      description: "Lote padrão de produção",
      example: "100"
    },
    {
      key: "status",
      label: "Status",
      type: "string",
      required: false,
      description: "ACTIVE ou INACTIVE",
      example: "ACTIVE"
    }
  ]
};

export const BOMImportConfig: ImportEntityConfig = {
  entityName: "ProductBOM",
  columns: [
    {
      key: "parentSku",
      label: "SKU Pai",
      type: "string",
      required: true,
      description: "SKU do produto ou componente pai",
      example: "PRD-001"
    },
    {
      key: "childType",
      label: "Tipo Filho",
      type: "string",
      required: true,
      description: "MATERIAL ou COMPONENT",
      example: "MATERIAL",
      validation: (val) => ["MATERIAL", "COMPONENT"].includes(val) ? null : "Tipo de filho inválido. Use MATERIAL ou COMPONENT."
    },
    {
      key: "childIdentifier",
      label: "ID Filho",
      type: "string",
      required: true,
      description: "Código do Material ou SKU do Componente",
      example: "MAT-001"
    },
    {
      key: "quantity",
      label: "Quantidade",
      type: "decimal",
      required: true,
      description: "Quantidade necessária",
      example: "1.5",
      validation: (val) => Number(val) <= 0 ? "Quantidade deve ser maior que zero." : null
    },
    {
      key: "lossPercentage",
      label: "Perda (%)",
      type: "decimal",
      required: false,
      description: "Percentual de perda no processo",
      example: "5.0"
    },
    {
      key: "notes",
      label: "Notas",
      type: "string",
      required: false,
      description: "Observações do item na estrutura",
      example: "Corte a laser"
    }
  ]
};

export const EngineeringImportConfigs = {
  "CADASTRO": ProductImportConfig,
  "ESTRUTURA": BOMImportConfig
};
