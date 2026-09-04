import { useMemo, useState } from 'react';
import type { MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { TokenPicker } from '../components/TokenPicker.js';
import { SelectPicker, type SelectOption } from '../components/SelectPicker.js';
import { CollectionNftPicker, ANY_TOKEN } from '../components/CollectionNftPicker.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { useAffordability } from '../components/useAffordability.js';
import { FundsNote } from '../components/FundsNote.js';
import { useCollectionMeta } from '../components/useCollectionMeta.js';
import { useCollectionTokens } from '../components/useCollectionTokens.js';
import { BlockDurationInput } from '../components/BlockDurationInput.js';

export interface MakeOfferFormProps {
	client: MarketClient;
	username: string;
	defaultNftContract?: string;
	defaultTokenId?: string;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

// ANY_TOKEN sentinel (collection-wide offer; contract treats an empty
// tokenId as a wildcard) is shared with CollectionNftPicker.

/**
 * Make an offer. Pick the collection from the registry (name + owner),
 * then pick a specific transferable NFT in it — or "any NFT" for a
 * collection-wide offer. Soulbound tokens that aren't held by the
 * collection owner are excluded (they can never be transferred to
 * fulfill the offer). Funds are escrowed only when the holder accepts;
 * for magi_token payment the buyer's `makeOffer` escrow pull requires a
 * prior `approve(market,total)` (the SDK composite handles that leg).
 */
export function MakeOfferForm({
	client,
	username,
	defaultNftContract,
	defaultTokenId,
	onSuccess,
	onClose
}: MakeOfferFormProps) {
	const tokenMeta = useTokenMeta(client.config);
	const collMeta = useCollectionMeta(client.config);

	const [nftContract, setNftContract] = useState(defaultNftContract ?? '');
	// '' = nothing chosen yet; ANY_TOKEN = collection-wide; else a tokenId.
	const [tokenChoice, setTokenChoice] = useState(defaultTokenId ?? '');
	const [amount, setAmount] = useState('1');
	const [paymentToken, setPaymentToken] = useState('');
	const [price, setPrice] = useState('');
	const [expirationBlock, setExpirationBlock] = useState<number | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const microPrice = paymentToken && price.trim() !== '' ? tokenMeta.toMicro(paymentToken, price.trim()) : '';
	const NATIVE = new Set(['hive', 'hbd']);
	const isNative = NATIVE.has((paymentToken || '').toLowerCase());
	// The contract escrows pricePerUnit × amount at makeOffer time, so a
	// native (HIVE/HBD) offer needs a transfer.allow intent for that total.
	const totalMicro = useMemo(() => {
		if (!microPrice || Number(amount) <= 0) return null;
		try {
			return (BigInt(microPrice) * BigInt(Number(amount))).toString();
		} catch {
			return null;
		}
	}, [microPrice, amount]);

	const collectionOptions = useMemo<SelectOption[]>(
		() =>
			collMeta.collections.map((c) => ({
				value: c.contractId,
				label: c.name,
				hint: c.owner ? `by ${c.owner}` : c.contractId
			})),
		[collMeta.collections]
	);

	const collectionOwner = collMeta.owner(nftContract);
	const { tokens, loading: tokensLoading } = useCollectionTokens(client.config, nftContract, collectionOwner);

	// The contract wildcard for a collection offer is an empty tokenId.
	const resolvedTokenId = tokenChoice === ANY_TOKEN ? '' : tokenChoice;
	const tokenChosen = tokenChoice !== '';
	const isCollectionOffer = tokenChoice === ANY_TOKEN;
	/** How many accounts hold the chosen token — drives the "who can accept" copy. */
	const chosenHolderCount =
		tokens.find((t) => t.tokenId === resolvedTokenId)?.holders.length ?? 0;

	const funds = useAffordability(client.config, username, paymentToken.trim(), totalMicro);

	const valid = useMemo(
		() =>
			funds.ok &&
			nftContract.trim() !== '' &&
			tokenChosen &&
			Number(amount) > 0 &&
			paymentToken.trim() !== '' &&
			microPrice !== '' &&
			(() => {
				try {
					return BigInt(microPrice) > 0n;
				} catch {
					return false;
				}
			})(),
		[nftContract, tokenChosen, amount, paymentToken, microPrice]
	);

	async function handleSubmit() {
		if (!valid || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const intents = isNative && totalMicro
				? [{ type: 'transfer.allow' as const, args: { limit: totalMicro, token: paymentToken.trim() } }]
				: undefined;
			const op = client.ops.makeOfferOp(
				username,
				{
					nftContract: nftContract.trim(),
					tokenId: resolvedTokenId,
					amount: Number(amount),
					paymentToken: paymentToken.trim(),
					pricePerUnit: microPrice,
					expirationBlock: expirationBlock ?? 0
				},
				intents
			);
			const res = await client.broadcast(op);
			setTxId(res.txId);
			onSuccess?.(res.txId);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Modal title="Make an offer" subtitle="Your payment is escrowed now (at offer time); refunded if you cancel or it expires unaccepted." onClose={onClose}>
			{txId ? (
				<>
					<BroadcastResult txId={txId} config={client.config} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : (
				<>
					<SelectPicker
						label="Collection"
						value={nftContract}
						options={collectionOptions}
						onChange={(v) => {
							setNftContract(v);
							setTokenChoice('');
						}}
						disabled={submitting}
					/>

					{nftContract && (
						<CollectionNftPicker
							config={client.config}
							nftContract={nftContract}
							tokens={tokens}
							loading={tokensLoading}
							value={tokenChoice}
							onChange={setTokenChoice}
							disabled={submitting}
						/>
					)}

					{/* An offer is an OPEN bid on (nftContract, tokenId): the payload
					    carries no seller and `doAcceptOffer` lets any holder accept.
					    Say so explicitly — picking a token whose tile lists a holder
					    otherwise reads as "offering to that account". */}
					{tokenChosen && (
						<p className="magi-market-field-hint">
							{isCollectionOffer
								? 'Open offer: anyone holding an NFT from this collection can accept it — whoever accepts first gets paid.'
								: chosenHolderCount > 1
									? `Open offer: any of the ${chosenHolderCount} accounts holding this NFT can accept it — whoever accepts first gets paid. You can't direct an offer at one specific account.`
									: "Open offer: whoever holds this NFT can accept it. You can't direct an offer at one specific account."}
						</p>
					)}

					<Field label="Amount">
						<TextInput type="number" inputMode="numeric" min={1} value={amount} onChange={setAmount} disabled={submitting} />
					</Field>
					<TokenPicker config={client.config} value={paymentToken} onChange={setPaymentToken} disabled={submitting} />
					<Field label="Price per unit">
						<TextInput inputMode="decimal" value={price} onChange={setPrice} placeholder={tokenMeta.smallestUnit(paymentToken)} disabled={submitting} />
					</Field>
					<BlockDurationInput
						client={client}
						label="Expires in (optional)"
						value={expirationBlock}
						onChange={setExpirationBlock}
						allowEmpty
						disabled={submitting}
					/>

					<FundsNote funds={funds} paymentToken={paymentToken.trim()} tokenMeta={tokenMeta} />
					{error && <p className="magi-market-status error">{error}</p>}

					<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
						{submitting ? 'Submitting…' : 'Make offer'}
					</button>
				</>
			)}
		</Modal>
	);
}
