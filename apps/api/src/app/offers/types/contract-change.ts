import type { CreateCompanyContractDto } from "../dto/create-company-contract.dto";
import type { ChangeAuthor } from "./change-author";

/** A new company contract and who records it why. */
export type ContractChange = {
  readonly contract: CreateCompanyContractDto;
  readonly author: ChangeAuthor;
};
