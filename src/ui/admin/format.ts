/** Pounds to the penny, or to a hundredth of a penny below one, so that cheap calls do not all read £0.00. */
export function formatGbp(value: number): string {
  if (value > 0 && value < 0.01) return `£${value.toFixed(4)}`;
  return `£${value.toFixed(2)}`;
}
