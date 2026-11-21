"use client";

import { create } from "qrcode";

const QUIET_ZONE_MODULES = 4;

/**
 * The otpauth URI as an inline SVG QR code, generated in the browser (RNX-349): no image URL, no request. One
 * path draws every dark module, so no SVG markup is injected as a string.
 */
export function TotpQrCode({ otpauthUri }: { otpauthUri: string }) {
  const { modules } = create(otpauthUri, { errorCorrectionLevel: "M" });
  const size = modules.size + QUIET_ZONE_MODULES * 2;
  let path = "";
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (modules.get(row, column)) path += `M${column + QUIET_ZONE_MODULES} ${row + QUIET_ZONE_MODULES}h1v1h-1z`;
    }
  }
  return (
    <svg role="img" aria-label="QR code for your authenticator app" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className="size-48 rounded-rx bg-white">
      <path d={path} fill="#000" />
    </svg>
  );
}
