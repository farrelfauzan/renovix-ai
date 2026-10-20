import { Controller, Get, Req } from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { createFastifyAdapter } from "./create-fastify-adapter";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

@Controller("id-probe")
class IdProbeController {
  @Get()
  read(@Req() request: FastifyRequest): { id: string } {
    return { id: request.id };
  }
}

describe("RX-166: Fastify request ids", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [IdProbeController] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("AC1: each request id is a UUID and two requests differ", async () => {
    const first = await app.inject({ method: "GET", url: "/id-probe" });
    const second = await app.inject({ method: "GET", url: "/id-probe" });

    expect(first.json().id).toMatch(UUID_PATTERN);
    expect(second.json().id).toMatch(UUID_PATTERN);
    expect(first.json().id).not.toBe(second.json().id);
  });

  it("AC3: a request-id or x-request-id header never becomes the request id", async () => {
    const chosen = "client-chosen-id";

    const res = await app.inject({
      method: "GET",
      url: "/id-probe",
      headers: { "request-id": chosen, "x-request-id": chosen },
    });

    expect(res.json().id).not.toBe(chosen);
    expect(res.json().id).toMatch(UUID_PATTERN);
  });
});
