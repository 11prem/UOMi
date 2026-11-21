/**
 * Sizes from prototype/css/app.css for the money forms that the kit's `ui/metrics` doesn't carry, kept here so the
 * route files stay literal-free. Everything else comes from the theme and `ui/metrics`.
 */
export const FORM = {
  /** `.amount-input`: the 2 px underline under the hero amount (DESIGN.md § Inputs, Amount field). */
  underline: 2,
  /** `.split-row`: min height, the per-person value box and the result column. */
  splitRow: 60,
  splitValue: 72,
  splitResult: 64,
  /** `.check`: the 24 px tick box with its 1.5 px edge. */
  check: 24,
  /** Below this many dp per unit of system text size, a split row puts its value and result on a second line (320 dp, 2× text). */
  stackBelow: 340,
} as const;
