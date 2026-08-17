import { useState, type ReactNode } from 'react';

/**
 * Collapsible per-collection group used by the listings/auctions/mint-spots
 * tabs. Header shows the collection name + item count and toggles a grid
 * of tiles. Defaults open; consumers can flip a group's `defaultOpen` for
 * an alternate UX (e.g., a wallet view that prefers collapsed-by-default).
 */
export interface CollectionGroupProps {
	collectionName: string;
	/**
	 * Collection owner, shown muted in parentheses after the name. Pass it
	 * bare (`alice`) or `hive:`-prefixed — the prefix is stripped here so
	 * every call site doesn't repeat that. Omit/empty to show nothing.
	 */
	owner?: string;
	count: number;
	defaultOpen?: boolean;
	/** Optional header action (e.g. a collection-owner settings gear),
	 *  rendered beside the toggle. Kept a sibling of the toggle button so we
	 *  don't nest interactive controls. */
	action?: ReactNode;
	/**
	 * `grid` (default) wraps children in the tile grid. `stack` leaves the
	 * body unwrapped so a consumer can nest its own structure — Explore puts
	 * per-template sub-groups here, each with its own grid.
	 */
	layout?: 'grid' | 'stack';
	children: ReactNode;
}

/** `hive:alice` → `alice`; already-bare names pass through. */
export const bareAccount = (a?: string) => (a ?? '').replace(/^hive:/, '');

export function CollectionGroup({
	collectionName,
	owner,
	count,
	defaultOpen = true,
	action,
	layout = 'grid',
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
					<span className="magi-market-coll-name">
						{collectionName}
						{bareAccount(owner) && (
							<span className="magi-market-coll-owner"> ({bareAccount(owner)})</span>
						)}
					</span>
					<span className="magi-market-coll-count">{count}</span>
				</button>
				{action && <div className="magi-market-coll-header-action">{action}</div>}
			</div>
			{open && (
				<div className={layout === 'grid' ? 'magi-market-grid' : 'magi-market-coll-stack'}>
					{children}
				</div>
			)}
		</section>
	);
}

export interface TemplateGroupProps {
	/** The template (mintSeries head) these tokens were minted from. */
	templateId: string;
	count: number;
	defaultOpen?: boolean;
	children: ReactNode;
}

/**
 * Secondary grouping inside a collection: tokens minted from the same
 * template. Editions of one template are near-identical, so a collection
 * with 1000 of them would otherwise render as 1000 visually identical
 * tiles. Collapsed by default — the point is to compress the grid, and the
 * count on the header is usually all a browser needs.
 */
export function TemplateGroup({ templateId, count, defaultOpen = false, children }: TemplateGroupProps) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<section className="magi-market-tpl-group">
			<button
				type="button"
				className="magi-market-tpl-header"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
			>
				<span className={`magi-market-coll-chevron ${open ? 'open' : ''}`} aria-hidden="true">▾</span>
				<span className="magi-market-tpl-name" title={templateId}>#{templateId}</span>
				<span className="magi-market-tpl-badge">template</span>
				<span className="magi-market-coll-count">{count}</span>
			</button>
			{open && <div className="magi-market-grid">{children}</div>}
		</section>
	);
}
