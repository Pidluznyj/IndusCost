/**
 * Helpers para auditoria estática de páginas financeiras.
 * Separa JSX renderizado (corpo principal vs drawer) ignorando imports e helpers locais.
 */

function findFinancePageJsxStart(source: string): number {
  const exportFn = source.search(/export function Finance\w+Page\b/);
  const from = exportFn >= 0 ? exportFn : 0;
  const shell = source.indexOf("<FinanceBiDashboardShell", from);
  if (shell >= 0) return shell;
  const ret = source.indexOf("return (", from);
  return ret >= 0 ? ret : from;
}

export function extractFinanceComponentJsx(source: string): string {
  const start = findFinancePageJsxStart(source);
  return source.slice(start);
}

export function extractFinanceAuditDrawerBlock(source: string): string {
  const jsx = extractFinanceComponentJsx(source);
  const open = jsx.indexOf("<FinanceDataAuditDrawer");
  if (open < 0) return "";
  const closeTag = "</FinanceDataAuditDrawer>";
  const close = jsx.indexOf(closeTag, open);
  if (close < 0) return jsx.slice(open);
  return jsx.slice(open, close + closeTag.length);
}

/** JSX visível fora do drawer (header, main, filtros, KPIs). */
export function extractFinanceMainContentExcludingAuditDrawer(source: string): string {
  const jsx = extractFinanceComponentJsx(source);
  const open = jsx.indexOf("<FinanceDataAuditDrawer");
  if (open < 0) return jsx;
  const closeTag = "</FinanceDataAuditDrawer>";
  const close = jsx.indexOf(closeTag, open);
  if (close < 0) return jsx.slice(0, open);
  return jsx.slice(0, open) + jsx.slice(close + closeTag.length);
}

export function extractFinanceExecutiveHeaderBlock(source: string): string {
  const jsx = extractFinanceComponentJsx(source);
  const open = jsx.indexOf("<FinanceExecutivePageHeader");
  if (open < 0) return "";
  const afterOpen = jsx.slice(open);
  const extraIdx = afterOpen.indexOf("extraActions={");
  if (extraIdx >= 0) {
    const closeIdx = afterOpen.indexOf("\n      />", extraIdx);
    if (closeIdx >= 0) return afterOpen.slice(0, closeIdx + "\n      />".length);
  }
  const closeIdx = afterOpen.lastIndexOf("\n      />");
  if (closeIdx >= 0) return afterOpen.slice(0, closeIdx + "\n      />".length);
  const inlineClose = afterOpen.indexOf("/>", afterOpen.indexOf("title="));
  return inlineClose >= 0 ? afterOpen.slice(0, inlineClose + 2) : afterOpen;
}

export function financeMainContentIncludes(source: string, needle: string): boolean {
  return extractFinanceMainContentExcludingAuditDrawer(source).includes(needle);
}

export function financeAuditDrawerIncludes(source: string, needle: string): boolean {
  return extractFinanceAuditDrawerBlock(source).includes(needle);
}

export function financeExecutiveHeaderIncludes(source: string, needle: string): boolean {
  return extractFinanceExecutiveHeaderBlock(source).includes(needle);
}
