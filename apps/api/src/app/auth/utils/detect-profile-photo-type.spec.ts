import { photoBytes } from "../../../../test/profile-photo-files";
import { detectProfilePhotoType } from "./detect-profile-photo-type";

// RNX-334: the type of a profile photo comes from the file's own bytes.
describe("detectProfilePhotoType", () => {
  it.each([
    ["PNG", photoBytes.png(), { mimeType: "image/png", extension: "png" }],
    ["JPEG", photoBytes.jpeg(), { mimeType: "image/jpeg", extension: "jpg" }],
    ["WebP", photoBytes.webp(), { mimeType: "image/webp", extension: "webp" }],
  ])("recognises a %s from its signature", (_name, inputBytes, expectedType) => {
    expect(detectProfilePhotoType(inputBytes)).toEqual(expectedType);
  });

  it.each([
    ["a GIF", photoBytes.gif()],
    ["a PDF", photoBytes.pdf()],
    ["text", photoBytes.text()],
    ["an empty file", Buffer.alloc(0)],
    ["a RIFF file that is not WebP (a WAV)", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")])],
    ["a PNG signature cut short", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  ])("refuses %s", (_name, inputBytes) => {
    expect(detectProfilePhotoType(inputBytes)).toBeNull();
  });
});
