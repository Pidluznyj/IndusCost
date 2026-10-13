/**
 * Imagens importadas como módulo: o Vite devolve a URL final do arquivo.
 */
declare module "*.png" {
  const src: string;
  export default src;
}
