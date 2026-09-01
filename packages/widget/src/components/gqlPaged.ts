import { gqlFetchFailover } from '@vsc.eco/market-sdk';

/**
 * Rows per request. The indexer's public Hasura role caps EVERY response at
 * 100 rows and silently ignores a larger explicit `limit` — asking for
 * `limit: 5000` still returns 100, with no error and no indication the set
 * was truncated. So the only way to read a full table slice is offset
 * paging at exactly this size.
 *
 * This bit hard: an un-paged `magi_nft_token_info` read of a 1023-token
 * collection returned its first 100 rows, and the accompanying balance read
 * returned 100 rows that all happened to belong to the collection owner —
 * which looked exactly like "this collection only contains the owner's
 * NFTs" rather than like a truncated query.
 */
const PAGE = 100;

/** Backstop so a mis-specified query can't spin forever: 200 × 100 rows. */
const MAX_PAGES = 200;

/**
 * Pages requested at once. Strictly sequential paging made a 1023-token
 * collection an 11-request chain and the offer picker took ~11s to fill.
 * The row count isn't known up front, so a batch may request pages past the
 * end — those come back empty and cost one round trip, which is a good trade
 * for cutting the wall-clock by ~6×.
 */
const CONCURRENCY = 6;

export interface PagedResult<Row> {
	rows: Row[];
	/** True when MAX_PAGES was hit, i.e. the set may still be incomplete. */
	truncated: boolean;
}

/**
 * Read every row of one indexer list by offset paging.
 *
 * `query` must accept `$limit: Int!` and `$offset: Int!`, select a single
 * row list, and carry a **stable `order_by`** — offset paging over an
 * unordered result can repeat or skip rows between requests.
 *
 * Stops on the first short page. Errors propagate: a partial set that looks
 * complete is exactly the failure mode this helper exists to prevent.
 */
export async function gqlFetchAllPages<Row>(
	urls: string[],
	query: string,
	pick: (data: unknown) => Row[] | undefined,
	vars: Record<string, unknown> = {}
): Promise<PagedResult<Row>> {
	const rows: Row[] = [];
	const fetchPage = async (page: number): Promise<Row[]> => {
		const data = await gqlFetchFailover<unknown>(urls, query, {
			...vars,
			limit: PAGE,
			offset: page * PAGE
		});
		return pick(data) ?? [];
	};

	for (let first = 0; first < MAX_PAGES; first += CONCURRENCY) {
		const batch = await Promise.all(
			Array.from({ length: Math.min(CONCURRENCY, MAX_PAGES - first) }, (_, i) => fetchPage(first + i))
		);
		// Append in page order — each page is itself ordered and offsets
		// ascend, so concatenating batches keeps the overall order stable.
		for (const page of batch) rows.push(...page);
		// A short page anywhere in the batch means the end is inside it. (Not
		// just the last page: a concurrent write could shrink the set
		// mid-flight, and stopping early beats looping on empty pages.)
		if (batch.some((page) => page.length < PAGE)) return { rows, truncated: false };
	}
	return { rows, truncated: true };
}

/** The page size callers must use in their `limit`/`offset` variables. */
export const GQL_PAGE_SIZE = PAGE;
