import { RequestMethod, Type } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import {
  MetadataScanner,
  ModulesContainer,
  NestFactory,
  Reflector,
} from "@nestjs/core";
import { Access } from "../common/decorators/access.decorator";
import { AccessOptions } from "../common/types/access-options";

// RX-114 coverage: the route table of the real AppModule, as Nest's own
// scanner sees it (preview mode: every module reachable from AppModule is
// scanned, dynamic modules included, and nothing is instantiated, so no
// database or secret is needed). marked is ESM-only.
// Not read: a route registered on the Fastify instance outside a Nest
// controller (main.ts: the Swagger UI under /api-docs).
jest.mock("marked", () => ({}));
// AppModule is required, not imported: an import would put every file of the
// app into the spec type program (tsconfig.spec.json), which then reports the
// app's own type errors a second time; `tsc -p tsconfig.app.json` reports them.
const { AppModule }: { AppModule: Type<unknown> } = require("./app.module");

type Route = {
  readonly label: string;
  readonly access: AccessOptions | undefined;
  readonly usesGuards: boolean;
};

const hasGuards = (target: object): boolean =>
  (Reflect.getMetadata(GUARDS_METADATA, target) ?? []).length > 0;

function listRoutes(modules: ModulesContainer): Route[] {
  const reflector = new Reflector();
  const scanner = new MetadataScanner();
  const routes: Route[] = [];
  for (const moduleRef of modules.values()) {
    for (const { metatype } of moduleRef.controllers.values()) {
      const controller = metatype as new (...args: never[]) => object;
      for (const name of scanner.getAllMethodNames(controller.prototype)) {
        const handler: () => unknown = controller.prototype[name];
        const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        const path = [controller, handler]
          .map((target): string => Reflect.getMetadata(PATH_METADATA, target))
          .filter((part) => part !== "/")
          .join("/");
        routes.push({
          label: `${RequestMethod[method]} /${path} (${controller.name}.${name})`,
          access: reflector.getAllAndOverride(Access, [handler, controller]),
          usesGuards: hasGuards(controller) || hasGuards(handler),
        });
      }
    }
  }
  return routes;
}

describe("RX-114: every route of AppModule declares its access", () => {
  let routes: Route[];

  beforeAll(async () => {
    const context = await NestFactory.createApplicationContext(AppModule, {
      preview: true,
      logger: false,
    });
    routes = listRoutes(context.get(ModulesContainer));
    await context.close();
    process.stdout.write(`RX-114 coverage: ${routes.length} routes looked at\n`);
  });

  const labels = (found: Route[]) => found.map((route) => route.label).sort();

  it("looks at the real route table (it is not empty)", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it("every route has @Access, on the handler or on its controller", () => {
    expect(labels(routes.filter((route) => !route.access))).toEqual([]);
  });

  it("every public route gives a reason", () => {
    const withoutReason = routes.filter(
      ({ access }) => access?.public && !(typeof access.reason === "string" && access.reason.trim()),
    );

    expect(labels(withoutReason)).toEqual([]);
  });

  // Any @UseGuards fails: access is declared with @Access and checked by the
  // one global AccessGuard, so no controller needs a guard of its own.
  it("no controller or route uses @UseGuards", () => {
    expect(labels(routes.filter((route) => route.usesGuards))).toEqual([]);
  });
});
