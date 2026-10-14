import { Reflector } from "@nestjs/core";
import { AccessOptions } from "../types/access-options";

/**
 * The only access declaration of a route: `@Access({ auth: ["jwt", "session"] })`
 * or `@Access({ public: true, reason: "..." })`, on a controller or a handler
 * (the handler's declaration replaces the controller's). `AccessGuard` reads
 * it; a route without it is denied.
 */
export const Access = Reflector.createDecorator<AccessOptions>();
