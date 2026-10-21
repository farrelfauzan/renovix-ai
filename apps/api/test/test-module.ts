import { ModuleMetadata } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { Test, TestingModule, TestingModuleBuilder } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AdminAuditModule } from "../src/app/admin-auth/admin-audit.module";
import { AdminAuditInterceptor } from "../src/app/admin-auth/interceptor/admin-audit.interceptor";
import { ModelCallCostsModule } from "../src/app/model-call-costs/model-call-costs.module";
import { PrismaModule } from "../src/app/prisma/prisma.module";
import { PrismaService } from "../src/app/prisma/prisma.service";
import { RepositoriesModule } from "../src/app/prisma/repositories.module";
import { AccessModule } from "../src/common/access.module";
import { GlobalExceptionFilter } from "../src/common/filters/global-exception.filter";
import { AccessGuard } from "../src/common/guards/access.guard";
import { AdminOriginGuard } from "../src/common/guards/admin-origin.guard";
import { createFastifyAdapter } from "../src/common/utils/create-fastify-adapter";
import { testDatabaseUrl } from "./test-database";

/**
 * Builds a Nest testing module with the real PrismaService on the test
 * database, every repository (RepositoriesModule, as in AppModule), the global
 * AdminOriginGuard (RX-156: an /admin route answers only the back-office
 * Origin), the global AccessGuard (a route
 * without `@Access` answers 403) and the global back-office audit hook
 * (RX-97) and the global exception filter (RNX-171), registered the way AppModule does it, and the global
 * ModelCallCostsModule (RNX-162: CreditService writes each call's model_call_costs row through it). `override` gets the builder for
 * overrideProvider/overrideGuard (e.g. `withFakeProvider`). Close it with
 * `moduleRef.close()` in afterAll.
 */
export async function createTestModule(
  metadata: ModuleMetadata,
  override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
) {
  testDatabaseUrl(); // fails with a hint when the test database is not configured
  const moduleRef = await override(
    Test.createTestingModule({
      ...metadata,
      imports: [PrismaModule, RepositoriesModule, AccessModule, AdminAuditModule, ModelCallCostsModule, ...(metadata.imports ?? [])],
      providers: [
        { provide: APP_GUARD, useExisting: AdminOriginGuard },
        { provide: APP_GUARD, useExisting: AccessGuard },
        { provide: APP_INTERCEPTOR, useExisting: AdminAuditInterceptor },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        ...(metadata.providers ?? []),
      ],
    }),
  ).compile();
  return { moduleRef, prisma: moduleRef.get(PrismaService) };
}

/** Starts the module as a Fastify app for `app.inject(...)`. Close with `app.close()`. */
export async function createFastifyApp(moduleRef: TestingModule) {
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter(),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
