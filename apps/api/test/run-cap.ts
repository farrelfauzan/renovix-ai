import type { PrismaService } from "../src/app/prisma/prisma.service";

/**
 * RX-22b: sets the per-run credit cap (platform setting perRunCreditCap) to `credits`, with the floor
 * (perRunCreditCapFloor, 1 credit without a row) lowered to the smallest unit so a test can use a cap below 1 credit.
 */
export async function setRunCap(prisma: PrismaService, credits: number): Promise<void> {
  await prisma.platformSetting.createMany({
    data: [
      { name: "perRunCreditCap", value: credits },
      { name: "perRunCreditCapFloor", value: 0.000001 },
    ],
  });
}
