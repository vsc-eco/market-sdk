import r2wc from '@r2wc/react-to-web-component';
import { MagiMarketPanel, type MagiMarketPanelProps } from './MarketPanel.js';
import './styles.css';

/**
 * Register `<magi-market-panel>` so non-React hosts (vanilla JS, Vue,
 * Svelte, server-rendered pages) can embed the marketplace with one tag.
 *
 * Object-valued props (aioha, config, client, onSuccess) MUST be set as JS
 * properties on the element, not HTML attributes. Strings/booleans pass
 * through attributes fine. Mirrors @vsc.eco/token-widget's webcomponent.
 */
const MarketPanelElement = r2wc(
	MagiMarketPanel as unknown as (p: MagiMarketPanelProps) => JSX.Element,
	{
		props: {
			username: 'string',
			viewAccount: 'string',
			className: 'string',
			hideHeader: 'boolean',
			bare: 'boolean',
			aioha: 'json',
			onBroadcast: 'function',
			keyType: 'json',
			config: 'json',
			client: 'json',
			onSuccess: 'function'
		}
	}
);

if (typeof window !== 'undefined' && typeof customElements !== 'undefined') {
	if (!customElements.get('magi-market-panel')) {
		customElements.define('magi-market-panel', MarketPanelElement);
	}
}

export { MarketPanelElement as MagiMarketPanelElement };
