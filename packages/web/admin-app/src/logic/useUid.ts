let id = 0;

export function useUid() {
  return `component-${id++}`;
}
