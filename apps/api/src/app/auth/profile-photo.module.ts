import { Module } from "@nestjs/common";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { ProfilePhotoController } from "./controller/profile-photo.controller";
import { ProfilePhotoService } from "./service/profile-photo.service";

/**
 * RNX-334: the profile photo routes. Separate from AuthModule because they need the storage service (KnowledgeModule),
 * which AuthModule's other importers (the back-office modules and their specs) do not configure.
 */
@Module({
  imports: [KnowledgeModule],
  controllers: [ProfilePhotoController],
  providers: [ProfilePhotoService],
})
export class ProfilePhotoModule {}
