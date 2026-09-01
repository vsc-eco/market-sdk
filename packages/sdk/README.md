# @vsc.eco/market-sdk

Read providers + a broadcast orchestrator + a deployer client for the Magi NFT-marketplace. Builds on [`@vsc.eco/market-core`](../core). Scope, styling, and signer model mirror [`@vsc.eco/token-sdk`](../../../nft-sdk/packages/sdk) exactly.

## `createMarketClient(opts)`

```ts
import { createMarketClient, TESTNET_CONFIG } from '@vsc.eco/market-sdk';

const market = createMarketClient({ config: TESTNET_CONFIG, aioha });

// reads
const info = await market.provider.getMarketInfo();           // node state — schema-free
const mine = await market.provider.getListings({ seller: 'hive:alice' });

// headless: build an op, sign it yourself
const { op } = market.ops.buyOp('alice', { listingId: 3, amount: 1 });

// one-shot cross-contract "sell": NFT approve + list, chunked-batch signed
await market.sell('alice', {
  nftContract: 'vsc1...nft',
  tokenId: '1', amount: 1,
  paymentToken: 'vsc1...token', pricePerUnit: '10.000'
});

// accepting a buy offer needs the same authorization: approve + acceptOffer
await market.acceptOffer('alice', {
  offerId: 7, amount: 1,
  nftContract: 'vsc1...nft', tokenId: '1'
});
```

`TESTNET_CONFIG` is pre-wired to the deployed testnet marketplace
`vsc1BnMAaeUzhzVcfKMDG5vphthhymk6irjLNq`.

## Layers

- **Provider** (`createMarketProvider`) — `getMarketInfo()` via the VSC node
  `getStateByKeys` (authoritative, schema-free); listing/offer/auction/
  bundle/swap/rental/mint-spot views via the indexer Hasura tables
  (`magi_market_*`, mirroring token-sdk's indexer dependence). Both planes
  use the shared `gqlFetchFailover` (multi-endpoint, abortable, timed).
- **Orchestrator** — `broadcast` (single) / `broadcastBatch` (chunked, one
  signature per `chunkSize` ops, a Hive block of spacing between chunks).
  The cross-contract helpers (`sell`, `auction`, `rental`,
  `mintSpotListing`, `acceptOffer`, `acceptCollectionOffer`,
  `buyWithPayment`) emit the approval leg + the market
  leg and run them through `broadcastBatch`. Same Aioha
  (`vscCallContract` → `signAndBroadcastTx`) / custom `onBroadcast`
  fallback chain as token-sdk.
- **Deployer** (`createDeployerClient`) — prepare-deploy + SSE log stream +
  op substitution, for (re)deploying the marketplace wasm. Mirrored from
  token-sdk (contract-agnostic).

## Headless

Skip `aioha`/`onBroadcast`, use `market.ops.*Op(...)` to get `{ op, call }`
bundles, and broadcast them however you like.
