import { buildProfilePhotoKey } from "./build-profile-photo-key";

// RNX-334: an uploaded photo's storage key is under the user's own prefix, with a fresh random id.
describe("buildProfilePhotoKey", () => {
  it("is users/<userId>/profile-photo/<object id>.<extension>", () => {
    expect(buildProfilePhotoKey("user-1", "webp", "object-1")).toBe("users/user-1/profile-photo/object-1.webp");
  });

  it("uses a different random id each time", () => {
    expect(buildProfilePhotoKey("user-1", "png")).not.toBe(buildProfilePhotoKey("user-1", "png"));
  });
});
