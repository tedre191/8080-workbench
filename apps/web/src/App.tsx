import { assemble } from '@i8080/core';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BinaryInfo } from './components/BinaryInfo';
import { Breakpoints } from './components/Breakpoints';
import { Devices } from './components/Devices';
import { Disassembly } from './components/Disassembly';
import { Editor } from './components/Editor';
import { FrontPanel } from './components/FrontPanel';
import { Memory } from './components/Memory';
import { ProgramBar } from './components/ProgramBar';
import { Reference, REFERENCE_SEARCH_ID } from './components/Reference';
import { Registers } from './components/Registers';
import { Stack } from './components/Stack';
import { terminalKey, TerminalView } from './components/TerminalView';
import { Trace } from './components/Trace';
import { CPU_TESTS } from './examples';
import { usePrograms, type OpenProgram } from './programs';
import { Session } from './session';

const DEBUG_TABS = ['Memory', 'Breakpoints', 'Trace', 'Reference'] as const;
type DebugTab = (typeof DEBUG_TABS)[number];

// How long typing must pause before the edited program is loaded.
const SYNC_DELAY_MS = 400;

// Keys typed into a text field belong to it, not to the running program.
function isTextField(target: EventTarget | null) {
  return target instanceof HTMLElement && target.closest('input, textarea, select') !== null;
}

export function App() {
  const library = usePrograms();
  const { current } = library;
  // Start with whatever program was open last time, already loaded.
  const [session] = useState(() => {
    const newSession = new Session();
    newSession.openSource(current.source);
    return newSession;
  });
  useSyncExternalStore(session.subscribe, session.getVersion);
  const [debugTab, setDebugTab] = useState<DebugTab>('Memory');
  const editorInput = useRef<HTMLTextAreaElement>(null);

  // Assemble as the source changes (under a millisecond for typical programs):
  // errors show immediately, and once typing pauses the new code is loaded.
  const source = current.source;
  const live = useMemo(() => assemble(source), [source]);
  useEffect(() => {
    const timer = setTimeout(() => session.sync(live, source), SYNC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [session, live, source]);

  const openProgram = (program: OpenProgram | undefined) => {
    if (!program) return;
    session.clearBreakpoints();
    session.setSpeed('real');
    session.openSource(program.source);
  };

  const openCpuTest = async (name: string) => {
    const test = CPU_TESTS.find((t) => t.name === name);
    if (!test) return;
    session.setStatus({ tone: 'info', text: `Downloading ${name}…` });
    try {
      const response = await fetch(test.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      session.setSpeed('max');
      session.openBinary({ name, bytes, format: 'com' });
    } catch (error) {
      session.setStatus({
        tone: 'error',
        text: `Couldn't download ${name} (${error}). Check your connection.`,
      });
    }
  };

  const openFile = async (file: File) => {
    if (/\.(asm|s|a80|txt)$/i.test(file.name)) {
      openProgram(library.create(file.name.replace(/\.[^.]+$/, ''), await file.text()));
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    session.openBinary({
      name: file.name,
      bytes,
      format: /\.com$/i.test(file.name) ? 'com' : 'raw',
    });
  };

  const onEdit = (newSource: string) => {
    session.editSource(source, newSource);
    const { forked } = library.edit(newSource);
    if (forked) {
      session.setStatus({ tone: 'info', text: `Saved your changes as a new program, "${forked}"` });
    }
  };

  // Insert code on new lines below the line the caret is on. (The editor
  // keeps its caret position after the Insert button takes focus.)
  const insertSnippet = (code: string) => {
    const caret = editorInput.current?.selectionStart ?? source.length;
    const newline = source.indexOf('\n', caret);
    const lineEnd = newline === -1 ? source.length : newline;
    const before = source.slice(0, lineEnd);
    const after = source.slice(lineEnd);
    onEdit(before === '' ? code + after : `${before}\n${code}${after}`);
  };

  const onDelete = () => {
    if (!confirm(`Delete "${current.name}"? This can't be undone.`)) return;
    openProgram(library.remove(current.ref.id));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'F1':
          setDebugTab('Reference');
          requestAnimationFrame(() => document.getElementById(REFERENCE_SEARCH_ID)?.focus());
          break;
        case 'F5':
          if (session.running) session.pause();
          else session.run();
          break;
        case 'F10':
          session.stepOver();
          break;
        case 'F11':
          if (event.shiftKey) session.stepOut();
          else session.step();
          break;
        default: {
          // While a program runs, typing anywhere outside the editor goes to it.
          const byte =
            session.running && !isTextField(event.target) ? terminalKey(event) : undefined;
          if (byte === undefined) return;
          session.terminal.send(byte);
        }
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  const { status, binary } = session;

  return (
    <div className="app">
      <FrontPanel session={session} />

      <div className={'status-bar tone-' + status.tone} role="status">
        {status.text}
      </div>

      <main className="workspace">
        <section className="pane pane-source">
          <h2 className="sr-only">Program</h2>
          <ProgramBar
            programs={library.programs}
            current={current}
            binaryName={binary?.name ?? null}
            onOpen={(ref) => openProgram(library.open(ref))}
            onOpenRom={openCpuTest}
            onOpenFile={openFile}
            onNew={() => openProgram(library.create())}
            onRename={(name) => library.rename(current.ref.id, name)}
            onDelete={onDelete}
          />
          {binary ? (
            <BinaryInfo binary={binary} />
          ) : (
            <>
              <Editor
                session={session}
                source={source}
                live={live}
                onChange={onEdit}
                inputRef={editorInput}
              />
              {live.errors.length > 0 && (
                <ul className="error-list">
                  {live.errors.map((e, i) => (
                    <li key={i}>
                      <span className="mono">line {e.line}</span> {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <section className="pane pane-disasm">
          <h2 className="pane-title">Disassembly</h2>
          <Disassembly session={session} />
        </section>

        <section className="pane pane-cpu">
          <h2 className="pane-title">Registers</h2>
          <Registers session={session} />
          <h2 className="pane-title">Stack</h2>
          <Stack session={session} />
        </section>

        <section className="pane pane-debug">
          <div className="tabs" role="tablist">
            {DEBUG_TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={debugTab === t}
                className={debugTab === t ? 'active' : ''}
                onClick={() => setDebugTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="tab-body" role="tabpanel">
            {debugTab === 'Memory' && <Memory session={session} />}
            {debugTab === 'Breakpoints' && <Breakpoints session={session} />}
            {debugTab === 'Trace' && <Trace session={session} />}
            {debugTab === 'Reference' && (
              <Reference
                session={session}
                onInsert={binary ? undefined : insertSnippet}
                onNewProgram={(name, code) => openProgram(library.create(name, code))}
              />
            )}
          </div>
        </section>

        <section className="pane pane-io">
          <div className="io-terminal">
            <h2 className="pane-title">
              Terminal <span className="muted">ports 10h, 11h</span>
              <button className="btn small" onClick={() => session.clearTerminal()}>
                Clear
              </button>
            </h2>
            <TerminalView session={session} />
          </div>
          <div className="io-devices">
            <h2 className="pane-title">Devices</h2>
            <Devices session={session} />
          </div>
        </section>
      </main>
    </div>
  );
}
