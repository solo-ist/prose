#!/usr/bin/env node
/**
 * reap-circuit.mjs — surgically kill orphaned Circuit Electron MCP servers.
 *
 * Circuit Electron (@snowfort/circuit-electron, a 0.0.x alpha) does not exit
 * when its Claude client disconnects. Orphaned servers reparent to launchd and
 * a chunk of them spin into ~100% CPU busy-loops. Left alone they accumulate
 * (we once found 74 of them eating ~10 cores).
 *
 * This is the SAFE inverse of the "NEVER pkill -f node" rule in CLAUDE.md: it
 * never touches a live server. A circuit process is reaped only if walking up
 * its parent chain reaches init (pid 1) through circuit processes alone. If the
 * chain roots in ANY live non-circuit parent — the current session's `claude`,
 * a concurrent agent's, or a terminal you launched it from — it is spared.
 * That makes it multi-agent safe by construction (see Multi-Agent Awareness).
 *
 * Usage:
 *   node scripts/reap-circuit.mjs            # reap orphans
 *   node scripts/reap-circuit.mjs --dry-run  # report only, kill nothing
 */

import { execSync } from 'node:child_process';

const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-n');

// pid, ppid, %cpu, command for every process. Tab-free parse: first three
// whitespace-delimited fields, then the rest is the command (may contain spaces).
const rows = execSync('ps -axo pid=,ppid=,pcpu=,command=', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) return null;
    return { pid: +m[1], ppid: +m[2], cpu: parseFloat(m[3]), command: m[4] };
  })
  .filter(Boolean);

const byPid = new Map(rows.map((p) => [p.pid, p]));
// Match only real invocations — the leaf (`.bin/circuit-electron`) and the npm
// wrapper (`@snowfort/circuit-electron`) always have a slash before the name.
// Requiring that slash avoids matching a shell that merely echoes the string.
const isCircuit = (p) => p && /\/circuit-electron/.test(p.command);
const circuit = rows.filter(isCircuit);

// An orphan's parent chain is circuit-only until it hits init (pid 1).
// Reaching a live non-circuit ancestor (a claude client, peer agent, shell)
// means it's still attached to something → spare it.
function isOrphan(proc) {
  let cur = proc;
  while (true) {
    if (cur.ppid === 1) return true;            // circuit-only chain rooted at launchd
    const parent = byPid.get(cur.ppid);
    if (!isCircuit(parent)) return false;       // attached to a live non-circuit parent
    cur = parent;                               // parent is also circuit → keep climbing
  }
}

const orphans = circuit.filter(isOrphan);
const live = circuit.length - orphans.length;

if (orphans.length === 0) {
  console.log(
    circuit.length === 0
      ? 'Circuit Electron: none running. Nothing to reap.'
      : `Circuit Electron: ${circuit.length} running, all attached to live clients. Nothing to reap.`
  );
  process.exit(0);
}

const totalCpu = orphans.reduce((s, p) => s + (p.cpu || 0), 0).toFixed(1);
console.log(
  `Circuit Electron: ${circuit.length} running — ${live} live, ${orphans.length} orphaned ` +
  `(${totalCpu}% CPU)${dryRun ? ' [dry-run]' : ''}`
);

for (const p of orphans) {
  const tag = p.cpu > 50 ? ` ⚠ ${p.cpu}% CPU` : '';
  if (dryRun) {
    console.log(`  would reap pid ${p.pid} (ppid ${p.ppid})${tag}`);
  } else {
    try {
      process.kill(p.pid, 'SIGKILL');
      console.log(`  reaped pid ${p.pid} (ppid ${p.ppid})${tag}`);
    } catch (err) {
      if (err.code !== 'ESRCH') console.log(`  pid ${p.pid}: ${err.message}`);
    }
  }
}
