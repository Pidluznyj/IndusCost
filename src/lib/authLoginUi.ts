/**
 * Distingue falha de rede (retry /me) de sessão expirada (mostrar formulário).
 */

export function isAuthSessionExpiredMessage(
  message: string | null | undefined
): boolean {
  if (!message) return false;
  const m = message.trim().toLowerCase();
  return (
    m.includes("sessão expirada") ||
    m.includes("faca login") ||
    m.includes("faça login") ||
    m.includes("autenticação necessária") ||
    m.includes("autenticacao necessaria") ||
    m === "unauthorized" ||
    m.includes("não autenticado") ||
    m.includes("nao autenticado")
  );
}

/** Erro em que faz sentido só “Tentar novamente” (sem formulário). */
export function isAuthConnectivityErrorMessage(
  message: string | null | undefined
): boolean {
  if (!message) return false;
  if (isAuthSessionExpiredMessage(message)) return false;
  const m = message.trim().toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("network request failed") ||
    m.includes("verifique a conexão") ||
    m.includes("verifique a conexao") ||
    m.includes("não foi possível verificar sua sessão") ||
    m.includes("nao foi possivel verificar sua sessao") ||
    m.includes("load failed") ||
    m.includes("fetch failed")
  );
}
