import type { CreditWarningLevel } from "@generated/prisma/client.js";
import type { WarningsToSendInput } from "../types/warnings-to-send-input";
import { pickWarningsToSend } from "./pick-warnings-to-send";

// RNX-329: which warnings the run-out check queues for an account, given its level, floor flag and the warnings already
// queued in its purchase cycle.
const BASE: WarningsToSendInput = { level: "none", belowFloor: false, recorded: [] };

describe("pickWarningsToSend (RNX-329)", () => {
  it.each<[string, Partial<WarningsToSendInput>, CreditWarningLevel[]]>([
    ["none, above the floor: nothing", {}, []],
    ["amber, nothing queued yet: amber", { level: "amber" }, ["amber"]],
    ["amber already queued: nothing", { level: "amber", recorded: ["amber"] }, []],
    ["straight to red: red only, no amber", { level: "red" }, ["red"]],
    ["red after amber: red", { level: "red", recorded: ["amber"] }, ["red"]],
    ["back to amber after red in the cycle: nothing", { level: "amber", recorded: ["red"] }, []],
    ["below the floor with no projection: floor", { belowFloor: true }, ["floor"]],
    ["red and below the floor at once: both", { level: "red", belowFloor: true }, ["red", "floor"]],
    ["all three already queued: nothing", { level: "red", belowFloor: true, recorded: ["amber", "red", "floor"] }, []],
  ])("%s", (_case, override, expected) => {
    const actual = pickWarningsToSend({ ...BASE, ...override });

    expect(actual).toEqual(expected);
  });
});
