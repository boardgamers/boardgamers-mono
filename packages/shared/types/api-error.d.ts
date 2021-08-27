export interface ApiError<T = string> {
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
  meta: any;
  user: T;
  updatedAt: Date;
}
