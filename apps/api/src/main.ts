import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import helmet from "@fastify/helmet";
import { AppModule } from "./app/app.module";
import { resolveLlmProvider } from "./app/providers/llm-provider";
import { ConfigService } from "@nestjs/config";
import * as yaml from "js-yaml";
import { readFileSync } from "fs";
import { join } from "path";

async function bootstrap(): Promise<NestFastifyApplication> {
  // RX-88: refuse LLM_PROVIDER=fake in production or next to a real key, before anything starts.
  resolveLlmProvider(process.env);

  const isDev = process.env.NODE_ENV === "development";
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : true;

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: isDev ? 50 * 1024 * 1024 : 1024 * 1024,
    }),
    {
      cors: {
        origin: isDev ? true : corsOrigins,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Portal-Session"],
        credentials: true,
      },
      logger: isDev
        ? ["debug", "error", "warn", "verbose", "log"]
        : ["error", "warn"],
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

  // Setup Swagger UI from openapi.yaml
  const openapiPath = join(__dirname, "assets", "openapi.yaml");
  const openapiDocument = yaml.load(
    readFileSync(openapiPath, "utf8"),
  ) as Record<string, unknown>;

  await fastifyInstance.register(require("@fastify/swagger"), {
    mode: "static",
    specification: {
      document: openapiDocument,
    },
  });
  await fastifyInstance.register(require("@fastify/swagger-ui"), {
    routePrefix: "/api-docs",
  });

  const configService = app.get(ConfigService);

  const port = configService.get<number>("PORT") || 3000;
  const host = configService.get<string>("HOST") || "0.0.0.0";

  await app.listen(port, host);
  console.log(`API is running on http://${host}:${port}/api`);

  return app;
}

bootstrap().catch((err) => {
  console.error("Error starting API:", err);
  process.exit(1);
});
