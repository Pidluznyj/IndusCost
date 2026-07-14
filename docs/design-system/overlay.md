# Overlay Design System

Padrão canônico para **popups, dialogs, drawers e telas de detalhe que abrem sobrepostas** ao conteúdo do sistema (auditoria de pedido, cadastros, cotações, KPIs de detalhe, etc.).

Baseado no tema **High Density** (alta densidade de informação, minimalista, corporativo) adaptado à identidade visual do IndusCost.

---

## Princípios

1. **Densidade útil, não poluição.** Fonte menor + `uppercase tracking-wider` em labels, valores em `font-black`. O contraste tipográfico faz o layout respirar sem espaço vazio.
2. **Semântica primeiro.** Tudo é feito com tokens do `@theme` (`--color-primary`, `--color-overlay-*`, `--color-border`). Nada de hex hardcoded no consumidor.
3. **Composição.** Cada overlay é uma composição de primitives — não uma cascata de `<div>` com classes replicadas.
4. **Acessibilidade padrão.** `role="dialog"`, `aria-modal`, `aria-labelledby`, foco inicial, `Esc` para fechar, click-outside, scroll-lock.
5. **Portal por padrão.** Overlays renderizam via `createPortal` no `document.body` — nada de stacking-context surpresa.

---

## Estrutura de um overlay

```
┌─────────────────────────────────────────────────┐
│  OverlayHeader   (título, eyebrow, subtítulo)   │  ← fixo
├─────────────────────────────────────────────────┤
│  OverlayTabs     (opcional)                     │  ← fixo
├─────────────────────────────────────────────────┤
│                                                 │
│  OverlayBody                                    │
│    OverlaySection                               │  ← rolável
│    OverlayFieldGrid                             │
│    OverlayKpiCardGrid                           │
│    OverlayTable                                 │
│                                                 │
├─────────────────────────────────────────────────┤
│  OverlayFooter   (ações)                        │  ← fixo
└─────────────────────────────────────────────────┘
```

---

## Componentes

Todos exportados por `@/src/components/ui/overlay`.

| Componente | Uso |
|---|---|
| `<Overlay>` | Shell (backdrop, portal, Esc, focus, scroll-lock). Sempre a raiz. |
| `<OverlayHeader>` | Título + eyebrow + subtítulo + ações + botão fechar. Variantes `flat` (default) e `solid`. |
| `<OverlayTabs>` | Navegação em abas. Variantes `underline` (default, analítico) e `pill` (secundário). |
| `<OverlayBody>` | Corpo rolável. Aplica `flex-1 overflow-y-auto`. |
| `<OverlayFooter>` | Barra de ações fixa (Cancelar / Salvar). |
| `<OverlaySection>` | Painel/bloco interno com header próprio. Variantes `card`, `plain`, `muted`. |
| `<OverlayKpiCard>` + `<OverlayKpiCardGrid>` | Cards de indicadores (KPI). |
| `<OverlayTable>` | Tabela densa (`sub-components`: `Head`, `Body`, `Row`, `HeadCell`, `Cell`). |
| `<OverlayField>` + `<OverlayFieldGrid>` | Campo de form + grid responsivo. |
| `<OverlayInput>`, `<OverlayTextarea>`, `<OverlaySelect>` | Controles com estilos canônicos. |
| `<OverlayBadge>` | Chip semântico (sky / emerald / amber / rose / violet / slate / primary). |

---

## Tokens (definidos em `src/index.css`)

| Token | Valor | Uso |
|---|---|---|
| `--color-overlay-scrim` | `hsl(222 47% 11% / 0.55)` | Backdrop escurecido |
| `--color-overlay-surface` | `hsl(0 0% 100%)` | Fundo do dialog |
| `--color-overlay-surface-muted` | `hsl(210 40% 98%)` | Footer, headers de tabela, seções muted |
| `--color-overlay-border` | `hsl(214 32% 91%)` | Bordas finas |
| `--color-overlay-border-strong` | `hsl(214 20% 82%)` | Divisores mais aparentes |
| `--color-overlay-text-strong` | `hsl(222 47% 11%)` | Título, valores |
| `--color-overlay-text-muted` | `hsl(220 9% 46%)` | Labels, hints |
| `--color-overlay-header-solid` | `hsl(221 83% 45%)` | Header variante `solid` (azul corporativo) |
| `--color-overlay-header-solid-foreground` | `hsl(0 0% 100%)` | Texto do header solid |
| `--radius-overlay` | `1rem` | Cantos externos (containers) |
| `--radius-overlay-inner` | `0.75rem` | Cantos internos (cards, seções) |
| `--shadow-overlay` | `0 25px 50px -12px rgb(0 0 0 / 0.25)` | Sombra do dialog |

---

## Tipografia (classes canônicas em `src/lib/overlay/overlayTypography.ts`)

| Constante | Uso |
|---|---|
| `OVERLAY_EYEBROW` | Contexto acima do título (`text-[10px] uppercase tracking-wider text-muted-foreground`) |
| `OVERLAY_TITLE` | Título padrão (`text-lg font-bold`) |
| `OVERLAY_TITLE_LG` | Título proeminente (`text-2xl font-bold`) |
| `OVERLAY_SUBTITLE` | Descrição abaixo do título |
| `OVERLAY_LABEL_DENSE` | Label uppercase 10px (densidade alta — analytics) |
| `OVERLAY_LABEL` | Label padrão (form-friendly) |
| `OVERLAY_KPI_VALUE` | Valor de KPI (`text-2xl font-black tabular-nums`) |
| `OVERLAY_KPI_VALUE_SM` | Valor de KPI menor (grids densos) |
| `OVERLAY_MONO` | Códigos, SKUs, IDs (`font-mono text-xs`) |
| `OVERLAY_TABLE_HEAD` | Cabeçalho de tabela densa |
| `OVERLAY_TABLE_CELL` | Célula padrão |

---

## Quando usar cada variante

### `OverlayHeader variant`
- **`flat`** (default) — 90% dos casos. Preserva identidade visual atual. Cadastros, edições, cotações, formulários, listas de detalhe.
- **`solid`** — reservado para overlays de decisão crítica ou "hero" analítico. Exemplos: auditoria 360º, wizards multi-etapa, aprovações que exigem foco.

### `OverlayHeader density`
- **`default`** (`text-lg`) — forms de cadastro/edição.
- **`prominent`** (`text-2xl font-black`) — dashboards, auditorias, KPIs.

### `OverlayField density`
- **`default`** — cadastros e edições comuns (label `font-medium text-sm`).
- **`dense`** — forms analíticos/de auditoria (label uppercase 10px).

### `OverlayTabs variant`
- **`underline`** — analítico, muitas abas, hierarquia clara.
- **`pill`** — nav secundária (ex.: sub-abas dentro de uma section).

### `OverlaySize`
- `sm` (max-w-md) — confirmação, form de 1-3 campos
- `md` (max-w-2xl) — form padrão (cadastro/edição)
- `lg` (max-w-4xl) — form com abas ou grid de KPIs
- `xl` (max-w-6xl) — dashboard / tela de detalhe
- `full` (max-w-[1680px]) — auditorias 360º, telas quase full-screen

---

## Exemplo canônico — form de cotação

```tsx
import {
  Overlay,
  OverlayBody,
  OverlayHeader,
  OverlayFooter,
  OverlaySection,
  OverlayFieldGrid,
  OverlayField,
  OverlayInput,
  OverlayTextarea,
  OverlayBadge,
} from "@/src/components/ui/overlay";

function EditQuoteDialog({ open, onClose, quote }: Props) {
  const titleId = "edit-quote-title";
  return (
    <Overlay
      open={open}
      onClose={onClose}
      size="md"
      ariaLabelledBy={titleId}
      testId="edit-quote-dialog"
    >
      <OverlayHeader
        titleId={titleId}
        eyebrow="Materiais · Cotação"
        title={quote ? "Editar cotação" : "Registrar cotação"}
        subtitle="Alterações recalculam o preço líquido no servidor."
        onClose={onClose}
        actions={
          quote?.isManual ? (
            <OverlayBadge tone="amber">Câmbio manual</OverlayBadge>
          ) : null
        }
      />
      <OverlayBody>
        <OverlaySection title="Dados da cotação">
          <OverlayFieldGrid columns={2}>
            <OverlayField label="Data" required colSpan={1}>
              {(p) => <OverlayInput {...p} type="date" value={date} onChange={...} />}
            </OverlayField>
            <OverlayField label="Preço base" required colSpan={1}>
              {(p) => <OverlayInput {...p} type="number" step="0.01" value={price} onChange={...} />}
            </OverlayField>
            <OverlayField label="Observações" colSpan={2}>
              {(p) => <OverlayTextarea {...p} rows={2} />}
            </OverlayField>
          </OverlayFieldGrid>
        </OverlaySection>
      </OverlayBody>
      <OverlayFooter>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Salvar
        </button>
      </OverlayFooter>
    </Overlay>
  );
}
```

---

## Exemplo — dashboard com KPIs e abas (variante `solid` proeminente)

```tsx
import {
  Overlay,
  OverlayBody,
  OverlayHeader,
  OverlayTabs,
  OverlayKpiCard,
  OverlayKpiCardGrid,
  OverlaySection,
  OverlayTable,
} from "@/src/components/ui/overlay";

function OrderAuditOverlay({ open, onClose, order }: Props) {
  const [active, setActive] = useState<TabId>("summary");
  return (
    <Overlay open={open} onClose={onClose} size="full" testId="order-audit">
      <OverlayHeader
        variant="solid"
        density="prominent"
        eyebrow="Financeiro · Conciliação de Carteira"
        title={`Auditoria 360º — ${order.code}`}
        subtitle="Pedido → Documento de saída → NF-e → Contas a Receber → Baixas"
        onClose={onClose}
      />
      <OverlayTabs
        tabs={AUDIT_TABS}
        active={active}
        onChange={setActive}
        variant="underline"
        testId="order-audit"
      />
      <OverlayBody>
        <OverlaySection title="Indicadores">
          <OverlayKpiCardGrid columns={4}>
            <OverlayKpiCard label="Valor faturado" value="R$ 132.400" tone="info" />
            <OverlayKpiCard label="Recebido" value="R$ 98.200" tone="positive" />
            <OverlayKpiCard label="Em aberto" value="R$ 34.200" tone="warning" />
            <OverlayKpiCard label="Divergências" value="2" tone="negative" />
          </OverlayKpiCardGrid>
        </OverlaySection>

        <OverlaySection title="Itens do pedido" className="mt-4">
          <OverlayTable stickyHeader>
            <OverlayTable.Head>
              <OverlayTable.Row>
                <OverlayTable.HeadCell>Código</OverlayTable.HeadCell>
                <OverlayTable.HeadCell>Descrição</OverlayTable.HeadCell>
                <OverlayTable.HeadCell align="right">Qtd</OverlayTable.HeadCell>
                <OverlayTable.HeadCell align="right">Valor</OverlayTable.HeadCell>
              </OverlayTable.Row>
            </OverlayTable.Head>
            <OverlayTable.Body>
              {items.map((it) => (
                <OverlayTable.Row key={it.id} interactive>
                  <OverlayTable.Cell mono>{it.sku}</OverlayTable.Cell>
                  <OverlayTable.Cell>{it.name}</OverlayTable.Cell>
                  <OverlayTable.Cell align="right" mono>{it.qty}</OverlayTable.Cell>
                  <OverlayTable.Cell align="right" mono>{formatCurrency(it.value)}</OverlayTable.Cell>
                </OverlayTable.Row>
              ))}
            </OverlayTable.Body>
          </OverlayTable>
        </OverlaySection>
      </OverlayBody>
    </Overlay>
  );
}
```

---

## Migrando um modal existente

Ver `src/components/materials/MaterialIntelligenceMarketQuoteModal.tsx` — é o modal de referência canônica migrado. Ele exercita: `Overlay`, `OverlayHeader`, `OverlayBody`, `OverlayFooter`, `OverlaySection`, `OverlayFieldGrid`, `OverlayField`, `OverlayInput`, `OverlayBadge`.

**Passo a passo típico:**

1. Trocar `<div className="fixed inset-0 z-50 ...">` externo por `<Overlay>`.
2. Extrair o header (título + fechar) para `<OverlayHeader>`.
3. Se tiver tabs, usar `<OverlayTabs>`.
4. Envolver conteúdo rolável em `<OverlayBody>`.
5. Trocar `<section className="rounded-xl border ...">` por `<OverlaySection>`.
6. Trocar labels/inputs custom por `<OverlayField>` + `<OverlayInput>`.
7. Extrair botões finais para `<OverlayFooter>`.
8. Remover hex hardcoded (`#E5E7EB`, `#6B7280`, `#111827`) — os primitives já usam os tokens.

---

## Checklist de PR

- [ ] O overlay usa `<Overlay>` como raiz (portal, backdrop, Esc, scroll-lock incluídos).
- [ ] Título vinculado ao dialog via `titleId` + `ariaLabelledBy`.
- [ ] Nenhum hex hardcoded — só tokens ou classes Tailwind semânticas.
- [ ] `data-testid` em pelo menos: dialog, header, footer, cada tab (se houver).
- [ ] Botão de fechar presente (ou justificativa se ausente, ex.: wizard).
- [ ] Footer com ações claras (`Cancelar` / ação primária).
- [ ] Densidade adequada ao conteúdo (`dense` só se for tela analítica).
- [ ] Testado em mobile (`sm:` breakpoints).

---

## O que NÃO usar

- ❌ `<div className="fixed inset-0 z-50 bg-black/50">` bruto — usar `<Overlay>`.
- ❌ Classes de cor hex hardcoded (`#E5E7EB`, `#111827`, etc.).
- ❌ `rounded-[16px]` cru — usar `rounded-[var(--radius-overlay)]` ou primitive.
- ❌ Header azul sólido como default — só para overlays críticos/hero.
- ❌ Repetir `text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]` inline — usar `<OverlayField>` ou `OVERLAY_EYEBROW`.
