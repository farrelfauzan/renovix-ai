import { Module } from "@nestjs/common";
import { McpController } from "./controller/mcp.controller";
import { McpUserController } from "./controller/mcp-user.controller";
import { WebSearchController } from "./controller/web-search.controller";
import { McpService } from "./service/mcp.service";
import { McpClientService } from "./service/mcp-client.service";
import { McpRegistryService } from "./service/mcp-registry.service";
import { McpUserService } from "./service/mcp-user.service";
import { WebSearchService } from "./service/web-search.service";
import { McpOAuthStateRepository } from "./repository/mcp-oauth-state.repository";
import { WorkspaceModule } from "../workspace/workspace.module";

@Module({
  imports: [WorkspaceModule],
  controllers: [McpController, McpUserController, WebSearchController],
  providers: [
    McpService,
    McpClientService,
    McpRegistryService,
    McpUserService,
    WebSearchService,
    McpOAuthStateRepository,
  ],
  exports: [
    McpService,
    McpClientService,
    McpRegistryService,
    McpUserService,
    WebSearchService,
  ],
})
export class McpModule {}
