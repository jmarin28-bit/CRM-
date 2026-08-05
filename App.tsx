import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Contacts from './pages/Contacts';
import Assistant from './pages/Assistant';
import Pipeline from './pages/Pipeline';
import Projects from './pages/Projects';
import Quotes from './pages/Quotes'; 
import Login from './pages/Login'; 
import Axis from './pages/Axis';
import CommercialGuide from './pages/CommercialGuide';
import { 
  listAccountsByUser,
  listContactsByUser,
  listOpportunitiesByUser,
  getActiveUser,
  setActiveUser as persistActiveUser,
  clearActiveUser,
  listUsers,
  listActivitiesByUser,
  createAccount,
  createContact
} from './services/storage';
import { AccountV2, ContactV2, OpportunityV2, CRMUser, ActivityV2 } from './types';

const App: React.FC = () => {
  const [activeUser, setActiveUser] = useState<CRMUser | null>(getActiveUser());
  const [activePage, setActivePage] = useState('dashboard');

  // Listener para navegación desde Axis
  useEffect(() => {
    const handleAxisNavigate = (event: Event) => {
      const customEvent = event as CustomEvent<{ page?: string }>;
      const page = customEvent.detail?.page;

      if (page) {
        setActivePage(page);
      }
    };

    window.addEventListener("axis:navigate", handleAxisNavigate);

    return () => {
      window.removeEventListener("axis:navigate", handleAxisNavigate);
    };
  }, []);

  const [accountsV2, setAccountsV2] = useState<AccountV2[]>([]);
  const [contactsV2, setContactsV2] = useState<ContactV2[]>([]);
  const [opportunitiesV2, setOpportunitiesV2] = useState<OpportunityV2[]>([]);
  const [activitiesV2, setActivitiesV2] = useState<ActivityV2[]>([]);
  const [users, setUsers] = useState<CRMUser[]>([]);

  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved) { return saved === 'dark'; }
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  const toggleTheme = () => setDarkMode(!darkMode);

  const [pendingAccountData, setPendingAccountData] = useState<Partial<AccountV2> | null>(null);

  useEffect(() => {
    if (activeUser) {
      setAccountsV2(listAccountsByUser() || []);
      setContactsV2(listContactsByUser() || []);
      setOpportunitiesV2(listOpportunitiesByUser() || []);
      setActivitiesV2(listActivitiesByUser() || []);
      setUsers(listUsers() || []);
    } else {
      setAccountsV2([]);
      setContactsV2([]);
      setOpportunitiesV2([]);
      setActivitiesV2([]);
      setUsers([]);
    }
  }, [activeUser]);

  const handleNavigate = (page: string) => {
    setActivePage(page);
  };

  const handleLogin = (user: CRMUser) => {
    setActiveUser(user);
    persistActiveUser(user);
  };

  const handleLogout = () => {
    clearActiveUser();
    setActiveUser(null);
    setActivePage('dashboard');
  };

  const changeUser = (user: CRMUser) => {
    setActiveUser(user);
    persistActiveUser(user);
  };

  const handleCreateAccountFromAssistant = (data: Partial<AccountV2>) => {
    setPendingAccountData(data);
    setActivePage('accounts');
  };

  const handleBulkImport = (data: { accounts: AccountV2[]; contacts: ContactV2[] }) => {
    data.accounts.forEach(acc => createAccount(acc));
    data.contacts.forEach(c => createContact(c));
    setAccountsV2(listAccountsByUser());
    setContactsV2(listContactsByUser());
  };

  if (!activeUser) {
    return <Login onLogin={handleLogin} />;
  }

  const renderContent = () => {
    switch (activePage) {
      case 'dashboard':
        return <Dashboard accounts={accountsV2} contacts={contactsV2} opportunities={opportunitiesV2} activeUser={activeUser} />;
      case 'pipeline':
        return <Pipeline activeUser={activeUser} />;
      case 'projects':
        return <Projects />;
      case 'quotes': 
        return <Quotes activeUser={activeUser} />;
      case 'accounts':
        return <Accounts pendingData={pendingAccountData} onClearPending={() => setPendingAccountData(null)} />;
      case 'contacts':
        return <Contacts activeUser={activeUser} />; 
      case 'assistant':
        return <Assistant accounts={accountsV2} contacts={contactsV2} activities={activitiesV2} opportunities={opportunitiesV2} onBulkImport={handleBulkImport} onCreateAccount={handleCreateAccountFromAssistant} />;
      case 'axis':
        return <Axis />;
      case 'commercial-guide':
        return <CommercialGuide />;
      default:
        return <Dashboard accounts={accountsV2} contacts={contactsV2} opportunities={opportunitiesV2} activeUser={activeUser} />;
    }
  };

  return (
    <Layout 
      activePage={activePage} 
      onNavigate={handleNavigate} 
      darkMode={darkMode}
      toggleTheme={toggleTheme}
      activeUser={activeUser}
      users={users} 
      onChangeUser={changeUser}
      onLogout={handleLogout}
    >
      {renderContent()}
    </Layout>
  );
};

export default App;