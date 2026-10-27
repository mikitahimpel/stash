/** One segment of `<SegmentedControl />`. */
export interface SegmentedControlOption<V extends string> {
  readonly value: V;
  readonly label: string;
}
