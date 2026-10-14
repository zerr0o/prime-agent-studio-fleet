// Mapping of domain states to Studio status visuals (dot + short word).
import type { ConnectionState, MemberSyncStatus, NodeState } from '@/domain/types';
import type { DotKind, StatusTone } from '@/ui/components';

export const connDot = (state: ConnectionState | undefined): DotKind =>
  state === 'online' ? 'connected' : !state || state === 'unknown' || state === 'connecting' || state === 'offline' ? 'idle' : 'error';

export const connTone = (state: ConnectionState | undefined): StatusTone =>
  state === 'online' ? 'connected' : state === 'offline' || !state || state === 'unknown' || state === 'connecting' ? 'muted' : 'failed';

export const syncTone = (status: MemberSyncStatus | undefined): StatusTone =>
  status === 'synced' ? 'connected' : status === 'latest' ? 'working' : status === 'behind' || status === 'diverged' || status === 'sync-off' ? 'attention' : 'muted';

export const nodeTone = (state: NodeState): StatusTone =>
  state === 'running'
    ? 'running'
    : state === 'done'
      ? 'done'
      : state === 'failed' || state === 'missing'
        ? 'failed'
        : state === 'ready'
          ? 'working'
          : state === 'review' || state === 'offline'
            ? 'attention'
            : 'muted';

export const nodeDot = (state: NodeState): DotKind =>
  state === 'running' ? 'running' : state === 'done' ? 'connected' : state === 'failed' || state === 'missing' ? 'error' : state === 'review' || state === 'offline' ? 'attention' : state === 'ready' ? 'unread' : 'idle';

export const runTone = (status: string): StatusTone =>
  status === 'running' || status === 'stopping' ? 'running' : status === 'completed' ? 'done' : status === 'failed' ? 'failed' : 'muted';

export type AddressKind = 'local' | 'https' | 'tailscale' | 'lan' | 'other';

export function addressKind(baseUrl: string): AddressKind {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname;
    if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]') return 'local';
    if (url.protocol === 'https:' && host.endsWith('.ts.net')) return 'https';
    const parts = host.split('.').map(Number);
    if (parts.length === 4 && parts.every((p) => Number.isInteger(p))) {
      if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return 'tailscale';
      if (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)) return 'lan';
    }
    return 'other';
  } catch {
    return 'other';
  }
}

/** Normalizes what a person typed: bare Tailscale names get https, bare IPs get http and port 3089. */
export function normalizeAddress(input: string): string | null {
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    if (/^[^/?#:@]+\.ts\.net(?:[/?#]|$)/i.test(text)) text = `https://${text}`;
    else if (/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(text)) text = `http://${text.includes(':') ? text : `${text}:3088`}`;
    else text = `http://${/:\d+$/.test(text) ? text : `${text}:3089`}`;
  }
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export const maskToken = (token: string | undefined) => (token ? `•••• ${token.slice(-4)}` : '');
