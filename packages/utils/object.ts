export function typedInclude<V, T extends V>(arr: readonly T[], v: V): v is T {
  return arr.includes(v as T);
}

export function pick<T, K extends keyof T>(o: T, props: K[] | readonly K[]): Pick<T, K> {
  return Object.assign(
    {},
    ...props.map((prop) => {
      if (o[prop] !== undefined) {
        return { [prop]: o[prop] };
      }
    }),
  );
}

export function omit<T extends Record<string, unknown>, K extends keyof T>(
  o: T,
  ...props: K[]
): Pick<T, Exclude<keyof T, K>> {
  const letsKeep = (Object.keys(o) as (keyof T)[]).filter((prop) => !typedInclude(props, prop));
  return pick(o, letsKeep);
}
