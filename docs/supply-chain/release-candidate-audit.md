# OP-30 — Release Candidate Audit: Cadeia de Suprimentos (domínio paralelo)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | OP-30 |
| **Branch** | `chore/supply-chain-guardrails` |
| **Auditoria em** | 2026-07-22 |
| **Cadeado** | `.cursor/rules/supply-chain-guardrails.mdc` (OP-00) |
| **Parecer** | **APROVADO PARA PILOTO CONTROLADO** (flags off no deploy; ativação gradual) |
| **Docs irmãos** | `operations-and-rollback-runbook.md` · `parallel-domain-architecture.md` · `current-state-audit.md` |

> Cursor / agentes **não** executam migrate, deploy ou alteração em produção. Este RC habilita implantação **humana** controlada.

---

## 1. Escopo entregue (fase 1)

Domínio **paralelo** de Compras / Estoque / Recebimento que:

- **Lê** motores oficiais (Material, Product/BOM, FinancialSupplier, SalesOrder, Nomus, custos/preços, MI) via adapters read-only.
- **Escreve** somente estruturas SC: almoxarifado, itens logísticos, ledger/saldos, SC→cotação→negociação→evidência→adjudicação→PO→recebimento, indicadores e planejamento sombra.
- **Não** retroalimenta custo publicado, BOM, precificação, Contas a Pagar ou syncs Nomus.

### Sequência de commits (OP-00 → OP-29)

Contagem: **34 commits** desde `1c95bae` (guardrails) até o tip da branch no momento da auditoria (docs OP-29). Hash do tip pré-OP-30: `8df1d2d`.

| Faixa | Tema |
|-------|------|
| OP-00…02 | Cadeado, auditoria de estado, arquitetura paralela |
| OP-03…05 | Boundary read-only, providers, feature flags + acesso |
| OP-06…13 | Inventory: schema aditivo, locais, vínculo MP, ledger, saldo inicial, reservas, UI |
| OP-14…24 | Purchasing: schema, SC, cotação, negociação, evidências, comparação, award, PO, workstation, receipt↔ledger, receiving UI, ganho realizado |
| OP-25…27 | Shadow planning, indicadores, hardening permissões/evidências |
| OP-28…29 | Matriz E2E + regressões; runbook operação/rollback |

*(OP-30 = este documento + correção de typecheck encontrada na auditoria.)*

---

## 2. Evidências da auditoria

### 2.1 Working tree

- `git status` limpo no início da auditoria (sem arquivos temporários SC pendentes).
- Sem untracked `tmp` / `.env` / credentials no escopo SC.

### 2.2 Secrets

- Grep em `src/lib/purchasing` sem matches de API keys / private keys / passwords.
- Evidências usam storage local (`APP_UPLOADS_DIR` / `data/uploads`) + hash — sem secrets embutidos no código.

### 2.3 Migrations aditivas

Pastas SC/inventory/purchasing relevantes (sem `DROP` / `RENAME` destrutivo no scan de `migration.sql`):

1. `20260410120000_purchases_block1`
2. `20260410180000_purchases_block2_mp_context`
3. `20260627120000_inventory_module_base`
4. `20260804120000_inventory_additive_warehouse_ledger`
5. `20260804130000_inventory_locations_hierarchy`
6. `20260804140000_inventory_official_material_link`
7. `20260804150000_inventory_movement_ledger_idempotency`
8. `20260805120000_inventory_initial_balance`
9. `20260806120000_inventory_reservations_blocks_quarantine`
10. `20260807120000_purchasing_additive_domain`
11. `20260808120000_purchase_request_workflow`
12. `20260809120000_purchase_quotation_collection`
13. `20260810120000_purchase_negotiation_rounds_savings`
14. `20260811120000_purchase_negotiation_evidence_trail`
15. `20260812120000_purchase_quotation_comparison`
16. `20260813120000_purchase_quotation_award_approval`
17. `20260814120000_purchase_order_formal`
18. `20260815120000_purchase_receipt_ledger`

*Nota:* `20260721130000_material_market_purchase_link` é MI, não ledger SC.

### 2.4 Feature flags (default **off**)

Arquivo: `src/lib/supply-chain/supplyChainFeatureFlags.ts` — `defaultWhenAbsent: false`.

| Env | Default |
|-----|---------|
| `SUPPLY_CHAIN_PURCHASES_MODULE_ENABLED` | off |
| `SUPPLY_CHAIN_INVENTORY_MODULE_ENABLED` | off |
| `SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED` | off |
| `SUPPLY_CHAIN_SHADOW_PLANNING_ENABLED` | off |
| `SUPPLY_CHAIN_INDICATORS_ENABLED` | off |

Teste: “fail closed por padrão” em `supplyChainModuleAccess.test.ts` — **PASS**.

Kill switch adicional: `INVENTORY_INTEGRATIONS_ENABLED = false` (`inventoryIntegrationTypes.ts`).

### 2.5 Permissões

- Cascas: `operations.supply_chain.{purchases,inventory,receiving}.view` (sem mega-key bleed).
- Compras: `purchases.*` + `operations.purchases.*`; approve ≠ view (OP-27).
- Estoque/recebimento: `inventory.movement(s).create` exigido para postar/estornar estoque.
- Matriz: `PURCHASING_PERSONA_MATRIX` em `purchasingSecurity.ts`.

### 2.6 APIs (registradas em `server.ts`)

| Domínio | Registro |
|---------|----------|
| Inventory | `registerInventoryRoutes` |
| SC / flags | `registerSupplyChainModuleRoutes`, `registerSettingsSupplyChainRoutes` |
| Requests / quotations / evidence / PO | `registerPurchase*` |
| Workstation / receipts / shadow / indicators | `registerPurchasingWorkstationRoutes`, `registerPurchaseReceiptRoutes`, `registerShadowPurchasePlanningRoutes`, `registerSupplyChainIndicatorsRoutes` |

Guards de flag → **404** quando off.

### 2.7 Telas (`App.tsx`)

`/inventory/*`, `/purchases` (+ quotations, orders, workstation, receiving, shadow-planning, indicators), cascas `/supply-chain/{purchases,inventory,receiving}`.

### 2.8 Anexos

- `purchaseEvidenceService` → `saveAppLocalFile` / `readAppLocalFile`.
- MIME ∩ extensão; max 15 MB; soft-delete; anti-IDOR no download.

### 2.9 Documentação

| Doc | Papel |
|-----|-------|
| `current-state-audit.md` | OP-01 estado |
| `parallel-domain-architecture.md` | OP-02 desenho (alinhado a `PURCHASE_RECEIPT`) |
| `operations-and-rollback-runbook.md` | OP-29 operação |
| **Este arquivo** | OP-30 RC |

### 2.10 Sem escrita em motores oficiais / AP / custo / BOM / preço

| Controle | Evidência |
|----------|-----------|
| Boundary + scan estático | `officialEngineBoundary*.ts`, `npm run test:supply-chain` (37 PASS na auditoria) |
| Meta AP/Nomus/custo | `createsAccountsPayable: false`, `writesNomus*: false`, `updatesPublishedCost: false` em receipt/PO/receiving/savings/shadow |
| PO workflow | `buildOperationalCommitmentMeta(...).createsAccountsPayable === false` |
| Providers | somente `find*` via proxy read-only |

### 2.11 Imports proibidos

Padrões em `OFFICIAL_ENGINE_FORBIDDEN_MUTABLE_IMPORT_PATTERNS`; scan do domínio SC sem violações (incluído na matriz E2E OP-28 + boundary tests).

---

## 3. Testes e validações (auditoria OP-30)

| Suite | Resultado |
|-------|-----------|
| `test:supply-chain` (boundary + providers + modules) | **37/37 PASS** |
| `test:purchasing` (inclui E2E OP-28) | **135/135 PASS** |
| `npm run test:supply-chain:e2e` (matriz + regressões protegidas) | **13/13 suites PASS** |
| `npm run build` | **PASS** (~17s) |
| Typecheck escopo SC (`tsc` filtrado) | **Corrigido** — ver §4 |

Regressões protegidas no runner E2E: materials/custos, produtos, BOM qty, production costs, pricing subset, pedidos subset, finance billing, AP sync, products sync — todas **PASS**.

---

## 4. Falha técnica encontrada e correção

| Item | Detalhe |
|------|---------|
| **Problema** | `src/lib/inventory/inventoryTypes.ts` — `snapshotFromBalance` passava `availableQuantity` para `calculateAvailableBalance`, cujo `Pick` não inclui esse campo (`TS2353`) |
| **Impacto** | Typecheck do domínio inventory/SC |
| **Correção** | Remover a propriedade espúria do argumento; `normalizeInventoryBalance` continua recalculando `availableQuantity` |
| **Reteste** | Filtro `tsc` no escopo SC sem erros (pós-correção); `inventoryBalanceMath` + `inventoryInitialBalance` 23/23 PASS; purchasing 135/135 e E2E runner já verdes na mesma sessão |

Nenhuma outra falha **causada pelo escopo SC** exigiu correção nesta auditoria.  
`tsc` global do monorepo ainda reporta erros pré-existentes em `scripts/` / `tmp-audits/` — **fora do RC SC** (não corrigidos; cadeado).

---

## 5. Migrations (plano de apply)

Ordem: `npx prisma migrate deploy` no host autorizado **após** backup, com **todas** as flags SC **off**.  
Lista completa: §2.3.  
Rollback de schema: **não** DROP — isolar por flags (ver §9).

---

## 6. Flags (plano de env)

Deploy inicial:

```bash
# Omitir ou false — fail closed
# SUPPLY_CHAIN_PURCHASES_MODULE_ENABLED=
# SUPPLY_CHAIN_INVENTORY_MODULE_ENABLED=
# SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED=
# SUPPLY_CHAIN_SHADOW_PLANNING_ENABLED=
# SUPPLY_CHAIN_INDICATORS_ENABLED=
```

Ativação piloto (nessa ordem): inventory casca → purchases → receiving → (opcional) indicators → (opcional) shadow.

---

## 7. Plano de implantação controlada

Detalhe operacional: `operations-and-rollback-runbook.md` §6.

Resumo:

1. Backup DB + filesystem de uploads.
2. Deploy código + `migrate deploy` com flags **off**.
3. Smoke 404 nas APIs flagadas; inventory legado conforme ACL.
4. Conceder personas piloto (analista / aprovador / recebedor).
5. Criar 1 almoxarifado + locais + vínculos MP + saldo inicial.
6. Ligar flags gradualmente; validar fluxo E2E humano.
7. Expandir só após critérios §8.

---

## 8. Plano de piloto

| Item | Critério |
|------|----------|
| Escopo | 1 almoxarifado, 1–3 MPs, 1–2 fornecedores já em `FinancialSupplier`, ≤5 usuários |
| Fluxo mínimo | SC → cotação → negociação → evidência → award → PO → recebimento parcial → final → conferir saldo e ganho realizado |
| Negativos | Duplicidade vínculo, evidência ausente, persona sem approve, estorno de 1 receipt |
| Duração sugerida | 1–2 semanas calendário com flags só no ambiente piloto |
| Saída do piloto | Zero writes detectados em oficiais; saldos coerentes pós-rebuild dryRun; runbook seguido sem incidente AP/Nomus/custo |

---

## 9. Critérios de aprovação e rollback

### Aprovação do RC (esta auditoria)

- [x] Commits da sequência presentes e coerentes
- [x] Migrations aditivas sem DROP no scan
- [x] Flags default off + testes fail-closed
- [x] Permissões granulares / personas documentadas
- [x] Working tree limpa; sem temp/secrets SC
- [x] APIs e telas integradas (`server.ts` / `App.tsx`)
- [x] Anexos com MIME∩ext e storage local
- [x] Docs OP-01/02/29 + este RC
- [x] Testes E2E + purchasing + supply-chain + regressões protegidas
- [x] Build OK
- [x] Boundary: sem write oficial / sem AP / sem custo-BOM-preço automático
- [x] Typecheck do escopo SC corrigido

### Rollback (emergência)

1. Desligar envs SC (receiving + purchases primeiro).
2. Estornar receipts indevidos (`REVERSAL` / status `ESTORNADO`).
3. `POST /api/inventory/balances/rebuild` com `dryRun` → apply se necessário.
4. **Não** tentar “desfazer” AP/custo/BOM/Nomus — SC não os altera.
5. Reverter release de código se preciso; **não** DROP migrations.

---

## 10. Riscos residuais (parecer franco)

1. **Operacional:** confusão estoque local × estoque Nomus permanece o maior risco humano — mitigado por docs, não por código.
2. **Flags on cedo demais** em produção ampla sem piloto → pedidos/recebimentos reais sem processo maduro.
3. **Uploads em disco** exigem backup de `APP_UPLOADS_DIR` além do PostgreSQL.
4. **Typecheck monorepo** ainda sujo fora do SC — não bloqueia o RC SC, mas suja CI global se `npm run lint` for gate único.
5. **Suites amplas** de pricing/sales-order têm asserts estáticos pré-existentes; o runner E2E usa subsets estáveis (documentado OP-28/29).
6. **Shadow planning / indicadores** são informativos; rascunhos de SC não criam OP/BOM, mas podem induzir demanda humana se mal interpretados.
7. **Sem deploy automático** — sucesso do RC depende de disciplina humana no host (cadeado OP-00 §10).

---

## 11. Parecer técnico final

A estrutura paralela da Cadeia de Suprimentos **está pronta como Release Candidate para piloto controlado**, não como “ligar tudo em produção”.

Pontos fortes: boundary testável, flags fail-closed, ledger imutável com estorno, meta explícita anti-AP/Nomus/custo, matriz E2E + regressões próximas verdes, documentação operacional completa.

Pontos fracos: dependência de processo humano no go-live; typecheck global do repo ainda ruidoso; risco de uso incorreto do estoque local como se fosse Nomus.

**Recomendação:** merge/deploy do artefato com **flags off** → piloto §8 → só então expandir receiving/purchases. Qualquer ponte futura para AP, custo, BOM ou Nomus exige novo escopo autorizado — **fora deste RC**.

---

*Fim OP-30 — auditoria do release candidate do domínio paralelo SC.*
