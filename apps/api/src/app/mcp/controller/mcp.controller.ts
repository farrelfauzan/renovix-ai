import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
} from "@nestjs/common";
import { Access } from "../../../common/decorators/access.decorator";
import { McpService } from "../service/mcp.service";

@Controller("mcp")
@Access({ auth: ["jwt", "session"] })
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  /**
   * List all available MCP server packages from the registry
   */
  @Get("registry")
  getRegistry() {
    return this.mcpService.getRegistry();
  }

  /**
   * List user's connected MCP integrations
   */
  @Get("servers")
  listServers(@Req() req: any) {
    return this.mcpService.listServers(req.user.userId);
  }

  /**
   * Test connection to a connected MCP integration
   */
  @Post("servers/:id/test")
  testConnection(@Req() req: any, @Param("id") id: string) {
    return this.mcpService.testConnection(req.user.userId, id);
  }

  /**
   * Disconnect / delete an MCP integration
   */
  @Delete("servers/:id")
  deleteServer(@Req() req: any, @Param("id") id: string) {
    return this.mcpService.deleteServer(req.user.userId, id);
  }
}
