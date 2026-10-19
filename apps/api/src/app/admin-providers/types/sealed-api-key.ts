/** A provider key as stored (RX-177): base64(iv || tag || ciphertext) and the version of the key that sealed it. */
export type SealedApiKey = {
  readonly ciphertext: string;
  readonly keyVersion: number;
};
