---
"@vsc.eco/market-core": patch
---

`MarketAmount.fromDecimal` now throws on empty input (`""`, `"-"`, `"."`) instead of reading it as zero. `MAINNET_CONFIG.gqlUrls` drops `api.vsc.eco`, which was retired and hangs instead of failing, so every first request no longer waits for a timeout.
