/** @jest-environment node */
const {
  addCmakeObjectPathMax,
  setArchitectures,
} = require('../withAndroidReleaseBuild');

const ARG = 'arguments "-DCMAKE_OBJECT_PATH_MAX=240"';
const count = (text, needle) => text.split(needle).length - 1;

const GRADLE = [
  'android {',
  '    namespace \'com.uomi.app\'',
  '    defaultConfig {',
  '        applicationId \'com.uomi.app\'',
  '        versionName "0.1.0"',
  '    }',
  '}',
  '',
].join('\n');

describe('addCmakeObjectPathMax', () => {
  it('inserts the cmake argument once, inside defaultConfig', () => {
    const out = addCmakeObjectPathMax(GRADLE);
    expect(count(out, ARG)).toBe(1);
    const inDefaultConfig = out.slice(out.indexOf('defaultConfig {'), out.indexOf('    }\n}'));
    expect(inDefaultConfig).toContain('externalNativeBuild {');
    expect(inDefaultConfig).toContain(ARG);
    expect(out).toContain("applicationId 'com.uomi.app'");
  });

  it('is idempotent on a second run', () => {
    const once = addCmakeObjectPathMax(GRADLE);
    expect(addCmakeObjectPathMax(once)).toBe(once);
  });

  it('handles CRLF line endings', () => {
    const out = addCmakeObjectPathMax(GRADLE.replace(/\n/g, '\r\n'));
    expect(count(out, ARG)).toBe(1);
  });

  it('fails loudly when there is no defaultConfig block', () => {
    expect(() => addCmakeObjectPathMax('android {\n}\n')).toThrow(/defaultConfig/);
  });
});

describe('setArchitectures', () => {
  const WANTED = { type: 'property', key: 'reactNativeArchitectures', value: 'armeabi-v7a,arm64-v8a,x86_64' };

  it('replaces the existing key in place', () => {
    const items = [
      { type: 'comment', value: 'archs' },
      { type: 'property', key: 'reactNativeArchitectures', value: 'arm64-v8a' },
      { type: 'property', key: 'newArchEnabled', value: 'true' },
    ];
    const out = setArchitectures(items);
    expect(out.filter((i) => i.key === 'reactNativeArchitectures')).toEqual([WANTED]);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual(items[2]);
  });

  it('adds the key when missing', () => {
    const out = setArchitectures([{ type: 'property', key: 'newArchEnabled', value: 'true' }]);
    expect(out).toContainEqual(WANTED);
    expect(out).toHaveLength(2);
  });

  it('is idempotent', () => {
    const once = setArchitectures([]);
    expect(setArchitectures(once)).toEqual(once);
  });
});
