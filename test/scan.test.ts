import { describe, it, expect, vi } from "vitest";
import { maxUint256, type Address, type Hex } from "viem";
import { classify, decodeApprovalLog, fetchRangeAdaptive, latestApprovals, type ApprovalLog } from "../src/scan.js";

const tokenA = "0x00000000000000000000000000000000000000a1" as Address;
const tokenB = "0x00000000000000000000000000000000000000b2" as Address;
const spender1 = "0x0000000000000000000000000000000000000001" as Address;
const spender2 = "0x0000000000000000000000000000000000000002" as Address;

function log(p: Partial<ApprovalLog>): ApprovalLog {
  return { token: tokenA, spender: spender1, value: 1n, blockNumber: 1n, logIndex: 0, ...p };
}

describe("classify", () => {
  it("treats zero as no approval", () => {
    expect(classify(0n)).toBe("none");
  });

  it("flags max uint and near-max values as unlimited", () => {
    expect(classify(maxUint256)).toBe("unlimited");
    expect(classify(2n ** 255n)).toBe("unlimited");
    expect(classify(2n ** 255n - 1n)).toBe("limited");
  });

  it("treats ordinary amounts as limited", () => {
    expect(classify(1_000n * 10n ** 18n)).toBe("limited");
  });
});

describe("latestApprovals", () => {
  it("keeps only the most recent log per token and spender", () => {
    const result = latestApprovals([
      log({ value: 5n, blockNumber: 1n }),
      log({ value: 9n, blockNumber: 3n }),
      log({ value: 7n, blockNumber: 2n }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.value).toBe(9n);
  });

  it("uses log index to order events inside one block", () => {
    const result = latestApprovals([
      log({ value: 0n, blockNumber: 4n, logIndex: 7 }),
      log({ value: 100n, blockNumber: 4n, logIndex: 2 }),
    ]);
    expect(result[0]?.value).toBe(0n);
  });

  it("separates different tokens and spenders", () => {
    const result = latestApprovals([
      log({ token: tokenA, spender: spender1 }),
      log({ token: tokenA, spender: spender2 }),
      log({ token: tokenB, spender: spender1 }),
    ]);
    expect(result).toHaveLength(3);
  });

  it("matches addresses case-insensitively", () => {
    const result = latestApprovals([
      log({ token: tokenA, value: 1n, blockNumber: 1n }),
      log({ token: tokenA.toUpperCase().replace("0X", "0x") as Address, value: 2n, blockNumber: 2n }),
    ]);
    expect(result).toHaveLength(1);
  });
});

describe("decodeApprovalLog", () => {
  const topic0 = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925" as Hex;
  const owner = ("0x" + "00".repeat(12) + "aa".repeat(20)) as Hex;
  const spenderTopic = ("0x" + "00".repeat(12) + "bb".repeat(20)) as Hex;
  const data = ("0x" + "ff".repeat(32)) as Hex;

  it("decodes an ERC-20 approval", () => {
    const decoded = decodeApprovalLog({
      address: tokenA,
      topics: [topic0, owner, spenderTopic],
      data,
      blockNumber: 12n,
      logIndex: 3,
    });
    expect(decoded?.spender).toBe("0x" + "bb".repeat(20));
    expect(decoded?.value).toBe(maxUint256);
    expect(decoded?.blockNumber).toBe(12n);
  });

  it("skips ERC-721 approvals, which have a 4th indexed topic", () => {
    const tokenId = ("0x" + "00".repeat(31) + "07") as Hex;
    expect(
      decodeApprovalLog({ address: tokenA, topics: [topic0, owner, spenderTopic, tokenId], data: "0x", blockNumber: 1n, logIndex: 0 }),
    ).toBeNull();
  });

  it("skips malformed logs with empty data", () => {
    expect(
      decodeApprovalLog({ address: tokenA, topics: [topic0, owner, spenderTopic], data: "0x", blockNumber: 1n, logIndex: 0 }),
    ).toBeNull();
  });
});

describe("fetchRangeAdaptive", () => {
  it("covers the whole range exactly once", async () => {
    const calls: [bigint, bigint][] = [];
    const out = await fetchRangeAdaptive(
      async (from, to) => {
        calls.push([from, to]);
        return [`${from}-${to}`];
      },
      0n,
      24n,
      10n,
    );

    expect(out).toEqual(["0-9", "10-19", "20-24"]);
    expect(calls).toHaveLength(3);
  });

  it("halves the chunk size when the RPC rejects a range", async () => {
    const fetchRange = vi.fn(async (from: bigint, to: bigint) => {
      if (to - from + 1n > 25n) throw new Error("query returned more than 10000 results");
      return [Number(from)];
    });

    const out = await fetchRangeAdaptive(fetchRange, 0n, 99n, 100n);

    // 100 -> 50 -> 25: four successful chunks of 25
    expect(out).toEqual([0, 25, 50, 75]);
  });

  it("gives up with the original error once a single block still fails", async () => {
    const boom = new Error("rpc down");
    await expect(
      fetchRangeAdaptive(async () => {
        throw boom;
      }, 0n, 3n, 4n),
    ).rejects.toBe(boom);
  });

  it("reports progress", async () => {
    const seen: bigint[] = [];
    await fetchRangeAdaptive(async () => [], 0n, 19n, 10n, (done) => seen.push(done));
    expect(seen).toEqual([10n, 20n]);
  });
});
