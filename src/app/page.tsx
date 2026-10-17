'use client';

/**
 * ExamHub Phase 1 — Interactive Prototype (single-page application).
 * All screens live under this entry with a hash-based internal router
 * because the preview environment exposes only "/".
 */
import * as React from 'react';
import { useDemoStore } from '@/lib/prototype/store';
import { Toaster } from '@/components/ui/sonner';

// Standalone screens
import { LoginScreen } from '@/components/prototype/screens/LoginScreen';
import { OnboardingScreen } from '@/components/prototype/screens/OnboardingScreen';
import { PracticeHub, PracticeSessionScreen } from '@/components/prototype/screens/PracticeScreens';
import { ExamRunner } from '@/components/prototype/screens/ExamRunner';

// Shell + app screens
import { AppShell } from '@/components/prototype/shell/AppShell';
import { DemoDock } from '@/components/prototype/shell/DemoDock';
import { DashboardRouter } from '@/components/prototype/screens/Dashboards';
import { ScreenRouter } from '@/components/prototype/screens/ScreenRouter';
import { WalkthroughDrawer } from '@/components/prototype/screens/Walkthrough';
import { GraduationCap } from 'lucide-react';

const subscribeToClientMount = () => () => {};

/**
 * Keep the server snapshot stable during hydration, then expose the browser
 * snapshot without an effect-driven state update.
 */
function useClientMounted() {
  return React.useSyncExternalStore(subscribeToClientMount, () => true, () => false);
}

export default function Home() {
  const store = useDemoStore();
  const route = store.route;
  const session = store.session;
  const path = route.path;

  // The entire app is driven by per-device localStorage state and relative
  // timestamps, so server-rendered content can never match the client's first
  // render (e.g. "17 hrs ago" vs "18 hrs ago"). Render a neutral shell on the
  // server and mount the real UI only on the client.
  const mounted = useClientMounted();

  // debug/demo hook (also documented in README for support engineers)
  React.useEffect(() => {
    (window as unknown as { __examhub: unknown }).__examhub = useDemoStore;
  }, []);

  // global tick engine — advances transfers + exam timer
  React.useEffect(() => {
    const iv = setInterval(() => {
      useDemoStore.getState().tick();
    }, 900);
    return () => clearInterval(iv);
  }, []);

  React.useEffect(() => {
    if (!store.hydrated) store.syncFromHash();
  }, [store.hydrated]);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <GraduationCap className="h-4 w-4 animate-pulse" /> Loading ExamHub…
        </p>
      </div>
    );
  }

  // fullscreen exam route
  if (path === '/exam') {
    return (
      <>
        <ExamRunner />
        <Toaster richColors position="bottom-right" />
      </>
    );
  }

  // standalone routes — the login page is the product's entry point
  let screen: React.ReactNode;
  switch (true) {
    case path === '/':
    case path === '/login':
      screen = <LoginScreen />;
      break;
    case path === '/onboarding':
      screen = <OnboardingScreen />;
      break;
    case path === '/practice' || path.startsWith('/practice/'):
      screen = <PracticeRouter />;
      break;
    case path.startsWith('/app'):
      screen = (
        <RequireSession>
          <AppShell>
            {path === '/app/dashboard' ? <DashboardRouter /> : <ScreenRouter />}
          </AppShell>
          <WalkthroughDrawer />
        </RequireSession>
      );
      break;
    default:
      screen = <LoginScreen />;
  }

  return (
    <>
      {screen}
      <DemoDock />
      <Toaster richColors position="bottom-right" />
    </>
  );
}

function RequireSession({ children }: { children: React.ReactNode }) {
  const store = useDemoStore();
  const hasSession = !!store.session;
  React.useEffect(() => {
    if (!hasSession) store.navigate('/login');
  }, [hasSession]);
  if (!hasSession) return null;
  return <>{children}</>;
}

function PracticeRouter() {
  const store = useDemoStore();
  const path = store.route.path;
  if (path === '/practice/session') return <PracticeSessionScreen />;
  return <PracticeHub />;
}
