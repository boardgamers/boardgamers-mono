import page from "page";
import type { SvelteComponent } from "svelte";
import { writable } from "svelte/store";

export type RouteTarget =
  | string
  | {
      name: string;
      query?: Record<string, string>;
      params?: Record<string, string>;
    };

/**
 * Middleware called before reaching target route
 *
 * @param route The target route
 * @returns `undefined` to continue routing, `RouteTarget` to go to a new destination
 */
export type RouteGuard = (route: Route) => Promise<void | RouteTarget> | void | RouteTarget;

export type RouteConfig = {
  path: string;
  component?: typeof SvelteComponent;
  redirect?: string;
  /**
   * Used to identify the route easily and navigate to it
   */
  name?: string;
  /**
   * Meta data that you will have access to in callbacks or in current route
   */
  meta?: Record<string, any>;
  guard?: RouteGuard;
  /**
   * Props passed to the svelte component. By default it's route.params,
   * but you can use a function instead to generate them
   */
  props?: (route: Route) => Record<string, any>;
};

export type RouterConfig = {
  routes: RouteConfig[];
  globalGuard?: RouteGuard;
};

export type Route = {
  component?: typeof SvelteComponent;
  query: Record<string, string>;
  meta: Record<string, any>;
  name?: string;
} & PageJS.Context;

/**
 * Store containing the current route, or null
 */
export const route = writable<Route | null>(null);

export function navigate(to: RouteTarget, replace = false) {
  if (replace) {
    page.redirect(routePath(to));
  } else {
    page(routePath(to));
  }
}

export function routePath(to: RouteTarget) {
  if (typeof to === "string") {
    return to;
  }
  const route = routes.find((r) => r.name === to.name);

  if (!route) {
    throw new Error(`Impossible to find route with name ${to.name}`);
  }

  let path = route.path;

  if (to.params) {
    path = route.path.replace(/:([A-Za-z-_]+)[^/]+/g, (match: string, capture: string) => {
      if (capture in to.params!) {
        return to.params![capture];
      }
      return match;
    });
  }

  if (to.query) {
    const queryString = new URLSearchParams(to.query).toString();
    if (queryString) {
      path += "?" + queryString;
    }
  }

  return path;
}

let routes: RouteConfig[];

/**
 * Initialize the router
 *
 * @param config
 */
export function createRouter(config: RouterConfig) {
  if (routes) {
    throw new Error("Router already initialized");
  }
  routes = config.routes;

  const augment = (ctx: PageJS.Context, config: RouteConfig) =>
    Object.assign(ctx, {
      component: config.component,
      meta: config.meta ?? {},
      name: config.name,
      props: config.props,
      query: ctx.querystring ? parseQuery(ctx.querystring) : {},
    });

  const handleGuard: (guard: RouteGuard, config: RouteConfig) => PageJS.Callback = (guard, config) => async (
    ctx,
    next
  ) => {
    const res = await guard(augment(ctx, config));

    if (res === undefined) {
      next();
    } else {
      navigate(res, true);
    }
  };

  for (const routeConfig of config.routes) {
    if (routeConfig.redirect) {
      page(routeConfig.path, routeConfig.redirect);
      return;
    }

    const callbacks: PageJS.Callback[] = [];

    if (config.globalGuard) {
      callbacks.push(handleGuard(config.globalGuard, routeConfig));
    }

    if (routeConfig.guard) {
      callbacks.push(handleGuard(routeConfig.guard, routeConfig));
    }

    callbacks.push((ctx) => route.set(augment(ctx, routeConfig)));

    page(routeConfig.path, ...callbacks);
  }

  page();
}

function parseQuery(queryString: string) {
  return Object.fromEntries(new URLSearchParams(queryString).entries());
}
