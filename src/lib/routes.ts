import { useCallback, useEffect, useState } from 'react';

// Every page has its own address in the URL hash (#/albums/<id>, #/people/<id>, ...), so the
// browser's back/forward buttons move between pages, a refresh stays on the same page, and an
// album can be bookmarked. Hash-based so it works on any static host with no server setup.
export type Route =
  | { page: 'landing' }
  | { page: 'sort' }
  | { page: 'albums' }
  | { page: 'album'; albumId: string }
  | { page: 'all-kept' }
  | { page: 'first-year'; slot: string | null } // slot: a month key ("m0".."m11", "birthday") or "all"
  | { page: 'people' }
  | { page: 'person'; personId: string };

export function parseHash(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((p) => decodeURIComponent(p));
  const [first, second, third] = parts;
  switch (first) {
    case 'sort':
      return { page: 'sort' };
    case 'albums':
      if (!second) return { page: 'albums' };
      if (second === 'all-kept') return { page: 'all-kept' };
      if (second === 'first-year') return { page: 'first-year', slot: third ?? null };
      return { page: 'album', albumId: second };
    case 'people':
      return second ? { page: 'person', personId: second } : { page: 'people' };
    default:
      return { page: 'landing' };
  }
}

export function routeHref(route: Route): string {
  switch (route.page) {
    case 'landing':
      return '#/';
    case 'sort':
      return '#/sort';
    case 'albums':
      return '#/albums';
    case 'album':
      return `#/albums/${encodeURIComponent(route.albumId)}`;
    case 'all-kept':
      return '#/albums/all-kept';
    case 'first-year':
      return route.slot ? `#/albums/first-year/${encodeURIComponent(route.slot)}` : '#/albums/first-year';
    case 'people':
      return '#/people';
    case 'person':
      return `#/people/${encodeURIComponent(route.personId)}`;
  }
}

// The top-level tab a page belongs to — used to highlight the right item in the header.
export function tabOf(route: Route): 'sort' | 'albums' | 'people' | null {
  switch (route.page) {
    case 'sort':
      return 'sort';
    case 'albums':
    case 'album':
    case 'all-kept':
    case 'first-year':
      return 'albums';
    case 'people':
    case 'person':
      return 'people';
    default:
      return null;
  }
}

export function navigate(route: Route, { replace = false }: { replace?: boolean } = {}) {
  const href = routeHref(route);
  if (window.location.hash === href) return;
  if (replace) {
    window.history.replaceState(null, '', href);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = href;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const sync = useCallback(() => {
    setRoute(parseHash(window.location.hash));
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [sync]);
  return route;
}
