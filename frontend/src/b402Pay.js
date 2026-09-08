// b402Pay.js
//
// Browser side of a B402 payment: create a session, sign the EIP-3009
// authorization, submit it, then follow the outcome.
//
// WHERE THE NUMBERS COME FROM
// Every value that decides what gets paid comes from the session the server
// created and holds. The client sends an amount when asking for a session
// and never again. What gets signed is the `accepts` entry the server
// returned, and what the server verifies against is its own stored copy,
// loaded by session id. A payload signed against anything else fails, which
// was confirmed against the live facilitator: lowering the value produced
// invalid_exact_evm_payload_authorization_value_mismatch.
//
// So this module must never build requirements of its own, and must never
// let a user edit the amount after a session exists. Changing the amount
// means asking for a new session.
//
// PAYLOAD SHAPE
// Established by probing the live facilitator rather than from a spec:
//
//   { x402Version: 2, scheme, network,
//     payload: { signature, authorization: {
//       from, to, value, validAfter, validBefore, nonce } } }
//
// A flat variant with signature and authorization at the top level was
// rejected with "paymentPayload.payload is required", so the nesting
// matters.

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const BSC_CHAIN_ID = 56;
export const BSCSCAN_TX = 'https://bscscan.com/tx/';

/** Outcomes the backend can report. All three are handled by the caller;
 *  only `paid` means money moved. */
export const PAY_OUTCOME = {
  PAID: 'paid',
  BROADCAST_UNCONFIRMED: 'broadcast_unconfirmed',
  FAILED: 'failed',
};

async function asJson(res) {
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, data: { detail: text.slice(0, 300) } };
  }
}

/** Live facilitator state: which assets, on which network, with which
 *  schemes. Read from the API, never hardcoded here. */
export async function fetchReadiness() {
  const res = await fetch(`${API_BASE_URL}/api/paybox/readiness`);
  const { ok, data } = await asJson(res);
  if (!ok) throw new Error(data?.detail || 'Could not read facilitator state.');
  return data;
}

/** The rail checks, run server side against the live facilitator. */
export async function fetchSelfCheck() {
  const res = await fetch(`${API_BASE_URL}/api/paybox/selfcheck`);
  const { ok, data } = await asJson(res);
  if (!ok) throw new Error(data?.detail || 'Self-check could not run.');
  return data;
}

/** Ask the server for a session. It replies 402 by design, which is the
 *  x402 standard's own status for "payment required" and not an error. */
export async function createSession({ amount, orderReference, description, asset }) {
  const res = await fetch(`${API_BASE_URL}/api/paybox/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: String(amount),
      order_reference: orderReference,
      description,
      ...(asset ? { asset } : {}),
    }),
  });
  const { status, data } = await asJson(res);
  if (status !== 402) {
    throw new Error(data?.detail || `Expected 402 with payment requirements, got ${status}.`);
  }
  const requirements = (data.accepts || [])[0];
  if (!requirements) throw new Error('The server returned no payment requirements.');
  return { sessionId: data.session_id, requirements, checkoutUrl: data.checkout_url };
}

export async function getSession(sessionId) {
  const res = await fetch(`${API_BASE_URL}/api/paybox/sessions/${sessionId}`);
  const { ok, data } = await asJson(res);
  if (!ok) throw new Error(data?.detail || 'Could not read the session.');
  return data;
}

/** A 32-byte nonce. Each authorization needs its own, and the contract
 *  rejects a repeat, which is what stops one signature being replayed. */
function randomNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Build the EIP-712 request for the wallet, straight from the server's
 *  requirements. Nothing here is chosen locally except the nonce and the
 *  validity window, neither of which changes what is paid or to whom. */
export function buildTypedData(requirements, from) {
  const extra = requirements.extra || {};
  const now = Math.floor(Date.now() / 1000);
  const validBefore = now + Number(requirements.maxTimeoutSeconds || 300);

  const authorization = {
    from,
    to: requirements.payTo,
    value: requirements.amount,
    validAfter: '0',
    validBefore: String(validBefore),
    nonce: randomNonce(),
  };

  return {
    authorization,
    typedData: {
      domain: {
        name: extra.name,
        version: extra.version,
        chainId: BSC_CHAIN_ID,
        verifyingContract: requirements.asset,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        ...authorization,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
      },
    },
  };
}

export function buildPaymentPayload(requirements, authorization, signature) {
  return {
    x402Version: 2,
    scheme: requirements.scheme,
    network: requirements.network,
    payload: { signature, authorization },
  };
}

/** Submit a signed payload. Returns the backend's own result, which
 *  distinguishes verify rejection from each settle outcome. */
export async function submitPayment(sessionId, paymentPayload) {
  const res = await fetch(`${API_BASE_URL}/api/paybox/sessions/${sessionId}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentPayload }),
  });
  const { data } = await asJson(res);
  return data;
}

/** Poll a broadcast-but-unconfirmed session until it resolves or the
 *  attempts run out.
 *
 * It never resubmits. The transaction is already on chain, and sending a
 * second one would risk paying twice for the same session. When the
 * attempts run out this reports that the outcome is still unknown rather
 * than calling it failed, because unknown and failed are different facts.
 */
export async function pollUntilResolved(sessionId, { attempts = 20, intervalMs = 3000, onTick } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, intervalMs));
    let session;
    try {
      // eslint-disable-next-line no-await-in-loop
      session = await getSession(sessionId);
    } catch {
      onTick?.({ attempt: i + 1, attempts, status: 'unreadable' });
      continue;
    }
    onTick?.({ attempt: i + 1, attempts, status: session.status });
    if (session.status === PAY_OUTCOME.PAID || session.status === PAY_OUTCOME.FAILED) {
      return session;
    }
  }
  return { status: 'unresolved', unresolved: true };
}
