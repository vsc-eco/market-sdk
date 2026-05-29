import { useMemo, useState } from 'react';
import type { Auction, MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { dutchCurrentPrice, formatCountdown, useChainClock } from '../components/useChainClock.js';

export interface MakeBidFormProps {
	client: MarketClient;
	username: string;
	auction: Auction;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

const NATIVE = new Set(['hive', 'hbd']);

/**
 * Place a bid on a live auction. For a native payment token (HIVE/HBD)
 * we attach a `transfer.allow` intent so the contract can pull funds at
 * settlement (english) or immediately (dutch). For a magi_token payment,
 * the bidder must have approved the marketplace separately first; the op
 * is broadcast as a single call.
 *
 * The contract requires `bidAmount` as an integer string in the payment
 * token's smallest unit (no decimals; `parseMoney` rejects anything else).
 * Human input → micro-units via `useTokenMeta`, which picks the right
 * decimals (3 for HBD/HIVE; per-token for magi_tokens).
 */
export function MakeBidForm({ client, username, auction, onSuccess, onClose }: MakeBidFormProps) {
	const tokenMeta = useTokenMeta(client.config);
	const paySymbol = tokenMeta.symbol(auction.paymentToken || 'hive');
	const isNative = NATIVE.has((auction.paymentToken || '').toLowerCase());

	const paymentToken = auction.paymentToken || 'hive';
	const isDutch = auction.auctionType === 'dutch';

	const clock = useChainClock(client);

	// Dutch: live current price ticks down each second, computed from the
	// chain clock anchor. Bid amount is locked to this — the contract only
	// charges the live current price anyway, and any higher declared bid
	// would be wasted (post-decay it's the same totalPrice that's pulled).
	const liveDutchMicro = useMemo(() => {
		if (!isDutch || clock.currentBlock == null) return null;
		return dutchCurrentPrice(
			auction.startPrice,
			auction.endPrice ?? '0',
			auction.startBlock ?? 0,
			auction.endBlock,
			clock.currentBlock
		);
	}, [isDutch, clock.currentBlock, auction.startPrice, auction.endPrice, auction.startBlock, auction.endBlock]);

	// English: editable bid; default is current high + 1 step, else start.
	const englishDefault = useMemo(
		() => tokenMeta.format(paymentToken, auction.highBid ?? auction.startPrice ?? '0'),
		[paymentToken, auction.highBid, auction.startPrice, tokenMeta]
	);
	const [englishBid, setEnglishBid] = useState(englishDefault);
	const englishMicro = useMemo(
		() => tokenMeta.toMicro(paymentToken, englishBid),
		[englishBid, paymentToken, tokenMeta]
	);
	const englishMin = useMemo(() => {
		const cur = auction.highBid ?? auction.startPrice ?? '0';
		try {
			return (BigInt(cur) + (auction.highBid ? 1n : 0n)).toString();
		} catch {
			return cur;
		}
	}, [auction.highBid, auction.startPrice]);

	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const secsLeft = useMemo(
		() => (isDutch ? clock.secondsUntilBlock(auction.endBlock) : null),
		[isDutch, clock, auction.endBlock]
	);
	const dutchEnded = secsLeft != null && secsLeft <= 0;

	const valid = isDutch
		? !!liveDutchMicro && !dutchEnded
		: !!englishMicro && (() => {
				try {
					return BigInt(englishMicro) >= BigInt(englishMin);
				} catch {
					return false;
				}
			})();

	async function handleSubmit() {
		if (!valid || submitting) return;
		// Recompute the dutch price from the freshest tick at submit-time so
		// we never sign a stale figure (the displayed value updates every
		// second; the user could click between ticks).
		let microBid: string | null;
		if (isDutch) {
			if (clock.currentBlock == null) return;
			microBid = dutchCurrentPrice(
				auction.startPrice,
				auction.endPrice ?? '0',
				auction.startBlock ?? 0,
				auction.endBlock,
				clock.currentBlock
			);
		} else {
			microBid = englishMicro;
		}
		if (!microBid) return;

		setSubmitting(true);
		setError(null);
		try {
			const intents = isNative
				? [{ type: 'transfer.allow' as const, args: { limit: microBid, token: auction.paymentToken || 'hive' } }]
				: undefined;
			const op = client.ops.placeBidOp(username, { auctionId: auction.auctionId, bidAmount: microBid }, intents);
			const { txId: tx } = await client.broadcast(op);
			setTxId(tx);
			onSuccess?.(tx);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	const subtitle = isDutch
		? `dutch · ${secsLeft != null ? `${formatCountdown(secsLeft)} left` : '…'}`
		: `english · ${auction.highBid ? `current high ${tokenMeta.format(paymentToken, auction.highBid)} ${paySymbol}` : `start ${tokenMeta.format(paymentToken, auction.startPrice)} ${paySymbol}`}`;

	return (
		<Modal title={`Bid on #${auction.tokenId}`} subtitle={subtitle} onClose={onClose}>
			{txId ? (
				<>
					<BroadcastResult txId={txId} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : isDutch ? (
				<>
					<Field
						label={`Current price (${paySymbol})`}
						hint="Dutch auction — buy at the live price. The contract pulls exactly this amount; the price ticks down each block until the auction ends."
					>
						<TextInput
							value={liveDutchMicro ? tokenMeta.format(paymentToken, liveDutchMicro) : '…'}
							onChange={() => {}}
							disabled
						/>
					</Field>
					{dutchEnded && <p className="magi-market-status error">Auction has ended.</p>}
					{error && <p className="magi-market-status error">{error}</p>}
					<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
						{submitting ? 'Buying…' : 'Buy now'}
					</button>
				</>
			) : (
				<>
					<Field
						label={`Bid amount (${paySymbol})`}
						hint={`English auction — bid must be at least ${tokenMeta.format(paymentToken, englishMin)} ${paySymbol}.`}
					>
						<TextInput inputMode="decimal" value={englishBid} onChange={setEnglishBid} placeholder="0.500" disabled={submitting} />
					</Field>
					{error && <p className="magi-market-status error">{error}</p>}
					<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
						{submitting ? 'Bidding…' : 'Place bid'}
					</button>
				</>
			)}
		</Modal>
	);
}

