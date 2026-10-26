import { maxUint256, type Address, type Hex } from "viem";

export interface ApprovalLog {
  token: Address;
  spender: Address;
  value: bigint;
  blockNumber: bigint;
  logIndex: number;
}

export type Risk = "unlimited" | "limited" | "none";

/** Anything this close to 2^256 is "infinite approval" in practice; wallets set maxUint256 or 2^255-ish. */
const UNLIMITED_THRESHOLD = 2n ** 255n;

export function classify(allowance: bigint): Risk {
  if (allowance === 0n) return "none";
  return allowance >= UNLIMITED_THRESHOLD ? "unlimited" : "limited";
}

/**
 * Collapse a stream of Approval logs to the latest one per (token, spender).
 * Order is by block then log index, so input order doesn't matter.
 */
export function latestApprovals(logs: ApprovalLog[]): ApprovalLog[] {
  const latest = new Map<string, ApprovalLog>();

  for (const log of logs) {
    const key = `${log.token.toLowerCase()}:${log.spender.toLowerCase()}`;
    const prev = latest.get(key);
    const newer =
      !prev ||
      log.blockNumber > prev.blockNumber ||
      (log.blockNumber === prev.blockNumber && log.logIndex > prev.logIndex);
    if (newer) latest.set(key, log);
  }

  return [...latest.values()];
}

/** Decode a raw eth_getLogs entry for Approval(owner, spender, value). Returns null for ERC-721 and malformed logs. */
export function decodeApprovalLog(raw: {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  blockNumber: bigint;
  logIndex: number;
}): ApprovalLog | null {
  // ERC-20 indexes owner + spender (3 topics, value in data).
  // ERC-721 reuses the same event signature but indexes tokenId too (4 topics).
  if (raw.topics.length !== 3) return null;
  const spenderTopic = raw.topics[2];
  if (!spenderTopic || raw.data.length < 66) return null;

  return {
    token: raw.address,
    spender: `0x${spenderTopic.slice(26)}` as Address,
    value: BigInt(raw.data.slice(0, 66)),
    blockNumber: raw.blockNumber,
    logIndex: raw.logIndex,
  };
}

/**
 * Fetch logs over [from, to], shrinking the range when the RPC rejects it.
 * Public RPCs cap eth_getLogs by block range or result size, and the cap differs per provider,
 * so we halve on failure and keep going rather than hardcode a number.
 */
export async function fetchRangeAdaptive<T>(
  fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  to: bigint,
  initialChunk = 50_000n,
  onProgress?: (done: bigint, total: bigint) => void,
): Promise<T[]> {
  const results: T[] = [];
  const total = to - from + 1n;
  let chunk = initialChunk;
  let cursor = from;

  while (cursor <= to) {
    const end = cursor + chunk - 1n > to ? to : cursor + chunk - 1n;
    try {
      results.push(...(await fetchRange(cursor, end)));
      cursor = end + 1n;
      onProgress?.(cursor - from, total);
    } catch (err) {
      if (chunk <= 1n) throw err;
      chunk = chunk / 2n;
    }
  }

  return results;
}

export { maxUint256 };
