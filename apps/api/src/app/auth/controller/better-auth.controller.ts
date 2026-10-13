import { Controller, All, Req, Res, VERSION_NEUTRAL } from "@nestjs/common";
import { auth } from "../../../lib/auth";

/**
 * Forwards all /api/auth/better/* requests to Better Auth handler.
 * Version-neutral so it lives outside the /api/v1/ prefix.
 */
@Controller({ path: "auth/better", version: VERSION_NEUTRAL })
export class BetterAuthController {
  @All("*")
  async handleAuth(@Req() req: any, @Res() res: any) {
    // Build the canonical URL using API_PUBLIC_URL for production correctness
    // (Cloud Run may use internal hostnames behind the LB)
    const baseURL =
      process.env.API_PUBLIC_URL || `${req.protocol}://${req.hostname}`;
    const path = req.url; // e.g. /api/auth/better/callback/google?code=...
    const url = `${baseURL.replace(/\/+$/, "")}${path}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        headers.set(
          key,
          Array.isArray(value) ? value.join(", ") : String(value),
        );
      }
    }

    const webRequest = new Request(url, {
      method: req.method,
      headers,
      body:
        req.method !== "GET" && req.method !== "HEAD"
          ? JSON.stringify(req.body)
          : undefined,
    });

    const response = await auth.handler(webRequest);

    // Convert Web Response back to Fastify response
    res.status(response.status);

    // Handle Set-Cookie headers separately — forEach merges them into a
    // single comma-separated value which browsers cannot parse correctly.
    const setCookieHeaders = response.headers.getSetCookie();
    if (setCookieHeaders.length > 0) {
      res.header("set-cookie", setCookieHeaders);
    }
    response.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() !== "set-cookie") {
        res.header(key, value);
      }
    });

    const body = await response.text();
    res.send(body);
  }
}
