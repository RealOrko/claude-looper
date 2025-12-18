import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import StepsPanel from './components/StepsPanel';
import LogsPanel from './components/LogsPanel';
import MetricsPanel from './components/MetricsPanel';
import GoalProgress from './components/GoalProgress';
import AgentStatusPanel from './components/AgentStatusPanel';
import StatusBanner from './components/StatusBanner';
import ErrorBoundary, { SectionErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider, useToast } from './components/Toast';
import { ThemeProvider, ThemeToggle } from './components/ThemeProvider';
import { ConnectionStatus } from './components/Loading';

// Inner App component that can use hooks
function AppContent() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const { state, connected, error, reconnect, reconnecting } = useWebSocket();
  const toast = useToast();

  // Show toast notifications for important events
  const prevStatus = React.useRef(state.status);
  useEffect(() => {
    if (prevStatus.current !== state.status) {
      if (state.status === 'completed') {
        toast.success('Goal completed successfully!', { title: 'Success' });
      } else if (state.status === 'failed') {
        toast.error('Goal execution failed', { title: 'Failed' });
      } else if (state.status === 'executing' && prevStatus.current === 'planning') {
        toast.info('Execution started', { duration: 3000 });
      }
      prevStatus.current = state.status;
    }
  }, [state.status, toast]);

  // Show connection status toasts
  const prevConnected = React.useRef(connected);
  useEffect(() => {
    if (prevConnected.current !== connected) {
      if (connected) {
        toast.success('Connected to server', { duration: 3000 });
      } else if (prevConnected.current === true) {
        toast.warning('Disconnected from server', { title: 'Connection Lost' });
      }
      prevConnected.current = connected;
    }
  }, [connected, toast]);

  // Keyboard shortcuts (matches sidebar order)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!e.altKey) return;
      const shortcuts = {
        '1': 'dashboard',
        '2': 'status',
        '3': 'goal',
        '4': 'steps',
        '5': 'logs',
        '6': 'metrics',
      };
      if (shortcuts[e.key]) {
        e.preventDefault();
        setActiveTab(shortcuts[e.key]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const renderContent = useCallback(() => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard state={state} />;
      case 'status':
        return <AgentStatusPanel state={state} connected={connected} />;
      case 'goal':
        return <GoalProgress state={state} />;
      case 'steps':
        return <StepsPanel state={state} logs={state.logs} retryHistory={state.retryHistory} />;
      case 'logs':
        return <LogsPanel logs={state.logs} />;
      case 'metrics':
        return <MetricsPanel state={state} />;
      default:
        return <Dashboard state={state} />;
    }
  }, [activeTab, state, connected]);

  return (
    <div className="app">
      <Header
        connected={connected}
        status={state.status}
        goal={state.goal}
      >
        <ConnectionStatus
          connected={connected}
          reconnecting={reconnecting}
          onReconnect={reconnect}
        />
        <ThemeToggle />
      </Header>

      <div className="main-container">
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          state={state}
        />

        <main className="content">
          {!connected && (
            <StatusBanner
              type="warning"
              message={error || "Disconnected from server"}
              action={reconnect}
              actionLabel="Reconnect"
            />
          )}

          <SectionErrorBoundary>
            {renderContent()}
          </SectionErrorBoundary>
        </main>
      </div>
    </div>
  );
}

// Main App wrapper with providers
function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
