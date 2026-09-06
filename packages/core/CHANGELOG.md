# @vsc.eco/market-core

## 0.0.3

### Patch Changes

- 2a15b34: Point `MAINNET_CONFIG` at the deployed mainnet magi-market contract (`vsc1BdZFXb8HdLptKUamNG4nL74hSb6UUBEiQA`, deployed 2026-07-22) instead of the testnet placeholder, and order the okinoko market-view indexer first for mainnet reads so listings don't silently resolve empty. `market-sdk` and `market-widget` republish via the internal `workspace:*` dependency bump.

## 0.0.2

### Patch Changes

- d29e379: Initial public npm release of the Magi Market SDK packages (@vsc.eco/market-core, @vsc.eco/market-sdk, @vsc.eco/market-widget).
- Mystery sales (random-draw buckets), a sweep that spends one asset, and paged reads

  **Buckets / mystery sales.** New ops and provider reads for random-draw sales:
  `buildListBucket` / `buildListBucketFlow` / `buildAddToBucket` /
  `buildAddToBucketFlow` / `buildBuyFromBucket` / `buildDelistBucket`, with
  `getBuckets`, `getBucketEntries`, `getBucketStacks` and `getBucketDraws`. A
  sale carries an optional on-chain `name` and cover-art candidates. Listing and
  restocking approve the marketplace per token rather than handing over the whole
  collection.

  **Groups of competing entries are `stacks`, not `pools`.** "Pool" already means
  a liquidity pool in this ecosystem and a bucket's stacks are nothing like one.
  `BucketPool` is `BucketStack`, `getBucketPools` is `getBucketStacks`, and the
  `pool` field on entries and draws is `stack`.

  **Sweep names the asset it spends.** `buildSweep` takes `paymentToken`. The
  contract adds every listing's cost into one `maxTotal` with no currency of its
  own, so a mixed-token sweep totalled two currencies into a cap belonging to
  neither and pulled both; the contract now rejects it and the SDK says which
  asset it means.

  **Every read is paged.** The indexer caps responses at 100 rows and ignores a
  larger `limit`, so every browse list silently showed a slice and called it the
  market. Both list helpers page with a total ordering, so all sixteen call sites
  are fixed; `looksTruncated` now means "stopped at the ceiling", not "a full
  page came back".

  **Widget.** Listings, bundles, mystery sales and mint spots merge into one
  "Buy now" tab grouped by collection; an Activity section reads a new
  `getActivity` feed; forms render as full-panel views and their transactions are
  watched to confirmation AND to the indexer catching up, so a refresh shows what
  you just did. NFT reads use the host app's configured endpoints instead of
  substituting token-sdk's defaults.

- 5ff7da3: Offer accept: gate the button on actually holding the NFT, and approve the marketplace as part of the accept.

  - core: new `buildAcceptOfferFlow` / `buildAcceptCollectionOfferFlow` composites — per-token `approve(market, tokenId, amount)` on the NFT contract followed by the accept leg, with `skipApproval` to drop the approve op.
  - sdk: `client.acceptOffer(...)` / `client.acceptCollectionOffer(...)` broadcast that flow as one chunked batch (same shape as `sell`).
  - widget: new `useUserNftHoldings` hook; the offers tab hides Accept for accounts that hold none of the offered item (per-token for a token-specific offer, any token of the collection for a collection offer) and `AcceptOfferForm` now picks the delivered tokenId from the seller's actual holdings, caps the amount by the held balance, and signs approve + accept together.
  - widget: **the indexer caps every response at 100 rows and silently ignores a larger `limit`**, so `useCollectionTokens` / `useUserNftHoldings` were reading the first page and presenting it as the whole set. On a 1023-token collection the offer picker showed 10% of the tokens and a holder map consisting entirely of the collection owner — tokens sold on to other accounts were simply past the cap. New `gqlFetchAllPages` helper does offset paging with a 6-page fan-out (1023 tokens: ~11s sequential → ~300ms).
  - widget: the offer picker now reports holders (`held by alice`) and renders un-deliverable tokens disabled with the reason (unminted, or soulbound and not held by the collection owner — magi_nft aborts unless `from == ownerAddr`) instead of dropping them silently, which read as a missing NFT.
  - widget: new **Explore** section — every NFT on the network and who holds it, including tokens nobody has listed. "Make offer" on someone else's, "List for sale" on your own. It sits one level ABOVE the market tabs (a `Market | Explore` switch beside the panel header) because it isn't an order-book view; the header badge/subtitle follow the section. Its indexer reads are gated on the section being open.
  - widget: Explore aggregates **one tile per token**, not per (token, holder). A magi-market offer is an open bid on `(nftContract, tokenId)` — `MakeOfferPayload` carries no seller and `doAcceptOffer` lets any holder accept — so a token held by 35 accounts was rendering 35 identical "Make offer" buttons and implying you could bid on one person's copy. The tile now summarises holders ("held by alice +34", full list in the tooltip), the button reads "Offer to any holder" when more than one account holds it (plain "Make offer" otherwise), and `MakeOfferForm` states who can accept.
  - widget: fix the Explore tile's holder line overflowing into the tile beside it. `.magi-market-row-sub` is `white-space: nowrap` and its `overflow`/`text-overflow` don't apply to an inline span, so "held by alessandrawhite +34" laid out at 197px inside a 176px tile. New `.magi-market-tile-holder` wraps instead, with the "+N" count bound to the name by a non-breaking space.
  - widget: Explore is **paged per collection**, not capped — a `Load more` per collection group plus an overall "N of M NFTs shown". Paging the flat list was wrong here: one testnet collection holds 1021 of 1052 holdings, so a flat first page showed only that collection and every other one looked missing.
  - widget: Explore **search** over token id, holder, collection name/id and template id.
  - widget: collection groups are ordered **alphabetically by display name** (case/accent-insensitive, `numeric` so "Series 2" precedes "Series 10") on every grouped view — listings, offers, auctions, mint spots, rentals and Explore — and each header shows the **collection owner** in parentheses after the name.
  - widget: Explore gets a **two-pane layout when the panel is wide enough** (≥640px measured on the panel itself, via `useElementWidth`/ResizeObserver — not a viewport media query, so an embed in a narrow column on a wide screen still gets the stacked accordion): collections down the left, the selected one's contents on the right. Mobile keeps the existing accordion unchanged.
  - widget: `useCollectionMeta` pages its `magi_nft_overview` read. Only 5–6 collections exist today so nothing changes yet, but past 100 an un-paged read would drop the tail, and a nameless collection degrades to a shortened contract id — which would also sort wrong in the name-ordered lists.
  - widget: Explore groups by collection and then by **mint template** (`magi_nft_template_tokens`, paged — token-sdk's `getTemplateLinks` is un-paged and would see 100 of ~1037 links). Editions of one template collapse under a single sub-header instead of filling the grid with near-identical tiles. New `TemplateGroup` component + `CollectionGroup layout="stack"`.
  - widget: `useNftImages` now chunks its own requests. Its comment claimed token-sdk chunked internally, but `getTokenProperties` puts every key in one `getStateByKeys` and swallows the failure — so any batch over the node's ~100-key limit resolved nothing and every tile silently fell back to the Magi logo.
  - widget: sub-tabs row fixes. The Others/Yours pills are pinned to the centre grid column instead of relying on auto-placement, which had dropped them into column 1 (left-aligned) whenever the tab action slot was hidden — i.e. on Explore. And on a narrow panel the tab action ("Sell an NFT" + "Sweep") now takes its own row above the pills, since one line needs ~460px. Driven by the panel's measured width, replacing a viewport media query that missed a phone-width column inside a wider page.
  - widget: mobile layout. The tab strip is now a horizontal scroller once the tabs stop fitting (`min-width: max-content` on the tab + `overflow-x: auto` on the strip) instead of overflowing the panel and dragging the host page sideways; the active tab is kept centred. The sub-tabs row gives the tab action its own line below ~520px, and a hint standing in for a tile button takes a full-width line.
