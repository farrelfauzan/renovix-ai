import { Module } from "@nestjs/common";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { DocumentController } from "./controller/document.controller";
import { DocumentService } from "./service/document.service";
import { PdfConverter } from "./converter/pdf.converter";
import { DocxConverter } from "./converter/docx.converter";
import { XlsxConverter } from "./converter/xlsx.converter";

@Module({
  imports: [KnowledgeModule],
  controllers: [DocumentController],
  providers: [DocumentService, PdfConverter, DocxConverter, XlsxConverter],
  exports: [DocumentService],
})
export class DocumentModule {}
