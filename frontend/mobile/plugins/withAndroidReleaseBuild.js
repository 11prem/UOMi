// Makes `expo prebuild` emit the fixes a Windows release build needs (LongPathsEnabled=0, ninja 1.10.2):
//  1. CMake hashes object paths longer than 240 chars (the Android toolchain leaves the limit at 1000).
//  2. All three ABIs are built, so one APK runs on phones and on x86_64 emulators.
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const ARCH_KEY = 'reactNativeArchitectures';
const ARCH_VALUE = 'armeabi-v7a,arm64-v8a,x86_64';

function addCmakeObjectPathMax(gradleText) {
  if (gradleText.includes('CMAKE_OBJECT_PATH_MAX')) return gradleText;
  const m = /^([ \t]*)defaultConfig[ \t]*\{[ \t]*(\r?\n)/m.exec(gradleText);
  if (!m) throw new Error('withAndroidReleaseBuild: no "defaultConfig {" block found in app/build.gradle');
  const [line, indent, eol] = m;
  const i = indent + '    ';
  const block = [
    `${i}externalNativeBuild {`,
    `${i}    cmake {`,
    `${i}        arguments "-DCMAKE_OBJECT_PATH_MAX=240"`,
    `${i}    }`,
    `${i}}`,
  ].join(eol) + eol;
  const end = m.index + line.length;
  return gradleText.slice(0, end) + block + gradleText.slice(end);
}

function setArchitectures(items) {
  const wanted = { type: 'property', key: ARCH_KEY, value: ARCH_VALUE };
  const at = items.findIndex((i) => i.type === 'property' && i.key === ARCH_KEY);
  if (at === -1) return [...items, wanted];
  return items.map((item, idx) => (idx === at ? wanted : item));
}

const withAndroidReleaseBuild = (config) => {
  config = withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = addCmakeObjectPathMax(cfg.modResults.contents);
    return cfg;
  });
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = setArchitectures(cfg.modResults);
    return cfg;
  });
};

module.exports = withAndroidReleaseBuild;
module.exports.addCmakeObjectPathMax = addCmakeObjectPathMax;
module.exports.setArchitectures = setArchitectures;
