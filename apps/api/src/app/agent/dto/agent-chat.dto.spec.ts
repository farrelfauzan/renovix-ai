import { AttachIntegrationSchema, AttachToolSchema, DeployChannelSchema } from "./agent-chat.dto";

describe("AttachToolSchema config record", () => {
  it("accepts an object config with values of any type and returns it unchanged", () => {
    // Arrange
    const inputConfig = { url: "https://example.com", retries: 3, nested: { enabled: true } };
    const inputBody = { toolType: "web_search", config: inputConfig };
    const expectedResult = { success: true, data: { toolType: "web_search", config: inputConfig, enabled: true } };

    // Act
    const actualResult = AttachToolSchema.safeParse(inputBody);

    // Assert
    expect(actualResult).toEqual(expectedResult);
  });

  it("accepts a missing config", () => {
    // Arrange
    const inputBody = { toolType: "calculator" };

    // Act
    const actualResult = AttachToolSchema.safeParse(inputBody);

    // Assert
    expect(actualResult).toEqual({ success: true, data: { toolType: "calculator", enabled: true } });
  });

  it("rejects a config that is an array or a string", () => {
    // Arrange
    const inputArrayBody = { toolType: "calculator", config: ["not", "an", "object"] };
    const inputStringBody = { toolType: "calculator", config: "not-an-object" };

    // Act
    const actualArrayResult = AttachToolSchema.safeParse(inputArrayBody);
    const actualStringResult = AttachToolSchema.safeParse(inputStringBody);

    // Assert
    expect(actualArrayResult.success).toBe(false);
    expect(actualStringResult.success).toBe(false);
  });
});

describe("AttachIntegrationSchema config record", () => {
  it("accepts an object config with values of any type and returns it unchanged", () => {
    // Arrange
    const inputConfig = { workspace: "acme", limit: 50, flags: [true, false] };
    const inputBody = { provider: "github", config: inputConfig, scopes: ["repo"] };
    const expectedResult = { success: true, data: { provider: "github", config: inputConfig, scopes: ["repo"] } };

    // Act
    const actualResult = AttachIntegrationSchema.safeParse(inputBody);

    // Assert
    expect(actualResult).toEqual(expectedResult);
  });

  it("rejects a missing config and a config that is a string", () => {
    // Arrange
    const inputMissingBody = { provider: "github", scopes: ["repo"] };
    const inputStringBody = { provider: "github", config: "not-an-object", scopes: ["repo"] };

    // Act
    const actualMissingResult = AttachIntegrationSchema.safeParse(inputMissingBody);
    const actualStringResult = AttachIntegrationSchema.safeParse(inputStringBody);

    // Assert
    expect(actualMissingResult.success).toBe(false);
    expect(actualStringResult.success).toBe(false);
  });
});

describe("DeployChannelSchema config record", () => {
  it("accepts an api channel with an object config and returns it unchanged", () => {
    // Arrange
    const inputConfig = { label: "public", maxRequests: 100 };
    const inputBody = { channelType: "api", config: inputConfig };
    const expectedResult = { success: true, data: { channelType: "api", config: inputConfig } };

    // Act
    const actualResult = DeployChannelSchema.safeParse(inputBody);

    // Assert
    expect(actualResult).toEqual(expectedResult);
  });

  it("rejects an api channel whose config is an array", () => {
    // Arrange
    const inputBody = { channelType: "api", config: [1, 2, 3] };

    // Act
    const actualResult = DeployChannelSchema.safeParse(inputBody);

    // Assert
    expect(actualResult.success).toBe(false);
  });
});
