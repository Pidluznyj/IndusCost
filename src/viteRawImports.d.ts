/**
 * Import `?raw` do Vite — retorna o conteúdo do arquivo como string em vez
 * de processá-lo. Usado para reler CSS de impressão em tempo de execução
 * (ex.: extrair blocos `@media print` para exportação de imagens).
 */
declare module "*.css?raw" {
  const css: string;
  export default css;
}
