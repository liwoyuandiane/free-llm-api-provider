/**
 * Status Dashboard - Real-time provider health monitor
 * 
 * Displays a live updating table similar to free-coding-models.
 * Shows provider status, latency, quota, and health scores.
 */

const readline = require('readline');
const { getHealthyProviders, runHealthCheck } = require('./health-checker');
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

/**
 * Windows 终端对 emoji 支持不完整，返回用 ASCII 替代图标
 */
function getStatusIcons() {
  const isWindows = process.platform === 'win32';
  return {
    up: GREEN + (isWindows ? '[OK]' : '🟢') + RESET,
    auth_error: YELLOW + (isWindows ? '[AU]' : '🟡') + RESET,
    rate_limited: YELLOW + (isWindows ? '[RL]' : '⚠️') + RESET,
    timeout: RED + (isWindows ? '[TO]' : '⏳') + RESET,
    offline: RED + (isWindows ? '[--]' : '🔴') + RESET,
    error: RED + (isWindows ? '[ER]' : '❌') + RESET,
    unknown: DIM + (isWindows ? '[??]' : '⚪') + RESET,
    no_endpoint: DIM + (isWindows ? '[--]' : '⚫') + RESET,
  };
}

function formatLatency(ms) {
  if (ms < 0 || ms === Infinity || ms === undefined || ms === null) return '--';
  if (ms < 500) return GREEN + `${Math.round(ms)}ms` + RESET;
  if (ms < 1500) return YELLOW + `${Math.round(ms)}ms` + RESET;
  return RED + `${Math.round(ms)}ms` + RESET;
}

function formatScore(score) {
  if (typeof score !== 'number') return DIM + '--' + RESET;
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
  const icons = getStatusIcons();
  return icons[status] || icons.unknown;
}

function drawLine(width) {
  return '─'.repeat(width);
}

function renderDashboard() {
  const providers = getHealthyProviders();
  const config = loadConfig();
  const icons = getStatusIcons();
  
  let output = CLEAR_SCREEN;
  
  // Header
  output += `${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════════════════╗${RESET}\n`;
  output += `${BOLD}${CYAN}║${RESET}  ${BOLD}free-llm-api-provider - Real-time Provider Health${RESET}                      ${CYAN}║${RESET}\n`;
  output += `${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════════════════╝${RESET}\n\n`;
  
  // Legend
  output += `${DIM}Legend:${RESET} ${icons.up} Up${RESET}  ${icons.auth_error} Auth Err${RESET}  ${icons.rate_limited} Rate Limit${RESET}  ${icons.timeout} Timeout${RESET}  ${icons.offline} Offline${RESET}  ${icons.unknown} Unknown${RESET}\n`;
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
      output += `${CYAN}│${RESET} ${icons[p.status] || icons.unknown}${' '.repeat(Math.max(1, colStatus - 3))}`;
      output += `${CYAN}│${RESET} ${formatLatency(p.avgLatency)}${' '.repeat(Math.max(1, colLatency - 8))}`;
      output += `${CYAN}│${RESET} ${formatQuota(p.quota)}${' '.repeat(Math.max(1, colQuota - 4))}`;
      output += `${CYAN}│${RESET} ${formatScore(p.score)}${' '.repeat(Math.max(1, colScore - 3))}`;
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
  
  // 安全启用原始模式（Windows Git Bash 等可能不支持）
  try {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
  } catch (e) {
    console.log('[Dashboard] Raw mode not available, keyboard input disabled');
  }
  
  process.stdin.on('keypress', async (str, key) => {
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      clearInterval(refreshInterval);
      try {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
      } catch {}
      process.stdin.pause();
      rl.close();
      console.log('\nDashboard stopped.');
      resolvePromise();
    } else if (key.name === 'r') {
      await runHealthCheck(config);
      renderDashboard();
    }
  });
  
  // 使用 Promise 让调用者可以等待 dashboard 停止
  let resolvePromise;
  return new Promise((resolve) => {
    resolvePromise = resolve;
  });
}

module.exports = {
  startDashboard,
  renderDashboard,
};
