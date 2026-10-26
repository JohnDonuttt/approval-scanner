# approval-scanner

A command-line tool that lists the ERC-20 token approvals a wallet has granted, flags the unlimited ones, and prints the command to revoke each.

Every time you click "approve" in a dapp you may be giving a contract permission to spend a token from your wallet, often without a limit. Those permissions stay active until you revoke them. If the contract is later exploited, or was malicious to begin with, it can drain whatever the approval covers. This tool shows what is still open.

```
$ approval-scanner 0xYourWallet --rpc https://your-rpc --revoke

TOKEN  SPENDER                                     ALLOWANCE  RISK
-----  ------------------------------------------  ---------  ---------
USDC   0x1111111111111111111111111111111111111111  UNLIMITED  unlimited
DAI    0x2222222222222222222222222222222222222222  2.5        limited

Revoke commands (set --rpc-url and a signer):
cast send 0x5Fb…aa3 "approve(address,uint256)" 0x1111…1111 0
...
1 unlimited approval found.
```

## Install and run

Needs Node 20+.

```sh
pnpm install
pnpm build
node dist/cli.js <address> --rpc <url>
# or, without building
pnpm dev <address> --rpc <url>
```

| Option | Meaning |
| --- | --- |
| `--rpc <url>` | JSON-RPC endpoint (or set `RPC_URL`) |
| `--from-block <n>` | First block to scan. Defaults to 0 |
| `--chunk <n>` | Starting block range per request. Defaults to 50000 and shrinks on its own |
| `--unlimited-only` | Hide limited approvals |
| `--revoke` | Print a `cast send` revoke command per approval |
| `--json` | Machine-readable output |

**Exit codes:** `0` clean, `1` error, `2` at least one unlimited approval was found. That makes it usable in a script or a scheduled job that alerts you.

## How it works

1. Fetch every `Approval(owner, spender, value)` log where `owner` is your wallet, across all token contracts, in block ranges. If the RPC rejects a range (providers cap range size or result count), it halves the range and keeps going.
2. Drop ERC-721 approvals. They share the same event signature but have a fourth indexed topic.
3. Keep only the latest log per (token, spender), ordered by block and log index.
4. **Re-read the live `allowance()` from each token.** The last event isn't always the current state (for example, tokens where `transferFrom` reduces allowance without emitting an event), so the on-chain value is the source of truth.
5. Hide zero allowances, flag anything at or above 2^255 as unlimited, and print the rest.

## Limitations

- **Scanning from block 0 is slow on large chains.** Use `--from-block` with the wallet's first transaction block. Providers with strict `eth_getLogs` limits will take longer.
- **ERC-20 `approve` only.** It does not cover Permit2 signatures, `permit()` signatures that were never submitted on-chain, or NFT `setApprovalForAll`.
- **Doesn't judge spenders.** It shows who has access, not whether that contract is trustworthy. Look up unfamiliar spenders on a block explorer before deciding.
- **Token symbol/decimals** that fail to read fall back to a shortened address and the raw value.
- It is read-only: it never signs or sends anything. The revoke commands are printed for you to run.

## Development

```sh
pnpm test        # unit tests
pnpm typecheck
```

The unit tests cover risk classification, picking the latest approval per pair (including ordering within a block), ERC-20 vs ERC-721 log decoding, adaptive range splitting against a fake RPC that rejects large ranges, and output formatting. I also ran the CLI end to end against a local anvil chain with unlimited, limited, overwritten and revoked approvals.

## License

MIT
