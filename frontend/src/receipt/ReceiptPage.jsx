// receipt/ReceiptPage.jsx
//
// /receipt/<content_hash>: one Tnega Receipt, as the card designed for it
// ("Buy first. Keep the proof."), with the opt-in signature and the
// verifier from the Solana Fall School architecture (flow 2, page 4).
//
//   1. The record: /receipts/<content_hash>.json, hashed here; it must hash
//      to the address it is served at.
//   2. Not written yet: the buyer may sign receiptMessage(content_hash) with
//      their own wallet. That is a message, not a transaction: it moves
//      nothing and costs nothing. Not signing writes nothing.
//   3. Written: the receipt is read from Solana devnet at
//      ["receipt", content_hash] and checked field by field against the
//      record, its issuing transaction is read for the Ed25519 instruction
//      that verified the buyer's signature, and the purchase is read on
//      Solana mainnet. Every check runs in this browser, against public
//      endpoints, not against Tnega's server.
//
// Lazy-loaded (App.jsx), so @solana/web3.js and the wallet adapter load only
// on this page.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { Check, Copy, ExternalLink, Loader2, X, Minus } from 'lucide-react';
import SolanaConnectModal from '../sign/SolanaConnectModal';
import { solanaErrorText } from '../sign/solanaStatus';
import { setNoIndex, updatePageMeta } from '../seoMeta';
import {
  RECEIPT_PROGRAM, DEVNET_RPC, MAINNET_RPC, ED25519_PROGRAM, SOLANA_CHAIN_ID,
  receiptMessage, hexOf, bytesOfHex, sameBytes, sha256, base58Encode, receiptPda, configPda,
  accountDiscriminator, decodeReceipt, decodeConfig, parseEd25519, buyerBytes, txHashBytes,
  expectedFields, balanceChange, sameReading, pct, usd, utcTime, explorerDevnet,
} from './receiptChain';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const short = (s, a = 6, b = 4) => (s && s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);
const fmtInt = (n) => (n == null ? '' : Number(n).toLocaleString('en-US'));

export default function ReceiptPage({ hash, onBack }) {
  return (
    <ConnectionProvider endpoint={MAINNET_RPC}>
      <WalletProvider wallets={[]} autoConnect={false} localStorageKey="tnega-receipt-wallet">
        <Receipt hash={hash} onBack={onBack} />
      </WalletProvider>
    </ConnectionProvider>
  );
}

function Receipt({ hash, onBack }) {
  useEffect(() => setNoIndex(true), []);
  useEffect(() => {
    updatePageMeta({ title: 'Receipt', description: 'A Tnega Receipt on Solana devnet: the prices Tnega read when the buyer signed, re-checked in this browser.', path: '/receipt' });
  }, []);

  // 1. The record, hashed here.
  const [file, setFile] = useState({ status: 'loading' });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch(`/receipts/${hash}.json`, { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status === 404 ? 'no record is published at this address' : `HTTP ${r.status}`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        const digest = hexOf(await sha256(bytes));
        const data = JSON.parse(new TextDecoder().decode(bytes));
        if (live) setFile({ status: 'ok', data, digest, hashOk: digest === hash });
      } catch (e) {
        if (live) setFile({ status: 'error', error: e?.message || 'the record could not be read' });
      }
    })();
    return () => { live = false; };
  }, [hash]);

  // 2. The chain: the receipt on devnet, its issuing transaction, the purchase on mainnet.
  const [chain, setChain] = useState({ status: 'idle' });
  const [tick, setTick] = useState(0);
  const expected = useMemo(() => (file.status === 'ok' ? expectedFields(file.data) : null), [file]);
  useEffect(() => {
    if (file.status !== 'ok') return undefined;
    let live = true;
    setChain((c) => ({ ...c, status: c.status === 'idle' ? 'loading' : c.status }));
    (async () => {
      const out = { status: 'ok' };
      try {
        const devnet = new Connection(DEVNET_RPC, 'confirmed');
        const hashBytes = bytesOfHex(hash);
        const pda = receiptPda(hashBytes);
        out.pda = pda.toBase58();
        const [info, cfgInfo] = await devnet.getMultipleAccountsInfo([pda, configPda()]);
        if (cfgInfo) out.config = decodeConfig(cfgInfo.data);
        if (info) {
          const disc = await accountDiscriminator('Receipt');
          out.owned = info.owner.equals(new PublicKey(RECEIPT_PROGRAM)) && sameBytes(new Uint8Array(info.data).subarray(0, 8), disc);
          out.receipt = decodeReceipt(new Uint8Array(info.data));
          const sigs = await devnet.getSignaturesForAddress(pda, { limit: 25 });
          const first = sigs[sigs.length - 1];
          if (first) {
            out.issueSig = first.signature;
            const t = await devnet.getTransaction(first.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
            if (t) {
              const msg = t.transaction.message;
              const keys = msg.staticAccountKeys.map((k) => k.toBase58());
              const ixs = msg.compiledInstructions.map((ix) => ({ program: keys[ix.programIdIndex], data: ix.data }));
              out.issueOk = !t.meta?.err && ixs.some((ix) => ix.program === RECEIPT_PROGRAM);
              out.signedBy = keys[0];
              out.ed25519 = ixs.filter((ix) => ix.program === ED25519_PROGRAM).flatMap((ix) => parseEd25519(ix.data));
              out.issuedAtSlot = t.slot;
            }
          }
        }
        // The purchase, on its own chain.
        if (expected?.chain === 'solana' && expected.tx) {
          const main = new Connection(MAINNET_RPC, 'confirmed');
          const p = await main.getTransaction(expected.tx, { maxSupportedTransactionVersion: 0, commitment: 'finalized' });
          if (p) {
            const v = file.data.record?.value || file.data.record || {};
            out.purchase = {
              found: true,
              ok: !p.meta?.err,
              payer: p.transaction.message.staticAccountKeys[0].toBase58(),
              paid: -balanceChange(p.meta, expected.buyer, v.order?.pay_mint || USDC_MINT),
              received: balanceChange(p.meta, expected.buyer, v.order?.mint),
              slot: p.slot,
              blockTime: p.blockTime,
            };
          } else out.purchase = { found: false };
        }
        out.txHash = expected?.tx ? await txHashBytes(expected.tx) : null;
      } catch (e) {
        out.status = 'error';
        out.error = e?.message || 'a read failed';
      }
      if (live) setChain(out);
    })();
    return () => { live = false; };
  }, [file, hash, expected, tick]);

  const issued = chain.status === 'ok' && !!chain.receipt;

  // 3. The buyer's opt-in signature.
  const { wallets, wallet, publicKey, connected, select, connect, signMessage } = useWallet();
  const address = connected && publicKey ? publicKey.toBase58() : null;
  const isBuyer = !!address && !!expected && address === expected.buyer;
  const [picker, setPicker] = useState(false);
  const [pick, setPick] = useState(null);
  const [sign, setSign] = useState({ status: 'idle' });
  const connectingRef = useRef(false);
  useEffect(() => {
    if (!pick || wallet?.adapter.name !== pick || connected || connectingRef.current) return;
    connectingRef.current = true;
    setPick(null);
    connect()
      .then(() => setPicker(false))
      .catch((e) => setSign({ status: 'error', error: solanaErrorText(e) }))
      .finally(() => { connectingRef.current = false; });
  }, [pick, wallet, connected, connect]);
  useEffect(() => { if (connected) setPicker(false); }, [connected]);

  const doSign = useCallback(async () => {
    if (!connected) { setPicker(true); return; }
    if (!isBuyer) return;
    if (!signMessage) { setSign({ status: 'error', error: 'This wallet cannot sign a message. Try another Solana wallet.' }); return; }
    setSign({ status: 'signing' });
    try {
      const sig = await signMessage(new TextEncoder().encode(receiptMessage(hash)));
      setSign({ status: 'signed', signature: base58Encode(sig) });
    } catch (e) {
      setSign({ status: 'error', error: solanaErrorText(e) });
    }
  }, [connected, isBuyer, signMessage, hash]);

  // While a signature waits for the attestor, look for the receipt every 8 s.
  useEffect(() => {
    if (sign.status !== 'signed' || issued) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 8000);
    return () => clearInterval(t);
  }, [sign.status, issued]);

  const checks = useMemo(() => buildChecks({ hash, file, chain, expected }), [hash, file, chain, expected]);

  const v = file.status === 'ok' ? (file.data.record?.value || file.data.record || {}) : null;

  return (
    <div className="min-h-screen text-[#14172b]" style={{ background: 'radial-gradient(ellipse at 15% 25%, #1b3fb0 0, transparent 55%), radial-gradient(ellipse at 90% 75%, #6a3fb0 0, transparent 50%), #070b2a' }}>
      <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-6 sm:py-10">
        <header className="flex items-center justify-between">
          <button type="button" onClick={onBack} className="flex items-center gap-3 text-white text-[22px] font-medium">
            <img src="/fendi-head-512.png" alt="" className="w-10 h-10" />Tnega
          </button>
          <span className="text-[12px] text-[#9aa3d6]">Solana devnet · program {short(RECEIPT_PROGRAM)}</span>
        </header>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_640px] items-start">
          <section className="text-white lg:pt-16">
            <h1 className="text-[44px] sm:text-[72px] font-bold leading-[1.05] tracking-[-0.02em]">
              Buy first.<br />
              <span style={{ background: 'linear-gradient(90deg,#f5c24a,#f0a070)', WebkitBackgroundClip: 'text', color: 'transparent' }}>Keep the<br />proof.</span>
            </h1>
            <p className="mt-6 max-w-[520px] text-[18px] sm:text-[22px] leading-snug text-[#cdd3f0]">
              An optional receipt of what Tnega measured, written to Solana. Skip it and nothing is written.
            </p>
          </section>

          <section className="rounded-[28px] bg-[#eef0f8] p-6 sm:p-9 shadow-[0_30px_80px_#0008]">
            <div className="flex items-center gap-3 font-semibold text-[20px]"><img src="/fendi-head-512.png" alt="" className="w-9 h-9" />Tnega</div>
            {file.status === 'loading' && <p className="mt-6 flex items-center gap-2 text-[15px] text-[#5a6080]"><Loader2 size={16} className="animate-spin" />Reading the record</p>}
            {file.status === 'error' && <p className="mt-6 text-[15px] text-[#b42318]">This receipt cannot be shown: {file.error}.</p>}
            {file.status === 'ok' && v && (
              <>
                <h2 className="mt-4 text-[30px] sm:text-[38px] font-bold tracking-[-0.02em] leading-tight">
                  Receipt: {usd(Number(v.order?.amount))} of {v.chosen?.ticker || v.chosen?.symbol}
                </h2>
                <p className="mt-2 text-[16px] sm:text-[18px] leading-snug text-[#5a6080]">
                  {v.chosen?.symbol} from {v.chosen?.issuer} on {v.chosen?.chain}. Prices Tnega read when you signed. Your wallet signs this receipt; Tnega never holds funds or keys.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-[12px] border border-[#dde0ee] bg-white px-3 py-1 text-[15px]">Optional · Solana devnet</span>
                  {issued && chain.receipt.active && <span className="rounded-[12px] bg-[#e7f6ec] text-[#1d6b3a] px-3 py-1 text-[15px] font-medium">Written to devnet</span>}
                  {issued && !chain.receipt.active && <span className="rounded-[12px] bg-[#fdecea] text-[#b42318] px-3 py-1 text-[15px] font-medium">Revoked</span>}
                </div>

                <Prices v={v} />

                <div className="mt-5">
                  {issued ? (
                    <Written chain={chain} />
                  ) : (
                    <SignArea
                      sign={sign} connected={connected} address={address} isBuyer={isBuyer} buyer={expected?.buyer}
                      onSign={doSign} hash={hash}
                    />
                  )}
                </div>
              </>
            )}
          </section>
        </div>

        {file.status === 'ok' && (
          <section className="mt-10 rounded-[20px] bg-white/[0.06] border border-white/10 p-5 sm:p-8 text-white">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[20px] font-semibold">Check it yourself</h3>
              <button type="button" className="text-[13px] text-[#9aa3d6] underline" onClick={() => setTick((n) => n + 1)}>Read the chain again</button>
            </div>
            <p className="mt-1 text-[14px] text-[#cdd3f0]">Each check runs in this browser against public Solana endpoints, not against Tnega&apos;s server.</p>
            <ul className="mt-4 space-y-3">
              {checks.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <StatusIcon state={c.state} />
                  <div>
                    <div className="text-[15px]">{c.label}</div>
                    {c.detail && <div className="text-[13px] text-[#9aa3d6] break-all">{c.detail}</div>}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[13px] text-[#9aa3d6]">
              The other chains&apos; prices are Tnega&apos;s readings. An EVM reading can be replayed at its stated block with an archive node; a Solana reading is a Jupiter quote, a record of what Tnega read. A receipt says Tnega&apos;s attestor and the buyer signed this record; the purchase itself is checked above, on its own chain.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
              <a className="underline text-[#cdd3f0]" href={`/receipts/${hash}.json`} target="_blank" rel="noreferrer">The record (JSON)</a>
              {chain.pda && <a className="underline text-[#cdd3f0]" href={explorerDevnet('address', chain.pda)} target="_blank" rel="noreferrer">Receipt account</a>}
              <a className="underline text-[#cdd3f0]" href={explorerDevnet('address', RECEIPT_PROGRAM)} target="_blank" rel="noreferrer">Program</a>
            </div>
          </section>
        )}
      </div>

      {picker && (
        <SolanaConnectModal
          wallets={wallets}
          orderWallet={expected?.buyer}
          error={sign.status === 'error' ? sign.error : null}
          onClose={() => setPicker(false)}
          onPick={(n) => { setSign({ status: 'idle' }); select(n); setPick(n); }}
        />
      )}
    </div>
  );
}

function Prices({ v }) {
  const e = v.execution || {};
  const readings = Array.isArray(v.readings) ? v.readings : [];
  return (
    <div className="mt-5 rounded-[20px] bg-white px-5 sm:px-7 py-4">
      <h3 className="text-[20px] font-semibold pb-2 border-b border-[#e6e8f2]">The prices</h3>
      <Row
        label={`Paid on ${v.chosen?.chain || ''}`}
        value={<strong>{pct(e.executed_cost_bps)}</strong>}
        small={`${utcTime(e.block_time) || ''} · quoted ${pct(Math.round(Number(v.measured?.price_impact_bps)))} · Jupiter route${v.measured?.route ? ` (${v.measured.route.join(', ')})` : ''} · ${usd(e.price_paid_per_token_usd)} per token`}
      />
      {readings.map((r) => (
        <Row
          key={r.key}
          label={`${r.chain}`}
          sub={`${r.symbol} · ${r.issuer}`}
          value={r.state === 'filled' ? pct(r.cost_bps) : <span className="text-[#8a90ab]">Too thin for {usd(r.size_usd, 0)}</span>}
          small={[
            r.allin_per_share_usd != null ? `${usd(r.allin_per_share_usd)} per share` : null,
            utcTime(r.as_of),
            r.block != null ? `pool, block ${fmtInt(r.block)}` : r.slot != null ? `Jupiter quote, slot ${fmtInt(r.slot)}` : r.source,
          ].filter(Boolean).join(' · ')}
        />
      ))}
      <p className="pt-2 text-[12px] text-[#8a90ab]">Other versions: Tnega&apos;s latest measurement of a {usd(readings[0]?.size_usd || 1000, 0)} buy when you signed, each with its own time and source.</p>
    </div>
  );
}

function Row({ label, sub, value, small }) {
  return (
    <div className="flex gap-4 py-2.5 border-b border-[#eceef6] last-of-type:border-0 text-[16px] sm:text-[17px] leading-snug">
      <div className="w-[130px] sm:w-[160px] flex-none text-[#6a7090]">
        {label}
        {sub && <span className="block text-[12px] text-[#8a90ab]">{sub}</span>}
      </div>
      <div className="flex-1 min-w-0">
        {value}
        {small && <span className="block text-[13px] text-[#8a90ab]">{small}</span>}
      </div>
    </div>
  );
}

function SignArea({ sign, connected, address, isBuyer, buyer, onSign, hash }) {
  const [copied, setCopied] = useState(null);
  const copy = (text, what) => { navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(null), 1500); }).catch(() => {}); };
  if (sign.status === 'signed') {
    const cmd = `cd ~/Documents/DDIB2026/Solana/tnega-receipt && curl -sfO https://www.tnega.app/receipts/${hash}.json && node scripts/receipt-devnet.mjs issue --receipt ${hash}.json --buyer-sig ${sign.signature}`;
    return (
      <div className="rounded-[18px] bg-white p-4 text-[15px]">
        <div className="flex items-center gap-2 font-semibold text-[#1d6b3a]"><Check size={18} />Signed by your wallet</div>
        <p className="mt-1 text-[#5a6080]">Your signature covers this record&apos;s hash and nothing else. Tnega&apos;s attestor now writes the receipt to devnet with your signature verified in the same transaction. This page updates when it appears.</p>
        <div className="mt-3 text-[12px] text-[#8a90ab]">Your signature</div>
        <div className="flex items-start gap-2">
          <code className="flex-1 break-all text-[12px] bg-[#f4f5fa] rounded p-2">{sign.signature}</code>
          <button type="button" className="h-8 px-2 rounded border border-[#dde0ee] text-[12px] flex items-center gap-1" onClick={() => copy(sign.signature, 'sig')}><Copy size={13} />{copied === 'sig' ? 'Copied' : 'Copy'}</button>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] text-[#5a6080]">On this devnet demo the attestor is a script: the command it runs</summary>
          <div className="mt-2 flex items-start gap-2">
            <code className="flex-1 break-all text-[11px] bg-[#f4f5fa] rounded p-2">{cmd}</code>
            <button type="button" className="h-8 px-2 rounded border border-[#dde0ee] text-[12px] flex items-center gap-1" onClick={() => copy(cmd, 'cmd')}><Copy size={13} />{copied === 'cmd' ? 'Copied' : 'Copy'}</button>
          </div>
        </details>
      </div>
    );
  }
  const wrong = connected && !isBuyer;
  return (
    <>
      <button
        type="button"
        onClick={onSign}
        disabled={sign.status === 'signing' || wrong}
        className="w-full rounded-[16px] bg-[#12162e] text-white py-4 text-[20px] font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {sign.status === 'signing' && <Loader2 size={18} className="animate-spin" />}
        {connected ? 'Sign receipt in your wallet' : 'Connect your wallet to sign'}
      </button>
      {wrong && <p className="mt-2 text-[14px] text-[#b42318]">Connected {short(address)}. Only the buyer, {short(buyer)}, can sign this receipt.</p>}
      {sign.status === 'error' && <p className="mt-2 text-[14px] text-[#b42318]">{sign.error}</p>}
      <p className="mt-3 text-center text-[15px] text-[#6a7090]">Not signing? Nothing is written. Signing is a message, not a transaction: it moves nothing and costs nothing.</p>
    </>
  );
}

function Written({ chain }) {
  const r = chain.receipt;
  return (
    <div className="rounded-[18px] bg-white p-4 text-[15px]">
      <div className={`flex items-center gap-2 font-semibold ${r.active ? 'text-[#1d6b3a]' : 'text-[#b42318]'}`}>
        {r.active ? <Check size={18} /> : <X size={18} />}
        {r.active ? 'On Solana devnet, signed by you and by Tnega' : 'This receipt was revoked'}
      </div>
      <p className="mt-1 text-[#5a6080]">Issued {new Date(r.issuedAt * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC at {short(chain.pda, 8, 6)}.</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
        <a className="underline flex items-center gap-1" href={explorerDevnet('address', chain.pda)} target="_blank" rel="noreferrer">Receipt <ExternalLink size={12} /></a>
        {chain.issueSig && <a className="underline flex items-center gap-1" href={explorerDevnet('tx', chain.issueSig)} target="_blank" rel="noreferrer">Issuing transaction <ExternalLink size={12} /></a>}
      </div>
    </div>
  );
}

function StatusIcon({ state }) {
  if (state === 'ok') return <span className="mt-0.5 flex-none w-5 h-5 rounded-full bg-[#2ea463] flex items-center justify-center"><Check size={13} className="text-white" /></span>;
  if (state === 'fail') return <span className="mt-0.5 flex-none w-5 h-5 rounded-full bg-[#d64545] flex items-center justify-center"><X size={13} className="text-white" /></span>;
  if (state === 'pending') return <span className="mt-0.5 flex-none w-5 h-5 rounded-full border border-white/30 flex items-center justify-center"><Loader2 size={12} className="animate-spin text-white/70" /></span>;
  return <span className="mt-0.5 flex-none w-5 h-5 rounded-full border border-white/30 flex items-center justify-center"><Minus size={12} className="text-white/60" /></span>;
}

/** The verifier's checks (architecture page 4), each ok / fail / pending /
 *  waiting (nothing to check yet). */
export function buildChecks({ hash, file, chain, expected }) {
  const list = [];
  const loading = chain.status === 'loading' || chain.status === 'idle';
  if (file.status !== 'ok') return list;
  list.push({
    id: 'hash',
    label: 'The record hashes to this receipt’s content hash',
    state: file.hashOk ? 'ok' : 'fail',
    detail: file.hashOk ? `SHA-256 ${hash}` : `the published record hashes to ${file.digest}`,
  });
  if (chain.status === 'error') {
    list.push({ id: 'read', label: 'Read Solana', state: 'fail', detail: chain.error });
    return list;
  }
  const r = chain.receipt;
  list.push({
    id: 'pda',
    label: 'A receipt exists at ["receipt", content_hash] on devnet, owned by the program',
    state: loading ? 'pending' : r ? (chain.owned ? 'ok' : 'fail') : 'waiting',
    detail: chain.pda ? (r ? chain.pda : `${chain.pda}: not written yet (the buyer has not signed, or the attestor has not issued it)`) : null,
  });
  if (!r || !expected) return list;
  const buyer = buyerBytes(expected.buyer || '');
  const fieldsOk = sameBytes(r.contentHash, bytesOfHex(hash))
    && r.chainId === (expected.chain === 'solana' ? SOLANA_CHAIN_ID : BigInt(expected.chain || 0))
    && sameBytes(r.txHash, chain.txHash)
    && sameBytes(r.buyer, buyer)
    && r.quotedBps === expected.quotedBps
    && r.executedBps === expected.executedBps
    && r.notionalCents === expected.notionalCents;
  list.push({
    id: 'fields',
    label: 'Its fields match the record: buyer, purchase transaction, amount, the two costs and when the trade happened',
    state: fieldsOk && r.version === 2 && r.executedAt === expected.executedAt ? 'ok' : 'fail',
    detail: `${short(expected.buyer)} · ${usd(Number(r.notionalCents) / 100)} · quoted ${pct(r.quotedBps)} · paid ${pct(r.executedBps)}${r.executedAt ? ` · traded ${new Date(r.executedAt * 1000).toISOString().slice(0, 19).replace('T', ' ')} UTC` : ''} · version ${r.version}`,
  });
  const readingsOk = r.readings.length === expected.readings.length
    && expected.readings.every((e, i) => sameReading(e, r.readings[i]));
  list.push({
    id: 'readings',
    label: 'The prices from the other chains are stored on the receipt, each with its time, block or slot and source, as in the record',
    state: readingsOk ? 'ok' : 'fail',
    detail: `${r.readings.length} readings on chain`,
  });
  list.push({
    id: 'attestor',
    label: 'Issued by the attestor named in the program’s config',
    state: chain.config && r.issuer === chain.config.attestor && chain.issueOk ? 'ok' : 'fail',
    detail: `issuer ${short(r.issuer)}${chain.config ? `, config attestor ${short(chain.config.attestor)}` : ''}`,
  });
  const message = new TextEncoder().encode(receiptMessage(hash));
  const sigOk = (chain.ed25519 || []).some((s) => s.self && sameBytes(s.publicKey, buyer) && sameBytes(s.message, message));
  list.push({
    id: 'buyer',
    label: 'The buyer’s signature over this content hash, verified by Solana’s Ed25519 program right before issue_receipt; the program refuses to write a receipt without it',
    state: sigOk && chain.issueOk ? 'ok' : 'fail',
    detail: chain.issueSig ? `transaction ${short(chain.issueSig, 10, 8)}` : 'the issuing transaction was not found',
  });
  if (expected.chain === 'solana') {
    const p = chain.purchase;
    const rec = file.data.record?.value || file.data.record || {};
    const paidRaw = BigInt(rec.execution?.paid_raw || '0');
    const recvRaw = BigInt(rec.execution?.received_raw || '0');
    const ok = p?.found && p.ok && p.payer === expected.buyer && p.paid === paidRaw && p.received === recvRaw;
    list.push({
      id: 'purchase',
      label: 'The purchase succeeded on Solana mainnet, paid by the buyer, with the amounts in the record',
      state: !p ? 'pending' : ok ? 'ok' : 'fail',
      detail: p?.found ? `slot ${fmtInt(p.slot)} · ${Number(p.paid) / 1e6} USDC out · ${Number(p.received) / 10 ** (rec.chosen?.decimals ?? 8)} ${rec.chosen?.symbol || ''} in` : p ? 'not found on mainnet' : null,
    });
  }
  list.push({ id: 'active', label: 'Not revoked', state: r.active ? 'ok' : 'fail' });
  return list;
}
