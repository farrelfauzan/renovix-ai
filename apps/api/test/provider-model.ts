import { randomUUID } from "node:crypto";
import type { Prisma } from "@generated/prisma/client.js";
import type { PrismaService } from "../src/app/prisma/prisma.service";
import type { ModelConnection } from "../src/app/providers/types/model-connection";
import { seedAdminRoles } from "./admin-auth";
import { createModel, createProvider } from "./factories";

/**
 * RX-178: a model a chat call resolves: an active provider record (created by a fresh admin) and one model on it,
 * through the createProvider and createModel factories. `provider` overrides the record's fields (e.g. `baseUrl` of a
 * stub, `apiKey`, `status`); any other field overrides the model's (e.g. `slug`, `tier`; not its legacy `provider`
 * column, which nothing reads for routing any more). Call
 * `ModelRegistryService.refresh()` afterwards so the registry sees it.
 */
export async function createResolvableModel(
  prisma: PrismaService,
  {
    provider = {},
    ...model
  }: Partial<Omit<Prisma.AiModelUncheckedCreateInput, "provider">> & {
    provider?: Partial<Prisma.ProviderUncheckedCreateInput> & { apiKey?: string };
  } = {},
) {
  await seedAdminRoles(prisma);
  const admin = await prisma.adminUser.create({
    data: { email: `admin-${randomUUID().slice(0, 8)}@test.local`, passwordHash: "not-a-password-hash", role: "operations" },
  });
  const record = await createProvider(prisma, { createdByAdminId: admin.id, status: "active", ...provider });
  const aiModel = await createModel(prisma, { providerRecordId: record.id, ...model });
  return { admin, provider: record, model: aiModel };
}

/** A connection for unit tests that call the adapter or router directly (no registry): a `*.invalid` host unless given. */
export const testConnection = (overrides: Partial<ModelConnection> = {}): ModelConnection => ({
  slug: "fake/test-model",
  baseUrl: "http://provider-under-test.invalid/v1",
  apiKey: "fake-connection-key",
  providerName: "provider-under-test",
  ...overrides,
});
