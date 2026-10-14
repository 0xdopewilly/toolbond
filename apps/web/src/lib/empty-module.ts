// Stand-in for optional packages that wallet SDKs import but ToolBond never calls
// (Coinbase CDP's x402 payment helpers). See next.config.ts.
const unavailable = () => {
  throw new Error("This optional wallet feature is not part of ToolBond.");
};

export default unavailable;
export const toClientEvmSigner = unavailable;
export const registerExactEvmScheme = unavailable;
export const registerUptoEvmScheme = unavailable;
export const x402Client = unavailable;
