/**
 * Convierte un objeto Date a un string de formato YYYY-MM-DD según la zona local,
 * evitando desfases de días provocados por usar `.toISOString().split('T')[0]` en UTC.
 */
export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayLocal(): string {
  return toLocalDateKey(new Date());
}

export function addDaysLocal(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
}

/**
 * Parsea "YYYY-MM-DD" o "YYYY-MM-DDTHH:mm:ss" a sus componentes locales.
 */
export function calendarPartsOf(dateStr: string): { year: number, month: number, day: number } | null {
  if (!dateStr) return null;
  // If it's a date-only string like YYYY-MM-DD, parse it manually to avoid timezone shift
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return {
      year: parseInt(match[1], 10),
      month: parseInt(match[2], 10),
      day: parseInt(match[3], 10)
    };
  }
  // Otherwise try to parse as ISO and read in local time
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate()
  };
}

export function currentPeriod(type: 'mensual' | 'trimestral' | 'anual'): string {
  const now = new Date();
  const year = now.getFullYear();
  if (type === 'mensual') {
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }
  if (type === 'trimestral') {
    const q = Math.ceil((now.getMonth() + 1) / 3);
    return `${year}-Q${q}`;
  }
  return `${year}`;
}

export function periodBounds(period: string, type: 'mensual' | 'trimestral' | 'anual'): { fechaInicio: string, fechaFin: string } | null {
  if (type === 'mensual') {
    const match = period.match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const lastDay = new Date(year, month, 0).getDate();
    return {
      fechaInicio: `${period}-01`,
      fechaFin: `${period}-${String(lastDay).padStart(2, '0')}`
    };
  }
  if (type === 'trimestral') {
    const match = period.match(/^(\d{4})-Q([1-4])$/);
    if (!match) return null;
    const year = parseInt(match[1], 10);
    const q = parseInt(match[2], 10);
    const firstMonth = (q - 1) * 3 + 1;
    const lastMonth = q * 3;
    const lastDay = new Date(year, lastMonth, 0).getDate();
    return {
      fechaInicio: `${year}-${String(firstMonth).padStart(2, '0')}-01`,
      fechaFin: `${year}-${String(lastMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    };
  }
  if (type === 'anual') {
    const match = period.match(/^(\d{4})$/);
    if (!match) return null;
    const year = parseInt(match[1], 10);
    return {
      fechaInicio: `${year}-01-01`,
      fechaFin: `${year}-12-31`
    };
  }
  return null;
}

export function periodOptions(type: 'mensual' | 'trimestral' | 'anual'): { value: string, label: string }[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  
  const options: { value: string, label: string }[] = [];
  
  if (type === 'mensual') {
    for (let i = -2; i <= 6; i++) {
      let d = new Date(year, month - 1 + i, 1);
      let y = d.getFullYear();
      let m = d.getMonth() + 1;
      let val = `${y}-${String(m).padStart(2, '0')}`;
      let label = d.toLocaleString('es-CO', { month: 'long', year: 'numeric' });
      label = label.charAt(0).toUpperCase() + label.slice(1);
      options.push({ value: val, label });
    }
  } else if (type === 'trimestral') {
    for (let i = -2; i <= 3; i++) {
      const targetQ = Math.ceil(month / 3) + i;
      let y = year;
      let q = targetQ;
      if (q <= 0) {
        y -= 1;
        q += 4;
      } else if (q > 4) {
        y += 1;
        q -= 4;
      }
      
      const qMonths = [
        "",
        "(Ene-Mar)",
        "(Abr-Jun)",
        "(Jul-Sep)",
        "(Oct-Dic)"
      ];
      
      options.push({
        value: `${y}-Q${q}`,
        label: `${y} Q${q} ${qMonths[q]}`
      });
    }
  } else {
    options.push({ value: String(year - 1), label: `Año ${year - 1}` });
    options.push({ value: String(year), label: `Año ${year}` });
    options.push({ value: String(year + 1), label: `Año ${year + 1}` });
  }
  
  return options;
}
