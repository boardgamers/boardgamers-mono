import marked from "marked";

export function oneLineMarked(text: string) {
  return marked(text).replace(/<\/?p>/g, "");
}
