// src/lib/importer/MaterialConfig.ts
import { ImportEntityConfig } from "./types";

export const MaterialImportConfig: ImportEntityConfig = {
  entityName: "Material",
  columns: [
    {
      key: "code",
      label: "Código",
      type: "string",
      required: true,
      description: "Código único do material (SKU)",
      example: "MAT-001"
    },
    {
      key: "description",
      label: "Descrição",
      type: "string",
      required: true,
      description: "Nome ou descrição detalhada do material",
      example: "Aço Inox 304"
    },
    {
      key: "unit",
      label: "Unidade",
      type: "string",
      required: true,
      description: "Unidade de medida (KG, UN, M, etc.)",
      example: "KG"
    },
    {
      key: "category",
      label: "Categoria",
      type: "string",
      required: true,
      description: "MATERIA_PRIMA, INSUMO ou EMBALAGEM",
      example: "MATERIA_PRIMA",
      validation: (val) => {
        const valid = ["MATERIA_PRIMA", "INSUMO", "EMBALAGEM"];
        return valid.includes(val) ? null : "Categoria inválida. Use: MATERIA_PRIMA, INSUMO ou EMBALAGEM";
      }
    },
    {
      key: "supplier",
      label: "Fornecedor",
      type: "string",
      required: false,
      description: "Nome do fornecedor principal",
      example: "Siderúrgica Nacional"
    },
    {
      key: "currentCost",
      label: "Custo Atual",
      type: "decimal",
      required: true,
      description: "Custo de aquisição atual",
      example: "15.50",
      validation: (val) => Number(val) < 0 ? "Custo não pode ser negativo" : null
    },
    {
      key: "averageCost",
      label: "Custo Médio",
      type: "decimal",
      required: false,
      description: "Custo médio ponderado",
      example: "14.80"
    },
    {
      key: "standardCost",
      label: "Custo Padrão",
      type: "decimal",
      required: true,
      description: "Custo planejado/standard",
      example: "15.00"
    },
    {
      key: "freight",
      label: "Frete",
      type: "decimal",
      required: false,
      description: "Custo de frete unitário",
      example: "1.20"
    },
    {
      key: "standardLoss",
      label: "Perda Padrão (%)",
      type: "decimal",
      required: false,
      description: "Percentual de perda técnica",
      example: "5.0"
    },
    {
      key: "conversionFactor",
      label: "Fator Conversão",
      type: "decimal",
      required: false,
      description: "Fator para conversão de unidades",
      example: "1.0"
    },
    {
      key: "status",
      label: "Status",
      type: "string",
      required: false,
      description: "ACTIVE ou INACTIVE",
      example: "ACTIVE",
      validation: (val) => {
        if (!val) return null;
        return ["ACTIVE", "INACTIVE"].includes(val) ? null : "Status inválido. Use: ACTIVE ou INACTIVE";
      }
    }
  ]
};
