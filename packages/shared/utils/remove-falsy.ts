type NonFalsy<T> = T extends false
  ? never
  : T extends null
  ? never
  : T extends undefined
  ? never
  : T extends ""
  ? never
  : T extends 0
  ? never
  : T;

export function removeFalsy<T>(x: T[]) {
  return x.filter(Boolean) as NonFalsy<T>[];
}
