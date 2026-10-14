import { useGlobalSearchParams } from 'expo-router';

export const projectHref = (key: string, tab = '') => `/project/${encodeURIComponent(key)}${tab ? `/${tab}` : ''}`;
export const runHref = (runKey: string) => `/run/${encodeURIComponent(runKey)}`;

/** The project key of the current route (decoded). */
export function useProjectKey() {
  const params = useGlobalSearchParams<{ key: string }>();
  return decodeURIComponent(String(params.key ?? ''));
}
