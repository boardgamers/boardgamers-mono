export function htmlEscape(str: string): string {
  return str.replace(/[&<]/g, (match) => {
    switch (match) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      default:
        return match;
    }
  });
}
