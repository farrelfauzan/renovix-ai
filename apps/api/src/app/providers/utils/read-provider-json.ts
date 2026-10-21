const NOT_JSON_MESSAGE = "The provider answered with something other than JSON";

/**
 * The JSON body of a provider's 2xx answer (RNX-190). A body that is not JSON fails with a fixed text, never with the
 * parse error, which quotes the body's first characters (D197). The name is compared, not the class: the error comes
 * from Node's fetch, whose SyntaxError is not the one of a Jest test context.
 */
export async function readProviderJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (err) {
    if ((err as Error | undefined)?.name === "SyntaxError") throw new SyntaxError(NOT_JSON_MESSAGE);
    throw err;
  }
}
