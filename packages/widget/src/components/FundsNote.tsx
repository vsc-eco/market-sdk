import type { Affordability } from './useAffordability.js';
import type { TokenMeta } from './useTokenMeta.js';

/**
 * "You are short X" — the line that turns a failed transaction into a decision
 * made before signing. Renders nothing unless the shortfall is known, so a
 * slow balance lookup never accuses the user of being broke.
 */
export function FundsNote({
	funds,
	paymentToken,
	tokenMeta
}: {
	funds: Affordability;
	paymentToken: string;
	tokenMeta: TokenMeta;
}) {
	if (funds.ok || funds.short === null) return null;
	const sym = tokenMeta.symbol(paymentToken);
	return (
		<p className="magi-market-status error">
			Not enough {sym}: you have {tokenMeta.format(paymentToken, funds.balance ?? 0n)}, {' '}
			{tokenMeta.format(paymentToken, funds.short)} short.
		</p>
	);
}
