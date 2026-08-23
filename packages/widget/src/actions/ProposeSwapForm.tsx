import { useMemo, useState } from 'react';
import type { MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { TokenPicker } from '../components/TokenPicker.js';
import { BlockDurationInput } from '../components/BlockDurationInput.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { assertValidTokenIdChars } from '../components/tokenIdValid.js';

export interface ProposeSwapFormProps {
	client: MarketClient;
	username: string;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Propose an NFT-for-NFT swap. The proposer must already have approved
 * the marketplace on `offeredNft`. Optional token top-up (fee-only, no
 * royalty applied on barter) is paid by the proposer at accept time; the
 * intent for that top-up belongs on this op when it's a magi_token —
 * native top-ups would need a `transfer.allow` intent which the SDK's
 * `proposeSwapOp` does NOT currently accept, so we only support
 * magi_token top-ups here.
 */
export function ProposeSwapForm({ client, username, onSuccess, onClose }: ProposeSwapFormProps) {
	const tokenMeta = useTokenMeta(client.config);

	const [offeredNft, setOfferedNft] = useState('');
	const [offeredTokenId, setOfferedTokenId] = useState('');
	const [offeredAmount, setOfferedAmount] = useState('1');
	const [wantedNft, setWantedNft] = useState('');
	const [wantedTokenId, setWantedTokenId] = useState('');
	const [wantedAmount, setWantedAmount] = useState('1');
	const [topUp, setTopUp] = useState('');
	const [topUpToken, setTopUpToken] = useState('');
	const [expirationBlock, setExpirationBlock] = useState<number | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const offeredIdValid = assertValidTokenIdChars(offeredTokenId.trim());
	const wantedIdValid = assertValidTokenIdChars(wantedTokenId.trim());

	const hasTopUp = topUp.trim() !== '' && topUp.trim() !== '0';
	const microTopUp = hasTopUp ? tokenMeta.toMicro(topUpToken, topUp) : '';

	const valid = useMemo(() => {
		const oAmt = Number(offeredAmount);
		const wAmt = Number(wantedAmount);
		if (offeredNft.trim() === '' || wantedNft.trim() === '') return false;
		if (offeredTokenId.trim() === '' || wantedTokenId.trim() === '') return false;
		if (!offeredIdValid || !wantedIdValid) return false;
		if (!Number.isInteger(oAmt) || oAmt <= 0) return false;
		if (!Number.isInteger(wAmt) || wAmt <= 0) return false;
		if (hasTopUp) {
			if (topUpToken.trim() === '') return false;
			if (microTopUp === '' || BigInt(microTopUp) <= 0n) return false;
		}
		return true;
	}, [offeredNft, wantedNft, offeredTokenId, wantedTokenId, offeredIdValid, wantedIdValid, offeredAmount, wantedAmount, hasTopUp, topUpToken, microTopUp]);

	async function handleSubmit() {
		if (!valid || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const op = client.ops.proposeSwapOp(username, {
				offeredNft: offeredNft.trim(),
				offeredTokenId: offeredTokenId.trim(),
				offeredAmount: Number(offeredAmount),
				wantedNft: wantedNft.trim(),
				wantedTokenId: wantedTokenId.trim(),
				wantedAmount: Number(wantedAmount),
				topUp: hasTopUp ? microTopUp : '',
				topUpToken: hasTopUp ? topUpToken.trim() : '',
				expirationBlock: expirationBlock ?? 0
			});
			const { txId: tx } = await client.broadcast(op);
			setTxId(tx);
			onSuccess?.(tx);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Modal title="Propose a swap" subtitle="NFT-for-NFT trade with an optional token top-up." onClose={onClose}>
			{txId ? (
				<>
					<BroadcastResult txId={txId} config={client.config} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : (
				<>
					<Field label="Offered NFT contract">
						<TextInput value={offeredNft} onChange={setOfferedNft} placeholder="vsc1…" disabled={submitting} />
					</Field>
					<Field label="Offered token id" error={!offeredIdValid ? 'Invalid characters in token id.' : null}>
						<TextInput value={offeredTokenId} onChange={setOfferedTokenId} placeholder="nft1" disabled={submitting} />
					</Field>
					<Field label="Offered amount">
						<TextInput type="number" inputMode="numeric" min={1} value={offeredAmount} onChange={setOfferedAmount} disabled={submitting} />
					</Field>
					<Field label="Wanted NFT contract">
						<TextInput value={wantedNft} onChange={setWantedNft} placeholder="vsc1…" disabled={submitting} />
					</Field>
					<Field label="Wanted token id" error={!wantedIdValid ? 'Invalid characters in token id.' : null}>
						<TextInput value={wantedTokenId} onChange={setWantedTokenId} placeholder="nft7" disabled={submitting} />
					</Field>
					<Field label="Wanted amount">
						<TextInput type="number" inputMode="numeric" min={1} value={wantedAmount} onChange={setWantedAmount} disabled={submitting} />
					</Field>
					<Field label="Top-up (optional)" hint="Extra token amount you add to sweeten the deal.">
						<TextInput inputMode="decimal" value={topUp} onChange={setTopUp} placeholder={tokenMeta.smallestUnit(topUpToken)} disabled={submitting} />
					</Field>
					{hasTopUp && (
						<TokenPicker config={client.config} value={topUpToken} onChange={setTopUpToken} label="Top-up token" disabled={submitting} />
					)}
					<BlockDurationInput
						client={client}
						label="Expires in (optional)"
						value={expirationBlock}
						onChange={setExpirationBlock}
						allowEmpty
						disabled={submitting}
					/>

					{error && <p className="magi-market-status error">{error}</p>}

					<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
						{submitting ? 'Proposing…' : 'Propose swap'}
					</button>
				</>
			)}
		</Modal>
	);
}
