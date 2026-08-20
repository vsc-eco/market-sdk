import type { ActivityEvent } from '@vsc.eco/market-sdk';

export interface ActivityFeedProps {
	events: ActivityEvent[];
	/** `hive:alice` → shown as "you" when it matches. */
	me?: string;
	collectionName: (contractId: string) => string;
	formatPrice: (token: string | undefined, micro: string | undefined) => string | null;
	onOpenNft: (nftContract: string, tokenId: string) => void;
	emptyLabel: string;
}

const KIND_LABEL: Record<string, string> = {
	bought: 'bought',
	mintSpotBought: 'minted',
	bundleBought: 'bought a bundle',
	bucketPurchase: 'opened',
	swept: 'swept'
};

/** "3m", "5h", "2d" — a feed wants elapsed time, not a timestamp. */
function ago(at?: string): string {
	if (!at) return '';
	const t = new Date(at.endsWith('Z') ? at : `${at}Z`).getTime();
	if (!Number.isFinite(t)) return '';
	const s = Math.max(0, (Date.now() - t) / 1000);
	if (s < 60) return `${Math.floor(s)}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
}

const bare = (a: string) => a.replace(/^hive:/, '');
/** Rows store `hive:alice`; the panel's `me` is already stripped to `alice`. */
const norm = (a?: string) => bare((a ?? '').trim()).toLowerCase();

/**
 * What has actually been happening.
 *
 * Every one of these events was already being indexed and none of it was ever
 * shown — so a collection with a sale a minute looked exactly like a dead one.
 * Sales are the strongest signal a marketplace has about whether anything here
 * is worth buying, and this is the first place the widget says so out loud.
 */
export function ActivityFeed({
	events,
	me,
	collectionName,
	formatPrice,
	onOpenNft,
	emptyLabel
}: ActivityFeedProps) {
	if (events.length === 0) {
		return <div className="magi-market-state">{emptyLabel}</div>;
	}
	return (
		<ul className="magi-market-activity">
			{events.map((e, i) => {
				const isMe = !!me && norm(e.actor) === norm(me);
				const price = formatPrice(e.paymentToken, e.price);
				const what =
					e.tokenId && e.nftContract ? (
						<button
							type="button"
							className="magi-market-activity-link"
							onClick={() => onOpenNft(e.nftContract as string, e.tokenId as string)}
						>
							#{e.tokenId}
						</button>
					) : e.count != null ? (
						<span>
							{e.count} {e.kind === 'swept' ? 'listings' : 'items'}
						</span>
					) : (
						<span>an item</span>
					);
				return (
					<li key={`${e.txId ?? i}-${i}`} className="magi-market-activity-row">
						<span className={`magi-market-activity-kind ${e.kind}`}>{KIND_LABEL[e.kind] ?? e.kind}</span>
						<span className="magi-market-activity-main">
							<span className={`magi-market-activity-actor${isMe ? ' me' : ''}`}>
								{isMe ? 'You' : bare(e.actor)}
							</span>{' '}
							{what}
							{e.nftContract && (
								<span className="magi-market-activity-coll"> · {collectionName(e.nftContract)}</span>
							)}
						</span>
						{price && <span className="magi-market-activity-price">{price}</span>}
						<span className="magi-market-activity-ago">{ago(e.at)}</span>
					</li>
				);
			})}
		</ul>
	);
}
