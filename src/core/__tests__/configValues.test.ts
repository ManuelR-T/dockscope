import { describe, expect, it } from 'vitest';
import {
  PluginConfigError,
  validatePluginConfigValues,
  type PluginConfigFieldType,
} from '../plugin-contract/config';

describe('config value validators', () => {
  it.each<[PluginConfigFieldType, unknown, boolean]>([
    ['string', '', true],
    ['string', 1, false],
    ['string', null, false],
    ['number', 0, true],
    ['number', -1.5, true],
    ['number', NaN, false],
    ['number', Infinity, false],
    ['number', '1', false],
    ['boolean', false, true],
    ['boolean', true, true],
    ['boolean', 'false', false],
    ['select', 'known', true],
    ['select', 'unknown', false],
    ['select', 1, false],
  ])('validates %s value %s (accepted=%s)', (type, value, accepted) => {
    const schema = {
      fields: [
        { key: 'value', label: 'Value', type, options: [{ label: 'Known', value: 'known' }] },
      ],
    };
    const validate = () => validatePluginConfigValues({ value }, schema);
    if (accepted) {
      expect(validate()).toEqual({ value });
    } else {
      expect(validate).toThrow(PluginConfigError);
    }
  });

  it.each(['constructor', '__proto__', 'toString', 'unknown'])(
    'rejects unsupported type %s even on an unvalidated schema',
    (type) => {
      expect(() =>
        validatePluginConfigValues(
          { value: 'text' },
          { fields: [{ key: 'value', label: 'Value', type: type as PluginConfigFieldType }] },
        ),
      ).toThrow(PluginConfigError);
    },
  );
});
