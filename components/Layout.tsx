import React, { useState, useEffect, useRef } from 'react';
import { clearActiveUser } from '../services/storage';
import { CRMUser } from '../types';
import { 
  LayoutDashboard, 
  Building2, 
  Users, 
  Bot, 
  Menu, 
  X,
  Search,
  LogOut,
  Kanban,
  Briefcase,
  Sun,
  Moon,
  Calculator,
  Mic,
  Settings
} from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  activePage: string;
  onNavigate: (page: string) => void;
  darkMode: boolean;
  toggleTheme: () => void;
  activeUser: CRMUser;
  users: CRMUser[];
  onChangeUser: (user: CRMUser) => void;
  onLogout: () => void;
}

const Layout: React.FC<LayoutProps> = ({ 
  children, 
  activePage, 
  onNavigate, 
  darkMode, 
  toggleTheme, 
  activeUser,
  users,
  onChangeUser,
  onLogout
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; email?: string }>(() => {
    try {
      const saved = localStorage.getItem('crm_google_status');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.connected) return parsed;
      }
    } catch (e) {}
    return { connected: false };
  });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const connectPollRef = useRef<number | null>(null);

  const stopConnectPolling = () => {
    if (connectPollRef.current !== null) {
      window.clearInterval(connectPollRef.current);
      connectPollRef.current = null;
    }
  };

  const fetchGoogleStatus = async () => {
    // 1. Chequear estado local primero
    try {
      const saved = localStorage.getItem('crm_google_status') || localStorage.getItem('google_connected');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.connected) {
          setGoogleStatus({ connected: true, email: parsed.email });
        }
      }
    } catch (e) {}

    // 2. Chequear estado del servidor
    try {
      const res = await fetch(`/api/google-oauth/status?userId=${activeUser.id}&_t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setGoogleStatus(data);
        if (data && data.connected) {
          localStorage.setItem('crm_google_status', JSON.stringify(data));
        }
        return data;
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  };

  useEffect(() => {
    fetchGoogleStatus();
    if (showSettingsModal) {
      const modalPoll = window.setInterval(() => {
        fetchGoogleStatus();
      }, 2000);
      return () => window.clearInterval(modalPoll);
    }
  }, [activeUser.id, showSettingsModal]);

  // Detectar conexión exitosa via localStorage (funciona aunque sea popup o pestaña nueva)
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if ((event.key === 'google_connected' || event.key === 'crm_google_status') && event.newValue) {
        try {
          const data = JSON.parse(event.newValue);
          if (data.connected) {
            stopConnectPolling();
            setConnectingGoogle(false);
            setGoogleStatus({ connected: true, email: data.email });
            localStorage.setItem('crm_google_status', JSON.stringify({ connected: true, email: data.email }));
            setShowSettingsModal(true);
          }
        } catch (e) {}
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // También chequear localStorage al hacer foco (fallback si la pestaña ya cerró)
  useEffect(() => {
    const handleFocus = () => {
      try {
        const raw = localStorage.getItem('crm_google_status') || localStorage.getItem('google_connected');
        if (raw) {
          const data = JSON.parse(raw);
          if (data.connected) {
            stopConnectPolling();
            setConnectingGoogle(false);
            setGoogleStatus({ connected: true, email: data.email });
          }
        }
      } catch (e) {}
      fetchGoogleStatus();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [activeUser.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google_connect') === 'success') {
      window.history.replaceState({}, document.title, window.location.pathname);
      fetchGoogleStatus().then(() => {
        setShowSettingsModal(true);
      });
    }
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'google-oauth-success') {
        stopConnectPolling();
        setConnectingGoogle(false);
        if (event.data.email) {
          const statusObj = { connected: true, email: event.data.email };
          setGoogleStatus(statusObj);
          localStorage.setItem('crm_google_status', JSON.stringify(statusObj));
        }
        fetchGoogleStatus().then(() => setShowSettingsModal(true));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [activeUser.id]);

  useEffect(() => () => stopConnectPolling(), []);

  const handleDisconnectGoogle = async () => {
    if (!confirm("¿Estás seguro de que deseas desconectar tu cuenta de Google?")) return;
    try {
      const res = await fetch('/api/google-oauth/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: activeUser.id })
      });
      if (res.ok) {
        localStorage.removeItem('crm_google_status');
        localStorage.removeItem('google_connected');
        setGoogleStatus({ connected: false });
        alert("Cuenta de Google desconectada.");
      }
    } catch (e) {
      console.error(e);
      alert("Error al desconectar.");
    }
  };

  const handleConnectGoogle = async () => {
    setConnectingGoogle(true);
    try {
      const res = await fetch(
        `/api/google-oauth/url?userId=${activeUser.id}&email=${encodeURIComponent(activeUser.email)}`
      );
      if (!res.ok) {
        const errText = await res.text();
        alert(`Error al obtener la URL de conexión (HTTP ${res.status}): ${errText}`);
        setConnectingGoogle(false);
        return;
      }
      const data = await res.json();
      if (!data.url) {
        alert('No se recibió una URL de autorización de Google.');
        setConnectingGoogle(false);
        return;
      }

      // Abrir el flujo OAuth en nueva pestaña
      window.open(data.url, '_blank');

      // Iniciar polling agresivo: cada 2s durante hasta 5 minutos.
      // No depende de window.opener ni de localStorage entre orígenes distintos.
      stopConnectPolling();
      const startedAt = Date.now();
      connectPollRef.current = window.setInterval(async () => {
        const status = await fetchGoogleStatus();
        if (status?.connected) {
          stopConnectPolling();
          setConnectingGoogle(false);
          // El modal ya mostrará el estado verde porque googleStatus fue actualizado
        } else if (Date.now() - startedAt > 5 * 60 * 1000) {
          // Timeout 5 minutos
          stopConnectPolling();
          setConnectingGoogle(false);
        }
      }, 2000);

      // También verificar al volver a esta pestaña (visibilitychange)
      const onVisible = () => {
        if (document.visibilityState === 'visible') {
          fetchGoogleStatus().then(status => {
            if (status?.connected) {
              stopConnectPolling();
              setConnectingGoogle(false);
            }
          });
        }
      };
      document.addEventListener('visibilitychange', onVisible, { once: false });
      // Limpiar el listener cuando el polling se detenga
      const visibilityCleanup = window.setInterval(() => {
        if (connectPollRef.current === null) {
          document.removeEventListener('visibilitychange', onVisible);
          window.clearInterval(visibilityCleanup);
        }
      }, 3000);

    } catch (e: any) {
      console.error('[handleConnectGoogle]', e);
      alert(`Error de red al conectar con Google: ${e.message}`);
      setConnectingGoogle(false);
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'pipeline', label: 'Embudo Ventas', icon: Kanban },
    { id: 'quotes', label: 'Cotizaciones', icon: Calculator },
    { id: 'projects', label: 'Proyectos', icon: Briefcase },
    { id: 'accounts', label: 'Cuentas', icon: Building2 },
    { id: 'contacts', label: 'Contactos', icon: Users },
    { id: 'axis', label: 'Axis', icon: Mic },
    { id: 'commercial-guide', label: 'Agente Guía', icon: Bot },
  ];

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-200">
      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 dark:bg-slate-950 text-white transition-transform duration-200 ease-in-out lg:static lg:translate-x-0
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex h-16 items-center justify-between px-6 border-b border-slate-800 dark:border-slate-800">
          <div className="flex items-center space-x-2">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="font-bold text-white">I</span>
            </div>
            <span className="text-lg font-bold tracking-tight">Ioncore SAS</span>
          </div>
          <button className="lg:hidden" onClick={() => setIsMobileMenuOpen(false)}>
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <nav className="mt-6 px-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.id);
                  setIsMobileMenuOpen(false);
                }}
                className={`
                  flex w-full items-center space-x-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors
                  ${isActive 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'}
                `}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Footer Sidebar: User Selection */}
        <div className="absolute bottom-0 w-full p-4 border-t border-slate-800 dark:border-slate-800">
          <div className="flex items-center space-x-3 rounded-lg bg-slate-800 dark:bg-slate-900 p-3">
            <div className="h-10 w-10 rounded-full bg-slate-700 flex items-center justify-center">
              <span className="font-bold text-slate-300">
                {activeUser.name.split(' ').map(n => n[0]).join('').toUpperCase()}
              </span>
            </div>
            <div className="flex-1 overflow-hidden">
              <select
                value={activeUser.id}
                onChange={(e) => {
                  const u = users.find(x => x.id === e.target.value);
                  if (u) onChangeUser(u);
                }}
                className="w-full bg-slate-800 text-white text-sm rounded border-none px-1 py-1 focus:ring-1 focus:ring-blue-500 outline-none"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <p className="truncate text-xs text-slate-400 capitalize px-2">
                {activeUser.role === "director" ? "Director Comercial" : "Asesor"}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex h-16 items-center justify-between bg-white dark:bg-slate-800 px-6 shadow-sm border-b border-slate-200 dark:border-slate-700 transition-colors">
          <button 
            className="lg:hidden p-2 -ml-2 text-slate-500 dark:text-slate-400" 
            onClick={() => setIsMobileMenuOpen(true)}
          >
            <Menu size={24} />
          </button>

          <div className="hidden md:flex flex-1 max-w-lg ml-4 relative">
             <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={18} className="text-slate-400" />
             </div>
            <input 
              type="text"
              placeholder="Búsqueda rápida (Ctrl+K)..." 
              className="block w-full pl-10 pr-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg leading-5 bg-slate-50 dark:bg-slate-700 dark:text-white placeholder-slate-400 focus:outline-none focus:bg-white dark:focus:bg-slate-900 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition duration-150 ease-in-out"
            />
          </div>

          <div className="flex items-center space-x-4">
             <span className="text-sm text-slate-500 dark:text-slate-400 hidden sm:inline-block">v1.1.0 Proyectos</span>
             
             <button 
                onClick={toggleTheme}
                className="p-2 text-slate-400 hover:text-blue-600 dark:text-slate-400 dark:hover:text-yellow-400 transition-colors rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
                title={darkMode ? "Modo Claro" : "Modo Oscuro"}
             >
               {darkMode ? <Sun size={20} /> : <Moon size={20} />}
             </button>

             <button
                onClick={() => setShowSettingsModal(true)}
                className="p-2 text-slate-400 hover:text-blue-600 dark:text-slate-400 transition-colors rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
                title="Mi Perfil y Google Workspace"
             >
               <Settings size={20} />
             </button>

             <button
                onClick={onLogout}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                title="Cerrar sesión"
             >
               <LogOut size={20} />
             </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-slate-50 dark:bg-slate-900 transition-colors">
          {children}
        </main>
      </div>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-xl">
          <div className="bg-white dark:bg-slate-800 rounded-[40px] shadow-2xl w-full max-w-lg border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-850">
              <div>
                <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Mi Perfil & Configuración</h3>
                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-1">Ioncore CRM • Ajustes de usuario</p>
              </div>
              <button 
                onClick={() => setShowSettingsModal(false)} 
                className="p-2 bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white transition-all shadow-sm"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-8 space-y-6">
              {/* User Info Card */}
              <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-[24px] border border-slate-100 dark:border-slate-800">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white font-black text-lg shadow-md shadow-blue-100">
                    {activeUser.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                  </div>
                  <div>
                    <h4 className="font-black text-slate-800 dark:text-white uppercase text-sm leading-none">{activeUser.name}</h4>
                    <p className="text-xs text-slate-400 mt-1">{activeUser.email}</p>
                    <p className="text-[10px] font-black tracking-wider text-blue-600 dark:text-blue-400 uppercase mt-2">
                      {activeUser.role === 'director' ? 'Director Comercial' : 'Asesor Comercial'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Google Integration Card */}
              <div className="space-y-3">
                <h5 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">Integración de Google Workspace</h5>
                <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-[24px] border border-slate-100 dark:border-slate-800 space-y-4">
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Vincula tu cuenta corporativa de Google para gestionar correos (Gmail), agendar reuniones y generar enlaces de Google Meet directamente desde la ficha de cada contacto.
                  </p>

                  {googleStatus.connected ? (
                    <div className="space-y-4">
                      <div className="flex items-center space-x-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 p-4 rounded-xl">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">✅ Cuenta de Google Conectada</p>
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate mt-0.5">{googleStatus.email}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">Gmail • Calendario • Google Meet activos</p>
                        </div>
                      </div>
                      <button
                        onClick={handleDisconnectGoogle}
                        className="w-full py-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 font-black text-xs uppercase tracking-wider transition-colors border border-red-100 dark:border-red-950 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        Desconectar Cuenta
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 p-3 rounded-xl">
                        <p className="text-[10px] font-black text-blue-700 dark:text-blue-400 uppercase tracking-widest mb-1">Cuenta a conectar</p>
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{activeUser.email}</p>
                      </div>
                      <button
                        onClick={handleConnectGoogle}
                        disabled={connectingGoogle}
                        className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-black text-xs uppercase tracking-wider transition-colors shadow-lg shadow-blue-200/40 dark:shadow-none flex items-center justify-center space-x-2"
                      >
                        {connectingGoogle ? (
                          <span>Redirigiendo a Google...</span>
                        ) : (
                          <span>Conectar Cuenta Corporativa</span>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Layout;
