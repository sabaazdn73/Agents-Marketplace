// EvmHoldings.jsx
//
// Native coin and a named list of stablecoins on BNB Chain, Arbitrum and
// Robinhood Chain, read in the browser (useEvmHoldings.js). The card says
// which tokens it covers and that others are not read. Quantities only, except
// BNB, which is priced with the on-chain BNB/USD average the backend reads
// (useBnbPrice.js), with its label, window and block beside it, and only when
// the answer carries that label (labelledBnbUsd). Nothing else
// is priced: a stablecoin's dollar value is a claim about its peg, and there
// is no price source here for ETH.

import React from 'react';
import { formatUnits } from 'viem';
import { RefreshCw } from 'lucide-react';
import { useBnbQuote, labelledBnbUsd } from '../useBnbPrice';
import { BnbPriceSource } from '../shell/DataAttribution';
import { EVM_CHAINS, coverageList } from './evmTokens';
import { rpcProviderName } from './SignInProvider';
import { Basis, fmtAmount, fmtUsd, fmtCount } from './format';

function amount(raw, decimals) {
  if (raw == null) return null;
  return Number(formatUnits(raw, decimals));
}

function Row({ symbol, name, value, usd, credit }) {
  return (
    <li className="flex items-start justify-between gap-3 py-1.5 border-b border-line last:border-b-0">
      <span className="min-w-0">
        <span className="text-body text-fg">{symbol}</span>
        {name && <span className="text-label text-muted"> {name}</span>}
      </span>
      <span className="text-right">
        <span className="figure text-body text-fg block">{value}</span>
        {usd && <span className="figure text-label text-muted block">{usd}</span>}
        {credit}
      </span>
    </li>
  );
}

export default function EvmHoldings({ holdings }) {
  const bnbQuote = useBnbQuote();
  // Dollars only for the labelled on-chain average; otherwise BNB alone.
  const bnbUsd = labelledBnbUsd(bnbQuote);
  const { byChain, readAt, refresh } = holdings;
  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-title font-bold">On other chains</h2>
        <button type="button" onClick={refresh} className="h-8 px-2.5 rounded-md border border-line-strong text-label text-fg hover:bg-inset inline-flex items-center gap-1.5">
          <RefreshCw size={13} aria-hidden="true" /> Read again
        </button>
      </div>
      <p className="text-label text-muted mt-0.5 mb-3">
        A short named list, not everything the address holds: on each chain, the native coin and the
        tokens listed below it. Any other token is not read and is not shown. Read in your browser from
        each chain&apos;s public RPC provider{readAt ? `, ${readAt.toLocaleTimeString()}` : ''}.
      </p>
      <div className="space-y-4">
        {EVM_CHAINS.map((chain) => {
          const s = byChain[chain.chainId] || { status: 'loading' };
          return (
            <div key={chain.chainId}>
              <p className="text-label font-semibold text-fg">{chain.name}</p>
              <p className="text-label text-muted mb-1">Covers {coverageList(chain)} only.</p>
              {s.status === 'loading' && <p className="text-label text-muted">Reading…</p>}
              {s.status === 'error' && (
                <p className="text-label text-muted">
                  The chain&apos;s RPC provider ({rpcProviderName(chain.chainId)}) did not answer, so nothing on {chain.name} was read. That is about the call, not the address.
                </p>
              )}
              {s.status === 'ok' && (
                <>
                  <ul>
                    {(() => {
                      const n = amount(s.native.raw, s.native.decimals);
                      const isBnb = chain.native.symbol === 'BNB';
                      const usd = isBnb && bnbUsd != null && n != null ? `≈ ${fmtUsd(n * bnbUsd)}` : null;
                      return (
                        <Row
                          symbol={chain.native.symbol}
                          name="native"
                          value={fmtAmount(n)}
                          usd={usd}
                          credit={usd ? <BnbPriceSource quote={bnbQuote} className="block" /> : null}
                        />
                      );
                    })()}
                    {s.tokens.map((t) => (
                      <Row
                        key={t.address}
                        symbol={t.symbol}
                        name={t.name}
                        value={t.ok ? fmtAmount(amount(t.raw, t.decimals)) : 'not read: the balance call failed'}
                      />
                    ))}
                  </ul>
                  <Basis>
                    At block {fmtCount(Number(s.blockNumber))}.
                    {chain.native.symbol === 'BNB'
                      ? (bnbUsd != null ? ' BNB is priced with the on-chain BNB/USD average shown beside it, in USDT taken at one dollar; the stablecoins are quantities, not priced.' : ' The on-chain BNB/USD average was not available, so BNB is shown as a quantity and nothing here is priced.')
                      : ' Quantities only; nothing on this chain is priced here.'}
                  </Basis>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
