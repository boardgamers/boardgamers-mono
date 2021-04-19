export function browserEvent(target: any, ...args: any[]) {
  target.addEventListener(...args);

  return () => target.removeEventListener(...args);
}
