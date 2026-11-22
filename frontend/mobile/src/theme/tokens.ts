// Values are copied from prototype/css/tokens.css (light in `:root`, dark in `:root[data-theme="dark"]`).
// DESIGN.md is the visual source of truth; tokens.test.ts checks every colour here against the CSS.

const light = {
  stage: '#D7DBE3',
  stageInk2: '#444A58',
  ground: '#EEF0F4',
  sheet: '#FFFFFF',
  sheet2: '#F6F7FA',
  dupPink: '#F2C4CE',
  dupYellow: '#F3DF73',
  dupPinkEdge: '#D99AAA',
  dupYellowEdge: '#CDB548',
  perf: '#8C92A0',
  hair: 'rgba(95, 101, 116, .22)',
  hairStrong: 'rgba(95, 101, 116, .38)',
  ink: '#1B1F2A',
  ink2: '#5F6574',
  carbon: '#23308A',
  carbonPress: '#1A246C',
  onCarbon: '#FFFFFF',
  carbonWash: 'rgba(35, 48, 138, .08)',
  owe: '#B8322A',
  owed: '#1D734A',
  pending: '#7F6200',
  controlEdge: '#767C8C',
  stampAgreed: '#23308A',
  stampRed: '#B8322A',
  badge: '#F3DF73',
  onBadge: '#1B1F2A',
  scrim: 'rgba(17, 20, 33, .44)',
  focus: '#23308A',
  skeleton: 'rgba(95, 101, 116, .12)',
  selection: 'rgba(35, 48, 138, .18)',
  m1: '#23308A',
  m2: '#9C3B5C',
  m3: '#1D6B63',
  m4: '#8A5A12',
  m5: '#5B3E99',
  m6: '#2E6E2E',
};

export type ColorToken = keyof typeof light;
export type Colors = Record<ColorToken, string>;

const dark: Colors = {
  stage: '#05070F',
  stageInk2: '#A9AFC7',
  ground: '#10142A',
  sheet: '#1A1F3D',
  sheet2: '#20264A',
  dupPink: '#6A3550',
  dupYellow: '#6E5C1C',
  dupPinkEdge: '#8E5373',
  dupYellowEdge: '#93802F',
  perf: '#7D84A6',
  hair: 'rgba(164, 170, 194, .18)',
  hairStrong: 'rgba(164, 170, 194, .32)',
  ink: '#ECEEF6',
  ink2: '#A9AFC7',
  carbon: '#A9BCFF',
  carbonPress: '#C3D0FF',
  onCarbon: '#10142A',
  carbonWash: 'rgba(169, 188, 255, .12)',
  owe: '#FF9A90',
  owed: '#7AD9A8',
  pending: '#E9CF5C',
  controlEdge: '#7D84A6',
  stampAgreed: '#A9BCFF',
  stampRed: '#FF9A90',
  badge: '#E9CF5C',
  onBadge: '#10142A',
  scrim: 'rgba(4, 6, 16, .6)',
  focus: '#A9BCFF',
  skeleton: 'rgba(169, 175, 199, .12)',
  selection: 'rgba(169, 188, 255, .28)',
  m1: '#A9BCFF',
  m2: '#F2A7C0',
  m3: '#7FD1C6',
  m4: '#E8C07A',
  m5: '#C4B0FF',
  m6: '#9AD98F',
};

export const tokens: { light: Colors; dark: Colors } = { light, dark };

/** 4 px grid: `--s1`…`--s10`. The one screen gutter is `space.s4`. */
export const space = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s8: 32, s10: 40 } as const;

export const radius = { sheet: 6, segment: 9, plateLg: 12, bottomSheet: 14, pill: 999 } as const;

/** Durations in ms, easings as cubic-bezier control points (`Easing.bezier(...motion.ease.out)`). */
export const motion = {
  ease: {
    out: [0.23, 1, 0.32, 1],
    inOut: [0.77, 0, 0.175, 1],
    drawer: [0.32, 0.72, 0, 1],
  },
  duration: { press: 120, fast: 160, base: 220, screen: 320 },
  stagger: 40,
  /** `prefers-reduced-motion: reduce` overrides from tokens.css. */
  reduced: { screen: 180, stagger: 0 },
} as const;

/** Floating-layer shadows (`--lift-*`) as RN `boxShadow` strings; flat paper never uses them. */
export const lift = {
  light: {
    lift1: '0 1px 2px rgba(27, 31, 42, .06), 0 2px 6px rgba(27, 31, 42, .05)',
    lift2: '0 6px 16px rgba(27, 31, 42, .10), 0 2px 4px rgba(27, 31, 42, .06)',
    lift3: '0 18px 40px rgba(17, 20, 33, .22), 0 4px 10px rgba(17, 20, 33, .10)',
  },
  dark: {
    lift1: '0 1px 2px rgba(0, 0, 0, .35)',
    lift2: '0 6px 16px rgba(0, 0, 0, .4)',
    lift3: '0 18px 40px rgba(0, 0, 0, .55)',
  },
} as const;
