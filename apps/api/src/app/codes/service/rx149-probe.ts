// RX-149 evidence only: a service-folder file outside a repository that imports PrismaService,
// on a throwaway branch that is never merged.
import { PrismaService } from "../../prisma/prisma.service";

export const rx149Probe = PrismaService;
