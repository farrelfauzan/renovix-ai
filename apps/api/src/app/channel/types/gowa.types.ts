export interface GowaOutboundMessage {
  to: string;
  type: "text";
  text: { body: string };
}
