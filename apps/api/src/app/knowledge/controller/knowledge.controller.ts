import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Req,
  Body,
  Param,
  Query,
  HttpCode,
  BadRequestException,
  ParseUUIDPipe,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Access } from "../../../common/decorators/access.decorator";
import { KnowledgeService } from "../service/knowledge.service";
import {
  CreateKnowledgeBaseSchema,
  UpdateKnowledgeBaseSchema,
  AddChunksSchema,
  SearchChunksSchema,
} from "../dto/knowledge.dto";

@Controller("v1/knowledge")
@Access({ auth: ["apiKey"] })
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  // ─── Knowledge Bases ───

  @Post("bases")
  async createKnowledgeBase(@Req() req: any, @Body() body: unknown) {
    const parsed = CreateKnowledgeBaseSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.knowledgeService.createKnowledgeBase(req.user.id, parsed.data);
  }

  @Get("bases")
  async listKnowledgeBases(@Req() req: any) {
    return this.knowledgeService.listKnowledgeBases(req.user.id);
  }

  @Get("bases/:id")
  async getKnowledgeBase(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.knowledgeService.getKnowledgeBase(req.user.id, id);
  }

  @Put("bases/:id")
  async updateKnowledgeBase(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const parsed = UpdateKnowledgeBaseSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.knowledgeService.updateKnowledgeBase(
      req.user.id,
      id,
      parsed.data,
    );
  }

  @Delete("bases/:id")
  @HttpCode(204)
  async deleteKnowledgeBase(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    await this.knowledgeService.deleteKnowledgeBase(req.user.id, id);
  }

  // ─── Chunks ───

  @Post("bases/:id/upload")
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async uploadMarkdown(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    const file = await req.file();
    if (!file) {
      throw new BadRequestException("No file uploaded");
    }

    const filename = file.filename;
    if (!filename.endsWith(".md")) {
      throw new BadRequestException("Only .md files are supported");
    }

    const buffer = await file.toBuffer();
    if (buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException("File size exceeds 10MB limit");
    }

    return this.knowledgeService.uploadMarkdown(req.user.id, id, {
      filename,
      buffer,
    });
  }

  @Post("bases/:id/chunks")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async addChunks(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const parsed = AddChunksSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.knowledgeService.addChunks(req.user.id, id, parsed.data.chunks);
  }

  @Get("bases/:id/chunks")
  async listChunks(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.knowledgeService.listChunks(req.user.id, id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Delete("bases/:id/chunks/:chunkId")
  @HttpCode(204)
  async deleteChunk(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("chunkId", ParseUUIDPipe) chunkId: string,
  ) {
    await this.knowledgeService.deleteChunk(req.user.id, id, chunkId);
  }

  // ─── Search ───

  @Post("search")
  @HttpCode(200)
  async searchChunks(@Req() req: any, @Body() body: unknown) {
    const parsed = SearchChunksSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.knowledgeService.searchChunks(req.user.id, parsed.data.query, {
      knowledgeBaseId: parsed.data.knowledgeBaseId,
      topK: parsed.data.topK,
    });
  }
}
