import { TestingModuleBuilder } from "@nestjs/testing";
import { OpenRouterAdapter } from "../src/app/providers/openrouter.adapter";
import { FakeProviderAdapter } from "../src/app/providers/fake.adapter";

// The fake itself lives in src (RX-88: the runtime LLM_PROVIDER=fake mode uses it too).
export { FakeProviderAdapter } from "../src/app/providers/fake.adapter";
export type { FakeTurn } from "../src/app/providers/fake.adapter";

/** Installs the fake in place of OpenRouterAdapter, so ProviderRouter's "openrouter" key uses it. */
export function withFakeProvider(
  builder: TestingModuleBuilder,
  fake: FakeProviderAdapter,
) {
  return builder.overrideProvider(OpenRouterAdapter).useValue(fake);
}
