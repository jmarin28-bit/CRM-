import React, { useState } from 'react';
import { Mail, Lock, Building2, ArrowRight, ShieldCheck } from 'lucide-react';
import { CRMUser } from '../types';
import { authenticateUser } from '../services/storage';

interface LoginProps {
  onLogin: (user: CRMUser) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const authenticatedUser = authenticateUser(email, password);

    if (authenticatedUser) {
      onLogin(authenticatedUser);
      return;
    }

    setError('Credenciales incorrectas o usuario no registrado en IonCore.');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
      <div className="bg-white w-full max-w-5xl h-[600px] rounded-[50px] shadow-2xl flex overflow-hidden border border-slate-100">
        <div className="w-1/2 bg-slate-900 p-16 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute -top-24 -left-24 w-64 h-64 bg-blue-600 rounded-full blur-3xl opacity-20"></div>
          <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-blue-400 rounded-full blur-3xl opacity-20"></div>

          <div className="relative z-10">
            <div className="w-16 h-16 bg-blue-600 rounded-3xl flex items-center justify-center text-white mb-8 shadow-lg">
              <Building2 size={32} />
            </div>
            <h1 className="text-4xl font-black text-white uppercase tracking-tighter leading-none mb-4">
              Centro de
              <br />
              Inteligencia
            </h1>
            <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-sm">
              Plataforma central de gestión analítica y comercial exclusiva para el equipo de IonCore SAS.
            </p>
          </div>

          <div className="relative z-10">
            <div className="flex items-center gap-3 text-blue-400">
              <ShieldCheck size={20} />
              <span className="text-[10px] font-black uppercase tracking-[0.3em]">
                Acceso Restringido
              </span>
            </div>
          </div>
        </div>

        <div className="w-1/2 p-16 flex flex-col justify-center bg-white">
          <div className="mb-10">
            <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter mb-2">
              Iniciar Sesión
            </h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Ingresa tus credenciales corporativas
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
                Email Corporativo
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-slate-300 group-focus-within:text-blue-600 transition-colors">
                  <Mail size={18} />
                </div>
                <input
                  type="email"
                  required
                  placeholder="usuario@ioncore-sas.com"
                  className="w-full bg-slate-50 border border-slate-100 rounded-[25px] pl-12 pr-6 py-4 text-sm font-bold outline-none focus:bg-white focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-slate-700"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">
                Contraseña
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-slate-300 group-focus-within:text-blue-600 transition-colors">
                  <Lock size={18} />
                </div>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-100 rounded-[25px] pl-12 pr-6 py-4 text-sm font-bold outline-none focus:bg-white focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-slate-700"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-xs font-bold text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-slate-900 text-white py-5 rounded-[25px] font-black text-xs uppercase tracking-[0.3em] hover:bg-blue-600 transition-all active:scale-95 shadow-xl shadow-slate-200 mt-4 flex items-center justify-center gap-3 group"
            >
              Acceder al Sistema{' '}
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}