// BehaviourStudy.jsx
//
// A proof of concept for measuring on-chain behaviour, applied to one
// arbitrage bot on Solana.
//
// WHY THIS SAYS BOT AND NEVER AGENT
// The subject runs a fixed rule and submits transactions. It takes no
// instructions, does not adapt, and decides nothing. Calling it an agent
// would be wrong on the plain meaning of the word, and anyone who knows the
// difference would discount every number on the page for it. Everywhere the
// copy below says bot, that is deliberate and should stay.
//
// What the page is actually demonstrating is the method: that a wallet's
// behaviour can be characterised from public transaction data alone, without
// the operator's cooperation, and that the interesting findings are the ones
// the operator would not publish. The Solana subject is the worked example
// because Dune carries a complete Solana transaction table; see the EVM
// section of the same work for what is and is not available on BNB Chain.
//
// Every figure here was measured, not estimated. The source and the queries
// that produced it are stated at the foot of the page. Query costs are
// deliberately not published: they are an operational detail of our own
// account, not a property of the subject, and they invite a reader to weigh
// the findings by what they cost to obtain. The limitations section is not
// decoration: it is the part that makes the rest usable by someone else.

import React from 'react';
import {
  Activity, AlertTriangle, Clock, Coins, Layers, Scale, FlaskConical, Ban,
} from 'lucide-react';

const ACCENT = '#4F46E5';
const ADDRESS = 'MriyaNN8TMp6qRWjfr723PK7xgQK7yCt7Kg2v2PQu7X';

function Card({ icon: Icon, title, tag, tagColor = '#64748B', children }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-[#1E293B]">
      <div className="px-6 py-4 bg-gray-50/50 dark:bg-gray-800/30 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Icon size={16} style={{ color: ACCENT }} className="shrink-0" />
          <h3 className="font-bold text-sm truncate">{title}</h3>
        </div>
        {tag && (
          <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full shrink-0"
                style={{ background: `${tagColor}22`, color: tagColor }}>{tag}</span>
        )}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

/** A table that scrolls inside itself so the page never scrolls sideways. */
function Table({ head, rows, foot }) {
  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-left">
            {head.map((h, i) => (
              <th key={i} className={`pb-2 text-[10px] uppercase tracking-wide text-gray-400 font-semibold whitespace-nowrap ${i ? 'text-right pl-4' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
              {r.map((c, j) => (
                <td key={j} className={`py-1.5 whitespace-nowrap ${j ? 'text-right pl-4 font-mono' : 'text-gray-600 dark:text-gray-300'}`}>{c}</td>
              ))}
            </tr>
          ))}
          {foot && (
            <tr className="border-t-2 border-gray-200 dark:border-gray-700 font-semibold">
              {foot.map((c, j) => (
                <td key={j} className={`py-2 whitespace-nowrap ${j ? 'text-right pl-4 font-mono' : ''}`}>{c}</td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** A labelled proportion bar. Widths are the real percentages. */
function Bar({ label, pct, value, tone = ACCENT, scale = 1 }) {
  return (
    <div className="flex items-center gap-3 text-[11px]">
      <span className="w-28 shrink-0 text-gray-500 text-right">{label}</span>
      <span className="flex-1 h-3.5 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <span className="block h-full rounded" style={{ width: `${Math.min(100, pct * scale)}%`, background: tone }} />
      </span>
      <span className="w-20 shrink-0 font-mono text-gray-500">{value}</span>
    </div>
  );
}

const Note = ({ children }) => (
  <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mt-3">{children}</p>
);

export default function BehaviourStudy() {
  return (
    <div className="space-y-6">

      <div className="p-4 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/60 dark:bg-indigo-500/5 text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">
        A proof of concept for measuring on-chain behaviour, applied to an arbitrage bot on Solana.
        The subject runs a fixed rule and submits transactions. It takes no instructions, does not
        adapt and decides nothing, so it is a bot and not an agent. Everything below was measured
        from public transaction data with no cooperation from the operator.
      </div>

      <Card icon={FlaskConical} title="Subject and method" tag="Solana" tagColor="#14B8A6">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="text-gray-500">Address</span>
            <code className="font-mono text-[11px] break-all bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800 px-1.5 py-0.5 rounded">{ADDRESS}</code>
          </div>
        </div>
        <div className="mt-4">
          <Table
            head={['What was established', 'Result']}
            rows={[
              ['Role on chain', 'signer, not a program'],
              ['Total history', '8 days, first transaction 4 Sept 2026'],
              ['Days with any activity', '4 of 8'],
              ['Transactions in the live window', '35,344'],
              ['Distinct venues traded', '20'],
              ['Distinct pairs traded', '1,294'],
            ]}
          />
        </div>
        <Note>
          It appears as trader on 18,955 decoded swaps and as signer on 36,547 transactions in a
          30 day query window, and as a program on none. A 30 day window was queried and returned
          nothing before 4 September, so the eight day history is the whole history and not a
          truncation.
        </Note>
      </Card>

      <Card icon={Activity} title="Success rate, the number an explorer does not show" tag="60.1% revert" tagColor="#EF4444">
        <Table
          head={['Date', 'Txs', 'Landed', 'Reverted', 'Success', 'Avg compute units', 'Fees SOL', 'Fees on failures']}
          rows={[
            ['4 Sept', '870', '870', '0', '100.0%', '3,280', '0.0046', '0'],
            ['5 to 8 Sept', 'no activity', '', '', '', '', '', ''],
            ['9 Sept', '415', '415', '0', '100.0%', '2,370', '0.0021', '0'],
            ['10 Sept', '7,577', '3,139', '4,438', '41.4%', '134,773', '16.69', '4.43'],
            ['11 Sept (partial)', '27,743', '10,966', '16,777', '39.5%', '127,058', '64.74', '17.14'],
          ]}
          foot={['Total', '36,605', '15,390', '21,215', '42.0%', '', '81.44', '21.56']}
        />
        <div className="mt-5 p-3 rounded-lg border border-amber-200 dark:border-amber-500/25 bg-amber-50/60 dark:bg-amber-500/5 text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
          4 and 9 September are not the same behaviour as 10 and 11 September. Average compute units
          are 2,370 to 3,280 on those days against 127,000 to 135,000 on the later pair, a factor of
          40, and neither early day has a single failure. Every rate quoted on this page is therefore
          taken over 10 and 11 September only. Including the quiet days would lift the success rate
          to 42.0% and describe something that is not arbitrage.
        </div>
        <div className="mt-5 flex h-8 rounded overflow-hidden text-[11px] font-mono">
          <div className="flex items-center px-3 text-white" style={{ width: '60.06%', background: '#EF4444' }}>60.1% reverted, 21,228</div>
          <div className="flex items-center justify-end px-3 text-white" style={{ width: '39.94%', background: '#10B981' }}>14,116 landed</div>
        </div>
        <div className="mt-5">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">What the failures say</div>
          <Table
            head={['Program error', 'Txs', 'Share']}
            rows={[
              ['InstructionError[2, Custom(0)]', '19,057', '53.92%'],
              ['landed', '14,116', '39.94%'],
              ['InstructionError[2, Custom(3005)]', '870', '2.46%'],
              ['InstructionError[2, Custom(17)]', '536', '1.52%'],
              ['InstructionError[2, Custom(6036)]', '274', '0.78%'],
              ['InstructionError[2, NotEnoughAccountKeys]', '131', '0.37%'],
              ['InstructionError[2, ProgramFailedToComplete]', '113', '0.32%'],
              ['further codes, each under 0.2%', '247', '0.70%'],
            ]}
          />
        </div>
        <Note>
          Every failure sits at instruction index 2, the same position in every transaction, so the
          bot builds one transaction shape and it aborts at the same step each time. A single code
          accounts for 54% of all transactions signed and 90% of all failures. What that code means
          is program defined and was not decoded, so it is not described here as a slippage guard.
          What can be said without guessing is that the bot fires speculatively and one on chain
          check rejects the great majority of those attempts, cheaply and uniformly.
        </Note>
      </Card>

      <Card icon={Clock} title="Timing pattern" tag="clustered" tagColor="#8B5CF6">
        <div className="p-3 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30 text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
          Solana block_time is second granularity, so inter arrival percentiles derived from it are
          interpolation rather than measurement. A first pass produced a median gap of 621ms that the
          underlying data cannot support. Slot numbers are the honest clock at roughly 400ms each,
          so every figure below is a slot delta.
        </div>
        <div className="mt-4 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">Gap to the previous transaction</div>
          <Bar label="same slot" pct={35.72} value="35.72%" scale={2.8} />
          <Bar label="1 slot, 0.4s" pct={10.79} value="10.79%" scale={2.8} />
          <Bar label="2 slots, 0.8s" pct={5.65} value="5.65%" scale={2.8} />
          <Bar label="3 slots, 1.2s" pct={4.57} value="4.57%" scale={2.8} />
          <Bar label="4 slots, 1.6s" pct={3.72} value="3.72%" scale={2.8} />
          <Bar label="5 slots, 2.0s" pct={3.16} value="3.16%" scale={2.8} />
          <Bar label="6 slots, 2.4s" pct={2.64} value="2.64%" scale={2.8} />
          <Bar label="8 slots, 3.2s" pct={2.04} value="2.04%" scale={2.8} />
          <Bar label="over 40 slots" pct={4.52} value="4.52%" scale={2.8} tone="#94A3B8" />
        </div>
        <Note>
          A fixed interval poller produces a spike. If it wakes every two seconds, gaps pile up at
          five slots and almost nowhere else. There is no spike. The distribution decays
          monotonically from zero, which is what an opportunity triggered arrival process looks like.
        </Note>
        <div className="mt-5">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">Transactions in a single slot</div>
          <Table
            head={['Txs in one slot', 'Slots', 'Share of slots touched']}
            rows={[
              ['1', '15,149', '66.68%'],
              ['2', '5,477', '24.11%'],
              ['3', '1,129', '4.97%'],
              ['4', '458', '2.02%'],
              ['5', '190', '0.84%'],
              ['6', '129', '0.57%'],
              ['7 or more', '148 or more', '0.81%'],
            ]}
          />
        </div>
        <Note>
          More than a third of transactions land in the same slot as the one before, and a third of
          the slots it touches carry more than one of its transactions. Firing twelve or more
          transactions into one 400ms slot is racing, not scheduling. Set against a 60% revert rate,
          this is a bot that would rather send and lose the fee than miss.
        </Note>
        <Note>
          The limit worth stating: this measures submission timing. A bot polling every slot and
          submitting only on an opportunity would produce the same trace. What the data rules out is
          a fixed submission cadence, not a fixed polling loop behind it.
        </Note>
      </Card>

      <Card icon={Scale} title="Trade sizing" tag="208x spread" tagColor="#F59E0B">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">
            SOL leg size across 18,031 swaps, logarithmic
          </div>
          <Bar label="p5" pct={0.5} value="0.028 SOL" />
          <Bar label="p25" pct={2.4} value="0.165 SOL" />
          <Bar label="p50" pct={8.5} value="0.583 SOL" />
          <Bar label="p75" pct={26.9} value="1.841 SOL" />
          <Bar label="p90" pct={53.0} value="5.678 SOL" />
          <Bar label="p95" pct={71.0} value="10.92 SOL" />
          <Bar label="p99" pct={88.0} value="34.26 SOL" />
          <Bar label="max" pct={100} value="393.2 SOL" tone="#94A3B8" />
        </div>
        <Note>
          Bars are scaled logarithmically because a linear axis renders everything below p95 as a
          flat line, and that is itself the finding. The spread from p25 to p99 is a factor of 208
          and median to maximum is a factor of 675. A bot with a configured trade size does not do
          that, so this one sizes to whatever the opportunity supports.
        </Note>
        <div className="mt-5">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">Swaps per transaction</div>
          <Table
            head={['Swaps in one transaction', 'Txs', 'Share']}
            rows={[
              ['1', '2,575', '21.4%'],
              ['2', '5,649', '46.9%'],
              ['3', '3,255', '27.0%'],
              ['4', '565', '4.7%'],
              ['5', '12', '0.1%'],
            ]}
          />
        </div>
        <Note>
          Three quarters of landed attempts are two or three leg cycles, the expected shape for
          cyclic arbitrage. The 21% single swap group is not an arbitrage cycle on its own and is
          worth a second look by anyone building on this.
        </Note>
      </Card>

      <Card icon={Layers} title="Venues and pairs" tag="concentrates, then sprays" tagColor="#0EA5E9">
        <Table
          head={['Venue', 'Swaps', 'Share', 'Volume USD']}
          rows={[
            ['Meteora DLMM', '13,501', '52.0%', '3,811,591'],
            ['Meteora CPAMM', '3,295', '12.7%', '413,162'],
            ['PumpSwap', '2,618', '10.1%', '540,496'],
            ['Raydium CPMM', '1,615', '6.2%', '84,734'],
            ['Raydium CLMM', '1,154', '4.4%', '487,402'],
            ['Tessera v1', '1,031', '4.0%', '429,301'],
            ['BisonFi v1', '790', '3.0%', '82,152'],
            ['PancakeSwap v3', '782', '3.0%', '105,551'],
            ['Raydium AMM', '549', '2.1%', '337,009'],
            ['11 further venues', '623', '2.4%', '128,129'],
          ]}
          foot={['20 venues', '25,958', '100%', '6,419,527']}
        />
        <Note>
          Meteora across its four programs is 65.6% of all swaps. The bot is a Meteora centric
          arbitrageur that reaches out to nineteen other venues for the other side of a cycle.
        </Note>
        <div className="mt-5">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">Top pairs of 1,294</div>
          <Table
            head={['Pair', 'Swaps', 'Share', 'Cumulative', 'Volume USD']}
            rows={[
              ['WSOL-USDC', '3,398', '13.09%', '13.1%', '1,005,308'],
              ['WSOL-MET', '1,016', '3.91%', '17.0%', '319,994'],
              ['USDC-MET', '770', '2.97%', '20.0%', '176,874'],
              ['WSOL-STONK', '762', '2.94%', '22.9%', '770,369'],
              ['WSOL-fone', '579', '2.23%', '25.1%', '105,946'],
              ['WSOL-JUP', '563', '2.17%', '27.3%', '76,653'],
              ['WSOL-EMBER', '547', '2.11%', '29.4%', '275,380'],
              ['MET-EMBER', '528', '2.03%', '31.4%', '235,308'],
            ]}
          />
        </div>
        <div className="mt-4 space-y-1.5">
          <Bar label="top 1 pair" pct={13.1} value="13.1%" />
          <Bar label="top 10" pct={34.8} value="34.8%" />
          <Bar label="top 20" pct={44.8} value="44.8%" />
          <Bar label="top 50" pct={60.0} value="60.0%" />
          <Bar label="top 100" pct={72.5} value="72.5%" />
        </div>
        <Note>
          The Herfindahl index on swap counts is 0.025, an effective breadth of about 40 pairs, and
          388 pairs, 30% of them, were touched exactly once. It concentrates hard on venues and
          sprays across pairs. Those are two different answers and worth keeping apart.
        </Note>
      </Card>

      <Card icon={Ban} title="What this cannot tell you" tag="read this" tagColor="#EF4444">
        <div className="space-y-4">
          {[
            ['Whether it is profitable. Nothing here says that.',
             'The 6.4 million dollar figure is gross swap volume, which is turnover, not profit. Net PnL was not computed. Doing it properly means differencing token balances across each transaction cycle and netting off 81.4 SOL of fees and any Jito tips, which are a separate payment not visible in the fee column. A bot can push 6.4 million dollars of volume and lose money.'],
            ['What Custom(0) means.',
             'It is a program defined code and the program IDL was not decoded. The common reading is a profitability or slippage guard, and that is consistent with the pattern, but it is inference rather than evidence. Decoding the program at instruction index 2 is the single highest value next step.'],
            ['What 4 and 9 September actually were.',
             'The compute profile says they are not arbitrage. It does not say what they are. Deployment, funding, a dry run and a different strategy all fit.'],
            ['Anything before 12 August.',
             'The decoded trades check was unbounded and found no trade before 4 September, so it has certainly never traded earlier. The raw transaction check only reached back 30 days, so non trading activity before 12 August is unexamined.'],
            ['Which races it lost, and to whom.',
             'Failures are visible. The competitor that beat it is not, without reconstructing each contested slot, and neither is the opportunity it never attempted. A 60% revert rate cannot be read as inefficiency without knowing what the winners rate looks like on the same pairs.'],
            ['A 3,334 transaction accounting gap.',
             '15,390 transactions landed but only 12,056 carry a swap the curated trades table decodes. The remainder are either non swap operations or swaps on venues the decoder does not cover, so every venue and pair figure describes the decoded subset and not the whole.'],
            ['11 September is a partial day on a live chain.',
             'The last transaction captured is 19:30 UTC. Totals also drifted between queries as new blocks landed, with the transaction count rising by 24 over roughly twenty minutes. Treat 11 September as a run rate, not a daily total.'],
          ].map(([h, b], i) => (
            <div key={i} className="border-l-2 border-red-200 dark:border-red-500/30 pl-3">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-100">{h}</div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mt-1">{b}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card icon={Coins} title="Source and method" tag="5 queries" tagColor="#64748B">
        <Table
          head={['Query', 'What it established']}
          rows={[
            ['schema', 'column discovery from information_schema'],
            ['discover', 'signer versus program, and the true extent of the history'],
            ['activity', 'success rate, daily volume, fees'],
            ['timing', 'slot gaps and the error breakdown'],
            ['dex', 'venues, pairs and sizing'],
          ]}
        />
        <Note>
          Dune, reading the raw Solana transaction table and the curated trades table. The schema
          was read from information_schema rather than assumed, after the published documentation
          turned out not to list columns for the trades table. The venue and pair query was run with
          no date bound, which is what establishes that there is no history before 4 September
          rather than merely none inside a window.
        </Note>
      </Card>

      <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={14} className="text-gray-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            This method transfers to the EVM chains only in part. Dune carries a complete Solana
            transaction table, which is what makes the success rate and timing sections possible.
            For BNB Chain the equivalent scan is available but not free, the explorer free tier does
            not cover it, and no JSON-RPC method lists an address transactions. For Ethereum and
            Arbitrum the explorer free tier does return per transaction status, timestamp, value and
            counterparty, which is enough for the same analysis at no cost.
          </p>
        </div>
      </div>

    </div>
  );
}
