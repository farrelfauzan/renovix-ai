import type { Prisma } from "@generated/prisma/client.js";

/** An open database transaction: what `TransactionService.run` gives its work, and what a repository method takes as its last argument. */
export type DbTransaction = Prisma.TransactionClient;
