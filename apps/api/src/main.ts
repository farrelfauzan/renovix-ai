import "dotenv/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import helmet from "@fastify/helmet";
import { resolveLlmProvider } from "./app/providers/llm-provider";
import { resolvePaymentProviderName } from "./app/payments/utils/resolve-payment-provider-name";
import { createAppLogger } from "./common/utils/create-app-logger";
import { createFastifyAdapter } from "./common/utils/create-fastify-adapter";
import { assertRequiredSecrets } from "./common/utils/assert-required-secrets";
import { handleFatalStart } from "./common/utils/handle-fatal-start";
import { buildCorsOptions } from "./common/utils/build-cors-options";
import { ConfigService } from "@nestjs/config";

async function bootstrap(): Promise<NestFastifyApplication> {
  // RX-88: refuse LLM_PROVIDER=fake in production or next to a real key, before anything starts.
  resolveLlmProvider(process.env);
  // RNX-35: refuse a missing (production) or unknown PAYMENT_PROVIDER, and the fake in production unless payments are forced off.
  resolvePaymentProviderName(process.env);
  // RX-110: refuse missing, placeholder or too-short auth and encryption secrets, before anything starts.
  assertRequiredSecrets(process.env);
  // RNX-70: outside development and test, refuse a missing or invalid CORS_ORIGIN (never every origin with credentials).
  const corsOptions = buildCorsOptions(process.env);
  // RNX-233: AppModule is loaded only now, so a throw while its modules are evaluated (e.g. lib/auth reading a secret)
  // reaches handleFatalStart (masked, one JSON line) instead of Node's raw uncaught dump. Eager: no separate chunk.
  const { AppModule } = await import(/* webpackMode: "eager" */ "./app/app.module.js");

  const isDev = process.env.NODE_ENV === "development";

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter({
      bodyLimit: isDev ? 50 * 1024 * 1024 : 1024 * 1024,
    }),
    {
      cors: corsOptions,
      // RNX-17: JSON lines (readable in development) with the request's id, route and account; secrets masked.
      logger: createAppLogger(process.env),
      rawBody: true,
    },
  );

  app.setGlobalPrefix("api");

  // Security headers
  const fastifyInstance = app.getHttpAdapter().getInstance();
  // @ts-expect-error - fastify version mismatch between @fastify/helmet and @nestjs/platform-fastify
  await fastifyInstance.register(helmet, {
    contentSecurityPolicy: false,
  });

  await fastifyInstance.register(require("@fastify/multipart"), {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB max
    },
  });

  app.enableVersioning({
    defaultVersion: "1",
    prefix: "v",
    type: 0,
  });

  // RX-170: the API no longer serves Swagger UI. The OpenAPI documents are generated from the code
  // (`bun run openapi:generate`, docs/openapi/*.json) and served by the docs-backoffice/docs-portal
  // compose services, not by the API.

  const configService = app.get(ConfigService);

  const port = configService.get<number>("PORT") || 3000;
  const host = configService.get<string>("HOST") || "0.0.0.0";

  await app.listen(port, host);
  new Logger("Bootstrap").log(`API is running on http://${host}:${port}/api`);

  return app;
}

bootstrap().catch((err) => {
  handleFatalStart({ err, env: process.env, exit: process.exit });
});
