/**
 * Coalescência de chamadas assíncronas CONCORRENTES com a mesma chave.
 *
 * NÃO é um cache: a entrada é removida do mapa assim que a promise
 * resolve/rejeita (`finally`), então uma chamada posterior fora da janela
 * concorrente sempre executa `factory()` de novo — sem risco de servir dado
 * obsoleto. Só chamadas verdadeiramente simultâneas (mesma chave, mesmo
 * intervalo antes da resolução) compartilham o resultado/erro.
 *
 * Uso original: `loadOrderFullAudit` (~28 consultas por pedido) é chamado
 * por até 3 cargas de portfólio AR do Relatório Presidencial em paralelo,
 * frequentemente auditando os MESMOS pedidos do ano corrente ao mesmo tempo.
 */
export function dedupeInFlight<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  factory: () => Promise<T>
): Promise<T> {
  const existing = cache.get(key);
  if (existing) return existing;

  const promise = factory().finally(() => {
    cache.delete(key);
  });
  cache.set(key, promise);
  return promise;
}
