import { useState } from 'react';
import {
	createMarketClient,
	MAINNET_CONFIG,
	type AiohaLike,
	type BroadcastHook,
	type Listing,
	type MagiConfig,
	type MarketClient
} from '@vsc.eco/market-sdk';
import { BuyForm } from './actions/BuyForm.js';
import { MakeOfferForm } from './actions/MakeOfferForm.js';

export interface MarketActionButtonProps {
	username?: string;
	aioha?: AiohaLike;
	onBroadcast?: BroadcastHook;
	keyType?: unknown;
	config?: MagiConfig;
	client?: MarketClient;
	listing: Listing;
	action: 'buy' | 'offer';
	label?: string;
	onSuccess?: (txId: string) => void;
	className?: string;
}

/**
 * Drop-in single-action button for hosts that already render their own
 * listing grid and just want a "Buy" or "Offer" CTA per item, with the
 * SDK-provided form modal. Mirrors `NftActionButton` in
 * @vsc.eco/token-widget.
 */
export function MarketActionButton(props: MarketActionButtonProps) {
	const {
		username,
		aioha,
		onBroadcast,
		keyType,
		config = MAINNET_CONFIG,
		client: providedClient,
		listing,
		action,
		label,
		onSuccess,
		className
	} = props;
	const client = providedClient ?? createMarketClient({ config, aioha, onBroadcast, keyType });
	const [open, setOpen] = useState(false);
	const buttonLabel = label ?? (action === 'buy' ? 'Buy' : 'Make offer');
	return (
		<div
			className={`magi-market ${className ?? ''}`}
			style={{ display: 'inline-block', padding: 0, border: 0, background: 'transparent', boxShadow: 'none' }}
		>
			<button
				type="button"
				className="magi-market-submit"
				disabled={!username}
				onClick={() => setOpen(true)}
				style={{ width: 'auto', padding: '0.5rem 1rem' }}
			>
				{buttonLabel}
			</button>
			{open && username && action === 'buy' && (
				<BuyForm
					client={client}
					username={username}
					listing={listing}
					onSuccess={(tx) => {
						onSuccess?.(tx);
						setOpen(false);
					}}
					onClose={() => setOpen(false)}
				/>
			)}
			{open && username && action === 'offer' && (
				<MakeOfferForm
					client={client}
					username={username}
					defaultNftContract={listing.nftContract}
					defaultTokenId={listing.tokenId}
					onSuccess={(tx) => {
						onSuccess?.(tx);
						setOpen(false);
					}}
					onClose={() => setOpen(false)}
				/>
			)}
		</div>
	);
}
