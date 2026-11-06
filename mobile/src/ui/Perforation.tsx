import Svg, { Line } from 'react-native-svg';
import { size } from './metrics';

/**
 * The 2 px dashed top edge of an original bill (and of each duplicate, in its edge colour). Drawn with SVG because
 * React Native can't dash one side of a border on Android.
 */
export function Perforation({ color }: { color: string }) {
  return (
    <Svg height={size.perf} width="100%" style={{ position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'none' }}>
      <Line x1="0" y1={size.perf / 2} x2="100%" y2={size.perf / 2} stroke={color} strokeWidth={size.perf} strokeDasharray="6 4" />
    </Svg>
  );
}
