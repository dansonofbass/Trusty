/** Auth cookie names — kept dependency-free so the edge `proxy.ts` gate can
 *  import them without pulling Node-only modules (jose, node:crypto) into the
 *  edge bundle. */
export const SESSION_COOKIE = "constellation_session";
export const PKCE_COOKIE = "constellation_pkce";
