import { Module } from "@nestjs/common";
import { McpController } from "./mcp.controller";
import { McpUserController } from "./mcp-user.controller";
import { WebSearchController } from "./web-search.controller";
import { McpService } from "./mcp.service";
import { McpClientService } from "./mcp-client.service";
import { McpRegistryService } from "./mcp-registry.service";
import { McpUserService } from "./mcp-user.service";
import { WebSearchService } from "./web-search.service";
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
