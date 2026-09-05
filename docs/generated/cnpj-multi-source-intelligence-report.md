# Inteligência CNPJ multi-source (BrasilAPI + publica.cnpj.ws)

## Objetivo

Evoluir a consulta CNPJ do IndusCost de fonte única (`publica.cnpj.ws`) para um **agregador multi-source** com:

- proveniência por campo;
- fallback parcial;
- precedência determinística;
- proteção de contatos/endereço comerciais internos.

## Fontes

| Fonte | Status | Papel |
|-------|--------|--------|
| BrasilAPI (`/api/cnpj/v1/{cnpj}`) | Integrada | Identidade cadastral (Receita via BrasilAPI) |
| publica.cnpj.ws | Integrada | Complemento (QSA, IE, telefones) |
| Banco Central (BCB) | **Não aplicável** | Sem dado empresarial genérico por CNPJ no escopo; SELIC/IPCA/câmbio são macroeconômicos |

## Arquitetura

```
UI → /api/company-intelligence/... (backend)
  → aggregateCnpjIntelligence (Promise.allSettled)
      → BrasilAPI
      → publica.cnpj.ws
      → BCB report: not_applicable
  → mergeCnpjSummaries (campo a campo)
  → cache CustomerCnpjLookup (24h) com envelope multi-source
```

Hosts externos são hardcoded no backend. O frontend **não** chama APIs externas.

## Precedência (resumo)

- Identidade / CNAE / endereço cadastral: BrasilAPI → publica.cnpj.ws
- Telefone / e-mail / QSA / IE: publica.cnpj.ws → BrasilAPI
- Merge de sócios e CNAEs secundários por união (não apaga)

## Fallback parcial

Se ao menos uma fonte útil responder, a consulta retorna sucesso com `partialSuccess` e `warnings`.

## Proteção de dados internos

- Telefone/e-mail comerciais: não sobrescritos sem `confirmPublicContactOverwrite`
- Contatos CRM internos: nunca no patch
- Endereço operacional: só via seleção explícita na ação “aplicar”

## Testes

`src/lib/companyCnpjAggregator.test.ts` + `companyIntelligence.test.ts`
