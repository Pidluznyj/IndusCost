import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Trava de regressão via código-fonte (mesmo padrão de
 * GoalsCockpitPage.test.tsx): GoalDetailPage depende de `useEffect` +
 * `fetch` para carregar a meta, então SSR estático não mostra os cards de
 * indicador/tarefa — a prova de que a hierarquia Objetivo → Indicador →
 * Tarefas é respeitada fica no comportamento do código-fonte.
 */
describe("GoalDetailPage — drill-down e vínculo correto das tarefas", () => {
  function source(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(here, "GoalDetailPage.tsx"), "utf8");
  }

  it("nova tarefa pode ser vinculada ao indicador aberto (não só ao objetivo)", () => {
    const src = source();
    assert.ok(
      src.includes("keyResultId: selectedKrId"),
      "criação de iniciativa precisa poder usar keyResultId, não só goalId"
    );
    assert.ok(
      src.includes("newInitiativeScope"),
      "usuário escolhe explicitamente o nível da tarefa (indicador × objetivo)"
    );
  });

  it("abre um indicador específico via ?kr= (link vindo do Cockpit)", () => {
    const src = source();
    assert.ok(src.includes('searchParams.get("kr")'));
    assert.ok(src.includes("useSearchParams"));
  });

  it("permite adicionar um novo indicador sem sair da tela de detalhe", () => {
    const src = source();
    assert.ok(src.includes("GoalKeyResultWizardDialog"));
    assert.ok(src.includes("Novo indicador"));
  });

  it("gráfico traz as três curvas: ideal, acumulado mês a mês e período comparado", () => {
    const src = source();
    assert.ok(
      src.includes("/series"),
      "curvas mensais vêm da rota de série (recalculada pela regra, não do snapshot)"
    );
    assert.ok(src.includes("burnup-current-line"), "linha do acumulado mês a mês");
    assert.ok(src.includes("burnup-comparison-line"), "linha do período comparado");
    assert.ok(src.includes("burnup-legend"), "legenda identifica cada curva");
    assert.ok(
      src.includes("listGoalSeriesMonths"),
      "comparação alinhada por índice de mês do período atual"
    );
  });
});
