/**
 * Resolução do atributo `Secure` do cookie de sessão, compatível com ambiente
 * HTTP de LAN (ex.: http://192.168.100.5:3000).
 *
 * Em HTTP, um cookie `Secure` NÃO é enviado/armazenado pelo navegador — o que
 * quebra o login. Portanto o padrão é `secure: false` e só ativamos quando a
 * requisição é realmente HTTPS (direta ou via proxy) ou quando forçado por env.
 *
 * APP_COOKIE_SECURE: "1" força secure; "0" força inseguro; ausente => deriva do
 * protocolo da requisição.
 */
export function resolveCookieSecure(opts: {
  forcedSecure?: string | undefined;
  requestSecure?: boolean;
  forwardedProto?: string | string[] | undefined;
}): boolean {
  const forced = (opts.forcedSecure ?? "").trim();
  if (forced === "1" || forced.toLowerCase() === "true") return true;
  if (forced === "0" || forced.toLowerCase() === "false") return false;

  if (opts.requestSecure === true) return true;

  const xfp = opts.forwardedProto;
  const proto = Array.isArray(xfp) ? xfp[0] : xfp;
  if (typeof proto === "string" && proto.split(",")[0].trim().toLowerCase() === "https") {
    return true;
  }
  return false;
}
