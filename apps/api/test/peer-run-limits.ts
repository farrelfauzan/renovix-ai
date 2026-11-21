import type { PrismaService } from "../src/app/prisma/prisma.service";

/**
 * RNX-121b-1: the agent-call limits a test's runs read (platform settings peerRunMaxDepth, peerRunMaxAgentCalls and
 * peerRunCallTimeoutSeconds). Without these rows every agent call is unavailable (no value in code). RNX-326: also
 * peerRunMaxModelCalls and peerRunMaxMinutes; a test that does not give them gets the shipped seed's 30 and 5
 * (prisma/offers.seed.json), so the earlier tests run as before.
 */
export async function setPeerRunLimits(
  prisma: PrismaService,
  limits: { maxDepth: number; maxAgentCalls: number; callTimeoutSeconds: number; maxModelCalls?: number; maxMinutes?: number },
): Promise<void> {
  const { maxModelCalls = 30, maxMinutes = 5 } = limits;
  await prisma.platformSetting.createMany({
    data: [
      { name: "peerRunMaxDepth", value: limits.maxDepth },
      { name: "peerRunMaxAgentCalls", value: limits.maxAgentCalls },
      { name: "peerRunCallTimeoutSeconds", value: limits.callTimeoutSeconds },
      { name: "peerRunMaxModelCalls", value: maxModelCalls },
      { name: "peerRunMaxMinutes", value: maxMinutes },
    ],
  });
}
