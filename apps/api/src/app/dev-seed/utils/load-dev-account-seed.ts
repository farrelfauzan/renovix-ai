import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DevAccountSeedDto } from "../dto/dev-account-seed.dto";

const SEED_FILE = resolve(__dirname, "../../../../../../prisma/dev-account.seed.json");

/** Reads and validates prisma/dev-account.seed.json; throws with the validation messages when it is not valid. */
export function loadDevAccountSeed(): DevAccountSeedDto {
  return DevAccountSeedDto.parse(JSON.parse(readFileSync(SEED_FILE, "utf8")));
}
