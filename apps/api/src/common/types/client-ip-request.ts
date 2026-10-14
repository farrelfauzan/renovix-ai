/** The parts of a Fastify request that `clientIp` reads. */
export interface ClientIpRequest {
  headers: Record<string, string | string[] | undefined>;
  raw?: { socket?: { remoteAddress?: string } };
  socket?: { remoteAddress?: string };
}
