import { isGoogleProvider } from "./is-google-provider";

describe("RX-131: isGoogleProvider (a provider name starting with 'google-')", () => {
  it.each([
    { name: "google drive", provider: "google-drive", expected: true },
    { name: "only the prefix", provider: "google-", expected: true },
    { name: "google without a dash", provider: "google", expected: false },
    { name: "upper case", provider: "Google-drive", expected: false },
    { name: "google inside the name", provider: "my-google-x", expected: false },
    { name: "github", provider: "github", expected: false },
  ])("$name: '$provider' -> $expected", ({ provider, expected }) => {
    const actual = isGoogleProvider(provider);

    expect(actual).toBe(expected);
  });
});
