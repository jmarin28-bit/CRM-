'use client';

import React, { useEffect, useState } from 'react';

export default function Page() {
  const [Component, setComponent] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    import('../../App').then((mod) => setComponent(() => mod.default));
  }, []);

  if (!Component) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'sans-serif',
        color: '#475569',
        backgroundColor: '#f8fafc'
      }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>Cargando Ioncore CRM...</h2>
          <p style={{ fontSize: '14px', color: '#94a3b8' }}>Inicializando panel de control</p>
        </div>
      </div>
    );
  }

  return <Component />;
}
