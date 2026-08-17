import { useEffect, useMemo, useState } from 'react';
import type { MagiConfig } from '@vsc.eco/market-sdk';
import {
	createNftClient,
	MAINNET_CONFIG as TOKEN_MAINNET,
	TESTNET_CONFIG as TOKEN_TESTNET,
	type NftItem
} from '@vsc.eco/token-sdk';

/**
 * Resolve per-token image URLs for a list of (nftContract, tokenId) refs
 * via the token-sdk NFT provider — same 3-tier priority as `NftPicker`
 * (own props → template props → baseUri+tokenId). Results are cached by
 * `${contractId}:${tokenId}` so re-renders don't re-fetch resolved items,
 * and an early-bailout skips items already in the map.
 *
 * Requests are chunked HERE, not by the provider: token-sdk's
 * `getTokenProperties` puts every key into a single `getStateByKeys` and
 * swallows the failure, so one call covering more than the node's ~100-key
 * limit resolves nothing and every tile silently falls back to the Magi
 * logo. Chunking at this layer keeps each call well inside the limit (the
 * market provider uses the same 80-key bound for its own state reads), and
 * a partial failure then costs one chunk instead of the whole view.
 */
const CHUNK = 40;
export interface NftImagesResult {
	get: (nftContract: string, tokenId: string) => string | null | undefined;
	ready: boolean;
}

export function useNftImages(
	config: MagiConfig,
	items: ReadonlyArray<{ nftContract: string; tokenId: string }>
): NftImagesResult {
	const tokenConfig = useMemo(
		() => (config.network === 'vsc-testnet' ? TOKEN_TESTNET : TOKEN_MAINNET),
		[config.network]
	);
	const nft = useMemo(() => createNftClient({ config: tokenConfig }), [tokenConfig]);
	const [images, setImages] = useState<Map<string, string | null>>(new Map());
	const [ready, setReady] = useState(false);

	const sig = useMemo(
		() => items.map((i) => `${i.nftContract}:${i.tokenId}`).join('|'),
		[items]
	);

	useEffect(() => {
		if (!items.length) {
			setReady(true);
			return;
		}
		// Bail early if every requested item is already resolved.
		const missing = items.filter((i) => !images.has(`${i.nftContract}:${i.tokenId}`));
		if (missing.length === 0) {
			setReady(true);
			return;
		}
		let cancelled = false;
		setReady(false);
		// `resolveNftImages` wants `NftItem` shape; we only have refs.
		// The provider's image-resolution path uses contractId, tokenId,
		// templateId, and collection.baseUri — everything else is unread,
		// so a stub item is safe.
		const stubs = missing.map(
			(m) =>
				({
					contractId: m.nftContract,
					tokenId: m.tokenId,
					balance: 0,
					maxSupply: 0,
					isUnique: false,
					soulbound: false,
					collection: { contractId: m.nftContract, name: '', symbol: '', owner: '', baseUri: undefined },
					templateId: null
				}) as unknown as NftItem
		);
		// Resolve chunk by chunk, committing each as it lands so a long list
		// fills in progressively instead of staying on the fallback logo until
		// the last request returns. A chunk that throws marks only its own
		// items resolved-as-null.
		(async () => {
			for (let i = 0; i < stubs.length && !cancelled; i += CHUNK) {
				const slice = stubs.slice(i, i + CHUNK);
				const refs = missing.slice(i, i + CHUNK);
				let map = new Map<string, string | null>();
				try {
					map = await nft.nft.provider.resolveNftImages(slice);
				} catch {
					/* fall through — this chunk resolves to null */
				}
				if (cancelled) return;
				setImages((prev) => {
					const next = new Map(prev);
					for (const m of refs) {
						const k = `${m.nftContract}:${m.tokenId}`;
						next.set(k, map.get(k) ?? null);
					}
					return next;
				});
			}
			if (!cancelled) setReady(true);
		})();
		return () => {
			cancelled = true;
		};
	}, [nft, sig]); // eslint-disable-line react-hooks/exhaustive-deps

	return useMemo(
		() => ({
			get: (nftContract: string, tokenId: string) => images.get(`${nftContract}:${tokenId}`),
			ready
		}),
		[images, ready]
	);
}
