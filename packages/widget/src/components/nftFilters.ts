import type { NftItem } from '@vsc.eco/token-sdk';

/**
 * Returns true when `username` can transfer `item`.
 *
 * Non-soulbound NFTs are freely transferable. Soulbound NFTs are
 * transferable ONLY by the collection owner (per magi_nft's
 * `safeTransferFrom` rule: `isSoulbound(id) && from != ownerAddr → abort`).
 * So a user who minted a soulbound NFT to someone else can still rent
 * or bundle it from their own collection-owned NFTs, but a recipient of
 * someone else's soulbound NFT cannot.
 *
 * The market's `listRental` / `listBundle` / sale flows all hit
 * `nftSafeTransferFrom`, so passing a soulbound NFT that the user can't
 * transfer would abort on-chain. Filter at picker time to avoid the
 * dead-end attempt.
 */
export function canTransferNft(item: NftItem, username: string | undefined): boolean {
	if (!item.soulbound) return true;
	if (!username) return false;
	const me = `hive:${username.replace(/^@/, '').replace(/^hive:/, '')}`.toLowerCase();
	return (item.collection?.owner ?? '').toLowerCase() === me;
}
