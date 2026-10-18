// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../test-utils';
import { BottomCommandBar } from './Shell';

describe('BottomCommandBar text input', () => {
  it('keeps the voice controls and omits the input without onSubmitText', () => {
    render(<BottomCommandBar talkLabel="MIT F.R.I.D.A.Y. SPRECHEN" quickAction={{ label: 'Executive Briefing' }} />);
    expect(screen.getByRole('button', { name: /MIT F\.R\.I\.D\.A\.Y\. SPRECHEN/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stopp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Executive Briefing' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('has an accessible name and submits trimmed text on Enter, then clears', async () => {
    const user = userEvent.setup();
    const onSubmitText = vi.fn();
    render(<BottomCommandBar onSubmitText={onSubmitText} textLabel="Befehl eingeben" />);
    const input = screen.getByRole('textbox', { name: 'Befehl eingeben' });
    await user.type(input, '  Tagesbriefing starten {Enter}');
    expect(onSubmitText).toHaveBeenCalledExactlyOnceWith('Tagesbriefing starten');
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('does not submit empty input and disables the send button until there is text', async () => {
    const user = userEvent.setup();
    const onSubmitText = vi.fn();
    render(<BottomCommandBar onSubmitText={onSubmitText} textSubmitLabel="Befehl senden" />);
    const send = screen.getByRole('button', { name: 'Befehl senden' });
    expect(send).toBeDisabled();
    await user.type(screen.getByRole('textbox'), '   {Enter}');
    expect(onSubmitText).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox'), 'x');
    expect(send).toBeEnabled();
    await user.click(send);
    expect(onSubmitText).toHaveBeenCalledWith('x');
  });

  it('keeps the text when the command reports failure', async () => {
    const user = userEvent.setup();
    const onSubmitText = vi.fn().mockResolvedValue(false);
    render(<BottomCommandBar onSubmitText={onSubmitText} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'Mail senden{Enter}');
    await waitFor(() => expect(onSubmitText).toHaveBeenCalled());
    await waitFor(() => expect(input).not.toHaveAttribute('aria-busy'));
    expect(input).toHaveValue('Mail senden');
  });

  it('Escape clears the text first and leaves the field on the second press', async () => {
    const user = userEvent.setup();
    render(<BottomCommandBar onSubmitText={vi.fn()} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'abc');
    await user.keyboard('{Escape}');
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(input).not.toHaveFocus();
  });

  it('walks through the session history with ArrowUp/ArrowDown and restores the draft', async () => {
    const user = userEvent.setup();
    render(<BottomCommandBar onSubmitText={vi.fn()} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'erster{Enter}');
    await waitFor(() => expect(input).toHaveValue(''));
    await user.type(input, 'zweiter{Enter}');
    await waitFor(() => expect(input).toHaveValue(''));
    await user.type(input, 'entwurf');
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveValue('zweiter');
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveValue('erster');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input).toHaveValue('entwurf');
  });

  it('stays reachable in the compact variant and can be disabled', () => {
    const { rerender } = render(<BottomCommandBar compact onSubmitText={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeEnabled();
    rerender(<BottomCommandBar compact onSubmitText={vi.fn()} textDisabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});

describe('BottomCommandBar context chips', () => {
  it('explains a missing value through accessible name and tooltip instead of a bare dash', async () => {
    const user = userEvent.setup();
    render(<BottomCommandBar chips={[{ id: 'weather', icon: null, label: 'Wetter', value: '—', hint: 'Keine Datenquelle angebunden' }, { id: 'net', icon: null, label: 'Netzwerk', value: '12 ms' }]} />);
    const unavailable = screen.getByRole('group', { name: 'Wetter: —. Keine Datenquelle angebunden' });
    expect(unavailable).toHaveAttribute('tabindex', '0');
    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Keine Datenquelle angebunden');
    expect(screen.getByText('12 ms')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Netzwerk/ })).toBeNull();
  });
});
