import type { ServerResponse } from 'http';
import type { WebEvent } from '../events.js';
import { sendApiError } from '../security.js';
import type { RouteHandler } from '../types.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

function writeEvent(response: ServerResponse, event: WebEvent): void {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

export const getEvents: RouteHandler = async (request, response, context) => {
  const events = context.options.events;
  if (!events) {
    sendApiError(response, 503, 'Live events are not available');
    return;
  }

  const listener = (event: WebEvent) => {
    writeEvent(response, event);
  };

  if (!events.subscribe(listener)) {
    sendApiError(response, 503, 'Too many event stream clients are connected');
    return;
  }

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  response.write(': connected\n\n');

  const heartbeat = globalThis.setInterval(() => {
    response.write(': heartbeat\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  const cleanup = () => {
    globalThis.clearInterval(heartbeat);
    events.unsubscribe(listener);
  };

  request.on('close', cleanup);
  response.on('close', cleanup);
};
