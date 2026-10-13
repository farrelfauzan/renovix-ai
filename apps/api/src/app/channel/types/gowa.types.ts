export interface GowaInboundMessage {
  event: "message.received";
  from: string;
  to: string;
  message: {
    id: string;
    type: "text" | "image" | "document" | "audio" | "video";
    text?: { body: string };
    timestamp: number;
  };
}

export interface GowaOutboundMessage {
  to: string;
  type: "text";
  text: { body: string };
}
