import { Injectable, Logger } from "@nestjs/common";
import { AgentChannelRepository } from "../../agent/repository/agent-channel.repository";
import type { GowaOutboundMessage } from "../types/gowa.types";
import { splitMessage } from "../utils/split-message";

@Injectable()
export class GowaService {
  private readonly logger = new Logger(GowaService.name);

  constructor(private readonly agentChannels: AgentChannelRepository) {}

  /**
   * Send a text message via GOWA API
   */
  async sendMessage(
    to: string,
    text: string,
    channelConfig: Record<string, any>,
  ): Promise<void> {
    const { gowaUrl, apiToken } = channelConfig;

    // Split long messages (WhatsApp limit: 4096 chars)
    const chunks = splitMessage(text, 4000);

    for (const chunk of chunks) {
      const payload: GowaOutboundMessage = {
        to,
        type: "text",
        text: { body: chunk },
      };

      const response = await fetch(`${gowaUrl}/api/messages/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`GOWA send failed: ${error}`);
        throw new Error(`Failed to send WhatsApp message: ${response.status}`);
      }

      // Small delay between split messages
      if (chunks.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  /**
   * Every active whatsapp channel whose phoneNumber is `toNumber`, in one query filtered in SQL.
   * More than one tenant can save the same number, so the webhook picks among these by signature (RX-115).
   */
  async findWhatsappChannels(toNumber: unknown) {
    if (typeof toNumber !== "string" || !toNumber) return [];
    const channels =
      await this.agentChannels.findActiveWhatsappChannels(toNumber);
    return channels.map((channel) => ({ agent: channel.agent, channel }));
  }
}
