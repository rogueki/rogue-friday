import type { CSSProperties, ReactNode } from 'react';

export function Section({ title, children, style }: { title: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{ marginBottom: 28, ...style }}>
      <h3
        style={{
          margin: '0 0 12px',
          fontFamily: 'var(--jv-font-display)',
          fontSize: 12,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--friday-muted)',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Row({ children, gap = 16, style }: { children: ReactNode; gap?: number; style?: CSSProperties }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap, ...style }}>{children}</div>;
}

export function Grid({ children, min = 280, gap = 16, style }: { children: ReactNode; min?: number; gap?: number; style?: CSSProperties }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap, ...style }}>{children}</div>;
}

export const longGerman =
  'Außerordentlich lange Bezeichnung mit Umlauten: Größenänderung der Überwachungsschwelle für Übertragungsfehler beim nächtlichen Datenbank-Synchronisationslauf';
