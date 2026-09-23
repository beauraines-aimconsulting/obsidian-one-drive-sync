import type { RouteContext, RouteHandler } from './types.js';

interface RouteDefinition {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

export interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
}

export class Router {
  private readonly routes: RouteDefinition[] = [];

  add(method: string, pattern: string, handler: RouteHandler): void {
    this.routes.push({
      method: method.toUpperCase(),
      segments: this.split(pattern),
      handler,
    });
  }

  match(method: string, pathname: string): RouteMatch | undefined {
    const normalizedMethod = method.toUpperCase();
    const pathSegments = this.split(pathname);

    for (const route of this.routes) {
      if (route.method !== normalizedMethod || route.segments.length !== pathSegments.length) {
        continue;
      }

      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const routeSegment = route.segments[index];
        const pathSegment = pathSegments[index];
        if (routeSegment.startsWith(':')) {
          params[routeSegment.slice(1)] = decodeURIComponent(pathSegment);
          continue;
        }
        if (routeSegment !== pathSegment) {
          matched = false;
          break;
        }
      }

      if (matched) {
        return { handler: route.handler, params };
      }
    }

    return undefined;
  }

  async handle(
    match: RouteMatch,
    context: RouteContext,
    request: Parameters<RouteHandler>[0],
    response: Parameters<RouteHandler>[1]
  ): Promise<void> {
    await match.handler(request, response, context);
  }

  private split(pathname: string): string[] {
    if (pathname === '/') return [];
    return pathname.replace(/^\/+|\/+$/g, '').split('/');
  }
}
