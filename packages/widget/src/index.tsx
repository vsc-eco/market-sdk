import './styles.css';
import magiSvg from './assets/magi.svg';

export { MagiMarketPanel, type MagiMarketPanelProps } from './MarketPanel.js';
/**
 * Inlined Magi logo as a data URL — the same fallback image the panel
 * uses. Re-exported so headless integrators rendering their own rows can
 * match the look without pulling the file from the magi.eco origin.
 */
export const magiFallbackImage: string = magiSvg;
export { MarketActionButton, type MarketActionButtonProps } from './MarketActionButton.js';
export { ListForm, type ListFormProps } from './actions/ListForm.js';
export { BuyForm, type BuyFormProps } from './actions/BuyForm.js';
export { MakeOfferForm, type MakeOfferFormProps } from './actions/MakeOfferForm.js';
export { CreateAuctionForm, type CreateAuctionFormProps } from './actions/CreateAuctionForm.js';
export { ListMintSpotsForm, type ListMintSpotsFormProps } from './actions/ListMintSpotsForm.js';
