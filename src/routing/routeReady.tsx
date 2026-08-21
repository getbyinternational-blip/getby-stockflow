import React, { createContext, useContext } from 'react';

export type RouteReadyDetail = Record<string, unknown>;

export type RouteReadyContextValue = {
  routePath: string;
  routeLabel: string;
  transitionId: number | null;
  shellPainted: boolean;
  isRouteActive: boolean;
  pageInstanceId: string;
};

const RouteReadyContext = createContext<RouteReadyContextValue | null>(null);

export const RouteReadyProvider = RouteReadyContext.Provider;

export const useRouteReady = () => useContext(RouteReadyContext);
