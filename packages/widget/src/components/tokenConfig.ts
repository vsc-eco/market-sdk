import type { MagiConfig } from '@vsc.eco/market-sdk';
import {
	MAINNET_CONFIG as TOKEN_MAINNET,
	TESTNET_CONFIG as TOKEN_TESTNET
} from '@vsc.eco/token-sdk';

/**
 * The token-SDK config to use for NFT reads, built from the config the
 * consumer gave the market panel.
 *
 * Every NFT lookup here used to substitute token-sdk's own network defaults
 * and throw away the endpoints the host app had configured. That is not a
 * theoretical mismatch: token-sdk's testnet default points `gqlUrls` at
 * `api.testnet.vsc.eco`, which is unreachable — and image resolution reads
 * token properties through `getStateByKeys` on exactly that endpoint. So
 * every image silently failed and every tile fell back to the Magi logo,
 * while the host app had a perfectly good node URL the whole time.
 *
 * The host's endpoints win where it set them; the token defaults fill in the
 * rest (contract ids and anything else it did not specify).
 */
export function tokenConfigFrom(config: MagiConfig) {
	const base = config.network === 'vsc-testnet' ? TOKEN_TESTNET : TOKEN_MAINNET;
	return {
		...base,
		...(config.indexerHasuraUrls?.length
			? { indexerHasuraUrls: config.indexerHasuraUrls }
			: config.indexerHasuraUrl
				? { indexerHasuraUrls: [config.indexerHasuraUrl] }
				: {}),
		...(config.gqlUrls?.length
			? { gqlUrls: config.gqlUrls }
			: config.gqlUrl
				? { gqlUrls: [config.gqlUrl] }
				: {})
	};
}
