import { BadRequestException } from "@nestjs/common";
import { RouteIdDto } from "../dto/route-id.dto";

/** The user or session id of a route path (RNX-100), checked with RouteIdDto; 400 when it is not one. */
export function parseRouteId(value: string): RouteIdDto {
  const parsed = RouteIdDto.safeParse(value);
  if (!parsed.success) throw new BadRequestException("Invalid id");
  return parsed.data;
}
