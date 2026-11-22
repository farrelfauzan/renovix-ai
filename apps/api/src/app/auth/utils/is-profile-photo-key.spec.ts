import { isExternalPhotoUrl } from "./is-external-photo-url";
import { isProfilePhotoKey } from "./is-profile-photo-key";

// RNX-334: users.avatar is an uploaded photo's key, an external https URL, or null.
describe("telling an uploaded photo's key from an external URL", () => {
  it("a key under the user's own prefix is a key and not an external URL", () => {
    const inputAvatar = "users/user-1/profile-photo/object-1.png";

    expect([isProfilePhotoKey("user-1", inputAvatar), isExternalPhotoUrl(inputAvatar)]).toEqual([true, false]);
  });

  it("a key under another user's prefix is not this user's key", () => {
    expect(isProfilePhotoKey("user-2", "users/user-1/profile-photo/object-1.png")).toBe(false);
  });

  it("an external https URL is an external URL and not a key", () => {
    const inputAvatar = "https://lh3.googleusercontent.example.test/a/picture";

    expect([isProfilePhotoKey("user-1", inputAvatar), isExternalPhotoUrl(inputAvatar)]).toEqual([false, true]);
  });

  it.each([[null], [""], ["http://insecure.example.test/a.png"], ["javascript:alert(1)"], ["data:image/png;base64,AAAA"]])(
    "%p is neither",
    (inputAvatar) => {
      expect([isProfilePhotoKey("user-1", inputAvatar), isExternalPhotoUrl(inputAvatar)]).toEqual([false, false]);
    },
  );
});
