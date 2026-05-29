import { useEffect, useState } from 'react';
import type { MarketClient } from '@vsc.eco/market-sdk';

/** Hive-anchored testnet chain: verified at exactly 3.0s per block. */
const SECONDS_PER_BLOCK = 3;
/** Re-sync the chain head every 30s — fast enough that linear
 *  extrapolation never drifts by more than ~1 block. */
const RESYNC_MS = 30_000;
const TICK_MS = 1_000;

export interface ChainClock {
	/** Wall-clock epoch ms; updates every second so countdowns tick. */
	now: number;
	/** Snapshotted + linearly extrapolated current block; null while loading. */
	currentBlock: number | null;
	/** Wall-clock projection of when `block` will land (or did land). */
	blockToDate: (block: number) => Date | null;
	/** Seconds from `now` to `block`; negative if the block is in the past.
	 *  null while the first sync is in flight. */
	secondsUntilBlock: (block: number) => number | null;
}

/**
 * Anchors one `getBlockHeight()` snapshot plus wall-clock, then extrapolates
 * the head linearly at 3 s/block. Re-syncs every 30 s in the background so
 * drift stays sub-block. One hook instance per panel — the auction tiles
 * share its tick to drive countdowns + live Dutch prices.
 */
export function useChainClock(client: MarketClient): ChainClock {
	const [anchor, setAnchor] = useState<{ block: number; at: number } | null>(null);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		let cancelled = false;
		const sync = () => {
			client.provider
				.getBlockHeight()
				.then((b) => {
					if (cancelled || b == null) return;
					setAnchor({ block: b, at: Date.now() });
				})
				.catch(() => {
					/* keep last anchor — extrapolation degrades gracefully */
				});
		};
		sync();
		const id = setInterval(sync, RESYNC_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [client]);

	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), TICK_MS);
		return () => clearInterval(id);
	}, []);

	const currentBlock = anchor
		? anchor.block + Math.floor((now - anchor.at) / 1000 / SECONDS_PER_BLOCK)
		: null;

	const blockToDate = (block: number): Date | null => {
		if (!anchor) return null;
		const ms = anchor.at + (block - anchor.block) * SECONDS_PER_BLOCK * 1000;
		return new Date(ms);
	};
	const secondsUntilBlock = (block: number): number | null => {
		if (currentBlock == null) return null;
		return (block - currentBlock) * SECONDS_PER_BLOCK;
	};

	return { now, currentBlock, blockToDate, secondsUntilBlock };
}

/**
 * Pure mirror of `getDutchAuctionCurrentPriceBig` in the contract (see
 * `internal.go`): linear interpolation between `startPrice` (at startBlock)
 * and `endPrice` (at endBlock), clamped to either end. Inputs/outputs are
 * raw smallest-unit integer strings.
 */
export function dutchCurrentPrice(
	startPrice: string,
	endPrice: string,
	startBlock: number,
	endBlock: number,
	currentBlock: number
): string {
	if (!startPrice) return endPrice || '0';
	if (currentBlock <= startBlock) return startPrice;
	if (currentBlock >= endBlock) return endPrice || '0';
	try {
		const sp = BigInt(startPrice);
		const ep = BigInt(endPrice || '0');
		if (ep >= sp) return startPrice; // contract enforces ep<sp at create
		const elapsed = BigInt(currentBlock - startBlock);
		const duration = BigInt(endBlock - startBlock);
		const drop = ((sp - ep) * elapsed) / duration;
		return (sp - drop).toString();
	} catch {
		return startPrice;
	}
}

/** Local-time German date format: `dd.MM.yyyy, HH:mm` (24h, locale's
 *  separator, user's own timezone — the projection accuracy depends on
 *  the chain clock anchor, not the display). */
const GERMAN_DATE_FMT =
	typeof Intl !== 'undefined'
		? new Intl.DateTimeFormat('de-DE', {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				hourCycle: 'h23'
			})
		: null;

export function formatGermanDateTime(d: Date): string {
	return GERMAN_DATE_FMT ? GERMAN_DATE_FMT.format(d) : d.toISOString();
}

/** Human-readable countdown like "1h 23m 45s"; "ended" once seconds <= 0. */
export function formatCountdown(seconds: number): string {
	if (seconds <= 0) return 'ended';
	const s = Math.floor(seconds);
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (d > 0) return `${d}d ${h}h ${m}m`;
	if (h > 0) return `${h}h ${m}m ${sec}s`;
	if (m > 0) return `${m}m ${sec}s`;
	return `${sec}s`;
}
