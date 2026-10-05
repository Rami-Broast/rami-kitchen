import React, { useState } from 'react';

import { AuthProvider, useAuth } from './auth/AuthProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PosView, Shell } from './components/ui';
import { LangProvider } from './i18n/LangProvider';
import { DeliveriesScreen } from './screens/DeliveriesScreen';
import { LoginScreen } from './screens/LoginScreen';
import { LookupScreen } from './screens/LookupScreen';
import { MenuAvailabilityScreen } from './screens/MenuAvailabilityScreen';
import { NewOrderScreen } from './screens/NewOrderScreen';
import { PosBoard } from './screens/PosBoard';
import { ReportsScreen } from './screens/ReportsScreen';
import { ReceiptScreen } from './screens/ReceiptScreen';
import { RealtimeProvider } from './realtime/RealtimeProvider';
import { PrinterSettings } from './screens/PrinterSettings';

function Authed(): React.JSX.Element {
  const [view, setView] = useState<PosView>('board');
  return (
    <Shell view={view} onNavigate={setView}>
      {/* Keyed on the view so switching tabs clears a tripped boundary, and
          placed inside the Shell so a broken screen still leaves the nav and
          the branch banner usable. */}
      <ErrorBoundary key={view} onReset={() => setView('board')}>
        {view === 'board' ? <PosBoard /> : null}
        {view === 'new' ? <NewOrderScreen onPlaced={() => setView('board')} /> : null}
        {view === 'lookup' ? <LookupScreen /> : null}
        {view === 'menu' ? <MenuAvailabilityScreen /> : null}
        {view === 'deliveries' ? <DeliveriesScreen /> : null}
        {view === 'reports' ? <ReportsScreen /> : null}
        {view === 'receipt' ? <ReceiptScreen /> : null}
        {view === 'settings' ? <PrinterSettings onClose={() => setView('board')} /> : null}
      </ErrorBoundary>
    </Shell>
  );
}

function Root(): React.JSX.Element {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Authed /> : <LoginScreen />;
}

export function App(): React.JSX.Element {
  return (
    <LangProvider>
      <AuthProvider>
        {/* Inside AuthProvider: the socket authenticates with the signed-in
            branch's token and is torn down on sign-out. */}
        <RealtimeProvider>
          <Root />
        </RealtimeProvider>
      </AuthProvider>
    </LangProvider>
  );
}
