/**
 * Tiny GraphQL fetcher with optional failover. Used by both providers
 * (Hasura indexer, VSC node) so the same retry semantics apply everywhere.
 *
 * Failure model: any non-2xx HTTP response, network error, JSON parse
 * error, or non-empty `errors[]` array on the response is treated as a
 * failure for that endpoint and the next one is tried. The collected
 * errors bubble up as a single AggregateError-style message if every
 * endpoint fails.
 */

export interface GqlFetchOptions {
	/** AbortSignal to bail out early — cancels any in-flight fetch and stops failover. */
	signal?: AbortSignal;
	/** Per-request timeout in milliseconds. Defaults to no timeout. */
	timeoutMs?: number;
	/**
	 * Fired before each endpoint attempt. Useful for logging which mirror
	 * served a query under the hood.
	 */
	onAttempt?: (url: string, attempt: number) => void;
	/** Fired when an endpoint fails — the SDK moves on to the next URL after this. */
	onError?: (url: string, attempt: number, err: Error) => void;
}

/**
 * Send `query` to a single GraphQL endpoint. Throws on transport errors
 * or non-empty `errors` arrays. Most callers want `gqlFetchFailover`
 * instead — this is exported for hosts that already manage their own
 * URL ordering.
 */
export async function gqlFetchOne<T>(
	url: string,
	query: string,
	variables: Record<string, unknown> = {},
	opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
	const ac = opts.timeoutMs ? new AbortController() : null;
	const timer = ac && opts.timeoutMs ? setTimeout(() => ac.abort(), opts.timeoutMs) : null;
	const signal = mergeSignals(opts.signal, ac?.signal);

	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query, variables }),
			signal
		});
		if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
		const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
		if (json.errors && json.errors.length > 0) {
			throw new Error(`GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`);
		}
		if (json.data === undefined || json.data === null) {
			throw new Error('GraphQL response missing data');
		}
		return json.data;
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Try each URL in order. Returns the first successful response. Throws
 * after every URL fails — the message lists each failure for diagnosis.
 */
export async function gqlFetchFailover<T>(
	urls: string[],
	query: string,
	variables: Record<string, unknown> = {},
	opts: GqlFetchOptions = {}
): Promise<T> {
	if (urls.length === 0) throw new Error('gqlFetchFailover: no URLs configured');
	const failures: Array<{ url: string; err: Error }> = [];
	for (let i = 0; i < urls.length; i++) {
		const url = urls[i];
		opts.onAttempt?.(url, i);
		// If the caller has aborted before we even fire, stop here.
		if (opts.signal?.aborted) {
			throw signalAbortError(opts.signal);
		}
		try {
			return await gqlFetchOne<T>(url, query, variables, {
				signal: opts.signal,
				timeoutMs: opts.timeoutMs
			});
		} catch (err) {
			const e = err instanceof Error ? err : new Error(String(err));
			// User-initiated aborts shouldn't trigger failover — surface immediately.
			if (e.name === 'AbortError') throw e;
			failures.push({ url, err: e });
			opts.onError?.(url, i, e);
		}
	}
	const summary = failures
		.map((f) => `  ${f.url} → ${f.err.message}`)
		.join('\n');
	throw new Error(
		`gqlFetchFailover: all ${urls.length} endpoints failed:\n${summary}`
	);
}

function mergeSignals(...signals: Array<AbortSignal | null | undefined>): AbortSignal | undefined {
	const real = signals.filter((s): s is AbortSignal => !!s);
	if (real.length === 0) return undefined;
	if (real.length === 1) return real[0];
	const ac = new AbortController();
	for (const s of real) {
		if (s.aborted) {
			ac.abort();
			break;
		}
		s.addEventListener('abort', () => ac.abort(), { once: true });
	}
	return ac.signal;
}

function signalAbortError(s: AbortSignal): Error {
	const reason = (s as AbortSignal & { reason?: unknown }).reason;
	if (reason instanceof Error) return reason;
	const e = new Error('aborted');
	e.name = 'AbortError';
	return e;
}
