const SENSITIVE_ANYWHERE = /token|secret|passw(or)?d|pwd|api[-_]?key|signature|session/i;
const SENSITIVE_WORD = /(^|[-_])(auth|sid|sig|code|key|otp|jwt)$/i;
const HASH_ROUTE = /^#!?\//;

function isSensitive(name: string): boolean {
  return SENSITIVE_ANYWHERE.test(name) || SENSITIVE_WORD.test(name);
}

function redactHash(hash: string): string {
  return hash.replace(/([#?&])([^=&#?]+)=([^&]*)/g, (match, lead: string, name: string) =>
    isSensitive(name) ? `${lead}${name}=REDACTED` : match,
  );
}

/** Removes credentials from a URL, keeping its shape so the agent can still read it. */
export function sanitizeUrl(input: string): string {
  const url = new URL(input);
  url.username = '';
  url.password = '';
  for (const name of [...url.searchParams.keys()]) {
    if (isSensitive(name)) url.searchParams.set(name, 'REDACTED');
  }
  url.hash = redactHash(url.hash);
  return url.href;
}

/**
 * Identifies a page across visits. The query string is ignored, since it usually
 * holds view state, but hash routes count as separate pages. Dynamic routes stay
 * separate too: guessing that two paths share a template would misplace pins.
 */
export function pageKey(input: string): string {
  const url = new URL(input);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const route = HASH_ROUTE.test(url.hash) ? url.hash.split('?')[0] : '';
  return `${url.origin}${path}${route}`;
}

export function isAnnotatable(input: string | undefined): input is string {
  return !!input && /^https?:\/\//.test(input);
}

/** Permission pattern for a site. Leaving the port out covers every port on the host. */
export function sitePattern(input: string): string {
  const { protocol, hostname } = new URL(input);
  return `${protocol}//${hostname}/*`;
}
