import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import { refuseDeleted } from "./refuse-deleted";

describe("refuseDeleted", () => {
  const knownError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError("boom", { code, clientVersion: "test" });

  it("P2025 becomes a NotFoundException carrying the given message", async () => {
    const inputWrite = () => Promise.reject(knownError("P2025"));

    const actual = await refuseDeleted(inputWrite, "Agent not found").catch((err: unknown) => err);

    expect(actual).toBeInstanceOf(NotFoundException);
    expect(actual).toMatchObject({ message: "Agent not found" });
  });

  it("a plain Error is rethrown as the same object", async () => {
    const inputError = new Error("connection lost");

    const actual = await refuseDeleted(() => Promise.reject(inputError), "Agent not found").catch((err: unknown) => err);

    expect(actual).toBe(inputError);
  });

  it("a Prisma known-request error with another code is rethrown as the same object", async () => {
    const inputError = knownError("P2002");

    const actual = await refuseDeleted(() => Promise.reject(inputError), "Agent not found").catch((err: unknown) => err);

    expect(actual).toBe(inputError);
  });

  it("a write that resolves returns its value", async () => {
    const inputValue = { id: "agent-1" };

    const actual = await refuseDeleted(() => Promise.resolve(inputValue), "Agent not found");

    expect(actual).toBe(inputValue);
  });
});
