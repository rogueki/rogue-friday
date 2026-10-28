// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mockElementSize } from '../test-utils';
import { CircularMetric } from './Metrics';
import { ConfirmDialog, CommandPalette, Dialog, fuzzyScore, type CommandItem } from './Overlays';
import { FreshnessBadge, StatusFlag } from './Primitives';
import { Tabs, TextArea } from './Forms';
import { EmptyState, ErrorState, OfflineState } from './States';
import { ActivityFeed, DataTable, type DataTableColumn } from './Lists';

const items: CommandItem[] = [
  { id: 'ask', label: 'F.R.I.D.A.Y. fragen', group: 'F.R.I.D.A.Y.' },
  { id: 'task', label: 'Aufgabe anlegen', group: 'Erstellen', keywords: ['todo'] },
  { id: 'mail', label: 'E-Mail senden', group: 'Erstellen', critical: true, preview: { title: 'E-Mail an Max senden', warning: 'verlässt das System' } },
  { id: 'ro', label: 'Automationen pausieren', group: 'Automationen', disabled: true, disabledReason: 'Nur Lesezugriff' },
];

describe('CommandPalette', () => {
  it('filters, navigates with arrow keys and selects with Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} items={items} onSelect={onSelect} />);

    const input = screen.getByRole('combobox');
    expect(input).toHaveFocus();
    expect(screen.getAllByRole('option')).toHaveLength(4);

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', expect.stringContaining('task'));
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'task' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('matches keywords and reports no result text', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onOpenChange={() => undefined} items={items} onSelect={() => undefined} emptyLabel="Keine Treffer" />);
    await user.type(screen.getByRole('combobox'), 'todo');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('Aufgabe anlegen');
    await user.clear(screen.getByRole('combobox'));
    await user.type(screen.getByRole('combobox'), 'qqqqq');
    expect(screen.getByText('Keine Treffer')).toBeInTheDocument();
  });

  it('requires a second confirmation with preview for critical items (§43.4)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CommandPalette open onOpenChange={() => undefined} items={items} onSelect={onSelect} />);
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText('E-Mail an Max senden')).toBeInTheDocument();
    expect(screen.getByText('Du bist dabei:')).toBeInTheDocument();
    // Esc steps back first (does not close the palette)
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Du bist dabei:')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'mail' }));
  });

  it('does not execute disabled items', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<CommandPalette open onOpenChange={() => undefined} items={items} onSelect={onSelect} />);
    await user.click(screen.getByRole('option', { name: /Automationen pausieren/ }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('option', { name: /Automationen pausieren/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} items={items} onSelect={() => undefined} />);
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('ranks prefix matches above subsequence matches', () => {
    expect(fuzzyScore('fri', 'F.R.I.D.A.Y. fragen')).toBeGreaterThan(fuzzyScore('ffn', 'F.R.I.D.A.Y. fragen'));
    expect(fuzzyScore('xyz', 'F.R.I.D.A.Y.')).toBe(-1);
  });
});

describe('Dialog', () => {
  it('has dialog semantics, traps focus and closes on Escape', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <>
        <button type="button">Außerhalb</button>
        <Dialog open onOpenChange={onOpenChange} title="Neue Aufgabe" description="Beschreibung" footer={<button type="button">Anlegen</button>}>
          <input aria-label="Titel" />
        </Dialog>
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Neue Aufgabe' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Beschreibung');
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab cycles within the dialog only
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('lets only the top-most of stacked dialogs react to Escape and Tab', async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Dialog open onOpenChange={outer} title="Aufgabe">
          <input aria-label="Notiz" />
        </Dialog>
        <Dialog
          open
          onOpenChange={inner}
          title="Bestätigen"
          footer={
            <>
              <button type="button">Ja</button>
              <button type="button">Nein</button>
            </>
          }
        >
          <p>Bestätigung</p>
        </Dialog>
      </>,
    );
    const top = screen.getByRole('dialog', { name: 'Bestätigen' });
    for (let i = 0; i < 4; i += 1) {
      await user.tab();
      expect(top.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    expect(inner).toHaveBeenCalledWith(false);
    expect(outer).not.toHaveBeenCalled();
  });

  it('restores focus to the trigger when closed', async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Öffnen
          </button>
          <Dialog open={open} onOpenChange={setOpen} title="Dialog">
            <p>Inhalt</p>
          </Dialog>
        </>
      );
    }
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Öffnen' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The focus trap restores focus in its effect cleanup, which runs after the layer left the DOM (exit animation).
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  it('ConfirmDialog is an alertdialog and focuses the cancel button first', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onOpenChange={() => undefined} title="Löschen?" description="Du bist dabei …" tone="danger" confirmLabel="Löschen" onConfirm={onConfirm} />);
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('Tabs', () => {
  it('supports arrow keys, Home and End with roving tabindex', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Tabs
        label="Ansicht"
        onValueChange={onValueChange}
        items={[
          { id: 'a', label: 'Eins', content: <p>A</p> },
          { id: 'b', label: 'Zwei', content: <p>B</p> },
          { id: 'c', label: 'Drei', disabled: true },
          { id: 'd', label: 'Vier', content: <p>D</p> },
        ]}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');

    tabs[0]?.focus();
    await user.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenLastCalledWith('b');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('B');
    await user.keyboard('{ArrowRight}'); // skips the disabled tab
    expect(onValueChange).toHaveBeenLastCalledWith('d');
    await user.keyboard('{ArrowRight}'); // wraps
    expect(onValueChange).toHaveBeenLastCalledWith('a');
    await user.keyboard('{End}');
    expect(onValueChange).toHaveBeenLastCalledWith('d');
    await user.keyboard('{Home}');
    expect(onValueChange).toHaveBeenLastCalledWith('a');
  });
});

describe('CircularMetric', () => {
  it('renders "—" with an accessible reason for null, never a fake 0', () => {
    render(<CircularMetric label="GPU" value={null} nullReason="Treiber meldet keine Daten" />);
    const gauge = screen.getByRole('img');
    expect(gauge).toHaveAttribute('aria-label', 'GPU: nicht verfügbar. Treiber meldet keine Daten');
    expect(gauge).toHaveAttribute('data-missing', 'true');
    expect(gauge).toHaveTextContent('—');
    expect(gauge).not.toHaveTextContent('0');
  });

  it('renders a real zero as 0', () => {
    render(<CircularMetric label="CPU" value={0} />);
    const gauge = screen.getByRole('img');
    expect(gauge).not.toHaveAttribute('data-missing');
    expect(gauge).toHaveTextContent('0');
  });

  it('exposes value and unit to assistive tech', () => {
    render(<CircularMetric label="RAM" value={54.4} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'RAM: 54%');
  });
});

describe('FreshnessBadge', () => {
  it.each([
    ['fresh', 'Aktuell'],
    ['stale', 'Veraltet'],
    ['unknown', 'Unbekannt'],
    ['offline-cache', 'Offline-Cache'],
  ] as const)('shows text and icon for %s (not colour only)', (state, text) => {
    const { container } = render(<FreshnessBadge state={state} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('adds relative time in German', () => {
    render(<FreshnessBadge state="stale" asOf="2026-06-15T11:00:00Z" now={new Date('2026-06-15T11:20:00Z')} />);
    expect(screen.getByText(/vor 20 Minuten/)).toBeInTheDocument();
  });
});

interface Row {
  id: string;
  name: string;
  n: number;
}

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Name', sortable: true, sortValue: (r) => r.name },
  { id: 'n', header: 'Zahl', sortable: true, sortValue: (r) => r.n, align: 'right' },
];

describe('virtualization', () => {
  it('DataTable renders only a subset of 10 000 rows', () => {
    mockElementSize(800, 380);
    const rows: Row[] = Array.from({ length: 10_000 }, (_, i) => ({ id: `r${i}`, name: `Zeile ${i}`, n: i }));
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} label="Test" height={380} />);
    const rendered = screen.getAllByRole('row').length - 1; // minus header row
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(60);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '10001');
    expect(screen.getByText('10.000 Zeilen')).toBeInTheDocument();
  });

  it('DataTable sorts with null-safe, stable ordering and exposes aria-sort', async () => {
    mockElementSize(800, 380);
    const user = userEvent.setup();
    const rows: Row[] = [
      { id: 'a', name: 'Beta', n: 2 },
      { id: 'b', name: 'Alpha', n: 2 },
      { id: 'c', name: 'Gamma', n: 1 },
    ];
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} label="Sort" height={380} />);
    await user.click(screen.getByRole('button', { name: /Zahl/ }));
    expect(screen.getByRole('columnheader', { name: /Zahl/ })).toHaveAttribute('aria-sort', 'ascending');
    const names = screen.getAllByRole('row').slice(1).map((r) => r.textContent);
    // n asc: Gamma(1), then ties keep original order: Beta, Alpha
    expect(names[0]).toContain('Gamma');
    expect(names[1]).toContain('Beta');
    expect(names[2]).toContain('Alpha');
  });

  it('DataTable keyboard navigation activates the focused row', async () => {
    mockElementSize(800, 380);
    const user = userEvent.setup();
    const onRowActivate = vi.fn();
    const rows: Row[] = [
      { id: 'a', name: 'Eins', n: 1 },
      { id: 'b', name: 'Zwei', n: 2 },
    ];
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} label="Keys" height={380} onRowActivate={onRowActivate} />);
    screen.getByRole('grid').focus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onRowActivate).toHaveBeenCalledWith(rows[1]);
  });

  it('ActivityFeed windows 10 000 items', () => {
    mockElementSize(500, 420);
    const feed = Array.from({ length: 10_000 }, (_, i) => ({ id: `e${i}`, icon: <span />, title: `Ereignis ${i}` }));
    render(<ActivityFeed items={feed} label="Aktivität" height={420} />);
    const count = screen.getAllByRole('listitem').length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(40);
  });
});

describe('TextArea', () => {
  it('links label, hint and error to the textarea and reports changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<TextArea label="Notiz" hint="Wird lokal gespeichert." onChange={onChange} />);
    const field = screen.getByLabelText('Notiz');
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveAccessibleDescription('Wird lokal gespeichert.');
    expect(field).not.toHaveAttribute('aria-invalid');
    await user.type(field, 'abc');
    expect(onChange).toHaveBeenCalledTimes(3);

    rerender(<TextArea label="Notiz" hint="Wird lokal gespeichert." error="Darf nicht leer sein." />);
    expect(screen.getByLabelText('Notiz')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Notiz')).toHaveAccessibleDescription('Darf nicht leer sein.');
    expect(screen.getByRole('alert')).toHaveTextContent('Darf nicht leer sein.');
  });

  it('shows a character counter, marks required and honours hideLabel and disabled', async () => {
    const user = userEvent.setup();
    render(<TextArea label="Begründung" required showCount maxLength={20} hideLabel />);
    const field = screen.getByLabelText(/Begründung/);
    expect(field).toBeRequired();
    expect(field).toHaveAccessibleDescription('0 / 20');
    await user.type(field, 'Hallo');
    expect(field).toHaveAccessibleDescription('5 / 20');
    expect(screen.getByText(/Begründung/, { selector: 'label' })).toHaveClass('jv-sr-only');
  });

  it('is disabled for read-only capabilities', () => {
    render(<TextArea label="Notiz" disabled defaultValue="gesperrt" />);
    expect(screen.getByLabelText('Notiz')).toBeDisabled();
  });
});

describe('StatusFlag', () => {
  it('exposes its text alternative as hidden text, not as aria-label on a role-less span', () => {
    const { container } = render(<StatusFlag icon={<svg />} label="Wake-Word" value="bereit" tone="ok" />);
    const flag = container.querySelector('.jv-flag') as HTMLElement;
    expect(flag).not.toHaveAttribute('aria-label');
    expect(flag).toHaveTextContent('Wake-Word: bereit');
    expect(flag).toHaveAttribute('tabindex', '0');
    expect(flag).toHaveClass('jv-flag--ok');
  });
});

describe('compact states', () => {
  it('render title, description and the action in one wrapping container', () => {
    render(
      <div>
        <EmptyState compact title="Keine Freigaben" action={<button type="button">Anlegen</button>} />
        <ErrorState compact title="Nicht verfügbar" onRetry={() => undefined} />
        <OfflineState compact title="Offline" onRetry={() => undefined} />
      </div>,
    );
    for (const state of document.querySelectorAll('.jv-state--compact')) {
      expect(state.querySelector('.jv-state__text')).not.toBeNull();
      expect(state.querySelector('.jv-state__actions button')).not.toBeNull();
    }
    expect(document.querySelectorAll('.jv-state--compact')).toHaveLength(3);
  });
});
