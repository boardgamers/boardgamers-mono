export interface ApiError<T = string> {
  _id: T;

  error: {
    name: string;
    message: string;
    stack: string[];
  };
  request: {
    url: string;
    method: string;
    /**
     * Stringified content because mongodb doesn't support dots in keys
     */
    body: string;
  };
  meta: unknown;
  user: T;

  createdAt: Date;
  updatedAt: Date;
}
