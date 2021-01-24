export interface ChatMessage<T = string> {
  room: string;
  author?: T;
  data: {
    text: string;
  };
  type: "text" | "emoji" | "system";
}
