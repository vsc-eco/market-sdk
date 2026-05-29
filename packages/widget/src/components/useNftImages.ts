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
 * `resolveNftImages` itself batches per contract and chunks the
 * `getStateByKeys` keys inside `getTokenProperties`, so a 1000-token
 * collection won't blow the node's request size.
 */
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
		nft.nft.provider
			.resolveNftImages(stubs)
			.then((map) => {
				if (cancelled) return;
				setImages((prev) => {
					const next = new Map(prev);
					for (const m of missing) {
						const k = `${m.nftContract}:${m.tokenId}`;
						next.set(k, map.get(k) ?? null);
					}
					return next;
				});
			})
			.catch(() => {
				if (cancelled) return;
				setImages((prev) => {
					const next = new Map(prev);
					for (const m of missing) next.set(`${m.nftContract}:${m.tokenId}`, null);
					return next;
				});
			})
			.finally(() => !cancelled && setReady(true));
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
