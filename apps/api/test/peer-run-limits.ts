import type { PrismaService } from "../src/app/prisma/prisma.service";

/**
 * RNX-121b-1: the agent-call limits a test's runs read (platform settings peerRunMaxDepth, peerRunMaxAgentCalls and
 * peerRunCallTimeoutSeconds). Without these rows every agent call is unavailable (no value in code).
 */
export async function setPeerRunLimits(
  prisma: PrismaService,
  limits: { maxDepth: number; maxAgentCalls: number; callTimeoutSeconds: number },
): Promise<void> {
  await prisma.platformSetting.createMany({
    data: [
      { name: "peerRunMaxDepth", value: limits.maxDepth },
      { name: "peerRunMaxAgentCalls", value: limits.maxAgentCalls },
      { name: "peerRunCallTimeoutSeconds", value: limits.callTimeoutSeconds },
    ],
  });
}
