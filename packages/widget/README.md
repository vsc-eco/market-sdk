# @vsc.eco/market-widget

Embeddable Magi NFT-marketplace panel — React component **and** web component. Builds on [`@vsc.eco/market-sdk`](../sdk). Structure, chrome, theming, and signer model mirror [`@vsc.eco/token-widget`](../../../nft-sdk/packages/widget).

## React

```tsx
import { MagiMarketPanel } from '@vsc.eco/market-widget';
import '@vsc.eco/market-widget/themes/light.css'; // optional light theme

<MagiMarketPanel username="alice" aioha={aioha} config={TESTNET_CONFIG} />
```

## Web component

```html
<script type="module" src="@vsc.eco/market-widget/webcomponent"></script>
<magi-market-panel id="m"></magi-market-panel>
<script>
  const el = document.getElementById('m');
  el.username = 'alice';
  el.aioha = aiohaInstance;   // object props set as JS properties
  el.config = TESTNET_CONFIG;
</script>
```

## What it renders

- A connected-user header with **Sell an NFT**, **New auction**, **Sell mint spots**, **Make offer** CTAs.
- Tabs — **Listings / Auctions / Mint spots** — read from `client.provider`.
- Per-row **Buy** / **Offer** modals.
- Every write goes through the SDK's cross-contract orchestrator: selling/auctioning/mint-spot-listing emit the NFT-approval leg + the market leg and are signed as one chunked batch; buying batches the token `approve` + `buy` (or a native `transfer.allow` intent).

Action forms ship as named exports too (`ListForm`, `BuyForm`, `MakeOfferForm`, `CreateAuctionForm`, `ListMintSpotsForm`) plus `MarketActionButton` — hosts that render their own listing grid can keep their UI and adopt only the modals.
