/**
 * Remove starting emoji from game label
 */
export function gameLabel(label: string): string {
  return label.trim().slice(label.trim().indexOf(" ") + 1);
}
