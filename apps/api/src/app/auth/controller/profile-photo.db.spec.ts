import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { S3Service } from "../../knowledge/service/s3.service";
import { PrismaService } from "../../prisma/prisma.service";
import { PROFILE_PHOTO_MAX_BYTES } from "../config/profile-photo-max-bytes";
import { ProfilePhotoService } from "../service/profile-photo.service";
import { ProfilePhotoController } from "./profile-photo.controller";
import { createFastifyAdapter } from "../../../common/utils/create-fastify-adapter";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";
import { buildMultipartUpload, photoBytes } from "../../../../test/profile-photo-files";

// RNX-334: the profile photo routes with the real AccessGuard (session only), the real users table and the real
// repository, on the test database. The storage is an in-memory fake (profile-photo.controller.spec.ts checks the same
// routes without a database); nothing reaches a bucket. Made-up users and files only.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));

const GOOGLE_PICTURE = "https://lh3.googleusercontent.example.test/a/picture";

describe("RNX-334: GET, PUT and DELETE /auth/me/photo (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let objects: Map<string, Buffer>;
  const storage = {
    upload: jest.fn(async (key: string, bytes: Buffer) => {
      objects.set(key, bytes);
      return key;
    }),
    delete: jest.fn(async (key: string) => {
      objects.delete(key);
    }),
    getPresignedUrl: jest.fn(async (key: string) => `https://signed.example.test/${key}`),
  };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [ProfilePhotoController],
      providers: [ProfilePhotoService, { provide: S3Service, useValue: storage }],
    }));
    // like main.ts: multipart (global limit 10 MB) is needed for the upload route
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    await app.getHttpAdapter().getInstance().register(require("@fastify/multipart"), { limits: { fileSize: 10 * 1024 * 1024 } });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    objects = new Map();
    jest.clearAllMocks();
    await resetDatabase(prisma);
  });

  afterAll(() => app?.close());

  type SessionUser = { id: string; email: string };
  const upload = (user: SessionUser, options: Parameters<typeof buildMultipartUpload>[0], url = "/auth/me/photo") => {
    const { headers, payload } = buildMultipartUpload(options);
    return app.inject({ method: "PUT", url, headers: { ...headers, ...asSessionUser(user) }, payload });
  };
  const uploadPhoto = (user: SessionUser, bytes: Buffer, contentType = "image/png") =>
    upload(user, { filename: "photo", contentType, bytes });
  const getPhoto = (user: SessionUser, url = "/auth/me/photo") => app.inject({ method: "GET", url, headers: asSessionUser(user) });
  const removePhoto = (user: SessionUser, url = "/auth/me/photo") => app.inject({ method: "DELETE", url, headers: asSessionUser(user) });
  const readAvatar = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { avatar: true } })).avatar;

  it.each([
    ["a PNG", photoBytes.png(), "image/png"],
    ["a JPEG", photoBytes.jpeg(), "image/jpeg"],
    ["a WebP", photoBytes.webp(), "image/webp"],
  ])("AC1: %s is stored under the user's key, avatar holds the key, the serving route answers; remove deletes it", async (_name, bytes, contentType) => {
    const user = await createUser(prisma);

    const res = await uploadPhoto(user, bytes, contentType);

    expect(res.statusCode).toBe(200);
    const [key] = [...objects.keys()];
    expect(key.startsWith(`users/${user.id}/profile-photo/`)).toBe(true);
    expect(objects.get(key)).toEqual(bytes);
    expect(await readAvatar(user.id)).toBe(key);
    expect((await getPhoto(user)).json()).toEqual({ url: `https://signed.example.test/${key}` });

    const removed = await removePhoto(user);

    expect(removed.statusCode).toBe(204);
    expect(objects.size).toBe(0);
    expect(await readAvatar(user.id)).toBeNull();
    expect((await getPhoto(user)).json()).toEqual({ url: null });
  });

  it("AC1: replace deletes the old object; an external URL is served as it is and an upload over it deletes nothing", async () => {
    const user = await createUser(prisma, { avatar: GOOGLE_PICTURE });
    expect((await getPhoto(user)).json()).toEqual({ url: GOOGLE_PICTURE });
    await uploadPhoto(user, photoBytes.png());
    const [oldKey] = [...objects.keys()];
    expect(storage.delete).not.toHaveBeenCalled();

    await uploadPhoto(user, photoBytes.jpeg(), "image/jpeg");

    expect(objects.has(oldKey)).toBe(false);
    expect(objects.size).toBe(1);
    expect(await readAvatar(user.id)).toBe([...objects.keys()][0]);
  });

  it.each([
    ["a GIF", photoBytes.gif(), "image/gif"],
    ["a PDF", photoBytes.pdf(), "application/pdf"],
    ["a text file renamed .png", photoBytes.text(), "image/png"],
  ])("AC2: %s → 400, nothing stored, avatar unchanged", async (_name, bytes, contentType) => {
    const user = await createUser(prisma, { avatar: GOOGLE_PICTURE });

    const res = await uploadPhoto(user, bytes, contentType);

    expect(res.statusCode).toBe(400);
    expect(objects.size).toBe(0);
    expect(await readAvatar(user.id)).toBe(GOOGLE_PICTURE);
  });

  it("AC3: B's upload and remove, with A's id as a field, a query value or a path, never touch A's row or object", async () => {
    const userA = await createUser(prisma);
    const userB = await createUser(prisma);
    await uploadPhoto(userA, photoBytes.png());
    const keyOfA = (await readAvatar(userA.id)) as string;
    const withAId = { filename: "b.png", contentType: "image/png", bytes: photoBytes.jpeg(), fields: { userId: userA.id, id: userA.id } };

    await upload(userB, withAId);
    await upload(userB, withAId, `/auth/me/photo?userId=${userA.id}`);
    const asPath = await upload(userB, withAId, `/auth/me/photo/${userA.id}`);
    await removePhoto(userB, `/auth/me/photo?userId=${userA.id}`);
    const removedByPath = await removePhoto(userB, `/auth/me/photo/${userA.id}`);

    expect([asPath.statusCode, removedByPath.statusCode]).toEqual([404, 404]);
    expect(await readAvatar(userA.id)).toBe(keyOfA);
    expect(objects.has(keyOfA)).toBe(true);
    expect(await readAvatar(userB.id)).toBeNull();
  });

  it("AC4: exactly the limit is accepted; one byte over is a 400 naming the limit, nothing stored", async () => {
    const user = await createUser(prisma);

    const accepted = await uploadPhoto(user, photoBytes.png(PROFILE_PHOTO_MAX_BYTES));
    const keyAtLimit = await readAvatar(user.id);
    const refused = await uploadPhoto(user, photoBytes.png(PROFILE_PHOTO_MAX_BYTES + 1));

    expect(accepted.statusCode).toBe(200);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.details.file[0]).toContain("2 MB");
    expect([...objects.keys()]).toEqual([keyAtLimit]);
    expect(await readAvatar(user.id)).toBe(keyAtLimit);
  });

  it("AC5: A has a photo; B's serving route answers null, never A's, also with A's id in the query", async () => {
    const userA = await createUser(prisma);
    const userB = await createUser(prisma);
    await uploadPhoto(userA, photoBytes.png());
    storage.getPresignedUrl.mockClear();

    const res = await getPhoto(userB, `/auth/me/photo?userId=${userA.id}`);

    expect(res.json()).toEqual({ url: null });
    expect(storage.getPresignedUrl).not.toHaveBeenCalled();
  });

  it("every route needs a session", async () => {
    const methods = ["GET", "PUT", "DELETE"] as const;

    const statuses = await Promise.all(methods.map(async (method) => (await app.inject({ method, url: "/auth/me/photo" })).statusCode));

    expect(statuses).toEqual([401, 401, 401]);
  });
});
