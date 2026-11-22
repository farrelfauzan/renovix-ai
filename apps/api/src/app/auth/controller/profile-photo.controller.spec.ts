import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { GlobalExceptionFilter } from "../../../common/filters/global-exception.filter";
import { createFastifyAdapter } from "../../../common/utils/create-fastify-adapter";
import { S3Service } from "../../knowledge/service/s3.service";
import { UserRepository } from "../repository/user.repository";
import { PROFILE_PHOTO_MAX_BYTES } from "../config/profile-photo-max-bytes";
import { PROFILE_PHOTO_URL_EXPIRY_SECONDS } from "../config/profile-photo-url-expiry-seconds";
import { ProfilePhotoService } from "../service/profile-photo.service";
import { ProfilePhotoController } from "./profile-photo.controller";
import { buildMultipartUpload, photoBytes } from "../../../../test/profile-photo-files";

// RNX-334: the profile photo routes (PUT, GET, DELETE /auth/me/photo) with the real controller and service on Fastify
// and the real global exception filter. The users table and the storage are in-memory fakes (nothing reaches a
// database or a bucket); a test guard stands in for the session (the `x-test-user` header is the signed-in user id).
// The same behaviour on the real users table is profile-photo.db.spec.ts. Made-up ids and files only.
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";
const GOOGLE_PICTURE = "https://lh3.googleusercontent.example.test/a/picture";

/** Stands in for the sign-in: the user named by `x-test-user`, or a 401 without one. */
@Injectable()
class TestSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const userId = req.headers["x-test-user"];
    if (typeof userId !== "string") return false;
    req.user = { userId };
    return true;
  }
}

describe("RNX-334: the profile photo routes (Fastify, in-memory users and storage)", () => {
  let app: NestFastifyApplication;
  /** users.avatar by user id. */
  let avatars: Map<string, string | null>;
  /** The fake bucket: key → bytes and content type. */
  let objects: Map<string, { bytes: Buffer; contentType: string }>;
  const deletedKeys: string[] = [];

  const storage = {
    upload: jest.fn(async (key: string, bytes: Buffer, contentType: string) => {
      objects.set(key, { bytes, contentType });
      return key;
    }),
    delete: jest.fn(async (key: string) => {
      deletedKeys.push(key);
      objects.delete(key);
    }),
    getPresignedUrl: jest.fn(async (key: string, _name: string, expiresIn: number) => `https://signed.example.test/${key}?expires=${expiresIn}`),
  };
  const users = {
    findAvatarOrThrow: async (userId: string) => ({ avatar: avatars.get(userId) ?? null }),
    setAvatar: async (userId: string, avatar: string | null) => {
      avatars.set(userId, avatar);
      return { id: userId };
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProfilePhotoController],
      providers: [
        ProfilePhotoService,
        { provide: UserRepository, useValue: users },
        { provide: S3Service, useValue: storage },
        { provide: APP_GUARD, useClass: TestSessionGuard },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    // like main.ts: the global multipart limit (10 MB) is larger than the photo's own per-request limit
    await app.getHttpAdapter().getInstance().register(require("@fastify/multipart"), { limits: { fileSize: 10 * 1024 * 1024 } });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    avatars = new Map();
    objects = new Map();
    deletedKeys.length = 0;
    jest.clearAllMocks();
  });

  afterAll(() => app?.close());

  const upload = (userId: string, options: Parameters<typeof buildMultipartUpload>[0], url = "/auth/me/photo") => {
    const { headers, payload } = buildMultipartUpload(options);
    return app.inject({ method: "PUT", url, headers: { ...headers, "x-test-user": userId }, payload });
  };
  const uploadPhoto = (userId: string, bytes: Buffer, contentType = "image/png", filename = "photo.png") =>
    upload(userId, { filename, contentType, bytes });
  const getPhoto = (userId: string, url = "/auth/me/photo") => app.inject({ method: "GET", url, headers: { "x-test-user": userId } });
  const removePhoto = (userId: string, url = "/auth/me/photo") => app.inject({ method: "DELETE", url, headers: { "x-test-user": userId } });
  const keysOf = (userId: string) => [...objects.keys()].filter((key) => key.startsWith(`users/${userId}/profile-photo/`));

  describe("AC1: upload, show, replace and remove", () => {
    it.each([
      ["a PNG", photoBytes.png(), "image/png", "png"],
      ["a JPEG", photoBytes.jpeg(), "image/jpeg", "jpg"],
      ["a WebP", photoBytes.webp(), "image/webp", "webp"],
    ])("%s within the limit is stored under the user's key; the serving route gives a presigned URL; remove deletes it", async (_name, bytes, contentType, extension) => {
      const res = await uploadPhoto(USER_A, bytes, contentType, `photo.${extension}`);

      expect(res.statusCode).toBe(200);
      const [key] = keysOf(USER_A);
      expect(key).toMatch(new RegExp(`^users/${USER_A}/profile-photo/[0-9a-f-]{36}\\.${extension}$`));
      expect(objects.get(key)).toEqual({ bytes, contentType });
      expect(avatars.get(USER_A)).toBe(key);
      expect(res.json()).toEqual({ url: `https://signed.example.test/${key}?expires=${PROFILE_PHOTO_URL_EXPIRY_SECONDS}` });
      expect((await getPhoto(USER_A)).json()).toEqual(res.json());

      const removed = await removePhoto(USER_A);

      expect(removed.statusCode).toBe(204);
      expect(objects.size).toBe(0);
      expect(avatars.get(USER_A)).toBeNull();
      expect((await getPhoto(USER_A)).json()).toEqual({ url: null });
    });

    it("replace stores the new object, points avatar at it and deletes the old object", async () => {
      await uploadPhoto(USER_A, photoBytes.png());
      const [oldKey] = keysOf(USER_A);

      const res = await uploadPhoto(USER_A, photoBytes.jpeg(), "image/jpeg", "new.jpg");

      expect(res.statusCode).toBe(200);
      const [newKey] = keysOf(USER_A);
      expect(newKey).not.toBe(oldKey);
      expect(keysOf(USER_A)).toHaveLength(1);
      expect(avatars.get(USER_A)).toBe(newKey);
      expect(deletedKeys).toEqual([oldKey]);
    });

    it("a social sign-up's external URL is served as it is; an upload replaces it without deleting anything", async () => {
      avatars.set(USER_A, GOOGLE_PICTURE);
      expect((await getPhoto(USER_A)).json()).toEqual({ url: GOOGLE_PICTURE });

      const res = await uploadPhoto(USER_A, photoBytes.png());

      expect(res.statusCode).toBe(200);
      expect(avatars.get(USER_A)).toBe(keysOf(USER_A)[0]);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it("remove clears an external URL too, with no object to delete", async () => {
      avatars.set(USER_A, GOOGLE_PICTURE);

      const res = await removePhoto(USER_A);

      expect(res.statusCode).toBe(204);
      expect(avatars.get(USER_A)).toBeNull();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it("a user with no photo gets { url: null }; a value that is neither a key of theirs nor an https URL is not served", async () => {
      expect((await getPhoto(USER_A)).json()).toEqual({ url: null });
      avatars.set(USER_A, `users/${USER_B}/profile-photo/someone-elses.png`);

      expect((await getPhoto(USER_A)).json()).toEqual({ url: null });
      expect(storage.getPresignedUrl).not.toHaveBeenCalled();
    });
  });

  describe("AC2: only PNG, JPEG and WebP, decided from the file's bytes", () => {
    it.each([
      ["a GIF", photoBytes.gif(), "image/gif", "photo.gif"],
      ["a PDF", photoBytes.pdf(), "application/pdf", "photo.pdf"],
      ["a text file renamed .png with an image mime type", photoBytes.text(), "image/png", "photo.png"],
    ])("%s → 400, nothing stored, avatar unchanged", async (_name, bytes, contentType, filename) => {
      avatars.set(USER_A, GOOGLE_PICTURE);

      const res = await uploadPhoto(USER_A, bytes, contentType, filename);

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { type: "invalid_request_error", details: { file: [expect.stringContaining("PNG, JPEG or WebP")] } } });
      expect(storage.upload).not.toHaveBeenCalled();
      expect(objects.size).toBe(0);
      expect(avatars.get(USER_A)).toBe(GOOGLE_PICTURE);
    });

    it("a PNG sent as text/plain with a .txt name is still accepted (the bytes decide)", async () => {
      const res = await uploadPhoto(USER_A, photoBytes.png(), "text/plain", "photo.txt");

      expect(res.statusCode).toBe(200);
      expect(objects.get(keysOf(USER_A)[0])?.contentType).toBe("image/png");
    });

    it("a request without a file is a 400", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/auth/me/photo",
        headers: { "x-test-user": USER_A, "content-type": "multipart/form-data; boundary=x" },
        payload: "--x--\r\n",
      });

      expect(res.statusCode).toBe(400);
      expect(objects.size).toBe(0);
    });
  });

  describe("AC3: a user changes only their own photo", () => {
    it("B uploads and removes with A's id as a field, a query value and a path: A's row and object are untouched", async () => {
      await uploadPhoto(USER_A, photoBytes.png());
      const [keyOfA] = keysOf(USER_A);
      const withAId = { filename: "b.png", contentType: "image/png", bytes: photoBytes.jpeg(), fields: { userId: USER_A, id: USER_A, avatar: keyOfA } };

      const asField = await upload(USER_B, withAId);
      const asQuery = await upload(USER_B, withAId, `/auth/me/photo?userId=${USER_A}&id=${USER_A}`);
      const asPath = await upload(USER_B, withAId, `/auth/me/photo/${USER_A}`);
      const removedWithQuery = await removePhoto(USER_B, `/auth/me/photo?userId=${USER_A}`);
      const removedWithPath = await removePhoto(USER_B, `/auth/me/photo/${USER_A}`);

      expect([asField.statusCode, asQuery.statusCode]).toEqual([200, 200]);
      expect([asPath.statusCode, removedWithQuery.statusCode, removedWithPath.statusCode]).toEqual([404, 204, 404]);
      expect(avatars.get(USER_A)).toBe(keyOfA);
      expect(objects.has(keyOfA)).toBe(true);
      expect(deletedKeys).not.toContain(keyOfA);
      expect(keysOf(USER_B)).toHaveLength(0);
      expect(avatars.get(USER_B)).toBeNull();
    });
  });

  describe("AC4: the limit is PROFILE_PHOTO_MAX_BYTES", () => {
    it("the limit is 2 MB", () => {
      expect(PROFILE_PHOTO_MAX_BYTES).toBe(2 * 1024 * 1024);
    });

    it("a file of exactly the limit is accepted and stored whole", async () => {
      const bytes = photoBytes.png(PROFILE_PHOTO_MAX_BYTES);

      const res = await uploadPhoto(USER_A, bytes);

      expect(res.statusCode).toBe(200);
      expect(objects.get(keysOf(USER_A)[0])?.bytes.length).toBe(PROFILE_PHOTO_MAX_BYTES);
    });

    it.each([
      ["one byte over", PROFILE_PHOTO_MAX_BYTES + 1],
      ["well over (3 MB)", 3 * 1024 * 1024],
    ])("%s → 400 naming the limit, nothing stored, avatar unchanged", async (_name, size) => {
      avatars.set(USER_A, GOOGLE_PICTURE);

      const res = await uploadPhoto(USER_A, photoBytes.png(size));

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { type: "invalid_request_error", details: { file: [expect.stringContaining("2 MB")] } } });
      expect(storage.upload).not.toHaveBeenCalled();
      expect(objects.size).toBe(0);
      expect(avatars.get(USER_A)).toBe(GOOGLE_PICTURE);
    });
  });

  describe("AC5: the serving route answers the caller's own photo only", () => {
    it("A has a photo; B gets null (or B's own), never A's, also with A's id in the query or path", async () => {
      await uploadPhoto(USER_A, photoBytes.png());
      const [keyOfA] = keysOf(USER_A);
      storage.getPresignedUrl.mockClear();

      const bAlone = await getPhoto(USER_B);
      const bWithQuery = await getPhoto(USER_B, `/auth/me/photo?userId=${USER_A}&id=${USER_A}`);
      const bWithPath = await getPhoto(USER_B, `/auth/me/photo/${USER_A}`);
      await uploadPhoto(USER_B, photoBytes.webp(), "image/webp", "b.webp");
      const bOwn = await getPhoto(USER_B, `/auth/me/photo?userId=${USER_A}`);

      expect(bAlone.json()).toEqual({ url: null });
      expect(bWithQuery.json()).toEqual({ url: null });
      expect(bWithPath.statusCode).toBe(404);
      expect(bOwn.json().url).toContain(keysOf(USER_B)[0]);
      expect(bOwn.json().url).not.toContain(keyOfA);
      expect(storage.getPresignedUrl.mock.calls.map((call) => call[0])).not.toContain(keyOfA);
    });
  });

  it("a request with no session is refused and touches nothing", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/me/photo" });

    expect(res.statusCode).toBe(403);
  });
});
