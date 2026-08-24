// erc8183Negotiate.js
//
// Real client-side counterpart to backend/core/erc8183_negotiate.py.
//
// Real root cause this exists for (2026-08-21/22): job #56636 was funded
// through the old hire flow — a fixed plain-text description, no negotiate
// step — and was then PERMANENTLY rejected by the explainer agent's own
// notify_funded handler: "no signed quote anchored in job description".
// Traced through the real SDK verification logic
// (bnbagent_studio_core.erc8183.verify.verify_signed_job): a strict
// ERC-8183 seller requires the on-chain description to be a Schema-v1
// JobDescription carrying a negotiation_hash + provider_sig THIS provider
// signed — which only the real `negotiate` skill produces. This isn't
// specific to that one job; ANY hire against a properly strict seller
// through the old flow was dead on arrival.
//
// negotiateJob() below calls our OWN backend (never the agent directly —
// confirmed live that the agent's endpoint has no CORS support at all, a
// real OPTIONS preflight returned 405 with no Access-Control-Allow-Origin,
// so a browser fetch would be blocked outright). buildJobDescription() is a
// field-for-field port of the SDK's own
// bnbagent.erc8183.negotiation.build_job_description — verified
// byte-for-byte compatible against a real, live negotiation result
// (2026-08-22): the description this produces re-parses and its
// negotiation_hash correctly recovers the agent's real signer address via
// the same recover_quote_signer logic the seller uses to verify it. No
// keccak/checksum library needed here — `verifying_contract` is relayed
// verbatim from the negotiation result, which the agent already returns
// correctly EIP-55 checksummed (checksumming is idempotent, so re-deriving
// it client-side would be redundant, not more correct).

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

/** Real call to our backend's negotiate proxy. Returns the raw negotiation
 * result on a real accepted quote, or null — NEVER throws. The caller
 * (useHireAgent.js) falls back to the plain-description flow on null,
 * exactly the same way whether the agent doesn't support negotiate, isn't
 * reachable, or genuinely rejected the terms — that distinction doesn't
 * change what the buyer should do next. */
export async function negotiateJob(ownerAddress, taskDescription, terms) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/agents/negotiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_address: ownerAddress, task_description: taskDescription, terms }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body.available ? body.negotiation_result : null;
  } catch (e) {
    return null;
  }
}

/** Real call to our backend's notify_funded proxy — tells a strict ERC-8183
 * seller "I funded job X, please deliver" right after the real on-chain
 * `fund` tx confirms. Real, confirmed gap fixed 2026-08-24: without this,
 * a job funded through this marketplace had no trigger to ever get
 * delivered (see backend/server.py's /api/agents/notify-funded for the
 * full trace). Best-effort, NEVER throws and NEVER blocks the hire — the
 * job is already funded on-chain by the time this is called, so a failure
 * here means "delivery may be slower", never "the hire failed". Returns
 * true only on a real accepted notification. */
export async function notifyFunded(ownerAddress, jobId) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/agents/notify-funded`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_address: ownerAddress, job_id: Number(jobId) }),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return body.notified === true;
  } catch (e) {
    return false;
  }
}

/** Mirrors bnbagent.erc8183.negotiation._sanitize_for_claim exactly:
 * '[' -> '(', ']' -> ')' (prevents injection into the UMA claim's
 * [REQUEST]/[RESPONSE]/[VERIFY] section markers), strips ASCII control
 * chars except tab/newline. Must match byte-for-byte — this text is part
 * of the signed content. */
function sanitizeForClaim(s) {
  if (typeof s !== 'string') return String(s);
  const swapped = s.split('[').join('(').split(']').join(')');
  return Array.from(swapped)
    .filter((ch) => {
      const code = ch.codePointAt(0);
      return code >= 0x20 || ch === '\t' || ch === '\n';
    })
    .join('');
}

/** Real port of build_job_description(negotiation_result) — the exact
 * on-chain description string a strict ERC-8183 seller can verify. Throws
 * (caller should treat as "negotiate effectively failed, fall back") if
 * the result is missing required fields — mirrors the Python function's
 * own ValueError cases, never silently produces a description that would
 * fail verification. */
export function buildJobDescription(negotiationResult) {
  const response = negotiationResult.response || {};
  const request = negotiationResult.request || {};
  if (!response.accepted) {
    throw new Error('Cannot build description from a rejected negotiation');
  }
  const responseTerms = response.terms || {};
  const price = responseTerms.price || '';
  const currency = responseTerms.currency || '';
  if (!price) throw new Error('Negotiation response missing price');
  if (!currency) throw new Error('Negotiation response missing currency');

  // Quality fields only — price/currency are separate top-level fields on
  // the real schema, never nested in `terms` (matches job #56620's real,
  // confirmed-working on-chain description, and the Python builder).
  const terms = {
    deliverables: sanitizeForClaim(responseTerms.deliverables || ''),
    quality_standards: sanitizeForClaim(responseTerms.quality_standards || ''),
  };
  if (Array.isArray(responseTerms.success_criteria) && responseTerms.success_criteria.length) {
    terms.success_criteria = responseTerms.success_criteria.map(sanitizeForClaim);
  }

  const negotiatedAt = negotiationResult.negotiated_at ?? response.negotiated_at ?? Math.floor(Date.now() / 1000);
  const quoteExpiresAt = negotiationResult.quote_expires_at ?? response.quote_expires_at;

  const content = {
    version: 1,
    negotiated_at: negotiatedAt,
    task: sanitizeForClaim(request.task_description || ''),
    terms,
    price,
    currency,
  };
  if (quoteExpiresAt != null) content.quote_expires_at = quoteExpiresAt;
  if (negotiationResult.chain_id != null) content.chain_id = negotiationResult.chain_id;
  // Relayed verbatim — see module docstring on why no re-checksum is needed.
  if (negotiationResult.verifying_contract) content.verifying_contract = negotiationResult.verifying_contract;
  if (negotiationResult.negotiation_hash) content.negotiation_hash = negotiationResult.negotiation_hash;
  if (negotiationResult.provider_sig) content.provider_sig = negotiationResult.provider_sig;

  // Key order doesn't need to match Python's sort_keys=True — a strict
  // seller's own verification re-parses this JSON and re-serializes
  // canonically from the PARSED object before re-hashing (confirmed by
  // reading bnbagent_studio_core.erc8183.verify.recover_quote_signer), so
  // only the VALUES need to match, not this string's own key ordering.
  return JSON.stringify(content);
}

/** The real, agreed price as a BigInt raw-unit amount — what verify_signed_job
 * actually checks the funded budget against (must be >= this). */
export function negotiatedPriceRaw(negotiationResult) {
  const price = negotiationResult?.response?.terms?.price;
  if (!price) return null;
  return BigInt(price);
}
