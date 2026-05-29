import type { CustomJsonOp, MagiConfig, MagiNetwork } from '@vsc.eco/market-core';

/**
 * Client for the Magi contract-deployer service. Mirrors the okinoko
 * deployer's HTTP surface (POST /api/prepare-deploy, SSE GET /api/logs/:id,
 * GET /api/deployed-codes, GET /health). The default endpoint comes from
 * `MagiConfig.deployerUrl`; pass `serviceUrl` to override.
 *
 * The deployer flow looks like this:
 *
 *   1. Client calls `prepareDeploy({ wasmFile | repo, name, owner, ... })`
 *      → backend assigns a `deploymentId` and starts building the wasm.
 *   2. Client subscribes to the SSE stream via `subscribeLogs(deploymentId)`.
 *      Logs trickle in; eventually a `result` event carries the operations
 *      to sign (`custom_json` for the deploy op + optional `transfer` for
 *      the deployer fee).
 *   3. Client substitutes the `{{username}}` placeholder for the actual
 *      Hive username, signs via Aioha (or any other signer), broadcasts.
 *   4. Optionally polls the VSC node for the newly-registered contract id.
 *
 * The widget package wraps all four steps in a single `<MagiContractDeploy>`
 * UI, but every step is exposed individually here so headless integrators
 * can assemble their own deploy flow.
 */

export type DeployTag = 'market' | 'nft' | 'token' | string;

export interface DeployedCode {
	code: string;
	tag?: string;
	repo?: string;
	branch?: string;
}

export interface DeployLogEntry {
	level: 'INFO' | 'DEBUG' | 'ERROR' | string;
	timestamp: string;
	message: string;
}

/**
 * Operation shape returned by the deployer's `result` event. The
 * `data.json` / `data.required_auths` / `data.from` fields contain
 * `{{username}}` placeholders that the client must substitute before
 * signing.
 */
export interface DeployerOp {
	type: 'custom_json' | 'transfer';
	data: Record<string, unknown>;
}

export interface DeployResult {
	success: boolean;
	error?: string;
	message?: string;
	operations?: DeployerOp[];
}

export interface PrepareDeployParams {
	/** Pre-compiled wasm to upload. Mutually exclusive with `repo`. */
	wasmFile?: Blob | File;
	/** GitHub repo (e.g. `vsc-eco/magi_nft-contract`). Backend builds it. */
	repo?: string;
	/** Git branch — defaults to `main`. */
	branch?: string;
	/** Contract name (display name shown in registries). */
	name: string;
	/** Free-form description. */
	description?: string;
	/** Owner Hive account (without the `hive:` prefix). */
	owner: string;
	/** Tag for grouping (e.g. `nft`, `token`). Backend uses this for filters. */
	tag?: DeployTag;
	/**
	 * If `true`, validate inputs without actually starting a build. Useful
	 * for smoke-testing the endpoint config from a frontend.
	 */
	dryRun?: boolean;
}

export interface PrepareDeployResponse {
	deploymentId: string;
}

export interface DeployerClient {
	/** Healthcheck the deployer endpoint. */
	checkHealth(): Promise<boolean>;
	/** List deployed-code templates the backend can build from. */
	listDeployedCodes(opts?: { tag?: DeployTag }): Promise<DeployedCode[]>;
	/**
	 * Kick off a deploy — backend assigns a `deploymentId` and starts
	 * the build. Subscribe via `subscribeLogs(deploymentId)`.
	 */
	prepareDeploy(params: PrepareDeployParams): Promise<PrepareDeployResponse>;
	/**
	 * Subscribe to the SSE log stream. Returns an unsubscribe function.
	 * Callbacks fire in the order: many `onLog`, one `onResult`, one `onDone`
	 * (or `onError`). Internally uses an `EventSource`.
	 */
	subscribeLogs(
		deploymentId: string,
		callbacks: {
			onLog?: (entry: DeployLogEntry) => void;
			onResult?: (result: DeployResult) => void;
			onDone?: () => void;
			onError?: (err: Error) => void;
		}
	): () => void;
	/**
	 * Find the freshly-deployed contract by polling the VSC node for the
	 * newest contract whose creator matches `owner` and whose creation
	 * timestamp is after `since`. Polls every `pollIntervalMs` (default
	 * 3000ms) up to `timeoutMs` (default 90000ms). Returns the contract id
	 * (`vsc1...`) once the contract is indexed; throws on timeout.
	 */
	findContractAfter(opts: {
		owner: string;
		since: Date;
		pollIntervalMs?: number;
		timeoutMs?: number;
		signal?: AbortSignal;
	}): Promise<{ contractId: string; name: string }>;
}

export interface CreateDeployerClientOptions {
	config?: MagiConfig;
	/** Override the deployer service URL (defaults to `config.deployerUrl`). */
	serviceUrl?: string;
	/** Network identifier sent with every prepare-deploy. */
	network?: MagiNetwork;
}

/**
 * Parse a Magi-node-emitted timestamp as UTC. The node returns ISO-ish
 * strings like `"2026-05-10T14:51:42"` with no timezone designator;
 * per ECMAScript, naked-no-Z strings are interpreted as *local* time,
 * which would offset the comparison by the user's timezone. Append `Z`
 * unless the string already carries a designator so the wall-clock
 * value the indexer wrote is the value we compare against `since`.
 */
function parseUtcTs(s: string): number {
	if (!s) return NaN;
	const hasTz = /[zZ]$|[+\-]\d{2}:?\d{2}$/.test(s);
	return new Date(hasTz ? s : `${s}Z`).getTime();
}

/**
 * Trust limits for the `transfer` legs of a deployer-returned op bundle.
 * Without this, a compromised or malicious deployer endpoint could ship a
 * `transfer` op pointing at an attacker-controlled account for an arbitrary
 * amount, and the client would happily ask the user to sign it (the
 * deploy-op block makes it look routine). These defaults match the current
 * Magi deployer's actual usage — pay the gateway, never more than 100
 * units of TBD/HBD/HIVE — and can be overridden when the deployer's fee
 * schedule legitimately changes.
 */
export interface DeployerTransferLimits {
	/** Accounts the deployer transfer leg is allowed to pay (lowercase). */
	allowedRecipients?: string[];
	/** Currencies (the asset symbol at the end of the amount string) the
	 *  deployer transfer leg is allowed to pay in. */
	allowedCurrencies?: string[];
	/** Hard cap on the numeric portion of the amount (e.g. 100 means
	 *  "10.000 HBD" is fine, "1000.000 HBD" is not). */
	maxAmount?: number;
}

const DEFAULT_TRANSFER_LIMITS: Required<DeployerTransferLimits> = {
	allowedRecipients: ['vsc.gateway', 'vsc.testnet'],
	allowedCurrencies: ['HBD', 'HIVE', 'TBD'],
	maxAmount: 100
};

/**
 * Validate the deployer-returned `transfer` op against the trust limits.
 * Throws on violation so the caller never broadcasts an attacker-shaped
 * transfer. The Hive `amount` string format is `"X.XXX SYM"` (3 decimals
 * for HBD/HIVE/TBD), which is the only form the upstream deployer emits.
 */
function validateDeployerTransfer(
	to: string,
	amountStr: string,
	limits: Required<DeployerTransferLimits>
): void {
	const recipient = to.toLowerCase();
	if (!limits.allowedRecipients.includes(recipient)) {
		throw new Error(
			`substituteDeployerOps: deployer transfer to "${to}" is not in the allowed-recipient list (${limits.allowedRecipients.join(', ')}) — refusing to sign a potentially malicious transfer`
		);
	}
	const match = /^(\d+(?:\.\d+)?)\s+([A-Z]+)$/.exec(amountStr.trim());
	if (!match) {
		throw new Error(
			`substituteDeployerOps: deployer transfer amount "${amountStr}" is not a recognized Hive amount (expected "<number> <SYMBOL>")`
		);
	}
	const numeric = Number(match[1]);
	const currency = match[2];
	if (!limits.allowedCurrencies.includes(currency)) {
		throw new Error(
			`substituteDeployerOps: deployer transfer in "${currency}" is not in the allowed-currency list (${limits.allowedCurrencies.join(', ')})`
		);
	}
	if (!Number.isFinite(numeric) || numeric < 0 || numeric > limits.maxAmount) {
		throw new Error(
			`substituteDeployerOps: deployer transfer amount ${numeric} ${currency} exceeds the safety cap of ${limits.maxAmount} — refusing to sign`
		);
	}
}

/**
 * Substitute `{{username}}` placeholders inside the operations the
 * deployer returned with the actual Hive username, returning a clean
 * Hive-broadcast-ready array. Validates every `transfer` leg against the
 * `transferLimits` (default: pay only `vsc.gateway`/`vsc.testnet` in
 * HBD/HIVE/TBD, ≤100 units) — a compromised deployer cannot smuggle an
 * arbitrary transfer through this helper.
 */
export function substituteDeployerOps(
	operations: DeployerOp[],
	username: string,
	netId: MagiNetwork,
	transferLimits: DeployerTransferLimits = {}
): unknown[] {
	const limits: Required<DeployerTransferLimits> = {
		allowedRecipients: transferLimits.allowedRecipients ?? DEFAULT_TRANSFER_LIMITS.allowedRecipients,
		allowedCurrencies: transferLimits.allowedCurrencies ?? DEFAULT_TRANSFER_LIMITS.allowedCurrencies,
		maxAmount: transferLimits.maxAmount ?? DEFAULT_TRANSFER_LIMITS.maxAmount
	};
	const out: unknown[] = [];
	for (const op of operations) {
		if (op.type === 'custom_json') {
			const d = op.data as {
				required_auths: string[];
				required_posting_auths: string[];
				id: string;
				json: string;
			};
			let json = d.json;
			try {
				const inner = JSON.parse(json);
				if (typeof inner === 'object' && inner !== null && 'net_id' in inner) {
					(inner as Record<string, unknown>).net_id = netId;
					json = JSON.stringify(inner);
				}
			} catch {
				/* leave json as-is if it's not parseable */
			}
			out.push([
				'custom_json',
				{
					required_auths: d.required_auths.map((a) =>
						a === '{{username}}' ? username : a
					),
					required_posting_auths: d.required_posting_auths,
					id: d.id,
					json
				}
			] as CustomJsonOp);
		} else if (op.type === 'transfer') {
			const d = op.data as {
				from: string;
				to: string;
				amount: string;
				memo: string;
			};
			// Map the legacy testnet placeholder to the actual gateway account
			// BEFORE validation so the allowed-recipients check sees the
			// substituted account.
			const to = d.to === 'vsc.testnet' ? 'vsc.gateway' : d.to;
			validateDeployerTransfer(to, d.amount, limits);
			out.push([
				'transfer',
				{
					from: d.from === '{{username}}' ? username : d.from,
					to,
					amount: d.amount,
					memo: d.memo
				}
			]);
		}
	}
	return out;
}

export function createDeployerClient(
	opts: CreateDeployerClientOptions
): DeployerClient {
	const config = opts.config;
	const serviceUrl =
		opts.serviceUrl ??
		config?.deployerUrl ??
		(() => {
			throw new Error(
				'createDeployerClient: no `serviceUrl` and `config.deployerUrl` is unset.'
			);
		})();
	const network = opts.network ?? config?.network ?? 'vsc-mainnet';

	async function checkHealth(): Promise<boolean> {
		try {
			const res = await fetch(`${serviceUrl}/health`);
			if (!res.ok) return false;
			const data = (await res.json()) as { status?: string };
			return data.status === 'ok';
		} catch {
			return false;
		}
	}

	async function listDeployedCodes(args: { tag?: DeployTag } = {}): Promise<DeployedCode[]> {
		const url = args.tag
			? `${serviceUrl}/api/deployed-codes?tag=${encodeURIComponent(args.tag)}`
			: `${serviceUrl}/api/deployed-codes`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`listDeployedCodes: HTTP ${res.status}`);
		const data = (await res.json()) as { codes?: DeployedCode[] };
		return data.codes ?? [];
	}

	async function prepareDeploy(params: PrepareDeployParams): Promise<PrepareDeployResponse> {
		if (!params.wasmFile && !params.repo) {
			throw new Error('prepareDeploy: either `wasmFile` or `repo` is required');
		}
		const fd = new FormData();
		if (params.wasmFile) fd.append('wasm', params.wasmFile);
		if (params.repo) {
			fd.append('repo', params.repo);
			fd.append('branch', params.branch ?? 'main');
		}
		fd.append('name', params.name);
		fd.append('description', params.description ?? '');
		fd.append('owner', params.owner);
		if (params.tag) fd.append('tag', params.tag);
		fd.append('dry_run', String(params.dryRun ?? false));
		fd.append('network', network);

		const res = await fetch(`${serviceUrl}/api/prepare-deploy`, {
			method: 'POST',
			body: fd
		});
		if (!res.ok) throw new Error(`prepareDeploy: HTTP ${res.status} ${res.statusText}`);
		const data = (await res.json()) as { deployment_id?: string; error?: string };
		if (data.error) throw new Error(`prepareDeploy: ${data.error}`);
		if (!data.deployment_id) throw new Error('prepareDeploy: missing deployment_id in response');
		return { deploymentId: data.deployment_id };
	}

	function subscribeLogs(
		deploymentId: string,
		cbs: {
			onLog?: (entry: DeployLogEntry) => void;
			onResult?: (result: DeployResult) => void;
			onDone?: () => void;
			onError?: (err: Error) => void;
		}
	): () => void {
		const url = `${serviceUrl}/api/logs/${encodeURIComponent(deploymentId)}`;
		const es = new EventSource(url);

		es.onmessage = (event) => {
			try {
				const entry = JSON.parse(event.data) as DeployLogEntry;
				cbs.onLog?.(entry);
			} catch (err) {
				cbs.onError?.(err instanceof Error ? err : new Error(String(err)));
			}
		};
		es.addEventListener('result', (event) => {
			try {
				const result = JSON.parse((event as MessageEvent).data) as DeployResult;
				cbs.onResult?.(result);
			} catch (err) {
				cbs.onError?.(err instanceof Error ? err : new Error(String(err)));
			}
		});
		es.addEventListener('done', () => {
			es.close();
			cbs.onDone?.();
		});
		es.onerror = () => {
			es.close();
			cbs.onError?.(new Error(`Log stream lost (deployment ${deploymentId})`));
		};
		return () => es.close();
	}

	async function findContractAfter(args: {
		owner: string;
		since: Date;
		pollIntervalMs?: number;
		timeoutMs?: number;
		signal?: AbortSignal;
	}): Promise<{ contractId: string; name: string }> {
		const { owner, since, signal } = args;
		const interval = args.pollIntervalMs ?? 3000;
		// Default 300s - mainnet block-then-indexer turnaround can be 1-2
		// minutes during pool-of-builds congestion; 90s was too eager.
		const timeout = args.timeoutMs ?? 300000;
		const start = Date.now();
		// Case-insensitive bare-name match: Hive usernames are lowercase
		// on-chain but a host might pass `TIBFOX` from an input field.
		// Strip any leading `@` / `hive:` and lowercase both sides so the
		// creator gate doesn't reject a row over capitalisation drift.
		const ownerBare = owner.replace(/^(@|hive:)+/, '').trim().toLowerCase();
		const ownerHive = `hive:${ownerBare}`;
		const sinceMs = since.getTime();
		// FindContractFilter only supports byId / byCode / historical /
		// offset / limit (verified via __type introspection). There's no
		// byCreator filter, so we pull the most recent contracts via
		// `historical: true, limit: N` and match client-side. Results
		// come back newest-first which keeps the per-poll work cheap.
		const gqlUrls = config?.gqlUrls ?? (config?.gqlUrl ? [config.gqlUrl] : []);
		if (!gqlUrls.length) {
			throw new Error(
				'findContractAfter: no `gqlUrls` configured on MagiConfig'
			);
		}
		while (Date.now() - start < timeout) {
			if (signal?.aborted) throw new Error('findContractAfter: aborted');
			for (const url of gqlUrls) {
				try {
					const r = await fetch(url, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							query: `query {
								findContract(filterOptions: { historical: true, limit: 30 }) {
									id name creator creation_ts
								}
							}`
						})
					});
					if (!r.ok) continue;
					const json = (await r.json()) as {
						data?: {
							findContract?: Array<{
								id: string;
								name: string;
								creator: string;
								creation_ts: string;
							}>;
						};
					};
					const rows = json.data?.findContract ?? [];
					// Filter to *this user's* contracts created at-or-after we
					// started polling. The two conjoined filters are what
					// guarantees we don't return some other account's contract
					// or a stale one - matching `creator` means the user was
					// the deploy signer, matching `creation_ts >= since`
					// means the contract didn't exist when we kicked off.
					const candidates: Array<{ id: string; name: string; ts: number }> = [];
					for (const row of rows) {
						// Defensive case-insensitive compare on the indexer's
						// side too - the creator is always written as
						// `hive:<bare>` lowercase, but normalise anyway in
						// case a future change emits a different casing.
						if (row.creator?.toLowerCase() !== ownerHive) continue;
						const ts = parseUtcTs(row.creation_ts);
						if (!Number.isFinite(ts)) continue;
						if (ts >= sinceMs) candidates.push({ id: row.id, name: row.name, ts });
					}
					if (candidates.length > 0) {
						// Pick the *oldest* candidate >= since. If the user
						// happens to have multiple deploys in flight (rare),
						// this returns the one closest to when we started
						// watching, which is the one we just signed for.
						candidates.sort((a, b) => a.ts - b.ts);
						const winner = candidates[0];
						return { contractId: winner.id, name: winner.name };
					}
					// Successful response from this mirror; no need to try the
					// other mirrors this round.
					break;
				} catch {
					// Fall through to the next mirror.
				}
			}
			await new Promise<void>((resolve, reject) => {
				const t = setTimeout(resolve, interval);
				signal?.addEventListener(
					'abort',
					() => {
						clearTimeout(t);
						reject(new Error('findContractAfter: aborted'));
					},
					{ once: true }
				);
			});
		}
		throw new Error(
			`findContractAfter: timed out after ${Math.round(timeout / 1000)}s waiting for contract from ${ownerHive}. ` +
				'The contract may still appear later - check the explorer for the deploy txid.'
		);
	}

	return {
		checkHealth,
		listDeployedCodes,
		prepareDeploy,
		subscribeLogs,
		findContractAfter
	};
}
