// BehaviourStudy.jsx
//
// A proof of concept for measuring on-chain behaviour, applied to one
// arbitrage operation on Solana that runs from two wallets in sequence.
//
// WHY THIS SAYS BOT AND NEVER AGENT
// The subject runs a fixed rule and submits transactions. It takes no
// instructions, does not adapt, and decides nothing. Calling it an agent
// would be wrong on the plain meaning of the word, and anyone who knows the
// difference would discount every number on the page for it. Everywhere the
// copy below says bot, that is deliberate and should stay.
//
// TWO ADDRESSES, AND WHICH CAME FIRST
// This page originally covered MriyaNN8 alone and described it as an eight
// day old bot. That was true of the address and misleading about the
// operation. Analysing MRiYA4oN afterwards showed it had been trading since
// at least March and stopped the day MriyaNN8 took over, so the eight days
// were a migration rather than a beginning. Both are kept here, with the
// handover shown, because the correction is the most useful thing the second
// pass produced.
//
// Deliberately no query costs, credit spend or tooling notes. They are
// operational details of our own account, not properties of the subject, and
// they invite a reader to weigh findings by what they cost to obtain.

import React from 'react';
import {
  Activity, AlertTriangle, Clock, ArrowLeftRight, Layers, Scale, FlaskConical, Ban,
} from 'lucide-react';

const ACCENT = '#4F46E5';
const OLD = 'MRiYA4oN3158fCV8evhuCofrDzbHyYvYnGZUDJvoCsa';
const NEW = 'MriyaNN8TMp6qRWjfr723PK7xgQK7yCt7Kg2v2PQu7X';

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

function Bar({ label, pct, value, tone = ACCENT, scale = 1 }) {
  return (
    <div className="flex items-center gap-3 text-[11px]">
      <span className="w-28 shrink-0 text-gray-500 text-right">{label}</span>
      <span className="flex-1 h-3.5 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <span className="block h-full rounded" style={{ width: `${Math.min(100, pct * scale)}%`, background: tone }} />
      </span>
      <span className="w-24 shrink-0 font-mono text-gray-500">{value}</span>
    </div>
  );
}

const Note = ({ children }) => (
  <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mt-3">{children}</p>
);

/** The handover, drawn. Daily transaction counts for both wallets. */
function Handover() {
  const days = [
    ['03 Sep', 18129, 0], ['04 Sep', 18990, 870], ['05 Sep', 12182, 0],
    ['06 Sep', 31903, 0], ['07 Sep', 27213, 0], ['08 Sep', 29610, 0],
    ['09 Sep', 28621, 415], ['10 Sep', 14814, 7577], ['11 Sep', 4, 27743],
  ];
  const max = 31903;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
        <span className="w-16 shrink-0" />
        <span className="flex-1">MRiYA4oN, the first wallet</span>
        <span className="flex-1">MriyaNN8, the second</span>
      </div>
      {days.map(([d, a, b]) => (
        <div key={d} className="flex items-center gap-3 text-[11px]">
          <span className="w-16 shrink-0 text-gray-500 text-right">{d}</span>
          <span className="flex-1 flex items-center gap-2">
            <span className="flex-1 h-3 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <span className="block h-full rounded" style={{ width: `${100 * a / max}%`, background: '#64748B' }} />
            </span>
            <span className="w-14 font-mono text-gray-500 text-right">{a.toLocaleString()}</span>
          </span>
          <span className="flex-1 flex items-center gap-2">
            <span className="flex-1 h-3 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <span className="block h-full rounded" style={{ width: `${100 * b / max}%`, background: ACCENT }} />
            </span>
            <span className="w-14 font-mono text-gray-500 text-right">{b.toLocaleString()}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function BehaviourStudy() {
  return (
    <div className="space-y-6">

      <div className="p-4 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/60 dark:bg-indigo-500/5 text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">
        A proof of concept for measuring on-chain behaviour, applied to an arbitrage operation on
        Solana. The subject runs a fixed rule and submits transactions. It takes no instructions,
        does not adapt and decides nothing, so it is a bot and not an agent. Everything below was
        measured from public transaction data with no cooperation from the operator, and it runs
        from two wallets in sequence rather than one.
      </div>

      <Card icon={ArrowLeftRight} title="Two wallets, one operation" tag="handover 10 to 11 Sept" tagColor="#8B5CF6">
        <div className="space-y-1.5 mb-4">
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="text-gray-500 w-14 shrink-0">First</span>
            <code className="font-mono text-[11px] break-all bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800 px-1.5 py-0.5 rounded">{OLD}</code>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="text-gray-500 w-14 shrink-0">Second</span>
            <code className="font-mono text-[11px] break-all bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800 px-1.5 py-0.5 rounded">{NEW}</code>
          </div>
        </div>
        <Handover />
        <Note>
          The first wallet had been trading since at least 16 March and ran continuously until 10
          September, then stopped at four transactions on the 11th. The second made its first
          transaction on 4 September, spent two quiet days at 870 and 415, and took over on the
          11th with 27,743. One operation moving address, not two bots.
        </Note>
        <div className="mt-4 p-3 rounded-lg border border-amber-200 dark:border-amber-500/25 bg-amber-50/60 dark:bg-amber-500/5 text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
          This corrects the earlier reading of this page. Looking at the second wallet alone showed
          an eight day history and suggested a new bot finding its feet. It was a migration of an
          operation with at least six months behind it, and the two quiet days were a rehearsal
          rather than a start.
        </div>
      </Card>

      <Card icon={FlaskConical} title="Same operator, same code" tag="signature matches" tagColor="#14B8A6">
        <Table
          head={['Measure', 'First wallet', 'Second wallet']}
          rows={[
            ['Revert rate', '61.69%', '60.06%'],
            ['Dominant error', 'InstructionError[2, Custom(0)]', 'same'],
            ['Its share of all transactions', '55.23%', '53.92%'],
            ['Instruction index that fails', '2, every time', '2, every time'],
            ['Average compute units', '130k to 139k', '127k to 135k'],
            ['Submissions in the same slot', '40.16%', '35.72%'],
          ]}
        />
        <Note>
          The same abort at the same instruction position, the same compute profile and the same
          racing behaviour. Two wallets producing this signature independently would be a
          coincidence; together with the handover it is the same software moving address.
        </Note>
      </Card>

      <Card icon={Activity} title="Success rate, the number an explorer does not show" tag="61.7% revert" tagColor="#EF4444">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">
          First wallet, 13 August to 11 September
        </div>
        <div className="flex h-8 rounded overflow-hidden text-[11px] font-mono mb-4">
          <div className="flex items-center px-3 text-white" style={{ width: '61.69%', background: '#EF4444' }}>61.69% reverted, 569,111</div>
          <div className="flex items-center justify-end px-3 text-white" style={{ width: '38.31%', background: '#10B981' }}>353,362 landed</div>
        </div>
        <Table
          head={['', 'Transactions', 'Landed', 'Reverted', 'Success', 'Fees SOL', 'Fees on failures']}
          rows={[
            ['First wallet, 30 days', '922,473', '353,362', '569,111', '38.31%', '1,691.95', '489.93'],
            ['Second wallet, 10 to 11 Sept', '35,344', '14,116', '21,228', '39.94%', '81.44', '21.56'],
          ]}
        />
        <Note>
          29% of all fees the first wallet paid went on transactions that reverted. That is 489.93
          SOL bought nothing, and it is the cost of a strategy that would rather send and lose the
          fee than miss.
        </Note>

        <div className="mt-5">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">
            What the failures say, first wallet
          </div>
          <Table
            head={['Program error', 'Transactions', 'Share']}
            rows={[
              ['InstructionError[2, Custom(0)]', '509,502', '55.23%'],
              ['landed', '353,362', '38.31%'],
              ['InstructionError[2, Custom(3005)]', '20,496', '2.22%'],
              ['InstructionError[2, Custom(6048)]', '13,611', '1.48%'],
              ['InstructionError[2, Custom(6036)]', '7,617', '0.83%'],
              ['InstructionError[2, ProgramFailedToComplete]', '6,948', '0.75%'],
              ['InstructionError[2, Custom(6016)]', '2,398', '0.26%'],
              ['InstructionError[2, Custom(2014)]', '2,391', '0.26%'],
              ['42 further outcomes', '6,148', '0.66%'],
            ]}
          />
        </div>
        <Note>
          Every failure sits at instruction index 2, the same position in every transaction, across
          both wallets and 50 distinct outcomes. The bot builds one transaction shape and it aborts
          at the same step each time. A single code accounts for 55% of everything signed and 90%
          of all failures. What that code means is program defined and was not decoded, so it is
          not described here as a slippage guard. What can be said without guessing is that the bot
          fires speculatively and one on chain check rejects most attempts, cheaply and uniformly.
        </Note>
      </Card>

      <Card icon={Clock} title="Timing pattern" tag="clustered" tagColor="#8B5CF6">
        <div className="p-3 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30 text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
          Solana block_time is second granularity, so inter arrival percentiles derived from it are
          interpolation rather than measurement. Slot numbers are the honest clock at roughly 400ms
          each, so every figure below is a slot delta.
        </div>
        <div className="mt-4 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">
            Gap to the previous transaction, first wallet, 922,472 intervals
          </div>
          <Bar label="same slot" pct={40.16} value="40.16%" scale={2.5} />
          <Bar label="1 slot, 0.4s" pct={12.42} value="12.42%" scale={2.5} />
          <Bar label="2 slots, 0.8s" pct={5.94} value="5.94%" scale={2.5} />
          <Bar label="3 slots, 1.2s" pct={4.29} value="4.29%" scale={2.5} />
          <Bar label="4 slots, 1.6s" pct={3.45} value="3.45%" scale={2.5} />
          <Bar label="5 slots, 2.0s" pct={2.90} value="2.90%" scale={2.5} />
          <Bar label="6 slots, 2.4s" pct={2.48} value="2.48%" scale={2.5} />
          <Bar label="8 slots, 3.2s" pct={1.94} value="1.94%" scale={2.5} />
          <Bar label="over 40 slots" pct={4.03} value="4.03%" scale={2.5} tone="#94A3B8" />
        </div>
        <Note>
          A fixed interval poller produces a spike. If it wakes every two seconds, gaps pile up at
          five slots and almost nowhere else. There is no spike in either wallet. The distribution
          decays monotonically from zero, which is what an opportunity triggered arrival process
          looks like, and two in five transactions land in the same slot as the one before.
        </Note>
        <Note>
          The limit worth stating: this measures submission timing. A bot polling every slot and
          submitting only on an opportunity would produce the same trace. What the data rules out
          is a fixed submission cadence, not a fixed polling loop behind it.
        </Note>
      </Card>

      <Card icon={Scale} title="Trade sizing" tag="160x spread" tagColor="#F59E0B">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">
            SOL leg size, first wallet, 614,332 swaps, logarithmic
          </div>
          <Bar label="p5" pct={0.6} value="0.040 SOL" />
          <Bar label="p25" pct={2.6} value="0.197 SOL" />
          <Bar label="p50" pct={8.7} value="0.647 SOL" />
          <Bar label="p75" pct={25.3} value="1.960 SOL" />
          <Bar label="p90" pct={44.0} value="5.335 SOL" />
          <Bar label="p95" pct={56.0} value="9.589 SOL" />
          <Bar label="p99" pct={72.0} value="31.65 SOL" />
          <Bar label="max" pct={100} value="1,986.6 SOL" tone="#94A3B8" />
        </div>
        <Note>
          Bars are scaled logarithmically because a linear axis renders everything below p95 as a
          flat line, and that is itself the finding. The spread from p25 to p99 is a factor of 160
          and median to maximum is a factor of 3,069. A bot with a configured trade size does not
          do that, so this one sizes to whatever the opportunity supports. The second wallet shows
          the same behaviour with a lower ceiling, a maximum of 393 SOL against 1,987 here.
        </Note>
        <div className="mt-5">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">Legs per attempt</div>
          <Table
            head={['Swaps in one transaction', 'First wallet', 'Share', 'Second wallet share']}
            rows={[
              ['1', '28,567', '8.4%', '21.4%'],
              ['2', '242,741', '71.2%', '46.9%'],
              ['3', '64,150', '18.8%', '27.0%'],
              ['4', '5,195', '1.5%', '4.7%'],
              ['5', '103', '0.0%', '0.1%'],
            ]}
          />
        </div>
        <Note>
          Nine in ten landed attempts on the first wallet are two or three leg cycles, the expected
          shape for cyclic arbitrage. The single swap group is 8.4% here against 21.4% on the
          second wallet, and a one leg trade is not an arbitrage cycle on its own.
        </Note>
      </Card>

      <Card icon={Layers} title="Venues and pairs" tag="concentrates, then sprays" tagColor="#0EA5E9">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">
          First wallet, 727,794 swaps across 340,756 transactions, $179,657,735
        </div>
        <Table
          head={['Venue', 'Swaps', 'Share', 'Volume USD']}
          rows={[
            ['Meteora DLMM', '314,957', '43.3%', '82,675,843'],
            ['PumpSwap', '222,484', '30.6%', '47,600,396'],
            ['Meteora CPAMM', '42,329', '5.8%', '1,609,098'],
            ['Tessera v1', '31,515', '4.3%', '16,134,143'],
            ['Raydium CLMM', '28,832', '4.0%', '9,329,823'],
            ['Raydium CPMM', '24,732', '3.4%', '2,549,430'],
            ['BisonFi v1', '19,408', '2.7%', '5,324,861'],
            ['Raydium AMM', '15,792', '2.2%', '6,150,151'],
            ['PancakeSwap v3', '9,530', '1.3%', '2,202,455'],
            ['14 further venues', '18,215', '2.5%', '6,081,535'],
          ]}
          foot={['23 venues', '727,794', '100%', '179,657,735']}
        />
        <Note>
          Meteora across its programs is 50.2% here against 65.6% on the second wallet, and
          PumpSwap is 30.6% against 10.1%. The venue mix genuinely differs between the two, which
          is the one place the signature does not simply repeat.
        </Note>
        <div className="mt-5">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-2">
            Top pairs of 7,766 distinct
          </div>
          <Table
            head={['Pair', 'Swaps', 'Share', 'Volume USD']}
            rows={[
              ['WSOL-USDC', '74,340', '10.21%', '32,119,379'],
              ['WSOL-fone', '25,764', '3.54%', '13,581,783'],
              ['WSOL-CATE', '19,859', '2.73%', '11,696,962'],
              ['WSOL-ANSEM', '15,794', '2.17%', '16,738,507'],
              ['WSOL-Pistacio', '10,482', '1.44%', '4,060,265'],
              ['WSOL-Jimothy', '8,744', '1.20%', '2,311,324'],
              ['WSOL-TOAD', '7,688', '1.06%', '3,272,956'],
              ['WSOL-USDT', '6,986', '0.96%', '4,117,344'],
            ]}
          />
        </div>
        <div className="mt-4 space-y-1.5">
          <Bar label="top 1 pair" pct={10.2} value="10.2%" />
          <Bar label="top 5" pct={20.1} value="20.1%" />
          <Bar label="top 10" pct={25.0} value="25.0%" />
          <Bar label="top 20" pct={31.8} value="31.8%" />
          <Bar label="top 60" pct={47.1} value="47.1%" />
        </div>
        <Note>
          7,766 distinct pairs against 1,294 on the second wallet, and the sixty most traded are
          still under half of all swaps. It concentrates hard on venues and sprays across pairs.
          Those are two different answers and worth keeping apart.
        </Note>
      </Card>

      <Card icon={Ban} title="What this cannot tell you" tag="read this" tagColor="#EF4444">
        <div className="space-y-4">
          {[
            ['Whether it is profitable. Nothing here says that.',
             'The $179.7M figure is gross swap volume, which is turnover, not profit. Net PnL was not computed. Doing it properly means differencing token balances across each transaction cycle and netting off 1,692 SOL of fees and any Jito tips, which are a separate payment not visible in the fee column. A bot can push that volume and lose money.'],
            ['What Custom(0) means.',
             'It is a program defined code and the program IDL was not decoded. The common reading is a profitability or slippage guard, and that is consistent with the pattern, but it is inference rather than evidence. Decoding the program at instruction index 2 is the single highest value next step.'],
            ['How far back the first wallet actually goes.',
             'Its earliest observed trade is 16 March, which is the boundary of the queried window rather than a start date. The true first trade may be earlier. The transaction level figures on this page cover 13 August to 11 September and are not the whole history.'],
            ['Whether there are other wallets.',
             'Two were analysed because two were known. The same operator could be running others in parallel, and nothing here would show it. The signature described above is what you would search for.'],
            ['Which races it lost, and to whom.',
             'Failures are visible. The competitor that beat it is not, without reconstructing each contested slot, and neither is the opportunity it never attempted. A 61.69% revert rate cannot be read as inefficiency without knowing what the winners rate looks like on the same pairs.'],
            ['The decoded subset is not the whole.',
             'Venue and pair figures describe swaps that the curated trades table decodes. Transactions that landed without a decoded swap are absent from those sections, so treat the venue mix as a description of what could be read rather than of everything that happened.'],
            ['11 September is a partial day for both wallets.',
             'It is the day of the handover, so it shows one wallet stopping and the other starting rather than a normal day for either. Treat it as a transition, not a rate.'],
          ].map(([h, b], i) => (
            <div key={i} className="border-l-2 border-red-200 dark:border-red-500/30 pl-3">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-100">{h}</div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mt-1">{b}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={14} className="text-gray-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            This method transfers to the EVM chains only in part. A complete Solana transaction
            table is what makes the success rate and timing sections possible. For BNB Chain the
            equivalent scan is available but not free, the explorer free tier does not cover it,
            and no JSON-RPC method lists an address transactions. For Ethereum and Arbitrum the
            explorer free tier does return per transaction status, timestamp, value and
            counterparty, which is enough for the same analysis at no cost.
          </p>
        </div>
      </div>

    </div>
  );
}
