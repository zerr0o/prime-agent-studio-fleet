import { useLocalSearchParams } from 'expo-router';

import { RunView } from '@/features/runs/RunView';

export default function RunScreen() {
  const params = useLocalSearchParams<{ key: string }>();
  return <RunView runKey={decodeURIComponent(String(params.key ?? ''))} />;
}
