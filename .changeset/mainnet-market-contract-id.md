---
"@vsc.eco/market-core": patch
---

Point `MAINNET_CONFIG` at the deployed mainnet magi-market contract (`vsc1BdZFXb8HdLptKUamNG4nL74hSb6UUBEiQA`, deployed 2026-07-22) instead of the testnet placeholder, and order the okinoko market-view indexer first for mainnet reads so listings don't silently resolve empty. `market-sdk` and `market-widget` republish via the internal `workspace:*` dependency bump.
