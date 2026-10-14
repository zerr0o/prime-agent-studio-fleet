import { describe, expect, it } from 'vitest';

import { formatTime, translate } from '../src/i18n/core';

describe('i18n without Intl.PluralRules (Hermes)', () => {
  it('chooses singular and plural forms', () => {
    expect(translate('fr', 'home.machinesCount', { count: 0 })).toBe('0 machine');
    expect(translate('fr', 'home.machinesCount', { count: 1 })).toBe('1 machine');
    expect(translate('fr', 'home.machinesCount', { count: 3 })).toBe('3 machines');
    expect(translate('en', 'home.machinesCount', { count: 1 })).toBe('1 machine');
    expect(translate('en', 'home.machinesCount', { count: 0 })).toBe('0 machines');
  });
  it('formats times and dates by hand', () => {
    const today = new Date();
    today.setHours(17, 4, 0, 0);
    expect(formatTime('fr', today.getTime())).toBe('17:04');
    expect(formatTime('en', today.getTime())).toBe('05:04 PM');
    expect(formatTime('en', '2020-10-13T12:00:00')).toBe('Oct 13');
    expect(formatTime('fr', '2020-10-13T12:00:00')).toBe('13\u00a0oct.');
  });
});
