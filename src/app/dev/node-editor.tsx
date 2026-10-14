// Dev route: the node editor with mock data (http://localhost:8092/dev/node-editor).
import { useCallback, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';

import type { EditorEdge, EditorLane, EditorNode, NodeState } from '@/domain/types';
import { NodeEditor } from '@/features/pipeline/NodeEditor';
import { fontSize, layout, palettes, radius, weight } from '@/ui/theme';
import { ThemeProvider, useTheme } from '@/ui/theme-context';

const [cyan, yellow, , slate] = palettes.device;
const [teal, pink] = palettes.plan;

const LANES: EditorLane[] = [
  { id: 'm-i9', label: 'Workstation', color: cyan, online: true, meta: 'Synced · 1 run' },
  { id: 'm-hx', label: 'Laptop', color: yellow, online: false, meta: 'Offline · 3 tasks' },
  { id: 'm-mw', label: 'Buildbox', color: slate, online: true, meta: 'Synced · idle' },
  { id: 'unassigned', label: 'Unassigned', color: null, online: null, meta: '3 tasks' },
];

const WORDS: Record<NodeState, string> = {
  done: 'Done', running: 'Running', queued: 'Queued', ready: 'Ready', waiting: 'Waiting', review: 'Review',
  failed: 'Failed', stopped: 'Stopped', offline: 'Offline', unassigned: 'Unassigned', missing: 'Missing',
};

function node(id: string, laneId: string, x: number, title: string, plan: 'rate' | 'auth' | 'backlog', state: NodeState, detail?: string): EditorNode {
  return {
    id, laneId, x, title,
    subtitle: plan === 'rate' ? 'Rate limiting' : plan === 'auth' ? 'Auth refactor' : 'Backlog',
    planColor: plan === 'rate' ? teal : plan === 'auth' ? pink : null,
    state, stateLabel: WORDS[state], detail,
  };
}

const NODES: EditorNode[] = [
  node('step:audit', 'm-i9', 0, 'Audit the current middleware stack', 'rate', 'done', 'Workstation · 17:04'),
  node('step:design', 'm-i9', 272, 'Design the token bucket limiter', 'rate', 'running', 'step 3 of 7'),
  node('step:gateway', 'm-i9', 544, 'Wire the limiter into gateway routes', 'rate', 'queued', 'after the running task'),
  node('step:release', 'm-i9', 816, 'Release candidate checklist', 'rate', 'waiting', '2 tasks to finish'),
  node('step:sessions', 'm-hx', 0, 'Migrate the session store to Postgres', 'auth', 'review', 'run ended, step not checked'),
  node('step:redis', 'm-hx', 272, 'Add a Redis backend for counters', 'rate', 'offline', 'machine unreachable'),
  node('step:keys', 'm-hx', 544, 'Rotate the signing keys', 'auth', 'failed', '3 tests red'),
  node('step:oauth', 'm-mw', 0, 'Remove the legacy OAuth callback', 'auth', 'stopped'),
  node('step:docs', 'm-mw', 272, 'Document rate limit headers', 'rate', 'ready'),
  node('step:tests', 'm-mw', 544, 'Write limiter unit tests', 'rate', 'waiting', 'needs 2 tasks'),
  node('step:old', 'm-mw', 816, 'Benchmark the old throttle', 'rate', 'missing', 'removed from the Roadmap'),
  node('backlog:3', 'unassigned', 544, 'Load test the staging cluster', 'backlog', 'unassigned'),
  node('backlog:4', 'unassigned', 816, 'Publish the changelog entry', 'backlog', 'unassigned'),
];

const LINKS: [string, string][] = [
  ['step:audit', 'step:design'], ['step:audit', 'step:redis'], ['step:design', 'step:gateway'], ['step:redis', 'step:gateway'],
  ['step:design', 'step:tests'], ['step:docs', 'step:tests'], ['step:gateway', 'step:release'], ['step:tests', 'step:release'],
  ['step:sessions', 'step:keys'], ['step:keys', 'backlog:4'], ['backlog:3', 'backlog:4'], ['step:oauth', 'step:old'],
];

const log = (...a: unknown[]) => console.log('[node-editor]', ...a);

// ?theme=light switches the palette, ?many=1 adds about 80 tasks to check performance.
function manyNodes(): { nodes: EditorNode[]; links: [string, string][] } {
  const nodes = [...NODES];
  const links = [...LINKS];
  for (let c = 1; c <= 6; c++) {
    for (const n of NODES) {
      nodes.push({ ...n, id: `${n.id}#${c}`, x: n.x + c * 1100, state: n.state === 'running' ? 'done' : n.state, stateLabel: n.state === 'running' ? 'Done' : n.stateLabel });
    }
    for (const [f, t] of LINKS) links.push([`${f}#${c}`, `${t}#${c}`]);
    links.push(['step:release' + (c > 1 ? `#${c - 1}` : ''), `step:audit#${c}`]);
  }
  return { nodes, links };
}

export default function NodeEditorDemoRoute() {
  const { theme } = useLocalSearchParams<{ theme?: string }>();
  return (
    <ThemeProvider preference={theme === 'light' ? 'light' : 'dark'}>
      <NodeEditorDemo />
    </ThemeProvider>
  );
}

function NodeEditorDemo() {
  const { colors } = useTheme();
  const { many } = useLocalSearchParams<{ many?: string }>();
  const { width } = useWindowDimensions();
  const [initial] = useState(() => (many ? manyNodes() : { nodes: NODES, links: LINKS }));
  const [nodes, setNodes] = useState(initial.nodes);
  const [links, setLinks] = useState(initial.links);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  const edges = useMemo<EditorEdge[]>(
    () => links.map(([from, to]) => ({ id: `${from}->${to}`, from, to, satisfied: nodes.find((n) => n.id === from)?.state === 'done' })),
    [links, nodes],
  );

  const lanes = useMemo(
    () => LANES.map((l) => (l.online === null ? { ...l, meta: `${nodes.filter((n) => n.laneId === l.id).length} tasks` } : l)),
    [nodes],
  );

  const onMoveNode = useCallback((id: string, laneId: string, x: number) => {
    log('onMoveNode', id, laneId, x);
    setNodes((all) =>
      all.map((n) => {
        if (n.id !== id) return n;
        const state: NodeState = laneId === 'unassigned' ? 'unassigned' : n.state === 'unassigned' ? 'waiting' : n.state;
        return { ...n, laneId, x, state, stateLabel: WORDS[state] };
      }),
    );
  }, []);

  const onConnect = useCallback((from: string, to: string) => {
    log('onConnect', from, to);
    setLinks((l) => [...l, [from, to]]);
  }, []);

  const onSelect = useCallback((id: string | null) => {
    log('onSelect', id);
    setSelectedId(id);
  }, []);

  const onSelectEdge = useCallback((id: string | null) => {
    log('onSelectEdge', id);
    setSelectedEdgeId(id);
  }, []);

  const selNode = nodes.find((n) => n.id === selectedId);
  const selEdge = edges.find((e) => e.id === selectedEdgeId);
  const title = (id: string) => nodes.find((n) => n.id === id)?.title ?? id;
  const narrow = width < layout.mobile;

  const info = selEdge
    ? `Link · ${title(selEdge.to)} waits for ${title(selEdge.from)}`
    : selNode
      ? `${selNode.title} · ${selNode.stateLabel}${selNode.laneId === 'unassigned' ? '' : ' · ' + (LANES.find((l) => l.id === selNode.laneId)?.label ?? '')} · x ${selNode.x}`
      : 'Nothing selected';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: narrow ? 44 : 40, borderBottomWidth: 1, borderBottomColor: colors.line }}>
        <Text style={{ color: colors.text, fontSize: fontSize.ui, fontWeight: weight.semi as '600' }}>Nimbus API</Text>
        <Text style={{ color: colors.faint, fontSize: fontSize.meta }}>Pipeline · {nodes.length} tasks · {edges.length} links</Text>
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          onPress={() => setReadOnly((v) => !v)}
          style={{ height: narrow ? 36 : 28, paddingHorizontal: 10, justifyContent: 'center', borderRadius: radius.control, borderWidth: 1, borderColor: colors.line }}
        >
          <Text style={{ color: colors.muted, fontSize: fontSize.meta }}>{readOnly ? 'Read only' : 'Editable'}</Text>
        </Pressable>
      </View>
      <NodeEditor
        style={{ flex: 1 }}
        lanes={lanes}
        nodes={nodes}
        edges={edges}
        selectedId={selectedId}
        selectedEdgeId={selectedEdgeId}
        onSelect={onSelect}
        onSelectEdge={onSelectEdge}
        onMoveNode={onMoveNode}
        onConnect={onConnect}
        readOnly={readOnly}
        labels={{ unassignedLane: 'Unassigned', emptyLane: 'No task on this machine', fit: 'Fit to screen', zoomIn: 'Zoom in', zoomOut: 'Zoom out' }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: narrow ? 44 : 34, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.sidebar }}>
        <Text numberOfLines={1} testID="selection" style={{ flex: 1, color: colors.muted, fontSize: fontSize.meta }}>
          {info}
        </Text>
        {selEdge ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              log('removeLink', selEdge.id);
              setLinks((l) => l.filter(([f, t]) => `${f}->${t}` !== selEdge.id));
              setSelectedEdgeId(null);
            }}
            style={{ height: narrow ? 36 : 26, paddingHorizontal: 10, justifyContent: 'center', borderRadius: radius.control, borderWidth: 1, borderColor: colors.line }}
          >
            <Text style={{ color: colors.text, fontSize: fontSize.meta }}>Remove link</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
