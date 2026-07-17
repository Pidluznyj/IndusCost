# Analista de Compras — cenário de aceite (PERM-43)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-16 |
| **Fixture** | `src/lib/security/fixtures/analistaComprasPersona.ts` |
| **Testes** | `src/lib/analistaCompras.perm43.test.ts` |
| **Perfil em produção** | Não obrigatório — fixture de teste/homologação |

## Matriz

| Área | Liberado | Negado |
|------|----------|--------|
| Dashboard | `dashboard` view | demais módulos sem grant |
| Engenharia | Suprimentos / MP / MI (+ update/approve cotações) | Produtos, Simulações, Projetos, Simulador |
| Comercial | — | grupo inteiro oculto |
| Financeiro | AP, Centros de Custo, Fornecedores (+ manage) | AR, Fluxo, Faturamento, PV fin., Rel. Presidencial, Portfolio, Opex, Taxes, Reports |
| Operações | Estoque (+ abas), Compras, Manutenção Predial, Frota | Máquinas, Performance, Ordens de Produção |

## Dimensões validadas

1. Menu / submenu (sidebar oficial)
2. Abas (Suprimentos, Financeiro, Estoque)
3. Ações CRUD (`canPerformAction` / helpers)
4. APIs (`requireResource` + profileSnapshot da fixture)
5. URL direta negada → modal + fallback
6. Aba financeira negada → modal
7. `permissionsVersion` bump + revoke sem logout/login
8. Wiring `AuthContext` poll / sync-session / notice

## Como rodar

```bash
npx tsx --test src/lib/analistaCompras.perm43.test.ts
npm run test:analista-compras
npm run test:resource-navigation
npm test
npm run build
```
