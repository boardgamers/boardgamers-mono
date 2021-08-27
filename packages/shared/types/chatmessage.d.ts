export interface ChatMessage<T = string> {
  _id: T;
  room: string;
  author?: T;
  data: {
    text: string;
  };
  type: "text" | "emoji" | "system";
}
