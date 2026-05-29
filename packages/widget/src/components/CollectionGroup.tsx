import { useState, type ReactNode } from 'react';

/**
 * Collapsible per-collection group used by the listings/auctions/mint-spots
 * tabs. Header shows the collection name + item count and toggles a grid
 * of tiles. Defaults open; consumers can flip a group's `defaultOpen` for
 * an alternate UX (e.g., a wallet view that prefers collapsed-by-default).
 */
export interface CollectionGroupProps {
	collectionName: string;
	count: number;
	defaultOpen?: boolean;
	/** Optional header action (e.g. a collection-owner settings gear),
	 *  rendered beside the toggle. Kept a sibling of the toggle button so we
	 *  don't nest interactive controls. */
	action?: ReactNode;
	children: ReactNode;
}

export function CollectionGroup({
	collectionName,
	count,
	defaultOpen = true,
	action,
	children
}: CollectionGroupProps) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<section className="magi-market-coll-group">
			<div className="magi-market-coll-header-row">
				<button
					type="button"
					className="magi-market-coll-header"
					onClick={() => setOpen((v) => !v)}
					aria-expanded={open}
				>
					<span className={`magi-market-coll-chevron ${open ? 'open' : ''}`} aria-hidden="true">▾</span>
					<span className="magi-market-coll-name">{collectionName}</span>
					<span className="magi-market-coll-count">{count}</span>
				</button>
				{action && <div className="magi-market-coll-header-action">{action}</div>}
			</div>
			{open && <div className="magi-market-grid">{children}</div>}
		</section>
	);
}
