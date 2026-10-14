// Dev only: every component of the UI kit and every icon, dark and light.
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import {
  Badge,
  Banner,
  Breadcrumb,
  Button,
  ButtonRow,
  Card,
  Checkbox,
  Count,
  Dialog,
  Disclosure,
  Divider,
  Dot,
  EmptyState,
  Header,
  IconButton,
  Kbd,
  KeyValue,
  MachineChip,
  MenuButton,
  Panel,
  PillTabs,
  Progress,
  ProgressLabel,
  Row,
  SearchBox,
  SearchField,
  Segmented,
  Select,
  SectionHeader,
  Spinner,
  StatusLabel,
  SubRow,
  Swatches,
  Switch,
  TabBar,
  Tag,
  TextField,
  ToastProvider,
  Txt,
  UnderlineTabs,
  useToast,
  type DotKind,
  type StatusTone,
} from '@/ui/components';
import { Icon, iconNames } from '@/ui/icons';
import { useLayoutMode } from '@/ui/layout';
import { palettes, layout } from '@/ui/theme';
import { ThemeProvider, useTheme, type ThemePreference } from '@/ui/theme-context';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: 34 }}>
      <Txt variant="section" style={{ marginBottom: 14 }}>
        {title}
      </Txt>
      <View style={{ gap: 18 }}>{children}</View>
    </View>
  );
}

function Demo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 9 }}>
      <Txt variant="sectionLabel">{label}</Txt>
      {children}
    </View>
  );
}

const wrap = { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 } as const;

function Gallery({ preference, onPreference }: { preference: ThemePreference; onPreference: (p: ThemePreference) => void }) {
  const { colors } = useTheme();
  const mode = useLayoutMode();
  const toast = useToast();
  const [tab, setTab] = useState('roadmap');
  const [under, setUnder] = useState('project');
  const [pill, setPill] = useState('session');
  const [text, setText] = useState('');
  const [secret, setSecret] = useState('');
  const [search, setSearch] = useState('');
  const [box, setBox] = useState('');
  const [sw, setSw] = useState(true);
  const [c1, setC1] = useState(true);
  const [c2, setC2] = useState(false);
  const [seg, setSeg] = useState('preview');
  const [swatch, setSwatch] = useState<string | null>(palettes.device[1]);
  const [sel, setSel] = useState<string | null>('laptop');
  const [expanded, setExpanded] = useState(true);
  const [activeRow, setActiveRow] = useState('rate');
  const [dialog, setDialog] = useState(false);

  const menuItems = [
    { key: 'new', label: 'New conversation', icon: 'plus' as const, onPress: () => toast.show({ text: 'Conversation created.' }) },
    { key: 'rename', label: 'Rename', icon: 'pencil' as const, detail: 'Ctrl R', onPress: () => {} },
    { key: 'pin', label: 'Pin to top', icon: 'pin' as const, checked: true, onPress: () => {} },
    { divider: true as const },
    { label: 'Move to machine', section: true as const },
    { key: 'ws', label: 'Workstation', color: palettes.device[0], onPress: () => {} },
    { key: 'lp', label: 'Laptop', color: palettes.device[1], onPress: () => {} },
    { divider: true as const },
    { key: 'del', label: 'Remove project', icon: 'trash' as const, danger: true, onPress: () => toast.show({ text: 'Could not remove the project. Reload and try again.', tone: 'error' }) },
  ];
  const selectOptions = [
    { value: 'workstation', label: 'Workstation', color: palettes.device[0], detail: '127.0.0.1:3088' },
    { value: 'laptop', label: 'Laptop', color: palettes.device[1], detail: 'laptop.tail4c2a.ts.net' },
    { value: 'build', label: 'Build server', color: palettes.device[2], detail: '100.64.0.12:3089' },
  ];
  const statuses: StatusTone[] = ['working', 'done', 'failed', 'connected', 'attention', 'running', 'muted'];
  const dots: DotKind[] = ['running', 'unread', 'connected', 'attention', 'error', 'idle'];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header
        left={<Breadcrumb items={['Prime Fleet', 'UI kit', 'Gallery']} icon="layout" />}
        actions={
          <>
            <Segmented
              style={{ width: 180 }}
              options={[
                { key: 'dark', label: 'Dark', icon: 'moon' },
                { key: 'light', label: 'Light', icon: 'sun' },
              ]}
              value={preference}
              onChange={(k) => onPreference(k as ThemePreference)}
            />
          </>
        }
      />
      <ScrollView contentContainerStyle={{ padding: mode === 'phone' ? 16 : 32, paddingBottom: 120, maxWidth: 1100, width: '100%', alignSelf: 'center' }}>
        <Txt variant="body" tone="muted">
          Every component of the Prime Fleet UI kit, in the current theme. Layout mode: {mode}.
        </Txt>

        <Section title="Typography">
          <View style={{ gap: 6 }}>
            <Txt variant="stat">42%</Txt>
            <Txt variant="section">Section title, 20 / 550</Txt>
            <Txt variant="title">Dialog title, 19 / 550</Txt>
            <Txt variant="panel">Panel title, 15 / 600</Txt>
            <Txt variant="heading">Heading, 14 / 600</Txt>
            <Txt variant="body">Body, 13 / 400 with a line height of 1.8. Messages and descriptions in panels use it.</Txt>
            <Txt variant="uiStrong">UI strong, 12 / 550</Txt>
            <Txt variant="ui">UI, 12 / 400</Txt>
            <Txt variant="button">Button, 12 / 500</Txt>
            <Txt variant="meta">Meta, 11 / 400 muted</Txt>
            <Txt variant="groupLabel">Group label, 11 / 550 faint</Txt>
            <Txt variant="caption">Caption, 10 / 400 faint</Txt>
            <Txt variant="sectionLabel">Section label</Txt>
            <Txt variant="micro">Micro, 9 / 400 faint</Txt>
            <Txt variant="mono">mono · laptop.tail4c2a.ts.net · v0.9.8</Txt>
          </View>
          <View style={wrap}>
            {(['text', 'muted', 'faint', 'accent', 'accentText', 'green', 'red', 'amber', 'blue'] as const).map((t) => (
              <Txt key={t} tone={t}>
                {t}
              </Txt>
            ))}
          </View>
        </Section>

        <Section title="Buttons">
          <Demo label="Variants">
            <ButtonRow>
              <Button label="Add a plan" variant="primary" />
              <Button label="Cancel" variant="secondary" />
              <Button label="Stop run" variant="danger" />
              <Button label="Edit" variant="text" />
              <Button label="Retry" icon="refresh" />
              <Button label="Start on Laptop" icon="play" variant="primary" />
              <Button label="Saving" loading variant="secondary" />
              <Button label="Disabled" disabled variant="secondary" />
            </ButtonRow>
          </Demo>
          <Demo label="Compact">
            <ButtonRow>
              <Button label="Pull" compact />
              <Button label="Push" compact variant="primary" icon="arrow-up" />
              <Button label="Next" compact iconRight="arrow-up-right" />
            </ButtonRow>
          </Demo>
          <Demo label="Sidebar actions (tinted, quiet)">
            <View style={{ width: Math.min(272, 240), padding: 16, backgroundColor: colors.sidebar, gap: 8, borderRadius: 4 }}>
              <Button label="Add a machine" variant="tinted" icon="plus" kbd="Ctrl N" />
              <Button label="New pipeline" variant="quiet" icon="plus" />
            </View>
          </Demo>
          <Demo label="Icon buttons (sm 23, header 28, md 32)">
            <View style={wrap}>
              <IconButton icon="plus" size="sm" accessibilityLabel="Add" />
              <IconButton icon="more" size="sm" accessibilityLabel="More actions" />
              <IconButton icon="panel" size="header" accessibilityLabel="Toggle panel" />
              <IconButton icon="roadmap" size="header" active accessibilityLabel="Roadmap" />
              <IconButton icon="refresh" accessibilityLabel="Refresh" />
              <IconButton icon="settings" active accessibilityLabel="Preferences" />
              <IconButton icon="trash" disabled accessibilityLabel="Remove" />
            </View>
          </Demo>
        </Section>

        <Section title="Status and labels">
          <Demo label="Dots">
            <View style={wrap}>
              {dots.map((d) => (
                <View key={d} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 12 }}>
                  <Dot kind={d} />
                  <Txt variant="caption">{d}</Txt>
                </View>
              ))}
              <Dot kind="running" size={5} />
              <Spinner />
            </View>
          </Demo>
          <Demo label="Status labels">
            <View style={[wrap, { gap: 18 }]}>
              {statuses.map((t) => (
                <StatusLabel key={t} tone={t} label={{ working: 'Working', done: 'Done', failed: 'Failed', connected: 'Engine connected', attention: '1 question', running: 'Running', muted: 'Offline' }[t]} />
              ))}
            </View>
          </Demo>
          <Demo label="Badge, tag, kbd, count">
            <View style={wrap}>
              <Badge label="Update available" />
              <Badge label="This address" variant="solid" />
              <Badge label="Read-only" variant="solid" icon="shield" />
              <Tag label="Local" />
              <Kbd label="Ctrl K" />
              <View style={{ width: 120, flexDirection: 'row' }}>
                <Txt variant="ui" tone="muted">
                  Runs
                </Txt>
                <Count value={4} />
              </View>
            </View>
          </Demo>
          <Divider />
        </Section>

        <Section title="Cards and key values">
          <View style={{ flexDirection: mode === 'phone' ? 'column' : 'row', gap: 12 }}>
            <Card identityColor={palettes.device[1]} style={{ flex: 1, gap: 8 }} onPress={() => toast.show({ text: 'Opened Laptop.' })} accessibilityLabel="Laptop">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <Icon name="machine" size={16} color={palettes.device[1]} />
                <Txt variant="heading" style={{ fontSize: 13, fontWeight: '700' }}>
                  Laptop
                </Txt>
                <View style={{ marginLeft: 'auto' }}>
                  <StatusLabel tone="connected" label="Connected" />
                </View>
              </View>
              <Txt variant="mono" tone="muted" style={{ fontSize: 10 }}>
                laptop.tail4c2a.ts.net
              </Txt>
              <KeyValue items={[{ label: 'Runs in progress', value: 1 }, { label: 'Projects', value: 3 }]} />
            </Card>
            <Card style={{ flex: 1 }}>
              <Txt variant="meta">A plain card without press, 13 px padding, 1 px line, radius 12.</Txt>
            </Card>
          </View>
          <KeyValue framed items={[{ label: 'Address', value: 'laptop.tail4c2a.ts.net', mono: true }, { label: 'Studio version', value: '0.9.8', mono: true }, { label: 'Token', value: '•••• 7f2a' }, { label: 'Scopes', value: 'read, runs:write' }]} />
        </Section>

        <Section title="Navigation: rows, tree, tabs">
          <View style={{ flexDirection: mode === 'phone' ? 'column' : 'row', gap: 16 }}>
            <View style={{ width: mode === 'phone' ? '100%' : 272, backgroundColor: colors.sidebar, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 4 }}>
              <SectionHeader label="Workspace" paddingHorizontal={11} actions={<><IconButton icon="archive" size="sm" accessibilityLabel="Archive" /><IconButton icon="plus" size="sm" accessibilityLabel="Add a project" /></>} />
              <Txt variant="groupLabel" style={{ marginHorizontal: 12, marginTop: 8, marginBottom: 7 }}>
                Machines
              </Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Disclosure expanded={expanded} onToggle={() => setExpanded((v) => !v)} accessibilityLabel="Expand Workstation" />
                <View style={{ flex: 1 }}>
                  <Row label="Workstation" icon="machine" iconColor={palettes.device[0]} trailing={<><Dot kind="running" /><Count value={2} style={{ marginLeft: 6 }} /></>} />
                </View>
              </View>
              {expanded ? (
                <View style={{ paddingLeft: 33, paddingTop: 1, paddingBottom: 6 }}>
                  <SubRow label="Nimbus API · Add rate limiting to the public API" active={activeRow === 'rate'} onPress={() => setActiveRow('rate')} trailing={<Dot kind="running" size={5} />} />
                  <SubRow label="Orbit Web" active={activeRow === 'orbit'} onPress={() => setActiveRow('orbit')} trailing={<Dot kind="unread" size={5} />} />
                  <SubRow label="Atlas Mobile" active={activeRow === 'atlas'} onPress={() => setActiveRow('atlas')} />
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Disclosure expanded={false} onToggle={() => {}} accessibilityLabel="Expand Laptop" />
                <View style={{ flex: 1 }}>
                  <Row label="Laptop" icon="machine" iconColor={palettes.device[1]} trailing={<Dot kind="idle" />} />
                </View>
              </View>
              <Row label="Roadmap plan with a long name that truncates before the end" dotColor={palettes.plan[0]} />
              <Row label="Docs Portal" icon="folder" iconColor={palettes.project[4]} fillIcon />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 14 }}>
              <View style={{ borderWidth: 1, borderColor: colors.line }}>
                <TabBar
                  tabs={[
                    { key: 'conv', label: 'Add rate limiting to the public API', icon: 'chat' },
                    { key: 'roadmap', label: 'Roadmap', icon: 'roadmap', count: 12 },
                    { key: 'files', label: 'Files', icon: 'files' },
                  ]}
                  activeKey={tab}
                  onChange={setTab}
                  trailing={<><IconButton icon="more" size="sm" accessibilityLabel="Tab menu" /><IconButton icon="x" size="sm" accessibilityLabel="Close" /></>}
                />
                <View style={{ height: 48, backgroundColor: colors.bg }} />
              </View>
              <UnderlineTabs tabs={[{ key: 'project', label: 'Project' }, { key: 'session', label: 'Session' }, { key: 'backlog', label: 'Backlog' }, { key: 'archived', label: 'Archived', count: 0 }]} activeKey={under} onChange={setUnder} />
              <PillTabs tabs={[{ key: 'session', label: 'Session', icon: 'session' }, { key: 'agents', label: 'Agents', icon: 'agents' }, { key: 'files', label: 'Files', icon: 'files' }]} activeKey={pill} onChange={setPill} />
            </View>
          </View>
        </Section>

        <Section title="Fields and controls">
          <View style={{ flexDirection: mode === 'phone' ? 'column' : 'row', gap: 24 }}>
            <View style={{ flex: 1, gap: 18 }}>
              <TextField label="Machine name" hint="optional" value={text} onChangeText={setText} placeholder="Workstation" help="Shown in the sidebar. The host name is the default." />
              <TextField label="Access token" value={secret} onChangeText={setSecret} secure mono placeholder="Paste a token" help="Created in Studio, Preferences, API." />
              <TextField label="Address" value="192.168.1.42:3089" onChangeText={() => {}} mono error="Studio refuses plain LAN HTTP. Use the Tailscale address." />
              <TextField label="Pipeline instructions" value="" onChangeText={() => {}} multiline placeholder="Check the Roadmap step when the task is finished." />
            </View>
            <View style={{ flex: 1, gap: 18 }}>
              <Demo label="Search field (sidebar) and search box">
                <View style={{ backgroundColor: colors.sidebar, padding: 12, borderRadius: 4 }}>
                  <SearchField value={search} onChangeText={setSearch} placeholder="Search sessions" kbd="Ctrl K" />
                </View>
                <SearchBox value={box} onChangeText={setBox} placeholder="Search models" />
              </Demo>
              <Select label="Machine" value={sel} options={selectOptions.map((o) => ({ ...o, value: o.value }))} onChange={setSel} placeholder="Choose a machine" />
              <Demo label="Switch, checkbox, segmented">
                <View style={wrap}>
                  <Switch value={sw} onValueChange={setSw} accessibilityLabel="Auto mode" />
                  <Switch value={false} onValueChange={() => {}} accessibilityLabel="Off switch" />
                  <Checkbox checked={c1} onChange={setC1} label="Questions" />
                  <Checkbox checked={c2} onChange={setC2} label="Computer Use" />
                  <Checkbox checked={c1} onChange={setC1} tone="green" label="Roadmap step" />
                  <Checkbox checked={false} indeterminate onChange={() => {}} label="Some" />
                </View>
                <Segmented options={[{ key: 'hidden', label: 'Hidden' }, { key: 'preview', label: 'Preview' }, { key: 'expanded', label: 'Expanded' }]} value={seg} onChange={setSeg} />
              </Demo>
              <Demo label="Swatches (machine colors)">
                <Swatches colors={palettes.device} value={swatch} onChange={setSwatch} defaultLabel="Default color" labels={['Cyan', 'Yellow', 'Fuchsia', 'Slate', 'Brown']} />
              </Demo>
            </View>
          </View>
        </Section>

        <Section title="Banners, toasts, dialog, menu">
          <View style={{ borderWidth: 1, borderColor: colors.line }}>
            <Banner text="Update 0.9.9 is available for this machine." actionLabel="Update" />
            <Banner tone="warning" text="The Roadmap changed on Laptop. Reload it before saving again." actionLabel="Reload" />
            <Banner tone="error" text="Laptop does not answer. Check that Studio runs and that Tailscale is connected." actionLabel="Retry" />
            <Banner tone="quiet" text="This token can read only. Ask for runs:write to send messages." />
          </View>
          <View style={wrap}>
            <Button label="Show toast" onPress={() => toast.show({ text: 'Folder color updated.' })} />
            <Button label="Show error toast" onPress={() => toast.show({ text: 'Could not reach Laptop. Retry in a moment.', tone: 'error' })} />
            <Button label="Open dialog" onPress={() => setDialog(true)} />
            <MenuButton
              accessibilityLabel="Open menu"
              renderTrigger={(isOpen) => <IconButton icon="more" size="md" active={isOpen} accessibilityLabel="More" />}
              items={menuItems}
            />
            <MenuButton
              accessibilityLabel="Machine menu"
              align="start"
              renderTrigger={(isOpen) => (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 34, paddingHorizontal: 10, borderWidth: 1, borderColor: isOpen ? colors.accent : colors.line, borderRadius: 8, backgroundColor: colors.surface }}>
                  <Icon name="machine" size={16} color={palettes.device[0]} />
                  <Txt variant="ui">Workstation</Txt>
                  <Icon name="chevron" size={12} color={colors.faint} />
                </View>
              )}
              items={menuItems}
            />
          </View>
          <Dialog
            visible={dialog}
            onClose={() => setDialog(false)}
            icon="machine"
            title="Add a machine"
            description="Paste the address and a token created in Studio, Preferences, API."
            closeLabel="Close"
            actions={
              <ButtonRow align="end">
                <Button label="Cancel" onPress={() => setDialog(false)} />
                <Button label="Add machine" variant="primary" onPress={() => { setDialog(false); toast.show({ text: 'Machine added.' }); }} />
              </ButtonRow>
            }
          >
            <View style={{ gap: 14 }}>
              <TextField label="Name" value="Laptop" onChangeText={() => {}} />
              <TextField label="Address" value="https://laptop.tail4c2a.ts.net" onChangeText={() => {}} mono help="Tailscale HTTPS or HTTP on port 3089." />
            </View>
          </Dialog>
        </Section>

        <Section title="Progress, empty state, machine, breadcrumb, panel">
          <View style={{ maxWidth: 420, gap: 14 }}>
            <ProgressLabel label="5/12 tasks checked" stat="42%" value={5 / 12} />
            <Progress value={0.7} accessibilityLabel="Sync progress" />
          </View>
          <View style={{ gap: 12 }}>
            <MachineChip name="Workstation" color={palettes.device[0]} status="connected" />
            <MachineChip name="Laptop with a very long machine name that must truncate" color={palettes.device[1]} status="running" />
            <MachineChip name="Build server" color={palettes.device[2]} status="idle" variant="dot" muted />
          </View>
          <Breadcrumb items={['Laptop', 'Nimbus API', 'Add rate limiting to the public API with a long title that truncates when the bar is narrow']} icon="folder" iconColor={palettes.project[0]} fillIcon />
          <View style={{ borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg, maxWidth: 420 }}>
            <Panel title="Roadmap" subtitle="Nimbus API" actions={<IconButton icon="sync" size="header" accessibilityLabel="Sync Roadmaps" />}>
              <Checkbox checked tone="green" label="Add the rate limit middleware" onChange={() => {}} />
              <Checkbox checked={false} tone="green" label="Expose the remaining quota headers" onChange={() => {}} />
            </Panel>
          </View>
          <View style={{ borderWidth: 1, borderColor: colors.line }}>
            <EmptyState icon="pipeline" title="No pipeline yet" text="Assign Roadmap tasks to machines and link them to run in order." actionLabel="New pipeline" onAction={() => {}} />
          </View>
        </Section>

        <Section title={`Icons (${iconNames.length})`}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {iconNames.map((n) => (
              <View key={n} style={{ width: 96, alignItems: 'center', gap: 8, paddingVertical: 12, borderWidth: 1, borderColor: colors.lineSoft, borderRadius: 7, backgroundColor: colors.surface }}>
                <Icon name={n} size={18} color={colors.text} />
                <Txt variant="micro">{n}</Txt>
              </View>
            ))}
          </View>
          <View style={wrap}>
            {[11, 13, 14, 15, 16, 18, 21].map((sz) => (
              <Icon key={sz} name="machine" size={sz} color={palettes.device[3]} />
            ))}
          </View>
        </Section>
        <Txt variant="micro" style={{ marginTop: 40 }}>
          Sidebar width {layout.sidebarWidth} · header {layout.headerHeight} · tab bar {layout.tabbarHeight}
        </Txt>
      </ScrollView>
    </View>
  );
}

export default function GalleryRoute() {
  const [preference, setPreference] = useState<ThemePreference>('dark');
  return (
    <ThemeProvider preference={preference}>
      <ToastProvider>
        <Gallery preference={preference} onPreference={setPreference} />
      </ToastProvider>
    </ThemeProvider>
  );
}
