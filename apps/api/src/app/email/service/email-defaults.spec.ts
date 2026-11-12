import { ConfigService } from "@nestjs/config";
import { EmailService } from "./email.service";
import { EmailTemplateService } from "./email-template.service";

const mockSendMail = jest.fn().mockResolvedValue({ messageId: "message-1" });
jest.mock("nodemailer", () => ({ createTransport: () => ({ sendMail: mockSendMail }) }));

describe("RNX-46: email defaults use the Renovix sender and links", () => {
  const emptyConfig = { get: (_key: string, fallback?: unknown) => fallback } as unknown as ConfigService;

  it("sends from no-reply@notify.renovix.id when EMAIL_FROM is not set", async () => {
    const service = new EmailService(emptyConfig);

    await service.send({ to: "a@example.com", subject: "s", html: "h", text: "t" });

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "no-reply@notify.renovix.id" }));
  });

  it("links to https://chat.renovix.id when APP_BASE_URL is not set", () => {
    const service = new EmailTemplateService(emptyConfig);

    const actualUrl = service.getAcceptUrl("token-1");

    expect(actualUrl).toBe("https://chat.renovix.id/workspace-invites/accept?token=token-1");
  });
});
