'use client';

import dynamic from 'next/dynamic';
import React from 'react';

const App = dynamic(() => import('../../App'), {
  ssr: false,
  loading: () => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'sans-serif',
      color: '#475569',
      backgroundColor: '#f8fafc'
    }}>
      <div style={{ textAlignment: 'center' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>Cargando Ioncore CRM...</h2>
        <p style={{ fontSize: '14px', color: '#94a3b8' }}>Inicializando panel de control</p>
      </div>
    </div>
  ),
});

export default function Page() {
  return <App />;
}
