import {
  Controller,
  Post,
  Body,
  HttpCode,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Access } from "../../../common/decorators/access.decorator";
import { DocumentService } from "../service/document.service";
import { ExportRequestSchema } from "../dto/export-request.dto";
import { createInvalidBodyException } from "../../../common/utils/create-invalid-body-exception";

@Controller("export")
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  @Access({ auth: ["apiKey"] })
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async exportDocument(@Body() body: unknown) {
    const parsed = ExportRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw createInvalidBodyException(parsed.error);
    }

    const { markdown, format, filename } = parsed.data;
    return this.documentService.generate(markdown, format, filename);
  }
}
