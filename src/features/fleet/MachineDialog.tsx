// Add or edit a machine: address, token, name, color. The connection is tested first.
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { isApiError } from '@/api/errors';
import type { MachineInfo } from '@/api/types';
import type { MachineConfig } from '@/domain/types';
import { useT } from '@/i18n';
import { conductor, useFleet } from '@/state/hooks';
import { Banner, Button, ButtonRow, Dialog, Swatches, TextField, Txt, useToast } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { palettes } from '@/ui/theme';
import { useTheme } from '@/ui/theme-context';
import { addressKind, normalizeAddress } from './status';

function probeErrorKey(error: unknown) {
  if (!isApiError(error)) return 'error.unknown';
  if (error.offline) return 'error.offline';
  if (error.status === 401) return 'error.unauthorized';
  if (error.status === 404 && error.code === 'api_disabled') return 'error.apiDisabled';
  if (error.code === 'api_requires_encrypted_transport') return 'error.needsEncryptedTransport';
  if (error.status === 403) return 'error.forbidden';
  if (error.code === 'incompatible') return 'error.incompatible';
  if (error.code === 'relay_target_invalid') return 'machines.invalidAddress';
  return 'error.unknown';
}

export function MachineDialog({ visible, onClose, machine }: { visible: boolean; onClose: () => void; machine?: MachineConfig }) {
  const t = useT();
  const toast = useToast();
  const { colors } = useTheme();
  const machines = useFleet((state) => state.machines);
  const tokens = useFleet((state) => state.tokens);
  const [address, setAddress] = useState('');
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [info, setInfo] = useState<MachineInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAddress(machine?.baseUrl ?? '');
    setToken('');
    setLabel(machine?.label ?? '');
    const used = new Set(machines.map((m) => m.color));
    setColor(machine?.color ?? palettes.device.find((c) => !used.has(c)) ?? palettes.device[machines.length % palettes.device.length]);
    setInfo(null);
    setError(null);
  }, [visible, machine, machines]);

  const baseUrl = normalizeAddress(address);
  const kind = baseUrl ? addressKind(baseUrl) : null;
  const effectiveToken = token.trim() || (machine ? tokens[machine.key] ?? '' : '');

  const test = async () => {
    if (!baseUrl) return setError('machines.invalidAddress');
    setTesting(true);
    setError(null);
    setInfo(null);
    try {
      const result = await conductor.probe(baseUrl, effectiveToken);
      const duplicate = machines.find((m) => m.key !== machine?.key && m.machineId === result.machineId);
      if (duplicate) setError('machines.duplicate');
      else {
        setInfo(result);
        if (!label.trim()) setLabel(result.name);
      }
      return duplicate ? null : result;
    } catch (cause) {
      setError(probeErrorKey(cause));
      return null;
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    const result = info ?? (await test());
    if (!result || !baseUrl) return;
    const config = { label: label.trim() || result.name, baseUrl, color: color ?? palettes.device[0], machineId: result.machineId };
    if (machine) {
      conductor.updateMachine(machine.key, config, token.trim() || undefined);
      toast.show({ text: t('machines.saved'), tone: 'success' });
    } else {
      conductor.addMachine(config, token.trim());
      toast.show({ text: t('machines.added'), tone: 'success' });
    }
    onClose();
  };

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      icon="machine"
      title={machine ? t('machines.editTitle', { machine: machine.label }) : t('machines.addTitle')}
      description={t('machines.addDesc')}
      closeLabel={t('common.close')}
      actions={
        <ButtonRow align="end">
          <Button variant="secondary" label={testing ? t('machines.testing') : t('machines.test')} onPress={() => void test()} disabled={testing || !baseUrl || !effectiveToken} />
          <Button variant="primary" label={machine ? t('machines.save') : t('machines.add')} onPress={() => void save()} disabled={testing || !baseUrl || !effectiveToken} />
        </ButtonRow>
      }
    >
      <View style={{ gap: 16 }}>
        <TextField
          label={t('machines.address')}
          value={address}
          onChangeText={(value) => {
            setAddress(value);
            setInfo(null);
          }}
          placeholder="https://pc.tailnet.ts.net"
          mono
          autoCapitalize="none"
          keyboardType="url"
          help={t('machines.addressHelp')}
          error={error === 'machines.invalidAddress' ? t(error) : kind === 'lan' ? t('machines.lanWarning') : undefined}
          fill="bg"
        />
        <TextField
          label={t('machines.token')}
          hint={machine ? t('machines.tokenKeep') : undefined}
          value={token}
          onChangeText={(value) => {
            setToken(value);
            setInfo(null);
          }}
          secure
          mono
          autoCapitalize="none"
          help={t('machines.tokenHelp')}
          fill="bg"
        />
        <TextField label={t('machines.label')} hint={t('machines.labelHint')} value={label} onChangeText={setLabel} placeholder={info?.name ?? 'Workstation'} fill="bg" />
        <View style={{ gap: 9 }}>
          <Txt variant="button">{t('machines.color')}</Txt>
          <Swatches colors={palettes.device} labels={['Cyan', 'Yellow', 'Fuchsia', 'Slate', 'Brown']} value={color} onChange={(value) => setColor(value ?? palettes.device[0])} />
        </View>
        {info ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={15} color={colors.green} />
            <Txt variant="ui" tone="muted" style={{ flex: 1 }}>
              {t('machines.testOk', { name: info.name, version: info.studioVersion })}
            </Txt>
          </View>
        ) : null}
        {error && error !== 'machines.invalidAddress' ? <Banner tone="error" text={t(error)} /> : null}
      </View>
    </Dialog>
  );
}
