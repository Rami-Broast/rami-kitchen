import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

function Boom({ shouldThrow }: { shouldThrow: boolean }): React.JSX.Element {
  if (shouldThrow) {
    throw new Error('Cannot read properties of null');
  }
  return <p>Rendered fine</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs the caught error itself; silence it so a passing test is not
    // buried in an expected stack trace.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Rendered fine')).toBeTruthy();
  });

  it('shows a recoverable message instead of blanking the page', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    // The whole point: something is on screen, and it says what happened.
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText(/Cannot read properties of null/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload the app' })).toBeTruthy();
  });

  it('uses the title a caller gives it, so a page can name itself', () => {
    render(
      <ErrorBoundary title="This screen couldn’t be displayed">
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('This screen couldn’t be displayed')).toBeTruthy();
  });

  it('recovers when the cause is gone', () => {
    function Harness(): React.JSX.Element {
      const [broken, setBroken] = React.useState(true);
      return (
        <ErrorBoundary onReset={() => setBroken(false)}>
          <Boom shouldThrow={broken} />
        </ErrorBoundary>
      );
    }

    render(<Harness />);
    expect(screen.getByRole('alert')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Rendered fine')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports the failure to the console so it is diagnosable', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    expect(console.error).toHaveBeenCalledWith(
      'Unhandled render error:',
      expect.any(Error),
      expect.anything(),
    );
  });

  it('renders its fallback in Arabic when asked', () => {
    render(
      <ErrorBoundary lang="ar">
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    // The counter can be running in Arabic when something breaks; the way out
    // has to be readable in the language the staff member is using.
    expect(screen.getByText('حدث خطأ ما')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'حاول مرة أخرى' })).toBeTruthy();
  });
});
