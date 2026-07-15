# Convenção de nomes — chaves canônicas de permissão

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-15 |
| **Status** | Contrato alvo (Prompt 02) — **não** altera runtime |
| **Fonte tipada** | `src/lib/security/permissionContract` |
| **Pré-req** | Prompt 01 |

---

## 1. Objetivo

Definir um padrão **estável, auditável e em inglês** para `resourceKey` + ações, coerente com o repositório (ids de módulo, catálogo legado e rotas), sem copiar cegamente o seed PT atual (`comissoes.tab.*`, `financeiro.*`).

O runtime continua em:

- legado: `PERMISSION_CATALOG` (`products.view`, …);
- relacional parcial: seed PT (`comissoes`, `financeiro`, …).

O contrato canônico é a ponte futura; cada recurso declara `legacyPermissionKeys` e, quando existir, `relationalResourceKeys`.

---

## 2. Forma da chave

```text
{domain}[.{module}[.{section}[.{facet}]]]
```

Regras:

1. **snake_case** ASCII (`sales_orders`, não `sales-orders` nem `pedidosVenda`).
2. Domínios alinhados à sidebar: `dashboard` | `engineering` | `commercial` | `finance` | `operations` | `admin`.
3. Segmentos só `[a-z][a-z0-9_]*`.
4. Sem sufixo de ação na chave do recurso (`commercial.sales_orders`, não `commercial.sales_orders.view`).
5. Ação vive no grant: `{ resourceKey, action }`.
6. Tabs/facets usam segmento descritivo (`…tab.bom` só quando for aba de UI; caso contrário `…bom` / `…detail`).

Regex de validação (código): `^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)*$`.

---

## 3. Exemplos canônicos (repositório)

| resourceKey | Corresponde a |
|-------------|----------------|
| `engineering.products` | módulo `products` / `/products` |
| `engineering.products.tab.bom` | aba BOM do modal de produto |
| `commercial.sales_orders` | `sales-orders` / pedidos Nomus |
| `commercial.commissions.closings` | aba Fechamentos |
| `finance.accounts_receivable` | seção AR |
| `finance.portfolio_reconciliation.order_to_cash_audit` | aba O2C |
| `operations.inventory.movements` | aba movimentações |
| `admin.settings.security` | hub Usuários e Permissões |

---

## 4. Ações permitidas

| Ação | Uso |
|------|-----|
| `view` | Ver menu / tela / aba / detalhe |
| `create` | Criar registro |
| `update` | Editar (mapeia legado `*.edit`) |
| `delete` | Excluir **somente** onde o catálogo/API já prevê exclusão segura |
| `export` | Export CSV/XLSX/PDF |
| `execute` | Jobs, sync, simular, rebuild |
| `approve` | Aprovação explícita (cotação, contagem) |
| `close` | Fechar competência / aplicar fechamento |
| `reopen` | Reabrir (só se existir no produto — hoje raro) |
| `reprocess` | Reprocessar cálculos (comissões) |
| `manage` | Pacote operacional amplo já existente (`*.manage`) |

### 4.1 Proibições explícitas de `delete`

Não modelar `delete` genérico para:

- ledger de comissão / fechamento oficial;
- comissão paga / pagamento liquidado;
- documento fiscal (NF);
- histórico imutável;
- pedido Nomus;
- títulos AR/AP como “apagar título”.

Preferir `cancel`, `close`, `manage` (cancelar lote), `execute` (sync) conforme o domínio.

Lista enforçada: `PERMISSION_CONTRACT_FORBIDDEN_DELETE_KEYS`.

---

## 5. Relação com catálogos existentes

| Camada | Exemplo | Papel |
|--------|---------|-------|
| Canônico (novo) | `commercial.commissions.closings` | contrato alvo |
| Legado | `commissions.view` | runtime atual |
| Relacional PT | `comissoes.tab.fechamentos` | seed/UI parcial |

Aliases **não** substituem o canônico: documentam o bridge.

Evitar inventar legacy fantasma: toda `legacyPermissionKey` no contrato deve existir em `PERMISSION_CATALOG` (teste unitário).

---

## 6. Metadados obrigatórios por recurso

Ver `PermissionContractResource` em `types.ts`:

- label, parent, group, route, sortOrder;
- actions + legacy keys;
- relatedEndpoints;
- sensitivity;
- flags: sidebar / tab / internal action / detail screen;
- relationalResourceKeys (opcional).

---

## 7. Gaps conscientes (não resolvidos neste prompt)

1. FE `configuracoes` vs seed `admin` — documentado; canônico usa `admin.settings`.
2. Export de pedidos sem `sales_orders.export` no catálogo — `export` aponta para `sales_orders.view` temporariamente.
3. Pricing DELETE API com `pricing.view` — contrato **omite** delete até haver chave segura.
4. Abas legado de comissões (dashboard/previstas/…) — fora da matriz live (UI ocultas).
5. Frota: ações granulares `fleet.*` ainda resumidas em view/manage no contrato (expansão futura).
6. Herança viva AccessProfile — fora do escopo do contrato.

---

## 8. O que este prompt **não** faz

- Não altera sidebar, guards, APIs, usuários ou banco.
- Não substitui `PERMISSION_CATALOG` nem seeds PT.
- Não cria migration.
