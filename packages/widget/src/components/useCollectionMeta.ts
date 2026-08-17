import { useEffect, useMemo, useState } from 'react';
import { resolveIndexerUrls, type MagiConfig } from '@vsc.eco/market-sdk';
import { gqlFetchAllPages } from './gqlPaged.js';

interface OverviewRow {
	contract_id: string;
	name: string | null;
	owner: string | null;
}

export interface CollectionRow {
	contractId: string;
	name: string;
	owner: string;
}

export interface CollectionMeta {
	/** Collection display name for an NFT-contract id; falls back to a
	 * shortened id when the collection is unknown to the indexer. */
	name: (contractId: string) => string;
	/** Collection owner (`hive:…`) for an NFT-contract id, or '' if unknown. */
	owner: (contractId: string) => string;
	/** Every collection the indexer knows, for collection-picker dropdowns. */
	collections: CollectionRow[];
	/** True once the overview fetch has settled (success or failure). */
	ready: boolean;
}

const short = (id: string) => (id && id.length > 14 ? `${id.slice(0, 10)}…` : id || '');

/**
 * Resolve NFT-contract ids → collection name from `magi_nft_overview` (the
 * same indexer view the NFT panels use). One fetch per indexer-url set;
 * unknown ids degrade to a shortened contract id rather than throwing, so
 * the UI never shows a bare `vsc1…` when a name is available.
 */
export function useCollectionMeta(config: MagiConfig): CollectionMeta {
	const urls = useMemo(() => resolveIndexerUrls(config), [config]);
	const [map, setMap] = useState<Map<string, string>>(new Map());
	const [owners, setOwners] = useState<Map<string, string>>(new Map());
	const [rows, setRows] = useState<CollectionRow[]>([]);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setReady(false);
		// Paged: the indexer caps every response at 100 rows. Under ~100
		// collections this changes nothing, but past that an un-paged read
		// would silently drop the tail — and a collection with no name here
		// degrades to a shortened contract id, which also sorts wrong in the
		// name-ordered group lists.
		gqlFetchAllPages<OverviewRow>(
			urls,
			`query CM($limit:Int!,$offset:Int!){
				magi_nft_overview(order_by:{contract_id:asc}, limit:$limit, offset:$offset){
					contract_id name owner
				}
			}`,
			(d) => (d as { magi_nft_overview?: OverviewRow[] }).magi_nft_overview
		)
			.then(({ rows: overview }) => {
				if (cancelled) return;
				const m = new Map<string, string>();
				const o = new Map<string, string>();
				const list: CollectionRow[] = [];
				for (const r of overview) {
					if (r.name) m.set(r.contract_id, r.name);
					if (r.owner) o.set(r.contract_id, r.owner);
					list.push({ contractId: r.contract_id, name: r.name ?? short(r.contract_id), owner: r.owner ?? '' });
				}
				setMap(m);
				setOwners(o);
				setRows(list.sort((a, b) => a.name.localeCompare(b.name)));
			})
			.catch(() => {
				/* keep empty maps — callers fall back to shortened ids */
			})
			.finally(() => !cancelled && setReady(true));
		return () => {
			cancelled = true;
		};
	}, [urls]);

	return useMemo(
		() => ({
			name: (contractId: string) => map.get(contractId) ?? short(contractId),
			owner: (contractId: string) => owners.get(contractId) ?? '',
			collections: rows,
			ready
		}),
		[map, owners, rows, ready]
	);
}
