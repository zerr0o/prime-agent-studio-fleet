// Preferences: theme, language, export and import of pipelines and machines.
import { useState } from 'react';
import { Platform, ScrollView, Share, View } from 'react-native';

import { useT } from '@/i18n';
import { ScreenHeader } from '@/shell/ScreenHeader';
import { appStore, relayOrigin } from '@/state/app';
import { conductor, useFleet } from '@/state/hooks';
import { exportData, importData } from '@/state/persist';
import { Button, ButtonRow, Divider, KeyValue, Segmented, TextField, Txt, useToast } from '@/ui/components';
import { useLayoutMode } from '@/ui/layout';

function SettingsRow({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  const mode = useLayoutMode();
  return (
    <View style={{ flexDirection: mode === 'phone' ? 'column' : 'row', gap: 14, paddingVertical: 18, alignItems: mode === 'phone' ? 'stretch' : 'center' }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Txt variant="uiStrong">{title}</Txt>
        {help ? (
          <Txt variant="meta" style={{ lineHeight: 17 }}>
            {help}
          </Txt>
        ) : null}
      </View>
      <View style={{ minWidth: mode === 'phone' ? undefined : 300 }}>{children}</View>
    </View>
  );
}

export default function Settings() {
  const t = useT();
  const toast = useToast();
  const mode = useLayoutMode();
  const prefs = useFleet((state) => state.prefs);
  const [importText, setImportText] = useState('');

  const setPrefs = (patch: Partial<typeof prefs>) => appStore.setState((state) => ({ prefs: { ...state.prefs, ...patch } }));

  const doExport = async () => {
    const json = exportData(appStore.getState());
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `prime-fleet-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } else await Share.share({ message: json, title: 'Prime Fleet' });
    toast.show({ text: t('settings.exported'), tone: 'success' });
  };

  const doImport = () => {
    try {
      const result = importData(appStore.getState(), importText);
      appStore.setState({ machines: result.machines, pipelines: result.pipelines });
      setImportText('');
      toast.show({ text: t('settings.importDone', { machines: result.addedMachines, pipelines: result.pipelinesImported }), tone: 'success' });
      void conductor.refreshAll();
    } catch {
      toast.show({ text: t('settings.importFailed'), tone: 'error' });
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader crumbs={[t('settings.title')]} icon="preferences" />
      <ScrollView contentContainerStyle={{ padding: mode === 'phone' ? 16 : 27, maxWidth: 860, width: '100%', alignSelf: 'center' }}>
        <Txt variant="section" accessibilityRole="header">
          {t('settings.appearance')}
        </Txt>
        <Divider style={{ marginTop: 14 }} />
        <SettingsRow title={t('settings.theme')}>
          <Segmented
            value={prefs.theme}
            onChange={(value) => setPrefs({ theme: value as typeof prefs.theme })}
            options={[
              { key: 'dark', label: t('settings.theme.dark'), icon: 'moon' },
              { key: 'light', label: t('settings.theme.light'), icon: 'sun' },
              { key: 'system', label: t('settings.theme.system'), icon: 'monitor' },
            ]}
          />
        </SettingsRow>
        <Divider />
        <SettingsRow title={t('settings.language')}>
          <Segmented
            value={prefs.language}
            onChange={(value) => setPrefs({ language: value as typeof prefs.language })}
            options={[
              { key: 'system', label: t('settings.language.system') },
              { key: 'fr', label: 'Français' },
              { key: 'en', label: 'English' },
            ]}
          />
        </SettingsRow>

        <Txt variant="section" accessibilityRole="header" style={{ marginTop: 30 }}>
          {t('settings.data')}
        </Txt>
        <Divider style={{ marginTop: 14 }} />
        <SettingsRow title={t('settings.export')} help={t('settings.dataHelp')}>
          <ButtonRow align="end">
            <Button variant="secondary" icon="export" label={t('settings.export')} onPress={() => void doExport()} />
          </ButtonRow>
        </SettingsRow>
        <Divider />
        <View style={{ paddingVertical: 18, gap: 10 }}>
          <Txt variant="uiStrong">{t('settings.import')}</Txt>
          <TextField value={importText} onChangeText={setImportText} placeholder={t('settings.importPlaceholder')} multiline minHeight={110} mono fill="surface" />
          <ButtonRow align="end">
            <Button variant="secondary" icon="import" label={t('settings.import')} onPress={doImport} disabled={!importText.trim()} />
          </ButtonRow>
        </View>

        <Txt variant="section" accessibilityRole="header" style={{ marginTop: 30 }}>
          {t('settings.about')}
        </Txt>
        <Divider style={{ marginTop: 14, marginBottom: 18 }} />
        <KeyValue
          framed
          items={[
            { label: t('settings.version'), value: '1.0.0', mono: true },
            { label: t('settings.api'), value: 'v1', mono: true },
            ...(Platform.OS === 'web' ? [{ label: t('settings.relay'), value: relayOrigin(), mono: true }] : []),
          ]}
        />
      </ScrollView>
    </View>
  );
}
