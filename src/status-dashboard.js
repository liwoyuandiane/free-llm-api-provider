/**
 * Status Dashboard - Real-time provider health monitor
 * 
 * Displays a live updating table similar to free-coding-models.
 * Shows provider status, latency, quota, and health scores.
 */

const readline = require('readline');
const { getHealthState, getHealthyProviders, runHealthCheck } = require('./health-checker');
const { loadConfig } = require('./config');
const { sources } = require('./models');

// ANSI colors
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BG_RED = '\x1b[41m';
const BG_GREEN = '\x1b[42m';
const BG_YELLOW = '\x1b[43m';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';

const STATUS_ICONS = {
  up: GREEN + '🟢' + RESET,
  auth_error: YELLOW + '🟡' + RESET,
  rate_limited: YELLOW + '⚠️' + RESET,
  timeout: RED + '⏳' + RESET,
  offline: RED + '🔴' + RESET,
  error: RED + '❌' + RESET,
  unknown: DIM + '⚪' + RESET,
  no_endpoint: DIM + '⚫' + RESET,
};

function formatLatency(ms) {
  if (ms < 0 || ms === Infinity) return '--';
  if (ms < 500) return GREEN + `${ms}ms` + RESET;
  if (ms < 1500) return YELLOW + `${ms}ms` + RESET;
  return RED + `${ms}ms` + RESET;
}

function formatScore(score) {
  if (score >= 80) return GREEN + score + RESET;
  if (score >= 50) return YELLOW + score + RESET;
  return RED + score + RESET;
}

function formatQuota(pct) {
  if (pct === null || pct === undefined) return DIM + '--' + RESET;
  if (pct >= 70) return GREEN + `${pct}%` + RESET;
  if (pct >= 30) return YELLOW + `${pct}%` + RESET;
  return RED + `${pct}%` + RESET;
}

function formatStatus(status) {
  return STATUS_ICONS[status] || STATUS_ICONS.unknown;
}

function drawLine(width) {
  return '─'.repeat(width);
}

function renderDashboard() {
  const health = getHealthState();
  const providers = getHealthyProviders();
  const config = loadConfig();
  
  let output = CLEAR_SCREEN;
  
  // Header
  output += `${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════════════════╗${RESET}\n`;
  output += `${BOLD}${CYAN}║${RESET}  ${BOLD}free-llm-api-provider - Real-time Provider Health${RESET}                      ${CYAN}║${RESET}\n`;
  output += `${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════════════════╝${RESET}\n\n`;
  
  // Legend
  output += `${DIM}Legend:${RESET} ${GREEN}🟢 Up${RESET}  ${YELLOW}🟡 Auth Error${RESET}  ${YELLOW}⚠️ Rate Limited${RESET}  ${RED}⏳ Timeout${RESET}  ${RED}🔴 Offline${RESET}  ${DIM}⚪ Unknown${RESET}\n`;
  output += `${DIM}Press 'r' to refresh, 'q' to quit${RESET}\n\n`;
  
  // Table header
  const colProvider = 18;
  const colStatus = 10;
  const colLatency = 12;
  const colQuota = 10;
  const colScore = 8;
  const colModel = 28;
  const colKeys = 8;
  
  output += `${BOLD}${CYAN}┌${drawLine(colProvider)}┬${drawLine(colStatus)}┬${drawLine(colLatency)}┬${drawLine(colQuota)}┬${drawLine(colScore)}┬${drawLine(colModel)}┬${drawLine(colKeys)}┐${RESET}\n`;
  output += `${BOLD}${CYAN}│${RESET} ${BOLD}Provider${' '.repeat(colProvider - 9)}${CYAN}│${RESET} ${BOLD}Status${' '.repeat(colStatus - 7)}${CYAN}│${RESET} ${BOLD}Latency${' '.repeat(colLatency - 8)}${CYAN}│${RESET} ${BOLD}Quota${' '.repeat(colQuota - 6)}${CYAN}│${RESET} ${BOLD}Score${' '.repeat(colScore - 6)}${CYAN}│${RESET} ${BOLD}Best Model${' '.repeat(colModel - 11)}${CYAN}│${RESET} ${BOLD}Keys${' '.repeat(colKeys - 5)}${CYAN}│${RESET}\n`;
  output += `${BOLD}${CYAN}├${drawLine(colProvider)}┼${drawLine(colStatus)}┼${drawLine(colLatency)}┼${drawLine(colQuota)}┼${drawLine(colScore)}┼${drawLine(colModel)}┼${drawLine(colKeys)}┤${RESET}\n`;
  
  if (providers.length === 0) {
    output += `${CYAN}│${RESET} ${DIM}No providers configured...${' '.repeat(colProvider - 27)}${CYAN}│${RESET}${' '.repeat(colStatus)}${CYAN}│${RESET}${' '.repeat(colLatency)}${CYAN}│${RESET}${' '.repeat(colQuota)}${CYAN}│${RESET}${' '.repeat(colScore)}${CYAN}│${RESET}${' '.repeat(colModel)}${CYAN}│${RESET}${' '.repeat(colKeys)}${CYAN}│${RESET}\n`;
  } else {
    for (const p of providers) {
      const provider = sources[p.key];
      const name = provider ? provider.name : p.key;
      const nameStr = name.length > colProvider - 2 ? name.substring(0, colProvider - 5) + '...' : name;
      const modelStr = p.bestModel && p.bestModel.length > colModel - 2 ? p.bestModel.substring(0, colModel - 5) + '...' : (p.bestModel || 'Unknown');
      
      output += `${CYAN}│${RESET} ${nameStr}${' '.repeat(Math.max(1, colProvider - nameStr.length - 1))}`;
      output += `${CYAN}│${RESET} ${formatStatus(p.status)}${' '.repeat(Math.max(1, colStatus - 3))}`;
      output += `${CYAN}│${RESET} ${formatLatency(p.avgLatency)}${' '.repeat(Math.max(1, colLatency - String(Math.round(p.avgLatency > 0 ? p.avgLatency : 0)).length - 3))}`;
      output += `${CYAN}│${RESET} ${formatQuota(p.quota)}${' '.repeat(Math.max(1, colQuota - (p.quota !== null ? String(p.quota).length + 2 : 3)))}`;
      output += `${CYAN}│${RESET} ${formatScore(p.score)}${' '.repeat(Math.max(1, colScore - String(p.score).length - 1))}`;
      output += `${CYAN}│${RESET} ${modelStr}${' '.repeat(Math.max(1, colModel - modelStr.length - 1))}`;
      output += `${CYAN}│${RESET} ${p.keys}${' '.repeat(Math.max(1, colKeys - String(p.keys).length - 1))}`;
      output += `${CYAN}│${RESET}\n`;
    }
  }
  
  output += `${BOLD}${CYAN}└${drawLine(colProvider)}┴${drawLine(colStatus)}┴${drawLine(colLatency)}┴${drawLine(colQuota)}┴${drawLine(colScore)}┴${drawLine(colModel)}┴${drawLine(colKeys)}┘${RESET}\n`;
  
  // Summary
  const upCount = providers.filter(p => p.status === 'up').length;
  const downCount = providers.filter(p => p.status === 'offline' || p.status === 'timeout' || p.status === 'error').length;
  const total = providers.length;
  
  output += `\n${BOLD}Summary:${RESET} ${GREEN}${upCount} up${RESET} / ${RED}${downCount} down${RESET} / ${total} total providers\n`;
  output += `${DIM}Last updated: ${new Date().toLocaleTimeString()}${RESET}\n`;
  
  process.stdout.write(output);
}

async function startDashboard() {
  console.log('Starting real-time health dashboard...');
  console.log('Press "r" to force refresh, "q" to quit.\n');
  
  const config = loadConfig();
  
  // Initial ping
  await runHealthCheck(config);
  renderDashboard();
  
  // Auto-refresh every 10 seconds
  const refreshInterval = setInterval(async () => {
    await runHealthCheck(config);
    renderDashboard();
  }, 10000);
  
  // Key handler
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  
  process.stdin.on('keypress', async (str, key) => {
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      clearInterval(refreshInterval);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      console.log('\nDashboard stopped.');
      process.exit(0);
    } else if (key.name === 'r') {
      await runHealthCheck(config);
      renderDashboard();
    }
  });
  
  // Keep process alive
  await new Promise(() => {});
}

module.exports = {
  startDashboard,
  renderDashboard,
};
