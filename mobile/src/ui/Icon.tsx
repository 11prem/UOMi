import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

// prototype/js/app.js `P`, verbatim: one authored stroke set on a 24 × 24 grid.
const P = {
  home: '<path d="M4 10.5L12 4l8 6.5V20h-5v-6H9v6H4z"/>',
  bell: '<path d="M6 16v-5a6 6 0 0112 0v5l1.5 2h-15zM10 20.5h4"/>',
  receipt: '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2zM9 8.5h6M9 12.5h6"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0112 6c6 0 9.5 6 9.5 6a16 16 0 01-3.2 3.8M6.2 7.7A16 16 0 002.5 12S6 18 12 18c1.6 0 3-.4 4.2-1"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.9-3 3.4-4.8 6.5-4.8s5.6 1.8 6.5 4.8M16 5.2a3.5 3.5 0 010 6.6M18 14.9c1.7.6 3 2.2 3.5 4.6"/>',
  logout: '<path d="M14 4.5H6.5v15H14M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z"/>',
  lock: '<path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3"/>',
  alert: '<path d="M12 4l9 16H3zM12 10v4.5M12 17.5v.5"/>',
  wifioff: '<path d="M3 3l18 18M8.5 16.5a5 5 0 017 0M5 12.5a10 10 0 015.5-2.9M19 12.5a10 10 0 00-2.4-1.7M12 20h.01"/>',
  trip: '<path d="M2.5 13.5l19-8-5.5 15-3-6.5zM13 14l8.5-8.5"/>',
  food: '<path d="M3.5 11h17a8.5 8.5 0 01-17 0zM8 7.5c0-1.5 1-1.5 1-3M12 7.5c0-1.5 1-1.5 1-3M16 7.5c0-1.5 1-1.5 1-3"/>',
  office: '<path d="M3.5 8h17v11h-17zM9 8V5.5h6V8M3.5 12.5c5 2 12 2 17 0"/>',
  friends: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.9-3 3.4-4.8 6.5-4.8s5.6 1.8 6.5 4.8M16 5.2a3.5 3.5 0 010 6.6M18 14.9c1.7.6 3 2.2 3.5 4.6"/>',
  car: '<path d="M5 16.5v-4l2-5h10l2 5v4zM5 16.5v2h2.5v-2M16.5 16.5v2H19v-2M5 12.5h14"/>',
  party: '<path d="M4 10h16v3H4zM5.5 13v7h13v-7M12 10v10M12 10C9 10 7.5 8.8 7.5 7.3S9.5 5 12 10zM12 10c3 0 4.5-1.2 4.5-2.7S14.5 5 12 10z"/>',
  other: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  camera: '<path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  more: '<circle cx="12" cy="6" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="18" r="1.2"/>',
  swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  calendar: '<path d="M4.5 6h15v14h-15zM4.5 10h15M8.5 3.5v4M15.5 3.5v4"/>',
  bug: '<path d="M12 6.5v13M5 9h14M7 9v6a5 5 0 0010 0V9M3.5 13H7M17 13h3.5M9 6.5a3 3 0 016 0"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3M19.5 4.5v4h-4"/>',
};

export type IconName = keyof typeof P;

type Shape = { kind: 'path'; d: string } | { kind: 'circle'; cx: number; cy: number; r: number };

// Parsed once at load: the markup above only ever holds `<path d>` and `<circle cx cy r>`.
const SHAPES = Object.fromEntries(
  Object.entries(P).map(([name, markup]) => [
    name,
    [...markup.matchAll(/<(path|circle) ([^>]*?)\/>/g)].map(([, tag, attrs]): Shape => {
      const a = Object.fromEntries([...attrs.matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
      return tag === 'path' ? { kind: 'path', d: a.d } : { kind: 'circle', cx: +a.cx, cy: +a.cy, r: +a.r };
    }),
  ]),
) as Record<IconName, Shape[]>;

const SIZES = { sm: 20, md: 24, lg: 36 } as const;

/**
 * A stroked icon: 24 px at a 1.75 stroke (`sm` 20 px, `lg` 36 px at 1.5, as `svg.i` in app.css). Decorative: label the
 * control, not the icon. (No a11y props on the Svg: native Svg isn't focusable, and on web they would land on the <svg>.)
 */
export function Icon({ name, size = 'md', color }: { name: IconName; size?: keyof typeof SIZES; color?: string }) {
  const { colors } = useTheme();
  const px = SIZES[size];
  return (
    <Svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? colors.ink}
      strokeWidth={size === 'lg' ? 1.5 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {SHAPES[name].map((s, i) => (s.kind === 'path' ? <Path key={i} d={s.d} /> : <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} />))}
    </Svg>
  );
}
