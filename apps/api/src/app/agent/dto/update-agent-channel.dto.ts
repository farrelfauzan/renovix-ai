import { z } from "zod";

/** Body of PATCH /agents/:id/channels/:channelId (RNX-28): the channel's new config, any JSON object. */
export const UpdateAgentChannelSchema = z.record(z.string(), z.unknown());
