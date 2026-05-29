/**
 * Map the raw contract-abort strings the market emits into friendlier
 * user-facing text. The Go contract aborts with a short message verbatim
 * via `sdk.Abort(...)`; we surface them through `MarketClient.broadcast`'s
 * thrown `Error.message`. Unknown messages pass through unchanged so the
 * widget never silently swallows information.
 *
 * Keep this list ordered by specificity: the first substring match wins.
 */
const FRIENDLY: Array<{ match: RegExp | string; text: string }> = [
	// New post-2026-05-29 security-review fixes
	{ match: 'Contract is paused', text: 'The marketplace is paused — try again once the operator resumes it.' },
	{ match: 'Payment token not allowed', text: 'The payment token for this listing is no longer accepted by the marketplace. The seller will need to relist with an allowed token.' },
	{ match: 'Renter already has an active rental for this token', text: 'You already have an active rental for this NFT. End the current rental before renting another edition.' },
	{ match: 'Emergency NFT withdraw disabled', text: 'Direct NFT withdrawal is disabled. Escrowed NFTs are released through the normal cancel/end paths.' },
	{ match: 'active payment token', text: 'This token mediates live escrows and cannot be emergency-withdrawn. Remove it from the whitelist first.' },
	{ match: 'Collection is denied', text: 'This collection has been denied by the marketplace operator and cannot be traded here.' },
	{ match: 'Escrowed bid does not cover', text: 'The amount actually credited to escrow is less than the previous high bid (likely a fee-on-transfer or mis-classified payment token). Bid higher, or use a different payment token.' },
	// Pre-existing common aborts worth dressing up
	{ match: 'cost limit exceeded', text: 'The transaction ran out of resource credits. Wait for RC to regenerate or sign with an account that has more RC.' },
	{ match: 'Insufficient token balance', text: 'You do not have enough of this token to complete the action.' },
	{ match: 'Bid must exceed current high bid', text: 'Your bid must beat the current high bid by at least the minimum increment.' },
	{ match: 'Listing not active', text: 'This listing has already been bought, delisted, or expired.' },
	{ match: 'Offer not active', text: 'This offer is no longer active (cancelled, accepted, or expired).' },
	{ match: 'Auction not active', text: 'This auction is no longer active.' },
	{ match: 'Auction has ended', text: 'This auction has already ended.' },
	{ match: 'Auction has not started', text: 'This auction has not started yet.' },
	{ match: 'Listing has expired', text: 'This listing has expired.' },
	{ match: 'Seller cannot buy own listing', text: 'You are the seller of this listing — you cannot buy from yourself.' }
];

/**
 * Convert a thrown error from a contract call into a single user-facing
 * sentence. Pass the message string OR the raw error. Unknown messages
 * are returned unchanged so callers never lose underlying debug info.
 */
export function humanizeContractError(input: unknown): string {
	const raw = input instanceof Error ? input.message : typeof input === 'string' ? input : String(input);
	if (!raw) return 'Unknown error';
	for (const { match, text } of FRIENDLY) {
		const hit = typeof match === 'string' ? raw.includes(match) : match.test(raw);
		if (hit) return text;
	}
	return raw;
}
