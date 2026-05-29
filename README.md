# Magi Market SDK

Headless SDK + embeddable panels for the Magi NFT-marketplace (magi-market) contract. Same structure, code styling, and auth model as the [Magi Token SDK](../nft-sdk) — pull only the layer you need.

## Packages

| Package | Description |
|---|---|
| [`@vsc.eco/market-core`](packages/core) | Operation builders for every magi-market entrypoint + cross-contract sell/auction/rental/mint-spot/buy composites, types, decimal helper. Zero runtime deps. |
| [`@vsc.eco/market-sdk`](packages/sdk) | Read providers (node state + indexer), broadcast orchestrator with chunked-batch + the cross-contract flows, deployer client. |
| [`@vsc.eco/market-widget`](packages/widget) | React components + web components — marketplace panels + per-action forms. *(in progress)* |

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
