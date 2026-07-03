import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("FinanceCostCenterAuditTab fetch loop", () => {
  const audit = read("src/components/finance/cost-centers/FinanceCostCenterAuditTab.tsx");

  it("estabiliza sort com primitivos sortKey e sortDirection no load", () => {
    assert.match(audit, /const sortKey = sort\.key/);
    assert.match(audit, /const sortDirection = sort\.direction/);
    assert.match(audit, /sortKey,\s*\n\s*sortDirection,/);
    assert.doesNotMatch(audit, /pageSize,\s*sort\]/);
  });

  it("dispara fetch via useEffect dependente de load estável", () => {
    assert.match(audit, /useEffect\(\(\) => \{\s*\n\s*void load\(\);/);
    assert.match(audit, /\[load\]/);
  });

  it("não faz retry automático no catch — só setError", () => {
    const catchBlock = audit.slice(audit.indexOf("} catch (e) {"), audit.indexOf("} finally {"));
    assert.match(catchBlock, /setError\(/);
    assert.doesNotMatch(catchBlock, /void load\(\)/);
    assert.doesNotMatch(catchBlock, /load\(\)/);
  });

  it("Tentar novamente e Atualizar chamam load manualmente", () => {
    assert.match(audit, /onRetry=\{\(\) => void load\(\)\}/);
    assert.match(audit, /onClick=\{\(\) => void load\(\)\}/);
  });

  it("endpoint de auditoria e banner de erro controlado", () => {
    assert.match(audit, /\/api\/finance\/cost-center-audit/);
    assert.match(audit, /Não foi possível carregar a auditoria de classificação/);
    assert.match(audit, /FinanceModuleErrorBanner/);
  });

  it("filtros e paginação alteram URL sem refetch inline no onChange", () => {
    assert.match(audit, /patchUrl\(\{ aud_q: value \|\| null, aud_page: 1 \}\)/);
    assert.match(audit, /onPageChange=\{\(nextPage\) => patchUrl\(\{ aud_page: nextPage \}\)\}/);
    assert.match(audit, /handleSort/);
  });
});
