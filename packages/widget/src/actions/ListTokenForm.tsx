import { useState } from 'react';
import type { MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { TokenPicker } from '../components/TokenPicker.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { useUserBalances } from '../components/useUserBalances.js';

export interface ListTokenFormProps {
	client: MarketClient;
	username: string;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Sell an amount of an ERC-20 token-contract token for a fixed price in a
 * payment token. Cross-contract `client.sellToken(...)`: ERC-20
 * `approve(spender=contract:<market>, amount)` on the **asset** token, then
 * `listToken`, signed as one batch. magi-market's `buyToken` pulls the
 * asset via `transferFrom` (atomic). Amounts are integer unit strings.
 */
export function ListTokenForm({ client, username, onSuccess, onClose }: ListTokenFormProps) {
	const tokenMeta = useTokenMeta(client.config);
	const balances = useUserBalances(client.config, username);

	const [assetToken, setAssetToken] = useState('');
	const [amount, setAmount] = useState('');
	const [paymentToken, setPaymentToken] = useState('');
	const [price, setPrice] = useState('');
	const [skipApproval, setSkipApproval] = useState(false);
	const [step, setStep] = useState<1 | 2>(1);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Available balance of the asset token (null while loading or before pick).
	const availableMicro = assetToken ? balances.balanceOf(assetToken) : null;
	const assetSymbol = assetToken ? tokenMeta.symbol(assetToken) : '';
	const assetDecimals = assetToken ? tokenMeta.decimals(assetToken) : 0;
	const paySymbol = paymentToken ? tokenMeta.symbol(paymentToken) : '';
	const payDecimals = paymentToken ? tokenMeta.decimals(paymentToken) : 0;

	// User-typed amount is a human decimal (e.g. "0.5") — convert via the
	// asset token's decimals. Bad input → null; downstream invariants drop.
	const amountMicro = (() => {
		if (!assetToken || amount.trim() === '') return null;
		try {
			const m = tokenMeta.toMicro(assetToken, amount.trim());
			return m && BigInt(m) > 0n ? m : null;
		} catch {
			return null;
		}
	})();
	const priceMicro = (() => {
		if (!paymentToken || price.trim() === '') return null;
		try {
			const m = tokenMeta.toMicro(paymentToken, price.trim());
			return m && BigInt(m) > 0n ? m : null;
		} catch {
			return null;
		}
	})();

	const amountWithinBalance = (() => {
		if (!amountMicro) return false;
		if (availableMicro == null) return true; // still loading
		try {
			return BigInt(amountMicro) <= availableMicro;
		} catch {
			return false;
		}
	})();
	const step1Ok = assetToken.trim() !== '' && !!amountMicro && amountWithinBalance;
	const valid = step1Ok && paymentToken.trim() !== '' && !!priceMicro;

	async function handleSubmit() {
		if (!valid || submitting || !amountMicro || !priceMicro) return;
		setSubmitting(true);
		setError(null);
		try {
			const { txIds } = await client.sellToken(username, {
				tokenContract: assetToken.trim(),
				amount: amountMicro,
				paymentToken: paymentToken.trim(),
				pricePerUnit: priceMicro,
				skipApproval
			});
			const last = txIds[txIds.length - 1];
			setTxId(last);
			onSuccess?.(last);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Modal
			title="Sell a token"
			subtitle={
				txId
					? undefined
					: step === 1
						? 'Step 1 of 2 — choose the token & amount to sell'
						: 'Step 2 of 2 — price (approve + listToken signed as one batch)'
			}
			onClose={onClose}
		>
			{txId ? (
				<>
					<BroadcastResult txId={txId} config={client.config} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : step === 1 ? (
				<>
					<TokenPicker
						config={client.config}
						value={assetToken}
						onChange={(v) => {
							setAssetToken(v);
							setAmount('');
						}}
						disabled={submitting}
						label="Asset token to sell"
						excludeNative
					/>
					<Field
						label={`Amount to sell${assetToken ? ` (${assetSymbol})` : ''}`}
						hint={
							assetToken
								? availableMicro == null
									? 'Checking your balance…'
									: availableMicro === 0n
										? `You don't hold any ${assetSymbol}.`
										: `Available: ${tokenMeta.format(assetToken, availableMicro.toString())} ${assetSymbol}.${assetDecimals > 0 ? ` Up to ${assetDecimals} decimal place${assetDecimals === 1 ? '' : 's'}.` : ' Whole units only.'}`
								: 'Select a token first.'
						}
					>
						<div style={{ display: 'flex', gap: 6 }}>
							<TextInput
								inputMode={assetDecimals > 0 ? 'decimal' : 'numeric'}
								value={amount}
								onChange={setAmount}
								placeholder={assetDecimals > 0 ? '0.5' : '1000'}
								disabled={submitting || availableMicro === 0n}
							/>
							{availableMicro != null && availableMicro > 0n && (
								<button
									type="button"
									className="magi-market-submit ghost"
									style={{ width: 'auto', padding: '0.4rem 0.8rem' }}
									disabled={submitting}
									onClick={() => setAmount(tokenMeta.format(assetToken, availableMicro.toString()))}
								>
									Max
								</button>
							)}
						</div>
					</Field>
					{amountMicro && !amountWithinBalance && availableMicro != null && (
						<p className="magi-market-status error">
							Exceeds available balance ({tokenMeta.format(assetToken, availableMicro.toString())} {assetSymbol}).
						</p>
					)}
					<button type="button" className="magi-market-submit" disabled={!step1Ok} onClick={() => setStep(2)}>
						Next →
					</button>
				</>
			) : (
				<>
					<TokenPicker config={client.config} value={paymentToken} onChange={setPaymentToken} disabled={submitting} />
					<Field
						label={`Price per ${assetSymbol || 'unit'}${paymentToken ? ` (${paySymbol})` : ''}`}
						hint={
							paymentToken
								? payDecimals > 0
									? `Payment per ONE ${assetSymbol || 'asset'}. Up to ${payDecimals} decimal place${payDecimals === 1 ? '' : 's'}.`
									: `Payment per ONE ${assetSymbol || 'asset'}. Whole ${paySymbol} units only.`
								: 'Select a payment token first.'
						}
					>
						<TextInput
							inputMode={payDecimals > 0 ? 'decimal' : 'numeric'}
							value={price}
							onChange={setPrice}
							placeholder={tokenMeta.smallestUnit(paymentToken)}
							disabled={submitting}
						/>
					</Field>
					<label className="magi-market-field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
						<input type="checkbox" checked={skipApproval} onChange={(e) => setSkipApproval((e.target as HTMLInputElement).checked)} disabled={submitting} />
						<span className="magi-market-field-hint">Marketplace already approved for this token (skip the approve op)</span>
					</label>

					{error && <p className="magi-market-status error">{error}</p>}

					<div style={{ display: 'flex', gap: 8 }}>
						<button type="button" className="magi-market-submit ghost" style={{ width: 'auto' }} disabled={submitting} onClick={() => setStep(1)}>
							← Back
						</button>
						<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
							{submitting ? 'Listing…' : 'Approve & list token'}
						</button>
					</div>
				</>
			)}
		</Modal>
	);
}
