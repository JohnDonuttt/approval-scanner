import { formatUnits, type Address } from "viem";
import { type Risk } from "./scan.js";

export interface ApprovalRow {
  token: Address;
  symbol: string;
  decimals: number | null;
  spender: Address;
  allowance: bigint;
  risk: Risk;
}

export function formatAllowance(row: ApprovalRow): string {
  if (row.risk === "unlimited") return "UNLIMITED";
  if (row.decimals === null) return row.allowance.toString();
  const [whole = "0", frac = ""] = formatUnits(row.allowance, row.decimals).split(".");
  const trimmed = frac.slice(0, 4).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function revokeCommand(row: ApprovalRow): string {
  return `cast send ${row.token} "approve(address,uint256)" ${row.spender} 0`;
}

export function renderTable(rows: ApprovalRow[]): string {
  if (rows.length === 0) return "No active approvals found.";

  const header = ["TOKEN", "SPENDER", "ALLOWANCE", "RISK"];
  const body = rows.map((r) => [r.symbol, r.spender, formatAllowance(r), r.risk]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();

  return [line(header), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

export function renderJson(rows: ApprovalRow[]): string {
  return JSON.stringify(
    rows.map((r) => ({ ...r, allowance: r.allowance.toString() })),
    null,
    2,
  );
}
