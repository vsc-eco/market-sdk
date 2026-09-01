# @vsc.eco/market-core

Pure operation builders + types for the Magi NFT-marketplace (magi-market) contract. Zero runtime dependencies.

This package builds Hive `custom_json` operations and the inner `vsc.call` payloads — it does NOT broadcast, query, or sign anything. Use it directly for full control of the signing pipeline; otherwise reach for `@vsc.eco/market-sdk` (queries + broadcast orchestrator + deployer client) or `@vsc.eco/market-widget` (React components).

The split, styling, and auth model mirror [`@vsc.eco/token-core`](../../../nft-sdk/packages/core) exactly.

## What's covered

Every magi-market write entrypoint has a `build*` op builder:

- **Listings** — `buildList`, `buildDelist`, `buildBuy`, `buildUpdateListing`, `buildBatchList`, `buildBatchBuy`
- **Offers** — `buildMakeOffer`, `buildCancelOffer`, `buildAcceptOffer`, `buildAcceptCollectionOffer`
- **Auctions** — `buildCreateAuction`, `buildPlaceBid`, `buildSettleAuction`, `buildCancelAuction`, `buildSetMinBidIncrement`, `buildSetAntiSnipeBlocks`
- **Royalties & fees** — `buildSetRoyalty`, `buildSetRoyaltySplits`, `buildSetFee`, `buildSetFeeRecipient`, `buildSetCollectionFee`, `buildClearCollectionFee`, `buildSetMinOffer`
- **Sweep & bundles** — `buildSweep`, `buildListBundle`, `buildBuyBundle`, `buildDelistBundle`
- **Swaps** — `buildProposeSwap`, `buildAcceptSwap`, `buildCancelSwap`
- **Rentals** — `buildListRental`, `buildRent`, `buildEndRental`, `buildEndRentalEarly`, `buildDelistRental`
- **Mint spots** — `buildListMintSpots`, `buildBuyMintSpot`, `buildDelistMintSpots`
- **Governance & payment tokens** — `buildChangeOwner`, `buildAcceptOwnership`, `buildCancelOwnershipTransfer`, `buildPause`, `buildUnpause`, `buildDenyCollection`, `buildAllowCollection`, `buildAddPaymentToken`, `buildRemovePaymentToken`, `buildEmergencyWithdraw`, `buildInit`

## Cross-contract flows

magi-market never escrows listed NFTs — it moves them via operator approval on the **NFT contract**. "Putting an NFT up for sale" is therefore two ops on two contracts. The composites assemble the correct multi-op bundle (hand straight to `broadcastBatch`):

- `buildSellNftFlow` — NFT `setApprovalForAll(market,true)` + `list`
- `buildAuctionNftFlow` — approve + `createAuction`
- `buildRentalNftFlow` — approve + `listRental`
- `buildMintSpotFlow` — operator approval **or** per-token `approve(market,id,maxSpots)` + `listMintSpots`
- `buildAcceptOfferFlow` — NFT `approve(market,tokenId,amount)` + `acceptOffer`
- `buildAcceptCollectionOfferFlow` — same approve leg + `acceptCollectionOffer` (holder picks the `tokenId` to deliver)
- `buildBuyWithPayment` — token `approve(market,total)` + `buy`

Accepting an offer is a *sale*, so it needs the same authorization as
listing: `doAcceptOffer` pulls the NFT from the accepter via magi_nft's
`safeTransferFrom` and preflight-aborts without an operator approval or a
per-token allowance ≥ the accepted amount.

Native (HBD/HIVE) payments use a `transfer.allow` intent instead — see `nativeTransferAllow`.

## Auth

Identical to `@vsc.eco/token-core`: `buildVscCallOp` wraps a `vsc.call` in a Hive `custom_json` (`required_auths: [account]`), `normalizeHiveAccount`, `isValidHiveUsername`. Default `rcLimit` is **10000** — magi-market's heavier entrypoints (`init`, auction settle, sweep, bundles) reject `1000` with "cost limit exceeded".

## Decimals

`MarketAmount` (mirrors `TokenAmount`) converts a human `"12.345"` to the smallest-unit decimal string magi-market expects on the wire, and back.
