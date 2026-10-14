// How a request reaches a Studio. Native apps call it directly; the web build goes
// through the local relay because Studio refuses cross-origin browser calls.
export type Transport = {
  kind: 'direct' | 'relay';
  target(baseUrl: string, path: string): { url: string; headers: Record<string, string> };
};

export const normalizeBaseUrl = (value: string) => {
  const url = new URL(value.trim());
  return url.origin;
};

export const directTransport: Transport = {
  kind: 'direct',
  target: (baseUrl, path) => ({ url: normalizeBaseUrl(baseUrl) + path, headers: {} }),
};

export function relayTransport(relayOrigin: string): Transport {
  const base = relayOrigin.replace(/\/+$/, '');
  return {
    kind: 'relay',
    target: (baseUrl, path) => ({
      url: `${base}/relay${path}`,
      headers: { 'X-Studio-Target': normalizeBaseUrl(baseUrl) },
    }),
  };
}
