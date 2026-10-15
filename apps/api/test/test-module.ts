import { ModuleMetadata } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test, TestingModule, TestingModuleBuilder } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AdminNotificationRepository } from "../src/app/admin-auth/repository/admin-notification.repository";
import { AdminPiiGrantRepository } from "../src/app/admin-auth/repository/admin-pii-grant.repository";
import { AdminRecoveryCodeRepository } from "../src/app/admin-auth/repository/admin-recovery-code.repository";
import { AdminRoleRepository } from "../src/app/admin-auth/repository/admin-role.repository";
import { AdminSessionRepository } from "../src/app/admin-auth/repository/admin-session.repository";
import { AdminUserRepository } from "../src/app/admin-auth/repository/admin-user.repository";
import { CodesRepository } from "../src/app/codes/repository/codes.repository";
import { CatalogChangeRepository } from "../src/app/offers/repository/catalog-change.repository";
import { CompanyContractRepository } from "../src/app/offers/repository/company-contract.repository";
import { EnterpriseBundleRepository } from "../src/app/offers/repository/enterprise-bundle.repository";
import { PackageRepository } from "../src/app/offers/repository/package.repository";
import { PlatformSettingRepository } from "../src/app/offers/repository/platform-setting.repository";
import { PurchaseSnapshotRepository } from "../src/app/offers/repository/purchase-snapshot.repository";
import { TopUpPackRepository } from "../src/app/offers/repository/top-up-pack.repository";
import { PrismaModule } from "../src/app/prisma/prisma.module";
import { PrismaService } from "../src/app/prisma/prisma.service";
import { AccessModule } from "../src/common/access.module";
import { AccessGuard } from "../src/common/guards/access.guard";
import { testDatabaseUrl } from "./test-database";

/** Every repository of the API: a new repository is added here, so a test lists only the service it tests. */
const REPOSITORIES = [
  CodesRepository,
  AdminUserRepository,
  AdminSessionRepository,
  AdminRecoveryCodeRepository,
  AdminNotificationRepository,
  AdminRoleRepository,
  AdminPiiGrantRepository,
  PackageRepository,
  TopUpPackRepository,
  EnterpriseBundleRepository,
  CompanyContractRepository,
  PurchaseSnapshotRepository,
  PlatformSettingRepository,
  CatalogChangeRepository,
];

/**
 * Builds a Nest testing module with the real PrismaService on the test
 * database, every repository and the global AccessGuard, registered the way
 * AppModule does it (a route without `@Access` answers 403). `override` gets the builder for
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
      imports: [PrismaModule, AccessModule, ...(metadata.imports ?? [])],
      providers: [
        ...REPOSITORIES,
        { provide: APP_GUARD, useExisting: AccessGuard },
        ...(metadata.providers ?? []),
      ],
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
