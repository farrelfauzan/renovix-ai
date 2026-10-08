import { testDatabaseUrl } from "./test-database";

describe("RX-8: test database safety rule", () => {
  const original = process.env.TEST_DATABASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = original;
  });

  it("refuses a database whose name does not end in _test", () => {
    process.env.TEST_DATABASE_URL = "postgresql://u:p@localhost:5432/performa_ai";
    expect(() => testDatabaseUrl()).toThrow(/Refusing to use database "performa_ai"/);
  });

  it("refuses when TEST_DATABASE_URL is not set", () => {
    delete process.env.TEST_DATABASE_URL;
    expect(() => testDatabaseUrl()).toThrow(/TEST_DATABASE_URL is not set/);
  });

  it("accepts a *_test database", () => {
    process.env.TEST_DATABASE_URL = "postgresql://u:p@localhost:55432/renovix_test";
    expect(testDatabaseUrl()).toBe("postgresql://u:p@localhost:55432/renovix_test");
  });
});
