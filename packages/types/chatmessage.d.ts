export interface ChatMessage<T = string> {
  _id: T;
  room: string;
  author?: {
    _id: T;
    name: string;
  };
  data: {
    text: string;
  };
  type: "text" | "emoji" | "system";
}
