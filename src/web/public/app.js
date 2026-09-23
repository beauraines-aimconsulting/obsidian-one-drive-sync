import { fetchJson, sendJson, withStoredToken } from './api.js';

const LIVE_LOG_BOTTOM_THRESHOLD_PX = 24;

const state = {
  status: null,
  currentRunId: null,
  currentRun: null,
  logs: [],
  eventSource: null,
};

const elements = {
  readOnlyNotice: document.getElementById('read-only-notice'),
  watcherActive: document.getElementById('watcher-active'),
  watcherLastFile: document.getElementById('watcher-last-file'),
  syncEnabled: document.getElementById('sync-enabled'),
  syncTrackedFiles: document.getElementById('sync-tracked-files'),
  syncLastSync: document.getElementById('sync-last-sync'),
  syncTotalBytes: document.getElementById('sync-total-bytes'),
  scheduleEnabled: document.getElementById('schedule-enabled'),
  scheduleNextRun: document.getElementById('schedule-next-run'),
  scheduleLastOutcome: document.getElementById('schedule-last-outcome'),
  scheduleLastSummary: document.getElementById('schedule-last-summary'),
  syncButton: document.getElementById('sync-button'),
  syncDryRun: document.getElementById('sync-dry-run'),
  syncStatus: document.getElementById('sync-status'),
  syncModeHint: document.getElementById('sync-mode-hint'),
  liveLogOutput: document.getElementById('live-log-output'),
  liveLogMeta: document.getElementById('live-log-meta'),
  refreshButton: document.getElementById('refresh-button'),
};

function formatDateTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function renderValue(element, value) {
  if (element) element.textContent = value;
}

function setStatusMessage(message, className = 'muted') {
  if (!elements.syncStatus) return;
  elements.syncStatus.className = `status-message ${className}`.trim();
  elements.syncStatus.textContent = message;
}

function appendLogLine(line) {
  if (!line) return;
  state.logs.push(line);
  if (state.logs.length > 500) {
    state.logs.splice(0, state.logs.length - 500);
  }
}

function renderLogs() {
  if (!elements.liveLogOutput) return;
  const previousScrollTop = elements.liveLogOutput.scrollTop;
  const shouldFollowLog =
    elements.liveLogOutput.scrollHeight -
      elements.liveLogOutput.scrollTop -
      elements.liveLogOutput.clientHeight <=
    LIVE_LOG_BOTTOM_THRESHOLD_PX;

  elements.liveLogOutput.textContent =
    state.logs.length > 0 ? state.logs.join('\n') : 'Waiting for sync events…';
  elements.liveLogOutput.scrollTop = shouldFollowLog
    ? elements.liveLogOutput.scrollHeight
    : previousScrollTop;

  if (elements.liveLogMeta) {
    const run = state.currentRun;
    elements.liveLogMeta.textContent = run
      ? `${run.status.toUpperCase()} • ${run.dryRun ? 'dry run' : 'live sync'}${run.force ? ' • force' : ''}`
      : 'Live tail of sync progress, schedule runs, and rules updates.';
  }
}

function renderStatus() {
  const status = state.status;
  if (!status) return;

  renderValue(elements.watcherActive, status.watcherActive ? 'Watching' : 'Stopped');
  renderValue(elements.watcherLastFile, formatDateTime(status.lastFileProcessedAt));
  renderValue(elements.syncEnabled, status.sync?.enabled ? 'Enabled' : 'Disabled');
  renderValue(elements.syncTrackedFiles, String(status.sync?.trackedFileCount ?? 0));
  renderValue(elements.syncLastSync, formatDateTime(status.sync?.lastSyncAt ?? null));
  renderValue(elements.syncTotalBytes, formatBytes(status.sync?.totalBytes ?? 0));

  if (status.schedule) {
    renderValue(elements.scheduleEnabled, 'Enabled');
    renderValue(elements.scheduleNextRun, formatDateTime(status.schedule.nextRunAt ?? null));
    renderValue(
      elements.scheduleLastOutcome,
      status.schedule.lastRun
        ? `${status.schedule.lastRun.status} at ${formatDateTime(status.schedule.lastRun.finishedAt ?? status.schedule.lastRun.startedAt)}`
        : 'No runs yet'
    );
    renderValue(
      elements.scheduleLastSummary,
      status.schedule.lastRun
        ? `uploaded ${status.schedule.lastRun.uploaded ?? 0}, skipped ${status.schedule.lastRun.skipped ?? 0}, removed ${status.schedule.lastRun.removed ?? 0}, failed ${status.schedule.lastRun.failed ?? 0}`
        : 'Waiting for the first scheduled run.'
    );
  } else {
    renderValue(elements.scheduleEnabled, 'Disabled');
    renderValue(elements.scheduleNextRun, 'Not configured');
    renderValue(elements.scheduleLastOutcome, 'Not configured');
    renderValue(elements.scheduleLastSummary, 'Start the app with a schedule to see cadence and last outcome.');
  }

  if (elements.readOnlyNotice) {
    elements.readOnlyNotice.classList.toggle('hidden', !status.readOnly);
  }

  if (elements.syncModeHint) {
    if (!status.sync?.enabled) {
      elements.syncModeHint.textContent = 'Start the app with --sync to enable uploads and dry-run previews from the UI.';
    } else if (status.readOnly) {
      elements.syncModeHint.textContent = 'Read-only mode blocks sync triggers and rules saves.';
    } else {
      elements.syncModeHint.textContent = elements.syncDryRun?.checked
        ? 'Dry run previews uploads and removals without changing OneDrive.'
        : 'Live sync uploads changes and removes stale files in OneDrive.';
    }
  }

  if (elements.syncButton) {
    elements.syncButton.disabled = Boolean(status.readOnly) || !status.sync?.enabled;
  }
}

async function fetchStatus() {
  const { response, payload } = await fetchJson('/api/status');
  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }
  state.status = payload;
  renderStatus();
}

async function fetchRun(runId) {
  const { response, payload } = await fetchJson(`/api/sync/${encodeURIComponent(runId)}`);
  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  state.currentRunId = runId;
  state.currentRun = payload;
  state.logs = Array.isArray(payload.logs) ? [...payload.logs] : [];

  renderLogs();

  if (payload.status === 'running') {
    setStatusMessage(
      `${payload.dryRun ? 'Dry run' : 'Sync'} started at ${formatDateTime(payload.startedAt)}`,
      'status-warning'
    );
  } else if (payload.status === 'failed') {
    setStatusMessage(payload.error ?? 'Sync failed', 'status-error');
  } else {
    const summary = payload.summary;
    const summaryText = summary
      ? `uploaded ${summary.uploaded}, skipped ${summary.skipped}, removed ${summary.removed}, failed ${summary.failed}`
      : payload.status;
    setStatusMessage(
      `${payload.dryRun ? 'Dry run' : 'Sync'} ${payload.status}: ${summaryText}`,
      payload.status === 'partial' ? 'status-warning' : 'status-success'
    );
  }
}

async function triggerSync() {
  if (!elements.syncDryRun) return;

  try {
    if (elements.syncButton) elements.syncButton.disabled = true;
    setStatusMessage(
      elements.syncDryRun.checked ? 'Starting dry run…' : 'Starting sync…',
      'status-warning'
    );
    const { response, payload } = await sendJson('/api/sync', 'POST', {
      dryRun: elements.syncDryRun.checked,
    });
    if (!response.ok) {
      setStatusMessage(payload?.error ?? `Request failed with ${response.status}`, 'status-error');
      renderStatus();
      return;
    }

    state.logs = [];
    await fetchRun(payload.runId);
  } catch (error) {
    setStatusMessage(error instanceof Error ? error.message : String(error), 'status-error');
    renderStatus();
  }
}

function connectEvents() {
  const url = withStoredToken('/api/events');
  const source = new EventSource(url);
  state.eventSource = source;

  source.addEventListener('sync-progress', (event) => {
    const payload = JSON.parse(event.data);
    if (!state.currentRunId || state.currentRunId === payload.runId) {
      state.currentRunId = payload.runId;
      appendLogLine(payload.message);
      renderLogs();
    }
  });

  source.addEventListener('sync-complete', (event) => {
    const payload = JSON.parse(event.data);
    const runId = payload?.run?.runId;
    if (runId) {
      void fetchRun(runId);
    }
    void fetchStatus();
  });

  source.addEventListener('schedule-run', () => {
    void fetchStatus();
  });

  source.addEventListener('rules-updated', () => {
    appendLogLine('Rules updated and reloaded.');
    renderLogs();
  });

  source.addEventListener('file-evaluated', (event) => {
    const payload = JSON.parse(event.data);
    appendLogLine(`📄 ${payload.filepath}: ${payload.action}`);
    renderLogs();
  });

  source.onerror = () => {
    setStatusMessage('Live updates disconnected; retrying…', 'status-warning');
  };
}

function bindEvents() {
  elements.syncButton?.addEventListener('click', () => {
    void triggerSync();
  });
  elements.syncDryRun?.addEventListener('change', () => {
    renderStatus();
  });
  elements.refreshButton?.addEventListener('click', () => {
    void fetchStatus();
  });
}

async function initialize() {
  bindEvents();
  try {
    await fetchStatus();
    connectEvents();
    renderLogs();
  } catch (error) {
    setStatusMessage(error instanceof Error ? error.message : String(error), 'status-error');
    renderLogs();
  }
}

void initialize();
