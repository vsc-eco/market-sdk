# Magi Market SDK

Headless SDK + embeddable panels for the Magi NFT-marketplace (magi-market) contract. Same structure, code styling, and auth model as the [Magi Token SDK](../nft-sdk) — pull only the layer you need.

## Packages

| Package | Description |
|---|---|
| [`@vsc.eco/market-core`](packages/core) | Operation builders for every magi-market entrypoint + cross-contract sell/auction/rental/mint-spot/buy composites, types, decimal helper. Zero runtime deps. |
| [`@vsc.eco/market-sdk`](packages/sdk) | Read providers (node state + indexer), broadcast orchestrator with chunked-batch + the cross-contract flows, deployer client. |
| [`@vsc.eco/market-widget`](packages/widget) | React components + web components — marketplace panels + per-action forms. *(in progress)* |

## Installing while npm publishing is blocked

The packages are served as ordinary npm tarballs from
**<https://market-sdk.okinoko.io/pkg/>** — no auth, `.d.ts` included, and
installable by npm/pnpm/yarn/bun. That page carries the current URLs;
`/pkg/latest.json` is the machine-readable form.

```json
"dependencies": {
  "@vsc.eco/market-widget": "https://market-sdk.okinoko.io/pkg/v/market-widget-<version>.tgz",
  "@vsc.eco/market-sdk":    "https://market-sdk.okinoko.io/pkg/v/market-sdk-<version>.tgz"
}
```

The widget line alone is enough to *render the panel* — its `market-core` /
`market-sdk` deps are rewritten to the matching tarball URLs, so they come
along transitively. Add the `market-sdk` line only if you import it yourself:
under pnpm's isolated `node_modules` a transitive dep isn't importable by the
consumer, so `tsc` would fail with `TS2307`.

URLs are immutable and content-addressed — the `-local.<hash>` suffix is a
hash of the compiled output, and the tarballs are byte-reproducible, so
republishing unchanged output keeps existing lockfiles valid. To upgrade, read
`latest.json` and bump the URL. There is deliberately no moving `latest.tgz`:
a lockfile pins a URL's bytes by integrity, so a URL whose contents change
either serves stale code or fails installs with `EINTEGRITY`.

Republish with `/home/dockeruser/okinoko/publish-market-sdk-tarballs.sh`
(okinoko host). For developing against an unpublished change, prefer a
`link:` dep on the checkout — but then set
`resolve.dedupe: ['react', 'react-dom']` in the consumer's Vite config, or the
panel runs on a second React instance and every hook call throws.

## Deployed instance

`TESTNET_CONFIG` targets the live testnet marketplace
**`vsc1BnMAaeUzhzVcfKMDG5vphthhymk6irjLNq`** (owner `hive:magi.contracts`,
feeBps 0, deployed/initialized 2026-05-19).

## Cross-contract selling

magi-market keeps NFTs with the seller (operator approval, no escrow). The
SDK models this as a two-op flow on two contracts and signs it as one
chunked batch:

```ts
await market.sell('alice', { nftContract, tokenId: '1', amount: 1,
  paymentToken, pricePerUnit: '10.000' });
// → setApprovalForAll(market,true) on the NFT contract, then list(...) on the market
```

The same pattern covers `auction`, `rental`, `mintSpotListing`
(operator **or** per-token allowance), and `buyWithPayment`.

**Accepting a buy offer is the same kind of flow.** Accepting hands the NFT
to the buyer, so the market needs transfer authorization first — a seller
who never listed the token has none, and the bare accept aborts with
"Marketplace not approved as operator or sufficient per-token allowance to
fulfill offer":

```ts
await market.acceptOffer('alice', { offerId: 7, amount: 1,
  nftContract, tokenId: '1' });
// → approve(market, '1', 1) on the NFT contract, then acceptOffer(...) on the market
```

Collection-wide offers use `acceptCollectionOffer` with the `tokenId` the
holder chooses to deliver. Pass `skipApproval: true` on either when the
market is already authorized.
