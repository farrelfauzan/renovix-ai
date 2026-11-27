import { ChatCompletionRequestSchema } from "./chat-completion.dto";

describe("ChatCompletionRequestSchema json_schema response_format schema record", () => {
  it("accepts a JSON schema object with nested values and returns it unchanged", () => {
    // Arrange
    const inputSchema = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };
    const inputBody = {
      model: "test-model",
      messages: [{ role: "user", content: "Hi" }],
      response_format: { type: "json_schema", json_schema: { name: "answer", schema: inputSchema } },
    };

    // Act
    const actualResult = ChatCompletionRequestSchema.safeParse(inputBody);

    // Assert
    expect(actualResult).toMatchObject({
      success: true,
      data: { response_format: { type: "json_schema", json_schema: { name: "answer", schema: inputSchema } } },
    });
  });

  it("rejects a json_schema whose schema is an array or a string", () => {
    // Arrange
    const inputArrayBody = {
      model: "test-model",
      messages: [{ role: "user", content: "Hi" }],
      response_format: { type: "json_schema", json_schema: { name: "answer", schema: [] } },
    };
    const inputStringBody = {
      model: "test-model",
      messages: [{ role: "user", content: "Hi" }],
      response_format: { type: "json_schema", json_schema: { name: "answer", schema: "not-an-object" } },
    };

    // Act
    const actualArrayResult = ChatCompletionRequestSchema.safeParse(inputArrayBody);
    const actualStringResult = ChatCompletionRequestSchema.safeParse(inputStringBody);

    // Assert
    expect(actualArrayResult.success).toBe(false);
    expect(actualStringResult.success).toBe(false);
  });
});
