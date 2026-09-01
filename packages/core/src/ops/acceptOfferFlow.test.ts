import { describe, expect, it } from 'vitest';
import {
	buildAcceptCollectionOfferFlow,
	buildAcceptOfferFlow,
	type MarketOpContext
} from './market.js';

const MARKET = 'vsc1BnMAaeUzhzVcfKMDG5vphthhymk6irjLNq';
const NFT = 'vsc1BrztgdX2rZ6jw4oVzRmox23T2EKmFMYRYA';
const ctx: MarketOpContext = { contractId: MARKET, username: 'alice', network: 'vsc-testnet' };

describe('buildAcceptOfferFlow', () => {
	it('emits the NFT approve leg before the accept leg', () => {
		const bundles = buildAcceptOfferFlow(ctx, {
			offerId: 7,
			amount: 3,
			nftContract: NFT,
			tokenId: 'ed53'
		});
		expect(bundles).toHaveLength(2);
		const [approve, accept] = bundles;
		// Leg 1 targets the NFT contract, not the market.
		expect(approve.call.contractId).toBe(NFT);
		expect(approve.call.action).toBe('approve');
		expect(approve.call.payload).toEqual({
			// `contract:`-prefixed — magi_nft stores the allowance under the
			// market's cross-call identity, so a bare id leaves it unauthorized.
			spender: `contract:${MARKET}`,
			id: 'ed53',
			amount: 3
		});
		// Leg 2 is the market accept, scoped to exactly the approved amount.
		expect(accept.call.contractId).toBe(MARKET);
		expect(accept.call.action).toBe('acceptOffer');
		expect(accept.call.payload).toEqual({ offerId: 7, amount: 3 });
	});

	it('drops the approve leg when skipApproval is set', () => {
		const bundles = buildAcceptOfferFlow(ctx, {
			offerId: 7,
			amount: 1,
			nftContract: NFT,
			tokenId: 'ed53',
			skipApproval: true
		});
		expect(bundles).toHaveLength(1);
		expect(bundles[0].call.action).toBe('acceptOffer');
	});

	it('rejects a non-positive accept amount before signing', () => {
		expect(() =>
			buildAcceptOfferFlow(ctx, { offerId: 7, amount: 0, nftContract: NFT, tokenId: 'ed53' })
		).toThrow(/acceptOffer.amount/);
	});
});

describe('buildAcceptCollectionOfferFlow', () => {
	it('approves the delivered tokenId and passes it to the accept leg', () => {
		const bundles = buildAcceptCollectionOfferFlow(ctx, {
			offerId: 9,
			amount: 2,
			nftContract: NFT,
			tokenId: 'mkt-b4'
		});
		expect(bundles).toHaveLength(2);
		const [approve, accept] = bundles;
		expect(approve.call.contractId).toBe(NFT);
		expect(approve.call.payload).toMatchObject({ id: 'mkt-b4', amount: 2 });
		expect(accept.call.action).toBe('acceptCollectionOffer');
		expect(accept.call.payload).toEqual({ offerId: 9, tokenId: 'mkt-b4', amount: 2 });
	});

	it('signs both legs as the same account', () => {
		const bundles = buildAcceptCollectionOfferFlow(ctx, {
			offerId: 9,
			amount: 1,
			nftContract: NFT,
			tokenId: 'mkt-b4'
		});
		for (const b of bundles) {
			// `op` is the Hive tuple: ['custom_json', {...}]. Both legs must be
			// active-authed by the accepter, else the batch splits across signers.
			expect(b.op[0]).toBe('custom_json');
			expect(b.op[1].required_auths).toEqual(['alice']);
			expect(b.op[1].required_posting_auths).toEqual([]);
			expect(b.op[1].id).toBe('vsc.call');
		}
	});
});
