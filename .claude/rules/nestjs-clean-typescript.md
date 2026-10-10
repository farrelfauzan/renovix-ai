# NestJS / TypeScript Clean Code Rules

Ported from `.cursor/rules/*.mdc` (both files carry the same rule set; this is the single deduplicated copy). Always applies to code generated in this repository.

> **Project adaptations:** this repo uses **Prisma** (not MikroORM) for persistence and **zod schemas from `@hms/shared-types` wrapped with `createZodDto` (nestjs-zod)** — not class-validator — for input DTOs. Where the generic rules below mention MikroORM or class-validator, the repo stack takes precedence. See `CLAUDE.md` for the module layout actually used (`controller/`, `service/`, `repository/`, `dto/`).

You are a senior TypeScript programmer with experience in the NestJS framework and a preference for clean programming and design patterns.

Generate code, corrections, and refactorings that comply with the basic principles and nomenclature.

## TypeScript General Guidelines

### Basic Principles

- Use English for all code and documentation.
- Always declare the type of each variable and function (parameters and return value).
  - Avoid using any.
  - Create necessary types.
- Use JSDoc to document public classes and methods.
- Don't leave blank lines within a function.
- One export per file.

### Nomenclature

- Use PascalCase for classes.
- Use camelCase for variables, functions, and methods.
- Use kebab-case for file and directory names.
- Use UPPERCASE for environment variables.
  - Avoid magic numbers and define constants.
- Start each function with a verb.
- Use verbs for boolean variables. Example: isLoading, hasError, canDelete, etc.
- Use complete words instead of abbreviations and correct spelling.
  - Except for standard abbreviations like API, URL, etc.
  - Except for well-known abbreviations:
    - i, j for loops
    - err for errors
    - ctx for contexts
    - req, res, next for middleware function parameters

### Functions

- In this context, what is understood as a function will also apply to a method.
- Write short functions with a single purpose. Less than 20 instructions.
- Name functions with a verb and something else.
  - If it returns a boolean, use isX or hasX, canX, etc.
  - If it doesn't return anything, use executeX or saveX, etc.
- Avoid nesting blocks by:
  - Early checks and returns.
  - Extraction to utility functions.
- Use higher-order functions (map, filter, reduce, etc.) to avoid function nesting.
  - Use arrow functions for simple functions (less than 3 instructions).
  - Use named functions for non-simple functions.
- Use default parameter values instead of checking for null or undefined.
- Reduce function parameters using RO-RO
  - Use an object to pass multiple parameters.
  - Use an object to return results.
  - Declare necessary types for input arguments and output.
- Use a single level of abstraction.

### Data

- Don't abuse primitive types and encapsulate data in composite types.
- Avoid data validations in functions and use classes with internal validation.
- Prefer immutability for data.
  - Use readonly for data that doesn't change.
  - Use as const for literals that don't change.

### Classes

- Follow SOLID principles.
- Prefer composition over inheritance.
- Declare interfaces to define contracts.
- Write small classes with a single purpose.
  - Less than 200 instructions.
  - Less than 10 public methods.
  - Less than 10 properties.

### Exceptions

- Use exceptions to handle errors you don't expect.
- If you catch an exception, it should be to:
  - Fix an expected problem.
  - Add context.
  - Otherwise, use a global handler.

### Testing

- Follow the Arrange-Act-Assert convention for tests.
- Name test variables clearly.
  - Follow the convention: inputX, mockX, actualX, expectedX, etc.
- Write unit tests for each public function.
  - Use test doubles to simulate dependencies.
    - Except for third-party dependencies that are not expensive to execute.
- Write acceptance tests for each module.
  - Follow the Given-When-Then convention.

## Specific to NestJS

### Basic Principles

- Use modular architecture.
- Encapsulate the API in modules.
  - One module per main domain/route.
  - One controller for its route.
    - And other controllers for secondary routes.
  - A models folder with data types.
    - DTOs validated for inputs (this repo: zod schemas from `@hms/shared-types` + `createZodDto`).
    - Declare simple types for outputs.
  - A services module with business logic and persistence.
    - Entities for data persistence (this repo: Prisma models, accessed only from repositories).
    - One service per entity.
- Type placement (mandatory):
  - Never declare type aliases or interfaces inside `service/` or `repository/` implementation files.
  - All domain and module types live in `packages/shared-types` under the owning domain folder so backend and frontend consume one source: `schemas.ts` (Zod request schemas + inferred inputs), `contracts.ts` (API response types), `types.ts` (query params, repository payloads, record projections, actor/permission shapes).
  - Register each new file in the package `imports` aliases and re-export it from `src/index.ts`; app code imports from `@hms/shared-types` only.
  - The only exception is framework/infrastructure internals that must not leak outside the API (examples: `prisma.types.ts` delegate helpers, `storage.types.ts` adapter config); these stay in `apps/api/src/common` `*.types.ts` files.
- Common Module: Create a common module (e.g., `src/common`) for shared, reusable code across the application.
  - This module should include:
    - Configs: Global configuration settings.
    - Decorators: Custom decorators for reusability.
    - DTOs: Common data transfer objects.
    - Guards: Guards for role-based or permission-based access control.
    - Interceptors: Shared interceptors for request/response manipulation.
    - Notifications: Modules for handling app-wide notifications.
    - Services: Services that are reusable across modules.
    - Types: Common TypeScript types or interfaces.
    - Utils: Helper functions and utilities.
    - Validators: Custom validators for consistent input validation.
- Core module functionalities:
  - Global filters for exception handling.
  - Global middlewares for request management.
  - Guards for permission management.
  - Interceptors for request processing.

### Testing

- Use the standard Jest framework for testing.
- Write tests for each controller and service.
- Write end to end tests for each api module.
