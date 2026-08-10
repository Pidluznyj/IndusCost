import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/**
 * Comercial > Comissões > Provisão por pedido — clicar no número do pedido
 * abre o mesmo modal de Detalhe do Pedido usado em Comercial > Pedidos de
 * venda (SalesOrderDetailDialog). É um toggle de estado local (o modal é
 * portalizado no document.body, a rota/lista nunca desmonta), então fechar
 * sempre volta no mesmo estado de filtros/página de antes — sem navegação,
 * sem query params.
 */
describe("CommissionsOrderProvisionPage — abrir detalhe do pedido", () => {
  const src = read("src/components/commissions/pages/CommissionsOrderProvisionPage.tsx");

  it("reutiliza o SalesOrderDetailDialog (mesmo modal de Pedidos de venda), carregado sob demanda", () => {
    assert.match(src, /React\.lazy\(\(\) =>\s*\n\s*import\("@\/src\/components\/sales\/SalesOrderDetailDialog"\)/);
  });

  it("célula do pedido é clicável e abre o detalhe pelo salesOrderId da linha", () => {
    const cellIdx = src.indexOf('data-testid={`commissions-order-provision-open-detail-');
    assert.ok(cellIdx > 0, "botão de abrir detalhe não encontrado na célula do pedido");
    const cellBlock = src.slice(Math.max(0, cellIdx - 300), cellIdx + 100);
    assert.match(cellBlock, /onClick=\{\(\) => openOrderDetail\(row\.salesOrderId, row\.orderCode\)\}/);
  });

  it("fechar o detalhe é um toggle de estado local — nunca navega/perde filtros da tela", () => {
    assert.match(src, /const closeOrderDetail = useCallback\(\(\) => \{\s*setDetailOrderId\(null\);\s*setDetailOrderCode\(null\);\s*\}, \[\]\);/);
    assert.doesNotMatch(src, /closeOrderDetail[\s\S]{0,80}navigate\(/);
  });

  it("dialog recebe open/salesOrderId/orderCode/onClose — sem onOpenFullAudit (não navega para fora da tela)", () => {
    const dialogIdx = src.indexOf("<SalesOrderDetailDialog");
    assert.ok(dialogIdx > 0);
    const dialogBlock = src.slice(dialogIdx, dialogIdx + 300);
    assert.match(dialogBlock, /open\s*\n/);
    assert.match(dialogBlock, /salesOrderId=\{detailOrderId\}/);
    assert.match(dialogBlock, /orderCode=\{detailOrderCode\}/);
    assert.match(dialogBlock, /onClose=\{closeOrderDetail\}/);
    assert.doesNotMatch(dialogBlock, /onOpenFullAudit/);
  });
});
