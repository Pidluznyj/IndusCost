// src/lib/importer/CustomerConfig.ts
import { ImportEntityConfig } from "./types";

export const CustomerImportConfig: ImportEntityConfig = {
  entityName: "Customer",
  columns: [
    {
      key: "companyName",
      label: "Razão Social",
      type: "string",
      required: true,
      description: "Nome oficial da empresa",
      example: "Indústria de Exemplo LTDA"
    },
    {
      key: "tradeName",
      label: "Nome Fantasia",
      type: "string",
      required: false,
      description: "Nome comercial da empresa",
      example: "Exemplo Indústria"
    },
    {
      key: "taxId",
      label: "CNPJ / CPF",
      type: "string",
      required: true,
      description: "Documento de identificação (apenas números)",
      example: "12345678000199",
      transform: (val) => String(val).replace(/\D/g, "")
    },
    {
      key: "stateTaxId",
      label: "Insc. Estadual",
      type: "string",
      required: false,
      description: "Inscrição estadual da empresa",
      example: "123456789"
    },
    {
      key: "contactName",
      label: "Nome Contato",
      type: "string",
      required: false,
      description: "Nome da pessoa de contato",
      example: "João Silva"
    },
    {
      key: "email",
      label: "E-mail",
      type: "string",
      required: false,
      description: "E-mail de contato",
      example: "contato@exemplo.com.br",
      validation: (val) => {
        if (!val) return null;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(val) ? null : "E-mail inválido";
      }
    },
    {
      key: "phone",
      label: "Telefone",
      type: "string",
      required: false,
      description: "Telefone de contato",
      example: "(11) 99999-9999"
    },
    {
      key: "address",
      label: "Endereço",
      type: "string",
      required: false,
      description: "Endereço completo",
      example: "Rua das Indústrias, 123"
    },
    {
      key: "city",
      label: "Cidade",
      type: "string",
      required: false,
      description: "Cidade",
      example: "São Paulo"
    },
    {
      key: "state",
      label: "Estado",
      type: "string",
      required: false,
      description: "UF (2 caracteres)",
      example: "SP",
      transform: (val) => String(val).toUpperCase().substring(0, 2)
    },
    {
      key: "zipCode",
      label: "CEP",
      type: "string",
      required: false,
      description: "CEP (apenas números)",
      example: "01234567",
      transform: (val) => String(val).replace(/\D/g, "")
    },
    {
      key: "segment",
      label: "Segmento",
      type: "string",
      required: false,
      description: "Segmento de atuação",
      example: "Automotivo"
    },
    {
      key: "notes",
      label: "Observações",
      type: "string",
      required: false,
      description: "Notas adicionais",
      example: "Cliente VIP"
    }
  ]
};
