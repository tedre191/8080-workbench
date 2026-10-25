import { assemble } from '@i8080/core';
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BinaryInfo } from './components/BinaryInfo';
import { Breakpoints } from './components/Breakpoints';
import { Devices } from './components/Devices';
import { Disassembly } from './components/Disassembly';
import { Editor, replaceText } from './components/Editor';
import { FrontPanel } from './components/FrontPanel';
import { Memory } from './components/Memory';
import { ProgramBar } from './components/ProgramBar';
import { Reference, REFERENCE_SEARCH_ID } from './components/Reference';
import { Registers } from './components/Registers';
import { Stack } from './components/Stack';
import { terminalKey, TerminalView } from './components/TerminalView';
import { Trace } from './components/Trace';
import { CPU_TESTS, EXAMPLES } from './examples';
import { readChoice, readPref, writePref } from './prefs';
import { usePrograms, type OpenProgram } from './programs';
import { Session, SPEED_KEY, SPEEDS } from './session';
import { readShareLink, shareLink } from './share';

const DEBUG_TABS = ['Memory', 'Breakpoints', 'Trace', 'Reference'] as const;
type DebugTab = (typeof DEBUG_TABS)[number];
const DEBUG_TAB_KEY = 'i8080.debugTab';
const WRAP_KEY = 'i8080.wrap';
const SPEED_IDS = SPEEDS.map((speed) => speed.id);

const REPOSITORY_URL = 'https://github.com/tedre191/8080-workbench';

// How long typing must pause before the edited program is loaded.
const SYNC_DELAY_MS = 400;

// Keys typed into a text field belong to it, not to the running program.
function isTextField(target: EventTarget | null) {
  return target instanceof HTMLElement && target.closest('input, textarea, select') !== null;
}

// Keys that move between controls or press them, which stay with the page
// while a program runs. Tab always moves focus (the terminal sends it when
// it has focus itself). Enter and Space press a control only if it was
// reached with Tab: after clicking Run, they still go to the program.
function isNavigationKey(event: KeyboardEvent, focusedByTab: boolean) {
  if (event.key === 'Tab') return true;
  return (event.key === 'Enter' || event.key === ' ') && focusedByTab;
}

export function App() {
  const library = usePrograms();
  const { current } = library;
  // Start with whatever program was open last time, already loaded, at the
  // speed it ran at.
  const [session] = useState(() => {
    const newSession = new Session();
    const speed = readChoice(SPEED_KEY, SPEED_IDS);
    if (speed) newSession.setSpeed(speed);
    newSession.openSource(current.source);
    return newSession;
  });
  useSyncExternalStore(session.subscribe, session.getVersion);
  const [debugTab, setDebugTab] = useState<DebugTab>(
    () => readChoice(DEBUG_TAB_KEY, DEBUG_TABS) ?? 'Memory',
  );
  useEffect(() => writePref(DEBUG_TAB_KEY, debugTab), [debugTab]);
  // Wrap long lines in the editor: on unless turned off.
  const [wrap, setWrap] = useState(() => readPref(WRAP_KEY) !== '0');
  useEffect(() => writePref(WRAP_KEY, wrap ? '1' : '0'), [wrap]);
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
    const text = before === '' ? code + after : `${before}\n${code}${after}`;
    if (editorInput.current) replaceText(editorInput.current, text, onEdit);
    else onEdit(text);
  };

  // Open the program in a share link. A program with the same source is
  // reopened rather than copied, so reloading the page doesn't add another.
  const openShared = useEffectEvent(async () => {
    // Take the link out of the address bar first, so it's only opened once.
    const hash = location.hash;
    if (!new URLSearchParams(hash.slice(1)).has('code')) return;
    history.replaceState(null, '', location.pathname + location.search);
    const shared = await readShareLink(hash);
    if (!shared) {
      session.setStatus({
        tone: 'error',
        text: "Couldn't open the shared program: the link is damaged",
      });
      return;
    }

    const example = EXAMPLES.find((e) => e.source === shared.source);
    const own = library.programs.find((p) => p.source === shared.source);
    if (example) openProgram(library.open({ kind: 'example', id: example.id }));
    else if (own) openProgram(library.open({ kind: 'user', id: own.id }));
    else openProgram(library.create(shared.name, shared.source));
    session.setStatus({ tone: 'ok', text: `Opened the shared program "${shared.name}"` });
  });
  useEffect(() => {
    const open = () => void openShared();
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

  const onShare = async () => {
    const link = await shareLink({ name: current.name, source });
    try {
      await navigator.clipboard.writeText(link);
      session.setStatus({ tone: 'ok', text: 'Link copied: anyone who opens it gets this program' });
    } catch {
      // No clipboard access: put the link in the address bar instead.
      history.replaceState(null, '', link);
      session.setStatus({
        tone: 'ok',
        text: 'Copy the link in the address bar to share this program',
      });
    }
  };

  // Delete straight away, with an Undo button in the status bar.
  const onDelete = () => {
    const { name } = current;
    const { next, restore } = library.remove(current.ref.id);
    openProgram(next);
    session.setStatus({
      tone: 'info',
      text: `Deleted "${name}"`,
      action: {
        label: 'Undo',
        run: () => {
          openProgram(restore());
          session.setStatus({ tone: 'ok', text: `Restored "${name}"` });
        },
      },
    });
  };

  useEffect(() => {
    // Whether the focused element was reached with Tab rather than a click.
    let lastMove: 'tab' | 'pointer' = 'pointer';
    let focusedByTab = false;
    const onPointer = () => (lastMove = 'pointer');
    const onFocus = () => (focusedByTab = lastMove === 'tab');

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab') lastMove = 'tab';
      if (event.key === 'Escape' && session.stepping) {
        session.pause();
        event.preventDefault();
        return;
      }
      // By key position, as Alt+Z types a character on some keyboards.
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyZ') {
        setWrap((on) => !on);
        event.preventDefault();
        return;
      }
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
            session.running && !isTextField(event.target) && !isNavigationKey(event, focusedByTab)
              ? terminalKey(event)
              : undefined;
          if (byte === undefined) return;
          session.terminal.send(byte);
        }
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('focusin', onFocus);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('focusin', onFocus);
    };
  }, [session]);

  const { status, binary } = session;

  return (
    <div className="app">
      <FrontPanel session={session} />

      <div className={'status-bar tone-' + status.tone}>
        <span className="status-text" role="status">
          {status.text}
        </span>
        {status.action && (
          <button className="btn small status-action" onClick={status.action.run}>
            {status.action.label}
          </button>
        )}
        <a className="repo-link" href={REPOSITORY_URL} target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
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
            onShare={onShare}
            wrap={wrap}
            onToggleWrap={() => setWrap(!wrap)}
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
                wrap={wrap}
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

        <div className="side">
          <section className="pane pane-cpu">
            <h2 className="pane-title">Registers</h2>
            <Registers session={session} />
            <h2 className="pane-title">Stack</h2>
            <Stack session={session} />
          </section>

          <section className="pane pane-devices">
            <h2 className="pane-title">
              Devices
              <button
                className="btn small"
                onClick={() => session.setMuted(!session.speaker.muted)}
              >
                {session.speaker.muted ? 'Unmute sound' : 'Mute sound'}
              </button>
            </h2>
            <Devices session={session} />
          </section>
        </div>

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

        <section className="pane pane-terminal">
          <h2 className="pane-title">
            Terminal <span className="muted">ports 10h, 11h</span>
            <button className="btn small" onClick={() => session.clearTerminal()}>
              Clear
            </button>
          </h2>
          <TerminalView session={session} />
        </section>
      </main>
    </div>
  );
}
