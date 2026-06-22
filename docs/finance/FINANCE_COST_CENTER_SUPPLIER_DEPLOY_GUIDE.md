# Guia de deploy — Fornecedores, Centros de Custo e classificação AP

**Projeto:** IndusCost / My Industry  
**Módulo:** Financeiro → Classificação gerencial AP  
**Atualizado:** 2026-06-17  
**Commit de referência:** `5a3e639` (sequência `e025fdf` … `5a3e639`)

> Handoff técnico para aplicação no servidor.  
> Complementar: [`FINANCE_COST_CENTER_SUPPLIER_BLUEPRINT.md`](./FINANCE_COST_CENTER_SUPPLIER_BLUEPRINT.md), [`induscost-system-current-state.md`](../induscost-system-current-state.md).

---

## Escopo e princípio operacional

Esta funcionalidade **não altera** `NomusAccountsPayable`, sync Nomus nem cálculos oficiais do dashboard AP. Toda classificação vive em tabelas gerenciais (`FinancialSupplier`, `FinancialCostCenter`, `SupplierCostCenterRule`, `AccountsPayableCostCenterAllocation`).

**Regra de ouro:** nunca rodar `apply` sem `preview` aprovado pelo time financeiro.

---

## 1. Pré-deploy (ambiente de build / CI ou máquina local)

Executar no repositório **antes** de publicar no servidor.

### 1.1 Verificar árvore limpa

```bash
cd /caminho/para/IndusCost
git status
```

Esperado: working tree limpa ou apenas artefatos ignorados. Se houver mudanças locais não commitadas, resolver antes do deploy.

### 1.2 Atualizar código

```bash
git fetch origin
git pull origin main
```

Commits desta entrega (13 commits, do blueprint à revisão final):

```
e025fdf … 5a3e639
```

### 1.3 Dependências e Prisma

```bash
npm install
npx prisma generate
```

Em produção, preferir `npm ci` quando `package-lock.json` estiver sincronizado.

### 1.4 Migration necessária

Uma migration nova nesta entrega:

| Migration | Conteúdo |
|-----------|----------|
| `20260617130000_financial_ap_cost_center_supplier_base` | Tabelas gerenciais: fornecedores, aliases, centros de custo financeiros, regras, alocações AP, auditoria |

**No servidor (após backup):**

```bash
npx prisma migrate deploy
```

Não usar `migrate dev` em produção.

### 1.5 Testes obrigatórios

```bash
# Scripts CLI e integridade
npm run test:finance:cost-center-scripts

# Feature completa (fornecedores, CC, regras, alocações, integração AP)
npx tsx --test \
  src/lib/financeApCostCenterSupplierSchema.test.ts \
  src/lib/financeSupplierIdentity.test.ts \
  src/lib/financeSupplierRebuild.test.ts \
  src/lib/financeCostCenters.test.ts \
  src/lib/financeSupplierCostCenterRules.test.ts \
  src/lib/financeAccountsPayableCostCenterAllocation.test.ts \
  src/lib/financeCostCenterDashboard.test.ts \
  src/lib/financeAccountsPayableCostCenterIntegration.test.ts \
  src/lib/financeCostCentersPage.test.ts

# Regressão AP oficial
npm run test:finance:accounts-payable

# Qualidade
npm run lint
npm run build
```

Todos devem passar antes de subir em produção.

### 1.6 Build

```bash
npm run build
```

Artefato em `dist/`. Reiniciar o processo Node após deploy.

---

## 2. Ordem segura no servidor

Seguir **nesta ordem**. Não pular etapas.

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Backup do banco (snapshot PostgreSQL)                        │
│ 2. git pull + npm ci + prisma generate + migrate deploy       │
│ 3. npm run build                                                │
│ 4. Reiniciar aplicação (pm2/systemd)                            │
│ 5. Health check HTTP                                            │
│ 6. Validar telas (sem dados gerenciais ainda)                   │
│ 7. Conceder permissões RBAC aos perfis corretos                 │
│ 8. Preview fornecedores → revisar com financeiro                │
│ 9. Apply fornecedores (somente se aprovado)                     │
│10. Cadastrar centros de custo manualmente (UI)                  │
│11. Criar regras fornecedor → CC (UI)                            │
│12. Preview classificação → revisar com financeiro               │
│13. Apply classificação (somente se aprovado)                    │
│14. Integrity check final                                        │
│15. Validação manual completa (checklist §4)                     │
└─────────────────────────────────────────────────────────────────┘
```

### Detalhamento

| Etapa | O que faz | Grava dados? |
|-------|-----------|--------------|
| Deploy código + migration | Cria tabelas vazias; UI e APIs ficam disponíveis | Só schema |
| Health + telas | Confirma que AP oficial e telas novas carregam | Não |
| Preview fornecedores | Simula rebuild a partir de AP Nomus | **Não** |
| Apply fornecedores | Popula `FinancialSupplier` + aliases | **Sim** |
| CC + regras na UI | Cadastro manual pelo financeiro | **Sim** |
| Preview classificação | Simula alocações em lote | **Não** |
| Apply classificação | Grava `AccountsPayableCostCenterAllocation` | **Sim** |

**Importante:** centros de custo e regras são criados **manualmente** antes do apply de classificação. O apply em lote só classifica títulos que tenham fornecedor mapeado e regra ativa com rateio 100%.

---

## 3. Comandos prontos (servidor)

Assumir diretório `/opt/induscost` (ajustar conforme ambiente).  
`DATABASE_URL` deve estar definida no `.env` ou ambiente do processo.

### 3.1 Health check

```bash
# Substitua HOST e PORT conforme o ambiente (padrão PORT=3000)
curl -sS "http://127.0.0.1:3000/api/health" | jq .
```

Resposta esperada:

```json
{ "status": "ok", "timestamp": "..." }
```

### 3.2 Preview — fornecedores (read-only)

```bash
cd /opt/induscost
npm run finance:suppliers-from-ap:preview

# Opcional: salvar JSON para revisão offline
npm run finance:suppliers-from-ap:preview -- --out=tmp/suppliers-preview.json
```

Revisar no output:

- `Duplicidades potenciais`
- `Top fornecedores por valor`
- `Registros sem fornecedor` / `unidentifiableRecords`
- Avisos (`warnings`)

### 3.3 Apply — fornecedores (mutação)

Dry-run (sem alteração — só mostra instrução de confirmação):

```bash
npm run finance:suppliers-from-ap:apply
```

Apply real (exige confirmação textual exata):

```bash
npm run finance:suppliers-from-ap:apply -- --confirm="RECONSTRUIR FORNECEDORES AP"
```

### 3.4 Preview — classificação (read-only)

```bash
# Todos os títulos elegíveis
npm run finance:cc-classification:preview

# Recomendado na primeira implantação: apenas sem classificação
npm run finance:cc-classification:preview -- --unclassified-only

# Filtros opcionais
npm run finance:cc-classification:preview -- --unclassified-only --company="Nome Empresa"
npm run finance:cc-classification:preview -- --unclassified-only --supplier-id="<uuid>"

# Salvar relatório
npm run finance:cc-classification:preview -- --unclassified-only --out=tmp/cc-preview.json
```

### 3.5 Apply — classificação (mutação)

Dry-run:

```bash
npm run finance:cc-classification:apply -- --unclassified-only
```

Apply real:

```bash
npm run finance:cc-classification:apply -- \
  --unclassified-only \
  --confirm="APLICAR CENTROS DE CUSTO AP"
```

Na primeira implantação, usar sempre `--unclassified-only` para não sobrescrever alocações existentes (exceto as substituíveis pelo motor — ver §6).

### 3.6 Integrity check (read-only)

```bash
npm run finance:cc-integrity-check

# Com relatório em arquivo
npm run finance:cc-integrity-check -- --out=tmp/cc-integrity.json
```

Exit codes:

| Código | Significado |
|--------|-------------|
| `0` | Sem problemas |
| `1` | Avisos (warnings) |
| `2` | Problemas críticos |
| `3` | `DATABASE_URL` ausente ou falha de conexão |

Rodar **antes e depois** do apply de classificação.

### 3.7 Rollback lógico (quando aplicável)

#### Rollback de código

```bash
cd /opt/induscost
git log -5 --oneline          # identificar commit anterior ao deploy
git checkout <commit-anterior>
npm ci
npx prisma generate
npm run build
# reiniciar app
```

> As tabelas gerenciais permanecem no banco. O código antigo simplesmente não as utiliza.

#### Rollback de classificação (dados gerenciais)

Não há endpoint HTTP de “desfazer lote”. Opções seguras:

1. **Desativar regras** — `DELETE /api/finance/supplier-cost-center-rules/:id` ou desativação via UI (impede nova classificação automática).
2. **Inativar centros de custo** — impede uso em novas regras.
3. **Remover alocações gerenciais** — somente com aprovação e backup. Alocações com `lockedManual = true` **não** são sobrescritas pelo batch.

Exemplo SQL de emergência (executar **apenas** após backup e aprovação; **nunca** tocar em `NomusAccountsPayable`):

```sql
-- Remove alocações automáticas/em lote não bloqueadas manualmente
DELETE FROM "AccountsPayableCostCenterAllocation"
WHERE "source" IN ('AUTO_RULE', 'BATCH')
  AND "lockedManual" = false;
```

Auditoria em `FinancialCostCenterAuditLog` permanece para rastreabilidade.

#### O que NÃO fazer no rollback

- Não executar `DELETE` ou `UPDATE` em `NomusAccountsPayable`.
- Não rodar sync Nomus AP como “correção” de classificação.
- Não aplicar classificação em período fechado sem aprovação explícita.

---

## 4. Validação manual pós-deploy

Checklist para operador + financeiro:

- [ ] **Financeiro → Contas a Pagar** carrega; cards (aberto, vencido, etc.) batem com baseline pré-deploy (mesmos filtros de ano/mês).
- [ ] **Financeiro → Centros de Custo** carrega (`/finance/cost-centers`).
- [ ] Aba **Fornecedores** lista registros após apply (ou estado vazio claro antes do apply).
- [ ] Aba **Centros de Custo** permite cadastrar CC com código único.
- [ ] Aba **Regras** permite criar regra com rateio somando 100%.
- [ ] Aba **Sem classificação** lista títulos elegíveis.
- [ ] Aba **Visão geral** (dashboard CC) mostra valores coerentes após classificação.
- [ ] Aba **Auditoria** registra eventos de apply/rebuild.
- [ ] Drawer de classificação na AP enriquecida exibe fonte (`AUTO_RULE`, `MANUAL`, `BATCH`).
- [ ] Export CSV da AP inclui colunas de classificação (quando classificado).
- [ ] Usuário sem `finance.cost_centers.view` **não** vê o menu Centros de Custo.
- [ ] Usuário sem `finance.ap_allocations.apply_batch` **não** consegue preview/apply em lote.

### Permissões a configurar (RBAC)

Conceder aos perfis do financeiro conforme necessidade:

| Permissão | Uso |
|-----------|-----|
| `finance.cost_centers.view` | Ver CC e dashboard |
| `finance.cost_centers.manage` | CRUD centros |
| `finance.suppliers.view` | Ver fornecedores |
| `finance.suppliers.manage` | Rebuild fornecedores (API) |
| `finance.cost_center_rules.view` | Ver regras |
| `finance.cost_center_rules.manage` | CRUD regras |
| `finance.ap_allocations.view` | Ver classificação |
| `finance.ap_allocations.manage` | Alocação manual |
| `finance.ap_allocations.apply_batch` | Preview/apply em lote |
| `finance.cost_center_audit.view` | Auditoria dedicada |

---

## 5. Riscos operacionais

| Risco | Mitigação |
|-------|-----------|
| Rodar apply sem preview | Scripts apply em dry-run por padrão; confirmação textual obrigatória |
| Classificar histórico inteiro sem aprovação | Usar `--unclassified-only`; revisar preview JSON com financeiro |
| Alterar período fechado | Aplicar filtros `--company` / validar competência no preview antes do apply |
| Fornecedores sem documento | Revisar `unidentifiableRecords` e duplicidades no preview de fornecedores |
| Top fornecedores com consolidação indevida | Revisar `topSuppliersByAmount` e `potentialDuplicates` antes do apply |
| Sobrescrever classificação manual | Alocações `lockedManual = true` são preservadas pelo batch |
| Impacto em AP oficial | Integrity check + comparar cards AP antes/depois; nenhum script altera Nomus |

---

## 6. Rollback — resumo

| Camada | Ação | Impacto em AP oficial |
|--------|------|------------------------|
| Código | `git checkout` commit anterior + rebuild + restart | Nenhum |
| Schema | Tabelas gerenciais permanecem (migration já aplicada) | Nenhum |
| Fornecedores | Inativar via UI ou SQL em `FinancialSupplier` | Nenhum |
| Regras | Desativar via API/UI | Nenhum |
| Alocações | DELETE seletivo em `AccountsPayableCostCenterAllocation` (backup antes) | Nenhum |
| Nomus AP | **Não mexer** | — |

---

## 7. Referência rápida de endpoints novos

```
GET  /api/finance/cost-centers
GET  /api/finance/cost-centers/dashboard
POST /api/finance/cost-centers
PATCH /api/finance/cost-centers/:id
GET  /api/finance/cost-center-audit
GET  /api/finance/supplier-cost-center-rules
POST /api/finance/supplier-cost-center-rules
GET  /api/finance/suppliers/rebuild-from-ap-preview
POST /api/finance/suppliers/rebuild-from-ap-apply
GET  /api/finance/accounts-payable/classification-summary
GET  /api/finance/accounts-payable/unclassified
POST /api/finance/accounts-payable/classify-batch-preview
POST /api/finance/accounts-payable/classify-batch-apply
POST /api/finance/accounts-payable/:id/cost-center-allocation
```

Endpoints AP existentes (`dashboard`, `titles`, `export`) permanecem; enriquecimento de classificação é camada adicional.

---

## 8. Contatos e evidências

Após deploy bem-sucedido, arquivar no ticket:

- Hash do commit deployado
- Saída dos previews (`--out=...`)
- Saída do integrity check (antes e depois)
- Print ou nota dos cards AP (baseline vs pós-deploy)
- Data/hora e operador de cada apply
