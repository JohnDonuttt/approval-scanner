import { describe, it, expect } from "vitest";
import { formatAllowance, renderJson, renderTable, revokeCommand, type ApprovalRow } from "../src/render.js";

const row: ApprovalRow = {
  token: "0x00000000000000000000000000000000000000a1",
  symbol: "USDC",
  decimals: 6,
  spender: "0x0000000000000000000000000000000000000001",
  allowance: 1_500_000n,
  risk: "limited",
};

describe("render", () => {
  it("formats limited allowances using token decimals", () => {
    expect(formatAllowance(row)).toBe("1.5");
    expect(formatAllowance({ ...row, allowance: 2_000_000n })).toBe("2");
  });

  it("shows UNLIMITED instead of a giant number", () => {
    expect(formatAllowance({ ...row, risk: "unlimited", allowance: 2n ** 256n - 1n })).toBe("UNLIMITED");
  });

  it("falls back to the raw value when decimals are unknown", () => {
    expect(formatAllowance({ ...row, decimals: null })).toBe("1500000");
  });

  it("builds a cast revoke command", () => {
    expect(revokeCommand(row)).toBe(`cast send ${row.token} "approve(address,uint256)" ${row.spender} 0`);
  });

  it("renders an aligned table and an empty-state message", () => {
    const table = renderTable([row]);
    expect(table.split("\n")[0]).toMatch(/^TOKEN\s+SPENDER\s+ALLOWANCE\s+RISK$/);
    expect(table).toContain("USDC");
    expect(renderTable([])).toBe("No active approvals found.");
  });

  it("serialises bigints as strings in JSON", () => {
    const parsed = JSON.parse(renderJson([row]));
    expect(parsed[0].allowance).toBe("1500000");
  });
});
