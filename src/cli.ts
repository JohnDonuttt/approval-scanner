#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  pad,
  toEventSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { classify, decodeApprovalLog, fetchRangeAdaptive, latestApprovals, type ApprovalLog } from "./scan.js";
import { renderJson, renderTable, revokeCommand, type ApprovalRow } from "./render.js";

const APPROVAL_TOPIC = toEventSelector("Approval(address,address,uint256)");

const HELP = `approval-scanner <address> [options]

Lists the active ERC-20 approvals a wallet has granted and flags unlimited ones.

Options
  --rpc <url>         JSON-RPC endpoint (or set RPC_URL)
  --from-block <n>    First block to scan (default 0). Set this to the wallet's first
                      activity on big chains: scanning from genesis can take a while
  --chunk <n>         Starting block range per request (default 50000, shrinks automatically)
  --unlimited-only    Only show unlimited approvals
  --revoke            Print a 'cast send' command for each shown approval
  --json              Machine-readable output
  -h, --help          Show this help
`;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function fetchApprovalLogs(
  client: PublicClient,
  owner: Address,
  from: bigint,
  to: bigint,
  chunk: bigint,
  quiet: boolean,
): Promise<ApprovalLog[]> {
  const ownerTopic = pad(owner.toLowerCase() as Hex, { size: 32 });

  const raw = await fetchRangeAdaptive(
    async (start, end) =>
      client.request({
        method: "eth_getLogs",
        params: [
          {
            fromBlock: `0x${start.toString(16)}`,
            toBlock: `0x${end.toString(16)}`,
            topics: [APPROVAL_TOPIC, ownerTopic],
          },
        ],
      }),
    from,
    to,
    chunk,
    quiet
      ? undefined
      : (done, total) => process.stderr.write(`\rscanning blocks… ${((Number(done) / Number(total)) * 100).toFixed(0)}%`),
  );
  if (!quiet) process.stderr.write("\r\x1b[K");

  return raw
    .map((log) =>
      decodeApprovalLog({
        address: log.address,
        topics: log.topics,
        data: log.data,
        blockNumber: BigInt(log.blockNumber ?? "0x0"),
        logIndex: Number(log.logIndex ?? "0x0"),
      }),
    )
    .filter((l): l is ApprovalLog => l !== null);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      rpc: { type: "string" },
      "from-block": { type: "string", default: "0" },
      chunk: { type: "string", default: "50000" },
      "unlimited-only": { type: "boolean", default: false },
      revoke: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }

  const input = positionals[0]!;
  if (!isAddress(input)) throw new Error(`"${input}" is not a valid address`);
  const owner = getAddress(input);

  const rpc = values.rpc ?? process.env.RPC_URL;
  if (!rpc) throw new Error("no RPC endpoint: pass --rpc <url> or set RPC_URL");

  const client = createPublicClient({ transport: http(rpc) });
  const head = await client.getBlockNumber();
  const quiet = values.json || !process.stderr.isTTY;

  const logs = await fetchApprovalLogs(client, owner, BigInt(values["from-block"]!), head, BigInt(values.chunk!), quiet);
  const candidates = latestApprovals(logs);

  // the log only says what the *last event* set; confirm against the contract's current state
  const rows = (
    await mapPool(candidates, 10, async (c): Promise<ApprovalRow | null> => {
      const [allowance, symbol, decimals] = await Promise.all([
        client.readContract({ address: c.token, abi: erc20Abi, functionName: "allowance", args: [owner, c.spender] }).catch(() => c.value),
        client.readContract({ address: c.token, abi: erc20Abi, functionName: "symbol" }).catch(() => `${c.token.slice(0, 8)}…`),
        client.readContract({ address: c.token, abi: erc20Abi, functionName: "decimals" }).catch(() => null),
      ]);

      const risk = classify(allowance);
      if (risk === "none") return null;
      return { token: getAddress(c.token), symbol, decimals, spender: getAddress(c.spender), allowance, risk };
    })
  )
    .filter((r): r is ApprovalRow => r !== null)
    .filter((r) => !values["unlimited-only"] || r.risk === "unlimited")
    // unlimited first, then by token symbol
    .sort((a, b) => Number(b.risk === "unlimited") - Number(a.risk === "unlimited") || a.symbol.localeCompare(b.symbol));

  if (values.json) {
    console.log(renderJson(rows));
    return;
  }

  console.log(renderTable(rows));
  if (values.revoke && rows.length > 0) {
    console.log("\nRevoke commands (set --rpc-url and a signer):");
    for (const row of rows) console.log(revokeCommand(row));
  }

  const unlimited = rows.filter((r) => r.risk === "unlimited").length;
  if (unlimited > 0) {
    console.error(`\n${unlimited} unlimited approval${unlimited === 1 ? "" : "s"} found.`);
    process.exitCode = 2; // lets scripts and CI fail on unlimited approvals
  }
}

main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
