import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Aioha, KeyTypes, type Providers } from '@aioha/aioha';
import { MagiMarketPanel } from '@vsc.eco/market-widget';
import {
	createMarketClient,
	MarketAmount,
	TESTNET_CONFIG,
	MAINNET_CONFIG,
	type MagiConfig,
	type MarketInfo
} from '@vsc.eco/market-sdk';

// The widget defaults to Altera dark; this opt-in stylesheet adds the light
// theme so the demo's theme toggle can flip the live panel.
import '@vsc.eco/market-widget/themes/light.css';

type Theme = 'light' | 'dark';

// VSC testnet is anchored on a Hive *testnet* L1 with a custom chain id.
// Aioha defaults to Hive mainnet — signing a vsc-testnet tx against mainnet
// fails to validate. Point Aioha at the testnet node + chain id when the SDK
// config is vsc-testnet; use the default (mainnet) Aioha for vsc-mainnet.
const TESTNET_HIVE_API = 'https://testnet.techcoderx.com';
const TESTNET_CHAIN_ID = '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';

type Network = 'vsc-testnet' | 'vsc-mainnet';

const CONFIGS: Record<Network, MagiConfig> = {
	'vsc-testnet': TESTNET_CONFIG,
	'vsc-mainnet': MAINNET_CONFIG
};

/**
 * Build an Aioha wired to the right Hive L1 for the VSC network. Testnet uses
 * the testnet node + custom chain id; mainnet uses Aioha's defaults. Each
 * network switch rebuilds this so signatures validate against the correct
 * chain. Keychain + MetaMask Snap are registered on both.
 */
function buildAioha(network: Network): Aioha {
	const a =
		network === 'vsc-testnet'
			? new Aioha(TESTNET_HIVE_API, [], TESTNET_CHAIN_ID)
			: new Aioha();
	a.registerKeychain();
	a.registerMetaMaskSnap().catch(() => {});
	return a;
}

// A real testnet collection (owner hive:tibfox) so the headless op snippet
// builds against a contract that actually exists.
const SAMPLE_NFT = 'vsc1BjBDTDFaiRqWjjVCVjCyghN281WyZfPc5A';

/**
 * Sections rendered on the page, in order. Each `id` matches the
 * corresponding `<h2 id="...">` so the sticky sidebar can both jump to and
 * highlight the active section. The `tag` drives the with/without-widget pill.
 */
const SECTIONS: Array<{ id: string; label: string; tag?: 'widget' | 'headless' }> = [
	{ id: 'install', label: 'Installation' },
	{ id: 'auth', label: 'Auth setup' },
	{ id: 'panel', label: '<MagiMarketPanel>', tag: 'widget' },
	{ id: 'info', label: 'Read: getMarketInfo', tag: 'headless' },
	{ id: 'reads', label: 'Read: listings/offers', tag: 'headless' },
	{ id: 'ops', label: 'Build ops', tag: 'headless' },
	{ id: 'composites', label: 'Cross-contract flows', tag: 'headless' },
	{ id: 'blocks', label: 'Block-height helper', tag: 'headless' },
	{ id: 'custom-signer', label: 'Custom signer', tag: 'headless' },
	{ id: 'web-component', label: 'Web component', tag: 'widget' },
	{ id: 'theming', label: 'Theming' },
	{ id: 'failover', label: 'Endpoint failover' },
	{ id: 'proof', label: 'What this proves' }
];

/**
 * Track which section is in view via IntersectionObserver so the sidebar
 * stays in sync as the user scrolls.
 */
function useActiveSection(ids: readonly string[]): string {
	const [activeId, setActiveId] = useState<string>(ids[0] ?? '');
	useEffect(() => {
		const headings = ids
			.map((id) => document.getElementById(id))
			.filter((el): el is HTMLElement => !!el);
		if (!headings.length) return;
		const obs = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((e) => e.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
				if (visible[0]) setActiveId(visible[0].target.id);
			},
			{ rootMargin: '-15% 0px -70% 0px', threshold: 0 }
		);
		headings.forEach((h) => obs.observe(h));
		return () => obs.disconnect();
	}, [ids]);
	return activeId;
}

function App() {
	const [network, setNetwork] = useState<Network>('vsc-testnet');
	const config = CONFIGS[network];
	// Rebuild Aioha whenever the network changes so txs sign against the right
	// Hive L1. The loadAuth effect below re-derives the connected user.
	const aioha = useMemo(() => buildAioha(network), [network]);

	const [username, setUsername] = useState<string | undefined>(undefined);
	const [user, setUser] = useState('');
	const [theme, setTheme] = useState<Theme>('dark');
	const [connecting, setConnecting] = useState<string | null>(null);
	const [loginErr, setLoginErr] = useState<string | null>(null);
	const [lastTx, setLastTx] = useState<string | null>(null);

	useEffect(() => {
		setLastTx(null);
		setLoginErr(null);
		setUsername(aioha.loadAuth() ? (aioha.getCurrentUser() ?? undefined) : undefined);
	}, [aioha]);

	useEffect(() => {
		document.body.dataset.theme = theme;
	}, [theme]);

	async function connect(provider: string) {
		const u = user.trim().replace(/^@/, '');
		if (!u) {
			setLoginErr('Enter your Hive username first.');
			return;
		}
		setLoginErr(null);
		setConnecting(provider);
		try {
			const res = await aioha.login(provider as Providers, u, {
				msg: 'Login to Magi Market SDK demo',
				keyType: KeyTypes.Posting
			});
			if (res.success) setUsername(aioha.getCurrentUser() ?? u);
			else setLoginErr(res.error || `Could not connect via ${provider}.`);
		} catch (e) {
			setLoginErr(e instanceof Error ? e.message : String(e));
		} finally {
			setConnecting(null);
		}
	}
	async function disconnect() {
		await aioha.logout();
		setUsername(undefined);
	}

	const connected = !!username;
	const themedClass = theme === 'light' ? 'magi-market-light-host' : '';
	const netLabel = network === 'vsc-testnet' ? 'testnet' : 'mainnet';
	// magi-market is only deployed on testnet so far; on mainnet the config's
	// contract id is a placeholder, so reads are empty and writes would fail.
	const marketLive = network === 'vsc-testnet';
	const sectionIds = useMemo(() => SECTIONS.map((s) => s.id), []);
	const activeId = useActiveSection(sectionIds);

	return (
		<div className="layout">
			<aside className="toc">
				<p className="toc-title">On this page</p>
				<ul>
					{SECTIONS.map((s) => (
						<li key={s.id}>
							<a
								href={`#${s.id}`}
								className={activeId === s.id ? 'active' : ''}
								onClick={(e) => {
									e.preventDefault();
									document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
									history.replaceState(null, '', `#${s.id}`);
								}}
							>
								{s.label}
							</a>
						</li>
					))}
				</ul>
			</aside>

			<main className="main">
				<h1>Magi Market SDK</h1>
				<p className="intro">
					Headless SDK + embeddable React/web-component panel for the Magi
					NFT-marketplace contract. Same structure, code styling, and auth
					model as the <a href="https://token-sdk.okinoko.io">Magi Token SDK</a>.
					Every section shows how to do the thing <strong>with the widget</strong>{' '}
					and <strong>without it</strong> (headless). Use the network switch below
					to point the whole page at <strong>{netLabel}</strong>; it's currently
					wired to the marketplace contract{' '}
					<code>{config.marketContractId}</code>
					{marketLive ? ' — connected actions run for real.' : '.'}
				</p>
				{!marketLive && (
					<p className="callout">
						<strong>Heads up:</strong> magi-market isn't deployed on mainnet yet,
						so this contract id is a placeholder — reads come back empty and write
						actions would fail. Switch to <strong>testnet</strong> for a live demo.
					</p>
				)}

				{/* ============== Wallet bar ============== */}
				<div className={`wallet-bar ${connected ? 'connected' : 'disconnected'}`}>
					<div className="wallet-bar-icon" aria-hidden="true">
						{connected ? (
							<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<polyline points="20 6 9 17 4 12" />
							</svg>
						) : (
							<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
								<rect x="3" y="6" width="18" height="13" rx="2" />
								<path d="M3 10h18" />
								<circle cx="16" cy="14" r="1" fill="currentColor" />
							</svg>
						)}
					</div>
					<div className="wallet-bar-body">
						<div className="wallet-bar-title">
							{connected ? <>Connected as <code>@{username}</code></> : 'Connect a Hive wallet'}
						</div>
						<div className="wallet-bar-sub">
							{connected
								? `Network: ${netLabel} · sell, buy, offer, auction, mint spots are live`
								: loginErr
									? loginErr
									: 'Keychain or MetaMask Snap. Browsing + headless reads work without connecting.'}
							{lastTx && (
								<>
									{' · last tx: '}
									<a href={`https://vsc.techcoderx.com/tx/${lastTx}`} target="_blank" rel="noopener noreferrer">
										<code>{lastTx.slice(0, 10)}…</code>
									</a>
								</>
							)}
						</div>
					</div>
					<div className="wallet-bar-actions">
						{connected ? (
							<button onClick={disconnect}>Disconnect</button>
						) : (
							<>
								<input
									value={user}
									onChange={(e) => setUser((e.target as HTMLInputElement).value)}
									placeholder="hive username"
								/>
								{(
									[
										['keychain', 'Keychain', 'primary'],
										['metamasksnap', 'MetaMask Snap', '']
									] as Array<[string, string, string]>
								).map(([id, label, cls]) => (
									<button key={id} className={cls} disabled={!!connecting} onClick={() => connect(id)}>
										{connecting === id ? 'Connecting…' : label}
									</button>
								))}
							</>
						)}
					</div>
				</div>

				{/* ============== Network ============== */}
				<div className="theme-row">
					<span><strong>Network:</strong></span>
					<button className={network === 'vsc-testnet' ? 'active' : ''} onClick={() => setNetwork('vsc-testnet')}>Testnet</button>
					<button className={network === 'vsc-mainnet' ? 'active' : ''} onClick={() => setNetwork('vsc-mainnet')}>Mainnet</button>
					<span style={{ color: '#64748b' }}>— swaps the SDK config (contract id, indexer + node endpoints) and the Aioha Hive-L1 chain, and re-runs every live read below.</span>
				</div>

				{/* ============== Theme ============== */}
				<div className="theme-row">
					<span><strong>Theme:</strong></span>
					<button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>Light</button>
					<button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>Altera dark</button>
					<span style={{ color: '#64748b' }}>— flips the live panel via <code>magi-market-light-host</code></span>
				</div>

				{/* ============== Installation ============== */}
				<h2 id="install">Installation</h2>
				<p>Three packages, layered. Install only the layer you need.</p>
				<pre className="code"><Code>{INSTALL_SNIPPET}</Code></pre>
				<ul>
					<li><code>@vsc.eco/market-core</code> — operation builders + types. Zero deps.</li>
					<li><code>@vsc.eco/market-sdk</code> — indexed reads, broadcast orchestrator, deployer client, multi-endpoint failover.</li>
					<li><code>@vsc.eco/market-widget</code> — the React panel + web component.</li>
				</ul>

				{/* ============== Auth ============== */}
				<h2 id="auth">Auth setup</h2>
				<p>
					Write operations sign through <a href="https://github.com/aioha-hive/aioha" target="_blank" rel="noopener noreferrer">Aioha</a>{' '}
					— the same setup okinoko-terminal and Altera use. The one testnet
					wrinkle: VSC testnet runs on a Hive <em>testnet</em> L1 with a custom
					chain id, so Aioha must be pointed there or signatures won't validate.
				</p>
				<pre className="code"><Code>{AUTH_SNIPPET}</Code></pre>
				<p className="callout">
					<strong>Don't use Aioha?</strong> Pass an <code>onBroadcast</code> hook
					instead — see <a href="#custom-signer">custom signer</a> below. The SDK
					still builds the operations; your callback only signs and broadcasts.
				</p>

				{/* ============== Panel (widget) ============== */}
				<h2 id="panel">&lt;MagiMarketPanel&gt;<span className="pill widget">with widget</span></h2>
				<p>
					One drop-in component: browse listings/auctions/offers/bundles/rentals/
					mint-spots/token-sales and act on them. Selling, auctioning and
					mint-spot listing run the SDK's cross-contract orchestrator (the NFT
					approval leg + the market op, signed as one chunked batch). The panel
					auto-imports its styles.
				</p>
				<pre className="code"><Code>{PANEL_SNIPPET}</Code></pre>
				<div className="live">
					<MagiMarketPanel
						key={network}
						username={username}
						aioha={aioha}
						keyType={KeyTypes.Active}
						config={config}
						className={themedClass}
						onSuccess={(tx) => setLastTx(tx)}
					/>
				</div>

				{/* ============== getMarketInfo (headless) ============== */}
				<h2 id="info">Read — <code>getMarketInfo()</code><span className="pill headless">no widget</span></h2>
				<p>Authoritative, schema-free read straight from the VSC node (<code>getStateByKeys</code>). No wallet needed:</p>
				<pre className="code"><Code>{INFO_SNIPPET}</Code></pre>
				<p>Live result:</p>
				<HeadlessInfo key={network} config={config} />

				{/* ============== reads (headless) ============== */}
				<h2 id="reads">Read — listings / offers / auctions<span className="pill headless">no widget</span></h2>
				<p>
					Indexed reads off the <code>magi_market_*</code> Hasura views. Every
					list type has a <code>get*</code> provider method with optional filters
					(<code>seller</code> / <code>nftContract</code> / <code>activeOnly</code>).
					Pull these directly when you build your own UI.
				</p>
				<pre className="code"><Code>{READS_SNIPPET}</Code></pre>
				<p>Live (first few active rows on {netLabel}):</p>
				<HeadlessReads key={network} config={config} />

				{/* ============== ops (headless) ============== */}
				<h2 id="ops">Build ops without broadcasting<span className="pill headless">no widget</span></h2>
				<p>
					Every action method has a sibling <code>ops.*Op</code> builder that
					returns the bundle without broadcasting — no signer required.{' '}
					<code>bundle.op</code> is a Hive <code>custom_json</code> ready for
					dhive; <code>bundle.call</code> exposes the inner contract-call fields
					if you'd rather call <code>aioha.vscCallContract(...)</code> yourself.
				</p>
				<pre className="code"><Code>{OPS_SNIPPET}</Code></pre>
				<p>Live bundle built in your browser{username ? ` for @${username}` : ''}:</p>
				<HeadlessOp key={network} config={config} username={username} />

				{/* ============== composites (headless) ============== */}
				<h2 id="composites">Cross-contract flows<span className="pill headless">no widget</span></h2>
				<p>
					Custody-changing actions need a leg on <em>another</em> contract first
					(approve the market on the NFT, or approve the payment token). The
					composite methods bundle both legs and sign them as one chunked batch,
					so the host never juggles two transactions.
				</p>
				<pre className="code"><Code>{COMPOSITES_SNIPPET}</Code></pre>

				{/* ============== blocks (headless) ============== */}
				<h2 id="blocks">Block-height helper<span className="pill headless">no widget</span></h2>
				<p>
					The contract works in <strong>absolute block numbers</strong>, not
					durations. <code>getBlockHeight()</code> returns the L2 height that the
					contract's <code>getCurrentBlockHeight()</code> sees, so you can turn
					"ends in 2 hours" into the <code>endBlock</code> / <code>expirationBlock</code>{' '}
					the entrypoints expect.
				</p>
				<pre className="code"><Code>{BLOCK_SNIPPET}</Code></pre>
				<p>Live ({netLabel} height now):</p>
				<HeadlessBlock key={network} config={config} />

				{/* ============== custom signer ============== */}
				<h2 id="custom-signer">Custom signer (no Aioha)<span className="pill headless">no widget</span></h2>
				<p>
					For Keychain-only apps or backend signers, pass an{' '}
					<code>onBroadcast</code> hook instead of an Aioha instance. The SDK
					still builds and stringifies the operation; your callback signs and
					broadcasts however the host already does. Works for both the
					composites and a single <code>ops.*Op</code> bundle.
				</p>
				<pre className="code"><Code>{CUSTOM_SIGNER_SNIPPET}</Code></pre>

				{/* ============== web component ============== */}
				<h2 id="web-component">Web component (vanilla / Vue / Svelte)<span className="pill widget">with widget</span></h2>
				<p>
					Non-React hosts embed the same panel as a custom element. String,
					number and boolean props pass as attributes; the Aioha instance,
					config object and callbacks must be set as JS properties on the element.
				</p>
				<pre className="code"><Code>{WEB_COMPONENT_SNIPPET}</Code></pre>

				{/* ============== theming ============== */}
				<h2 id="theming">Theming</h2>
				<p>
					The panel is driven by <code>--magi-*</code> CSS custom properties on{' '}
					<code>.magi-market</code> (or any ancestor) — the same variables the
					token widget uses, so one host theme block styles both. It defaults to{' '}
					<strong>Altera dark</strong>; opt into light by importing the bundled
					stylesheet and adding <code>magi-market-light-host</code> (the toggle at
					the top of this page does exactly that to the live panel).
				</p>
				<pre className="code"><Code>{THEMING_SNIPPET}</Code></pre>

				{/* ============== failover ============== */}
				<h2 id="failover">Endpoint failover</h2>
				<p>
					Both <code>indexerHasuraUrls</code> and <code>gqlUrls</code> accept
					ordered lists. The SDK tries each in turn — HTTP errors, network
					errors, GraphQL <code>errors[]</code> responses, and timeouts all
					trigger automatic failover to the next mirror. Pass{' '}
					<code>fetchOptions</code> to hook <code>onAttempt</code> /{' '}
					<code>onError</code> for telemetry or set a <code>timeoutMs</code>.
				</p>
				<pre className="code"><Code>{FAILOVER_SNIPPET}</Code></pre>

				{/* ============== proof ============== */}
				<h2 id="proof">What this demo proves</h2>
				<ul>
					<li>The panel renders in plain HTML — zero framework imports beyond React.</li>
					<li>Read providers query the live Magi indexer + node for marketplace state.</li>
					<li>Action forms build the same JSON payloads okinoko-terminal broadcasts.</li>
					<li>Aioha handoff works for Keychain / MetaMask Snap on the Hive testnet L1.</li>
					<li>Headless mode (no UI) returns ready-to-broadcast operation bundles.</li>
					<li>Cross-contract composites bundle the approval + market legs into one chunked batch.</li>
					<li><code>onBroadcast</code> swaps in any signer with no Aioha dependency.</li>
					<li>Theme switching is purely CSS-variable driven — no rebuild needed.</li>
				</ul>
			</main>
		</div>
	);
}

/**
 * Tiny syntax-ish highlighter — just enough to make snippets readable
 * without a heavyweight dependency.
 */
function Code({ children }: { children: string }) {
	const tokens: ReactNode[] = [];
	const re =
		/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|\b(import|from|export|const|let|var|function|return|async|await|if|else|for|of|in|new|class|extends|interface|type|true|false|null|undefined|as|void)\b|\b([A-Z][A-Za-z0-9]+)\b|\b(\d+(?:\.\d+)?)\b/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(children)) !== null) {
		if (m.index > last) tokens.push(children.slice(last, m.index));
		if (m[1]) tokens.push(<span key={`c-${m.index}`} className="com">{m[1]}</span>);
		else if (m[2]) tokens.push(<span key={`s-${m.index}`} className="str">{m[2]}</span>);
		else if (m[3]) tokens.push(<span key={`k-${m.index}`} className="kw">{m[3]}</span>);
		else if (m[4]) tokens.push(<span key={`t-${m.index}`} className="typ">{m[4]}</span>);
		else if (m[5]) tokens.push(<span key={`n-${m.index}`} className="num">{m[5]}</span>);
		last = re.lastIndex;
	}
	if (last < children.length) tokens.push(children.slice(last));
	return <>{tokens}</>;
}

/** Headless read: marketplace governance/config straight from the VSC node. */
function HeadlessInfo({ config }: { config: MagiConfig }) {
	const [info, setInfo] = useState<MarketInfo | null>(null);
	useEffect(() => {
		const client = createMarketClient({ config });
		client.provider.getMarketInfo().then(setInfo).catch(() => setInfo(null));
	}, [config]);
	return (
		<pre className="code">
			{info
				? JSON.stringify(info, null, 2)
				: 'loading… (owner / feeBps / feeRecipient / paused / pendingOwner)'}
		</pre>
	);
}

/** Headless reads: live listings / offers / auctions from the indexer. */
function HeadlessReads({ config }: { config: MagiConfig }) {
	const [data, setData] = useState<Record<string, unknown> | null>(null);
	useEffect(() => {
		let cancelled = false;
		const client = createMarketClient({ config });
		(async () => {
			try {
				const [listings, offers, auctions] = await Promise.all([
					client.provider.getListings({ activeOnly: true, limit: 3 }),
					client.provider.getOffers({ activeOnly: true }),
					client.provider.getAuctions({ activeOnly: true })
				]);
				if (cancelled) return;
				setData({
					listings: listings.slice(0, 3),
					offers: offers.slice(0, 2),
					auctions: auctions.slice(0, 2)
				});
			} catch {
				if (!cancelled) setData({});
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [config]);
	return (
		<pre className="code">
			{data === null ? 'loading…' : JSON.stringify(data, null, 2)}
		</pre>
	);
}

/** Headless op-builder: build a `list` bundle without broadcasting. */
function HeadlessOp({ config, username }: { config: MagiConfig; username: string | undefined }) {
	const bundle = useMemo(() => {
		const client = createMarketClient({ config });
		return client.ops.listOp(username ?? 'alice', {
			nftContract: SAMPLE_NFT,
			tokenId: 'card-001',
			amount: 1,
			paymentToken: 'hive',
			pricePerUnit: MarketAmount.fromDecimal('5.000', 3).toRawString()
		});
	}, [config, username]);
	return <pre className="code">{JSON.stringify(bundle, null, 2)}</pre>;
}

/** Headless: current L2 block height → a worked "ends in 2h" endBlock. */
function HeadlessBlock({ config }: { config: MagiConfig }) {
	const [height, setHeight] = useState<number | null>(null);
	useEffect(() => {
		const client = createMarketClient({ config });
		client.provider.getBlockHeight().then(setHeight).catch(() => setHeight(null));
	}, [config]);
	const perHour = 1200; // ~3.0s blocks
	return (
		<pre className="code">
			{height === null
				? 'loading…'
				: JSON.stringify(
						{ currentBlock: height, blocksPerHour: perHour, endBlockIn2h: height + 2 * perHour },
						null,
						2
				  )}
		</pre>
	);
}

const INSTALL_SNIPPET = `// React app — pull the widget; it depends on the core + sdk packages
pnpm add @vsc.eco/market-widget react react-dom @aioha/aioha

// Headless / no UI — pull just the SDK
pnpm add @vsc.eco/market-sdk

// Pure op builders, zero deps
pnpm add @vsc.eco/market-core`;

const AUTH_SNIPPET = `import { Aioha, KeyTypes } from '@aioha/aioha';
import { TESTNET_CONFIG } from '@vsc.eco/market-sdk';

// VSC testnet is anchored on a Hive *testnet* L1 with a custom chain id.
// Aioha defaults to Hive mainnet; point it at the testnet node + chain id
// when your SDK config is vsc-testnet, or signing fails to validate.
const TESTNET_HIVE_API = 'https://testnet.techcoderx.com';
const TESTNET_CHAIN_ID = '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';

const aioha = TESTNET_CONFIG.network === 'vsc-testnet'
  ? new Aioha(TESTNET_HIVE_API, [], TESTNET_CHAIN_ID)
  : new Aioha();
aioha.registerKeychain();
aioha.registerMetaMaskSnap().catch(() => {});

aioha.loadAuth(); // restore an existing session on reload`;

const PANEL_SNIPPET = `import { MagiMarketPanel } from '@vsc.eco/market-widget';
import { TESTNET_CONFIG } from '@vsc.eco/market-sdk';
import { KeyTypes } from '@aioha/aioha';

// The panel auto-imports its own styles. Browsing works with no wallet;
// pass username + aioha (or onBroadcast) to enable write actions.
<MagiMarketPanel
  aioha={aiohaInstance}
  username="alice"
  keyType={KeyTypes.Active}
  config={TESTNET_CONFIG}
  onSuccess={(txId) => console.log('Broadcast:', txId)}
/>`;

const INFO_SNIPPET = `import { createMarketClient, TESTNET_CONFIG } from '@vsc.eco/market-sdk';

const client = createMarketClient({ config: TESTNET_CONFIG });

// Governance/config straight from the VSC node (getStateByKeys) — schema-free.
const info = await client.provider.getMarketInfo();
// { owner, feeBps, feeRecipient, paused, pendingOwner? }`;

const READS_SNIPPET = `import { createMarketClient, TESTNET_CONFIG, MarketAmount } from '@vsc.eco/market-sdk';

const client = createMarketClient({ config: TESTNET_CONFIG });

// Indexed reads — no wallet needed. Filter by seller / nftContract / activeOnly.
const listings = await client.provider.getListings({ activeOnly: true });
const offers   = await client.provider.getOffers({ activeOnly: true });
const auctions = await client.provider.getAuctions({ activeOnly: true });
// also: getBundles, getSwaps, getRentals, getMintSpotListings, getTokenListings

// pricePerUnit is integer "smallest units" on the wire — wrap to display.
for (const l of listings) {
  const human = new MarketAmount(l.pricePerUnit, 3).toDecimalStringTrimmed();
  console.log(l.listingId, l.tokenId, human, l.paymentToken);
}`;

const OPS_SNIPPET = `import { createMarketClient, TESTNET_CONFIG, MarketAmount } from '@vsc.eco/market-sdk';

const client = createMarketClient({ config: TESTNET_CONFIG });

// Every write entrypoint has an ops.*Op builder that returns a bundle
// WITHOUT broadcasting (no signer required to build).
const bundle = client.ops.listOp('alice', {
  nftContract: 'vsc1BjBDTDFaiRqWjjVCVjCyghN281WyZfPc5A',
  tokenId: 'card-001',
  amount: 1,
  paymentToken: 'hive',
  pricePerUnit: MarketAmount.fromDecimal('5.000', 3).toRawString()
});

// bundle.op   → a Hive custom_json, ready for dhive / any broadcaster
// bundle.call → { contractId, action, payload, rcLimit, intents }
//   e.g. aioha.vscCallContract(call.contractId, call.action, call.payload,
//          call.rcLimit, call.intents, KeyTypes.Active)`;

const COMPOSITES_SNIPPET = `import { createMarketClient, TESTNET_CONFIG, MarketAmount } from '@vsc.eco/market-sdk';

const client = createMarketClient({ aioha: aiohaInstance, config: TESTNET_CONFIG });

// "Put an NFT up for sale" = NFT approve(market) + market \`list\`, signed as
// ONE chunked batch (works around Hive's per-tx op + per-block caps).
await client.sell('alice', {
  nftContract: 'vsc1BjBDTDFaiRqWjjVCVjCyghN281WyZfPc5A',
  tokenId: 'card-001',
  amount: 1,
  paymentToken: 'hive',
  pricePerUnit: MarketAmount.fromDecimal('5.000', 3).toRawString()
});

// Same approve-then-act pattern for the other custody-changing actions:
await client.auction('alice', { /* CreateAuctionParams */ });
await client.rental('alice',  { /* ListRentalParams */ });
await client.mintSpotListing('alice', { /* ListMintSpotsParams */ });

// Buying with a magi_token payment = token approve(market,total) + \`buy\`:
await client.buyWithPayment('alice', {
  listingId: 12, amount: 1, paymentToken: 'diy', total: '5000'
});`;

const BLOCK_SNIPPET = `import { createMarketClient, TESTNET_CONFIG } from '@vsc.eco/market-sdk';

const client = createMarketClient({ config: TESTNET_CONFIG });

// Auctions/rentals/offers take ABSOLUTE block numbers, not durations.
// Turn "ends in 2 hours" into the endBlock the contract expects:
const now = await client.provider.getBlockHeight();  // L2 height
const BLOCKS_PER_HOUR = 1200;                         // ~3.0s blocks
const endBlock = now + 2 * BLOCKS_PER_HOUR;`;

const CUSTOM_SIGNER_SNIPPET = `import { createMarketClient, TESTNET_CONFIG } from '@vsc.eco/market-sdk';

// No Aioha? Pass an onBroadcast hook. The SDK still builds + stringifies
// the op; your callback only signs + broadcasts (Keychain shown here).
const client = createMarketClient({
  config: TESTNET_CONFIG,
  onBroadcast: async (op, keyType) => {
    return new Promise((resolve, reject) => {
      window.hive_keychain.requestBroadcast(
        'alice', [op], 'Active',
        (res) => res.success
          ? resolve({ txId: res.result.id })
          : reject(new Error(res.message))
      );
    });
  }
});

await client.sell('alice', { /* ... */ }); // routed through onBroadcast`;

const WEB_COMPONENT_SNIPPET = `<script type="module">
  import '@vsc.eco/market-widget/webcomponent';
</script>

<magi-market-panel id="m" username="alice"></magi-market-panel>

<script>
  const el = document.getElementById('m');
  // Object props MUST be set as JS properties, not HTML attributes:
  el.aioha = yourAiohaInstance;
  el.keyType = KeyTypes.Active;
  el.config = TESTNET_CONFIG;
  el.onSuccess = (txId) => console.log(txId);
</script>`;

const THEMING_SNIPPET = `// The widget ships with Altera dark out of the box — no extra import needed.
// Opt into light by importing the bundled stylesheet and adding
// magi-market-light-host on the panel (or any ancestor):
import '@vsc.eco/market-widget/themes/light.css';
<MagiMarketPanel className="magi-market-light-host" ... />

// Or override variables yourself — works for both themes:
.my-host .magi-market {
  --magi-card-bg: #fafafa;
  --magi-accent: #ff5e3a;
  --magi-text: #1a1a1a;
}`;

const FAILOVER_SNIPPET = `import { createMarketClient } from '@vsc.eco/market-sdk';

const client = createMarketClient({
  config: {
    network: 'vsc-testnet',
    marketContractId: 'vsc1BnMAaeUzhzVcfKMDG5vphthhymk6irjLNq',
    // Ordered lists — the SDK tries each in turn and fails over on any
    // network / parse / GraphQL-errors[] response.
    indexerHasuraUrls: [
      'https://api-testnet.okinoko.io/hasura/v1/graphql',
      'https://indexer.testnet.magi.milohpr.com/v1/graphql'
    ],
    gqlUrls: ['https://magi-test.techcoderx.com/api/v1/graphql']
  },
  fetchOptions: {
    timeoutMs: 5000,
    onAttempt: (url, i) => console.debug(\`[gql] try #\${i}: \${url}\`),
    onError:   (url, i, err) => console.warn(\`[gql] \${url} failed: \${err.message}\`)
  }
});`;

createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>
);
