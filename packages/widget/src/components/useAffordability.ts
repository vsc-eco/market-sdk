import { useMemo } from 'react';
import type { MagiConfig } from '@vsc.eco/market-sdk';
import { useUserBalances } from './useUserBalances.js';

export interface Affordability {
	/** Balances have come back. Before this nothing is claimed either way. */
	ready: boolean;
	/** The user's smallest-unit balance for the payment token, once known. */
	balance: bigint | null;
	/** What is missing, in smallest units — only set when short. */
	short: bigint | null;
	/**
	 * False ONLY when the funds are positively known to be absent.
	 *
	 * Unknown is not the same as insufficient: while balances load, or when the
	 * payment token is one the balance sources do not cover, this stays true and
	 * the contract remains the authority. A pre-flight check that blocked on
	 * ignorance would turn a slow indexer into an unusable Buy button.
	 */
	ok: boolean;
}

/**
 * Can this account cover `totalMicro` of `paymentToken` right now?
 *
 * The contract already refuses an underfunded purchase, but it does so after
 * the user has signed and paid RC for the attempt — and the abort text
 * ("Insufficient token balance") arrives with no numbers in it. Checking here
 * turns that into a disabled button and a stated shortfall.
 *
 * `totalMicro` is a smallest-unit string because that is what every buy form
 * already computes for the contract call, so no conversion happens twice.
 */
export function useAffordability(
	config: MagiConfig,
	username: string | undefined,
	paymentToken: string | undefined,
	totalMicro: string | bigint | null | undefined
): Affordability {
	const balances = useUserBalances(config, username);
	return useMemo(() => {
		const balance = paymentToken ? balances.balanceOf(paymentToken) : null;
		let need: bigint | null = null;
		if (totalMicro !== null && totalMicro !== undefined && totalMicro !== '') {
			try {
				need = BigInt(totalMicro);
			} catch {
				need = null; // an in-progress input is not a shortfall
			}
		}
		if (!balances.ready || balance === null || need === null || need <= 0n) {
			return { ready: balances.ready, balance, short: null, ok: true };
		}
		const short = need > balance ? need - balance : null;
		return { ready: true, balance, short, ok: short === null };
	}, [balances, paymentToken, totalMicro]);
}
