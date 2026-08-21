/**
 * Which address a phone on the same Wi-Fi should open, and whether the dev
 * certificate actually covers it.
 *
 * Shared by `dev:lan` and `start:lan`; both bind 0.0.0.0 and so both print a
 * bind address rather than a reachable one unless told otherwise.
 */
import { networkInterfaces } from 'node:os';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';

export const CERT = 'certificates/localhost.pem';
export const KEY = 'certificates/localhost-key.pem';

/*
 * Virtual adapters report as external too — the WSL bridge on this machine sits
 * on 172.19.80.1 and is reachable from nothing — so name is the only signal
 * separating them from a real NIC.
 */
const VIRTUAL = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|Loopback|Bluetooth|TAP-|Tailscale|ZeroTier|Npcap/i;

const rank = (address) => {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
};

/** Real IPv4 addresses on this machine, home-router subnets first. */
export function lanCandidates() {
  return Object.entries(networkInterfaces())
    .filter(([name]) => !VIRTUAL.test(name))
    .flatMap(([name, addrs]) =>
      (addrs ?? [])
        .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
        .map((a) => ({ name, address: a.address }))
    )
    .sort((a, b) => rank(a.address) - rank(b.address));
}

/**
 * Prints the URLs, then warns about any address the certificate omits.
 *
 * A DHCP lease change silently invalidates a certificate pinned to the old IP,
 * and on the phone that surfaces only as an opaque certificate error. Worth
 * saying out loud here, but only a warning — the server is still fine on
 * localhost.
 */
export function printLan(port) {
  const candidates = lanCandidates();

  if (candidates.length === 0) {
    console.log('[lan] no LAN address found — is Wi-Fi or Ethernet connected?');
  }
  for (const { name, address } of candidates) {
    console.log(`[lan] https://${address}:${port}  (${name})`);
  }

  let covered;
  try {
    const san = new X509Certificate(readFileSync(CERT)).subjectAltName ?? '';
    covered = new Set(san.split(',').map((e) => e.trim().replace(/^(DNS|IP Address):/, '')));
  } catch {
    console.log(`[lan] warning: ${CERT} is missing or unreadable`);
    return candidates;
  }

  const uncovered = candidates.filter(({ address }) => !covered.has(address));
  for (const { address } of uncovered) {
    console.log(`[lan] warning: the certificate does not cover ${address} — the browser will reject it`);
  }
  if (uncovered.length > 0) {
    const names = ['localhost', '127.0.0.1', '::1', ...uncovered.map((c) => c.address)].join(' ');
    console.log(`[lan] regenerate with: mkcert -key-file ${KEY} -cert-file ${CERT} ${names}`);
  }

  return candidates;
}
