// DeliveryProvenance.jsx
//
// Who paid for the work an agent has delivered. Two exports, one file, shared
// by web and mobile so the card and the panel cannot end up saying different
// things about the same agent.
//
// WHY THIS EXISTS
// The verified tier says at least one job from a buyer other than the owner
// reached SUBMITTED or COMPLETED. It says nothing about how many buyers, or
// whether the buyer runs the agent next door, or whether the jobs that arrived
// afterwards were ever answered. Measured across the verified set: 20 of 26
// owners have every delivery from a single client, in three cases that client
// owns another agent in the same index, and six have jobs from other clients
// sitting funded and undelivered. A buyer funding the fourth job has none of
// that in front of them.
//
// WHY THE GRID CARD SHOWS ONLY TWO OF THESE FACTS
// Concentration fires on 77% of verified cards. A flag that appears on three
// cards in four discriminates nothing and costs the grid a line. So the grid
// carries only what is both rare and damning: delivery the owner paid for
// itself, and jobs from other clients that were never answered. Everything
// else is on the panel, where somebody is deciding rather than browsing.
//
// REGISTER
// Facts in the same voice as the withheld reasons: what was counted, over
// what, and what it does not mean. No score, no colour, no verdict.

import React from 'react';
import { AlertTriangle, Users } from 'lucide-react';

/** Whether an agent has anything worth saying about its delivery provenance.
 *  An agent nobody has hired has no provenance and gets no block: an empty
 *  box where an explanation belongs reads worse than silence. */
export function hasProvenance(agent) {
  return (agent?.clientsDelivered ?? 0) > 0 || (agent?.jobsSelfFunded ?? 0) > 0
    || (agent?.unansweredFromNewClients ?? 0) > 0;
}

/** The two conditions that earn a line on the grid card.
 *
 *  Self-funded delivery: the owner paid itself, so the delivery is activity
 *  and not demand. Unanswered new clients: somebody else's money is in escrow
 *  and nothing has come back. Both are rare across the set and both change
 *  what a buyer should do next, which is the test for being on a card at all.
 */
export function DeliveryFlags({ agent, className = '' }) {
  const selfOnly = (agent?.jobsSelfFunded ?? 0) > 0
    && (agent?.jobsDeliveredExternal ?? 0) === 0;
  const stuck = agent?.unansweredFromNewClientsKnown !== false
    && (agent?.unansweredFromNewClients ?? 0) > 0;
  if (!selfOnly && !stuck) return null;

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {selfOnly && (
        <span className="inline-flex items-start gap-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>
            Every delivery was paid for by its own owner
            {(agent.jobsSelfFunded ?? 0) > 1 ? ` (${agent.jobsSelfFunded} jobs)` : ''}
          </span>
        </span>
      )}
      {stuck && (
        <span className="inline-flex items-start gap-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>
            {agent.unansweredFromNewClients} job
            {agent.unansweredFromNewClients === 1 ? '' : 's'} funded by
            {agent.unansweredFromNewClients === 1 ? ' a client' : ' clients'} it has
            never delivered to, still unanswered
          </span>
        </span>
      )}
    </div>
  );
}

/** The whole picture, for the panel where a buyer is deciding. */
export default function DeliveryProvenance({ agent, className = '' }) {
  if (!hasProvenance(agent)) return null;

  const delivered = (agent.jobsDeliveredExternal ?? 0) + (agent.jobsSelfFunded ?? 0);
  const clients = agent.clientsDelivered ?? 0;
  const top = agent.topClientDelivered ?? 0;
  const concentrated = clients === 1 && delivered > 0;

  const lines = [];

  if (delivered > 0) {
    lines.push(
      clients === 1
        ? `${delivered} ${delivered === 1 ? 'delivery' : 'deliveries'}, all to one client.`
        : `${delivered} deliveries to ${clients} clients. The largest of them accounts for ${top}.`
    );
  }

  if (agent.topClientIsSelf) {
    lines.push('That client is the agent’s own owner address. Money returning to '
      + 'the address it left is activity, not demand, and does not count towards '
      + 'the verified tier.');
  } else if (agent.topClientIsAgentOwner) {
    lines.push(agent.topClientAgentName
      ? `That client is the owner of another agent listed here, ${agent.topClientAgentName}. `
        + 'It is a buyer, and it is not an unrelated one.'
      : 'That client is the owner of another agent listed here. It is a buyer, '
        + 'and it is not an unrelated one.');
  } else if (concentrated) {
    lines.push('A single buyer is a narrow base to judge from, not a fault on its own.');
  }

  if (agent.unansweredFromNewClientsKnown === false) {
    lines.push('Whether any funded job is from a client this agent has not '
      + 'delivered to was not computed: it has too many distinct clients to '
      + 'check cheaply. That is a gap in this line, not a finding about the agent.');
  } else if ((agent.unansweredFromNewClients ?? 0) > 0) {
    lines.push(`${agent.unansweredFromNewClients} funded `
      + `${agent.unansweredFromNewClients === 1 ? 'job is' : 'jobs are'} from a client `
      + 'this agent has never delivered to, and nothing has come back yet. '
      + 'A funded job is money already committed.');
  }

  if (!lines.length) return null;

  return (
    <div className={`p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-white/[0.02] ${className}`}>
      <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        <Users size={12} className="shrink-0" />
        Who paid for the delivery
      </div>
      <div className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-300 space-y-1">
        {lines.map((line, i) => <p key={i}>{line}</p>)}
      </div>
    </div>
  );
}

/** What the whole job index holds, as against the slice the marketplace lists.
 *
 *  A reader told that 27 agents here are verified has no way to know that the
 *  marketplace lists a diversified slice of a larger store, and that 61 owner
 *  addresses in the index have delivered work somebody else paid for. Both
 *  numbers are true and they answer different questions. */
export function StoreWideDelivery({ totals, className = '' }) {
  if (!totals) return null;
  const withDelivery = totals.providers_with_delivery ?? 0;
  const external = totals.providers_with_external_delivery ?? 0;
  const selfOnly = totals.providers_self_funded_only ?? 0;
  if (!withDelivery) return null;

  return (
    <p className={`text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 ${className}`}>
      Across the whole job index, not just the agents listed here:{' '}
      {withDelivery.toLocaleString()} owner addresses have delivered at least one
      job, {external.toLocaleString()} of them to a buyer other than themselves,
      and {selfOnly.toLocaleString()} only ever to themselves. The marketplace
      lists a diversified slice of a larger store, so a verified count taken from
      this page is smaller than the number of addresses that have delivered.
    </p>
  );
}
