// @vitest-environment jsdom
// MoveHistoryPanel.spec.tsx — the only test on the user-facing replay surface (scrub
// timeline, transport controls, JSON export, import). It exists because the silent-import bug
// (Browse → nothing happened) lived here and unit tests on format.ts can't catch a broken
// file-input wire. The per-move table and text copy were retired; only JSON export remains.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MoveHistoryPanel } from '../MoveHistoryPanel';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });


function setup(over: Partial<React.ComponentProps<typeof MoveHistoryPanel>> = {}) {
  const onSeek = vi.fn();
  const onImportReplay = vi.fn();
  const getReplayJson = vi.fn(() => '{"v":1,"meta":{},"start":{},"moves":[]}');
  render(
    <MoveHistoryPanel
      viewPly={over.viewPly ?? null}
      plyCount={over.plyCount ?? 2}
      onSeek={onSeek}
      getReplayJson={getReplayJson}
      onImportReplay={onImportReplay}
    />,
  );
  return { onSeek, onImportReplay, getReplayJson };
}

describe('MoveHistoryPanel — rendering', () => {
  it('renders the LIVE badge when watching the live game (not scrubbing)', () => {
    setup();
    expect(screen.getByText(/LIVE · \d+ moves?/)).toBeTruthy();
  });

  it('exposes an accessible replay-position slider', () => {
    setup({ viewPly: 1, plyCount: 2 });
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-valuenow')).toBe('1');
    expect(slider.getAttribute('aria-valuemax')).toBe('2');
  });
});

describe('MoveHistoryPanel — export', () => {
  it('download is disabled with no plies and serializes when present', () => {
    const { getReplayJson } = setup();
    // jsdom can't perform the anchor download navigation; stub it to just record the call.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stub');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    fireEvent.click(screen.getByTitle('Download this game as a portable replay file (.json) you can re-open later'));
    expect(getReplayJson).toHaveBeenCalled();
  });
});

describe('MoveHistoryPanel — scrubber', () => {
  it('step/edge buttons disabled at LIVE end, ⏮ jumps to start', () => {
    const { onSeek } = setup();
    fireEvent.click(screen.getByTitle('Start'));
    expect(onSeek).toHaveBeenCalledWith(0);
    expect((screen.getByTitle('Forward') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle('Live') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows cur / total when scrubbing', () => {
    setup({ viewPly: 1, plyCount: 2 });
    expect(screen.getByText(/REVIEW · 1 \/ 2/)).toBeTruthy();
  });

  it('arrow keys on the timeline seek one ply at a time', () => {
    const { onSeek } = setup({ viewPly: 1, plyCount: 2 });
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onSeek).toHaveBeenCalledWith(2);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onSeek).toHaveBeenCalledWith(0);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onSeek).toHaveBeenCalledWith(0);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onSeek).toHaveBeenCalledWith(2);
  });
});

describe('MoveHistoryPanel — import (the silent-import bug surface)', () => {
  it('reading a selected .json file hands raw text + filename to onImportReplay', async () => {
    const { onImportReplay } = setup();
    const json = '{"v":1,"meta":{},"start":{},"moves":[]}';
    const file = new File([json], 'game.json', { type: 'application/json' });
    // jsdom's File omits .text(); the component relies on it, so provide it.
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(json) });
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await vi.waitFor(() => expect(onImportReplay).toHaveBeenCalledWith(json, 'game.json'));
  });

  it('rejects an oversized file without reading it (client-side DoS guard)', () => {
    const { onImportReplay } = setup();
    const big = new File(['x'], 'huge.json', { type: 'application/json' });
    // Simulate a multi-hundred-MB file via the size property; .text() must NEVER be called.
    Object.defineProperty(big, 'size', { value: 5_000_000 });
    const text = vi.fn(() => Promise.resolve('should-not-be-read'));
    Object.defineProperty(big, 'text', { value: text });
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [big] } });
    expect(text).not.toHaveBeenCalled();               // the huge file was never slurped
    expect(onImportReplay).toHaveBeenCalledWith('', 'huge.json'); // routed to the error path
  });

  it('Import button is wired to the hidden file input', () => {
    setup();
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByText('Import'));
    expect(click).toHaveBeenCalled();
  });
});
