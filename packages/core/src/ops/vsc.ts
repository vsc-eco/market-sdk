import type { CustomJsonOp, MagiNetwork, VscCall, VscIntent } from '../types/index.js';

/**
 * Wrap a VSC contract call in a Hive `custom_json` op. This is the format
 * `aioha.vscCallContract` produces internally — and matches what gets
 * broadcast on Hive L1 to trigger a Magi L2 contract execution.
 *
 * `payload` may be a string OR an object — objects are JSON-stringified.
 * Default `rcLimit` is 10000 (matching okinoko-terminal's default for
 * NFT/token actions, and the value magi-market's heavier entrypoints —
 * `init`, auction settle, sweep, bundles — require; 1000 is rejected with
 * "cost limit exceeded"). Some lightweight calls (pause, simple reads) can
 * lower this to reduce gas.
 */
export function buildVscCallOp(params: {
	username: string;
	network: MagiNetwork;
	call: VscCall;
}): CustomJsonOp {
	const { username, network, call } = params;
	const caller = username.startsWith('hive:') ? username : `hive:${username}`;
	const rawAuth = caller.replace(/^hive:/, '');
	const rcLimit = call.rcLimit ?? 10000;

	const payloadStr =
		typeof call.payload === 'string' ? call.payload : JSON.stringify(call.payload);

	const inner = {
		net_id: network,
		caller,
		contract_id: call.contractId,
		action: call.action,
		payload: payloadStr,
		rc_limit: rcLimit,
		intents: (call.intents ?? []) as VscIntent[]
	};

	return [
		'custom_json',
		{
			required_auths: [rawAuth],
			required_posting_auths: [],
			id: 'vsc.call',
			json: JSON.stringify(inner)
		}
	];
}

/** Normalize "username", "@username", or "hive:username" → "hive:username". */
export function normalizeHiveAccount(input: string): string {
	const trimmed = input.trim().replace(/^@/, '');
	if (trimmed.startsWith('hive:')) return trimmed;
	return `hive:${trimmed}`;
}

/** Quick sanity check on a hive username (does NOT confirm L1 existence). */
export function isValidHiveUsername(input: string): boolean {
	const bare = input.trim().replace(/^(@|hive:)/, '');
	return /^[a-z][a-z0-9\-.]{2,15}$/.test(bare);
}
