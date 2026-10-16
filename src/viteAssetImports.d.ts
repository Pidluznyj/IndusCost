/**
 * Imagens e fontes importadas como módulo: o Vite devolve a URL final do arquivo.
 */
declare module "*.png" {
  const src: string;
  export default src;
}
declare module "*.woff2" {
  const src: string;
  export default src;
}
