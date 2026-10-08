import { ModuleMetadata } from "@nestjs/common";
import { Test, TestingModule, TestingModuleBuilder } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { PrismaModule } from "../src/app/prisma/prisma.module";
import { PrismaService } from "../src/app/prisma/prisma.service";
import { testDatabaseUrl } from "./test-database";

/**
 * Builds a Nest testing module with the real PrismaService on the test
 * database. `override` gets the builder for overrideProvider/overrideGuard
 * (e.g. `withFakeProvider`). Close it with `moduleRef.close()` in afterAll.
 */
export async function createTestModule(
  metadata: ModuleMetadata,
  override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
) {
  testDatabaseUrl(); // fails with a hint when the test database is not configured
  const moduleRef = await override(
    Test.createTestingModule({
      ...metadata,
      imports: [PrismaModule, ...(metadata.imports ?? [])],
    }),
  ).compile();
  return { moduleRef, prisma: moduleRef.get(PrismaService) };
}

/** Starts the module as a Fastify app for `app.inject(...)`. Close with `app.close()`. */
export async function createFastifyApp(moduleRef: TestingModule) {
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
