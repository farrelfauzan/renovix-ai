/** A recorded AutoGoPay answer in the documented envelope (RNX-273): the HTTP status and `{ success, message, data }`. */
export type AutoGoPayEnvelopedAnswer<T> = {
  readonly status: number;
  readonly body: { readonly success: boolean; readonly message: string; readonly data: T };
};
