import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createTransport, type Transporter } from "nodemailer";

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = createTransport({
      host: this.config.get<string>(
        "SMTP_HOST",
        "email-smtp.us-east-1.amazonaws.com",
      ),
      port: this.config.get<number>("SMTP_PORT", 587),
      secure: this.config.get<string>("SMTP_SECURE", "false") === "true",
      auth: {
        user: this.config.get<string>("SMTP_USERNAME", ""),
        pass: this.config.get<string>("SMTP_PASSWORD", ""),
      },
    });
  }

  async send(params: SendEmailParams): Promise<{ messageId: string }> {
    const from = this.config.get<string>(
      "EMAIL_FROM",
      "no-reply@notify.performa.ai",
    );

    const result = await this.transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    this.logger.log(
      `Email sent to ${params.to}, messageId: ${result.messageId}`,
    );

    return { messageId: result.messageId };
  }
}
