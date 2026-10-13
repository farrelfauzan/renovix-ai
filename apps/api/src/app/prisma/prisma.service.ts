import { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@generated/prisma/client.js";

/** Per model: the condition a row must meet to be returned by a read that does not say otherwise. */
type VisibleOnly = Partial<Record<Prisma.ModelName, Record<string, unknown>>>;

/** The models that hide rows by default. Empty: RX-124 adds the first ones. */
const VISIBLE_ONLY: VisibleOnly = {};

/** The top-level reads the default condition is added to (not nested reads, `_count`, relation filters, raw SQL or writes). */
const FILTERED_READS: readonly string[] = [
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
];

/**
 * Query extension that adds a model's default condition to the `where` of its top-level reads,
 * outside and inside `$transaction`. A condition the caller writes on the same column wins.
 */
function hideByDefault(visibleOnly: VisibleOnly) {
  return Prisma.defineExtension({
    name: "hide-by-default",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const condition = visibleOnly[model];
          if (!condition || !FILTERED_READS.includes(operation)) return query(args);
          const where = (args as { where?: object }).where;
          return query({ ...args, where: { ...condition, ...where } } as typeof args);
        },
      },
    },
  });
}

/**
 * The database client, as injection token and type. It is never constructed: PrismaModule provides
 * the client that `create()` builds, which carries the default filter. `$on` does not exist on it.
 */
export abstract class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * Builds the client with the default filter and the two lifecycle hooks below.
   * `visibleOnly` is a parameter only so a test can put a model on the map.
   */
  static create(visibleOnly: VisibleOnly = VISIBLE_ONLY): PrismaService {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });
    return new PrismaClient({ adapter })
      .$extends(hideByDefault(visibleOnly))
      .$extends({
        client: {
          onModuleInit: this.prototype.onModuleInit,
          onModuleDestroy: this.prototype.onModuleDestroy,
        },
      }) as unknown as PrismaService;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
