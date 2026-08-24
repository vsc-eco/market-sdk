import { useEffect, useMemo, useRef, useState } from 'react';
import type { BucketDraw, BucketListing, MarketClient } from '@vsc.eco/market-sdk';
import { createNftClient, 	type NftItem
} from '@vsc.eco/token-sdk';
import { tokenConfigFrom } from '../components/tokenConfig.js';
import { Spinner } from '../components/Spinner.js';
import { useTxStatus } from '../components/useTxStatus.js';
import magiSvg from '../assets/magi.svg';

export interface DrawRevealProps {
	client: MarketClient;
	bucket: BucketListing;
	/** The purchase to reveal. Draws are matched to it by tx. */
	txId: string;
	/** Stacks that guarantee something, so a hit can be called out. */
	rareStacks?: number[];
	onClose: () => void;
	onOpenNft: (nftContract: string, tokenId: string) => void;
}

/**
 * What you just pulled.
 *
 * The contract picks the NFT, and until now the widget threw that answer
 * away — you paid, the grid refreshed, and the card appeared in your wallet
 * with nothing to mark it. The whole appeal of a random draw is the moment
 * you find out, so this is that moment: cards land face-down and turn over
 * one after another.
 *
 * The reveal reads the chain's own `bucket_draw` events rather than anything
 * the client guessed, so what it shows is what actually happened — including
 * the order the contract drew in.
 */
export function DrawReveal({ client, bucket, txId, rareStacks, onClose, onOpenNft }: DrawRevealProps) {
	const [draws, setDraws] = useState<BucketDraw[] | null>(null);
	const [images, setImages] = useState<Map<string, string | null>>(new Map());
	const [timedOut, setTimedOut] = useState(false);
	// How many have turned over. Drives the stagger.
	const [shown, setShown] = useState(0);
	const cancelled = useRef(false);

	/**
	 * Follow the transaction to `indexed` first.
	 *
	 * The draws live in the indexer, so asking for them before it has read
	 * the block they are in can only return nothing. This used to run its own
	 * 30-second timer and give up — which is what put "the indexer hasn't
	 * caught up" on screen for a purchase that had worked perfectly.
	 */
	const { state } = useTxStatus(client.config, txId);

	// Once the block is indexed the rows are there; a couple of retries cover
	// the moment between the health check advancing and the insert landing.
	useEffect(() => {
		if (state !== 'indexed') return;
		cancelled.current = false;
		let tries = 0;
		const tick = async () => {
			if (cancelled.current) return;
			tries++;
			const rows = await client.provider.getBucketDraws({ txId });
			if (cancelled.current) return;
			if (rows.length > 0) {
				setDraws(rows.sort((a, b) => a.drawIndex - b.drawIndex));
				return;
			}
			if (tries >= 10) {
				setTimedOut(true);
				return;
			}
			setTimeout(tick, 2000);
		};
		void tick();
		return () => {
			cancelled.current = true;
		};
	}, [state, client, txId]);

	// A transaction that failed on chain drew nothing — say that, rather than
	// waiting out a clock for rows that are never coming.
	useEffect(() => {
		if (state === 'failed') setTimedOut(true);
	}, [state]);

	// Art for the drawn tokens, once we know what they are. Same resolver the
	// bucket card uses, so a revealed card looks like the one in the stack.
	const tokenConfig = useMemo(
		() => tokenConfigFrom(client.config),
		[client.config.network]
	);
	const nft = useMemo(() => createNftClient({ config: tokenConfig }), [tokenConfig]);

	useEffect(() => {
		if (!draws || draws.length === 0) return;
		let alive = true;
		(async () => {
			try {
				const map = await nft.nft.provider.resolveNftImages(
					Array.from(new Set(draws.map((d) => d.tokenId))).map(
						(tokenId) => ({ contractId: bucket.nftContract, tokenId }) as NftItem
					)
				);
				if (alive) setImages(map);
			} catch {
				/* art is a bonus; the reveal still works without it */
			}
		})();
		return () => {
			alive = false;
		};
	}, [draws, nft, bucket.nftContract]);

	// Turn them over one at a time. A pack that revealed all ten at once
	// would be a list, not a reveal.
	useEffect(() => {
		if (!draws) return;
		if (shown >= draws.length) return;
		const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 250 : 420);
		return () => clearTimeout(t);
	}, [draws, shown]);

	const rare = useMemo(() => new Set(rareStacks ?? []), [rareStacks]);
	const allShown = draws != null && shown >= draws.length;

	if (timedOut) {
		return (
			<div className="magi-market-reveal">
				<p className="magi-market-status warn">
					{state === 'failed'
						? 'That draw failed on chain — nothing was drawn and nothing was charged.'
						: 'Your draw went through, but we still cannot read the cards back. They are in your wallet either way — check the NFT page.'}
				</p>
				<button type="button" className="magi-market-submit" onClick={onClose}>Close</button>
			</div>
		);
	}

	if (!draws) {
		const waiting =
			state === 'pending'
				? 'Waiting for the network…'
				: state === 'included'
					? 'In a block — finalising…'
					: state === 'confirmed'
						? 'Confirmed — reading your cards…'
						: 'Opening…';
		return (
			<div className="magi-market-reveal">
				<div className="magi-market-reveal-wait">
					<Spinner />
					<p className="magi-market-field-hint">{waiting}</p>
					<p className="magi-market-field-hint magi-market-reveal-patience">
						This takes a few seconds — the cards are almost yours.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="magi-market-reveal">
			<div className="magi-market-reveal-cards">
				{draws.map((d, i) => {
					const flipped = i < shown;
					const isRare = rare.has(d.stack);
					const img = images.get(`${bucket.nftContract}:${d.tokenId}`) ?? null;
					return (
						<div
							key={`${d.tokenId}-${d.drawIndex}`}
							className={`magi-market-card${flipped ? ' flipped' : ''}${isRare ? ' rare' : ''}`}
							style={{ ['--i' as string]: String(i) }}
							role="button"
							tabIndex={flipped ? 0 : -1}
							title={flipped ? `#${d.tokenId}` : undefined}
							onClick={() => flipped && onOpenNft(bucket.nftContract, d.tokenId)}
							onKeyDown={(e) => {
								if (flipped && (e.key === 'Enter' || e.key === ' ')) {
									e.preventDefault();
									onOpenNft(bucket.nftContract, d.tokenId);
								}
							}}
						>
							<div className="magi-market-card-inner">
								<div className="magi-market-card-back" aria-hidden="true">
									<img src={magiSvg} alt="" />
								</div>
								<div className="magi-market-card-face">
									{img ? (
										<img src={img} alt={`#${d.tokenId}`} loading="lazy" />
									) : (
										<img src={magiSvg} alt={`#${d.tokenId}`} className="magi-market-tile-fallback-img" />
									)}
									{isRare && <span className="magi-market-card-hit">Guaranteed</span>}
									<span className="magi-market-card-id">#{d.tokenId}</span>
								</div>
							</div>
						</div>
					);
				})}
			</div>

			<p className="magi-market-field-hint magi-market-reveal-sum">
				{allShown
					? `${draws.length} card${draws.length === 1 ? '' : 's'} delivered to your wallet.`
					: 'Turning them over…'}
			</p>

			<div className="magi-market-reveal-actions">
				{!allShown && (
					<button
						type="button"
						className="magi-market-submit ghost"
						onClick={() => setShown(draws.length)}
					>
						Reveal all
					</button>
				)}
				<button type="button" className="magi-market-submit" onClick={onClose}>Done</button>
			</div>
		</div>
	);
}
