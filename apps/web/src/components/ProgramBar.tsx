import { useState } from 'react';
import { cx } from '../cx';
import { CPU_TESTS, EXAMPLES } from '../examples';
import type { OpenProgram, ProgramRef, UserProgram } from '../programs';

interface Props {
  programs: UserProgram[];
  current: OpenProgram;
  // Name of the binary program in the machine, if one is open instead of source.
  binaryName: string | null;
  onOpen(ref: ProgramRef): void;
  onOpenRom(name: string): void;
  onOpenFile(file: File): void;
  onNew(): void;
  onRename(name: string): void;
  onDelete(): void;
  onShare(): void;
  wrap: boolean;
  onToggleWrap(): void;
}

// Each menu entry's value is "kind:id": user:<id>, example:<id>, rom:<name> or file:<name>.
const menuValue = (kind: string, id: string) => `${kind}:${id}`;

// The program menu, with buttons to create, open, save and delete programs.
export function ProgramBar(props: Props) {
  const { programs, current, binaryName } = props;
  const isCpuTest = CPU_TESTS.some((test) => test.name === binaryName);
  const selected = binaryName
    ? menuValue(isCpuTest ? 'rom' : 'file', binaryName)
    : menuValue(current.ref.kind, current.ref.id);

  const onSelect = (value: string) => {
    const colon = value.indexOf(':');
    const kind = value.slice(0, colon);
    const id = value.slice(colon + 1);
    if (kind === 'rom') props.onOpenRom(id);
    else if (kind === 'user' || kind === 'example') props.onOpen({ kind, id });
  };

  const download = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([current.source], { type: 'text/plain' }));
    link.download = current.name.replace(/[^\w.-]+/g, '_') + '.asm';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="program-bar">
      <label className="select">
        <span className="sr-only">Program</span>
        <select value={selected} onChange={(event) => onSelect(event.target.value)}>
          {programs.length > 0 && (
            <optgroup label="My programs">
              {programs.map((program) => (
                <option key={program.id} value={menuValue('user', program.id)}>
                  {program.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Examples">
            {EXAMPLES.map((example) => (
              <option key={example.id} value={menuValue('example', example.id)}>
                {example.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="CPU tests">
            {CPU_TESTS.map((test) => (
              <option key={test.name} value={menuValue('rom', test.name)}>
                {test.name}
              </option>
            ))}
          </optgroup>
          {binaryName && !isCpuTest && (
            <optgroup label="Opened file">
              <option value={menuValue('file', binaryName)}>{binaryName}</option>
            </optgroup>
          )}
        </select>
      </label>

      {binaryName ? (
        <span className="program-tag" title="This program is machine code, with no source to edit">
          Machine code
        </span>
      ) : current.isExample ? (
        <span
          className="program-tag"
          title="Examples are templates: editing one saves your changes as a new program"
        >
          Example
        </span>
      ) : (
        <ProgramName
          key={`${current.ref.id}:${current.name}`}
          name={current.name}
          onRename={props.onRename}
        />
      )}

      <span className="program-actions">
        {!binaryName && (
          <button
            className={cx('btn small icon-btn', props.wrap && 'active')}
            aria-pressed={props.wrap}
            aria-label="Wrap long lines"
            onClick={props.onToggleWrap}
            title="Wrap long lines to the width of the editor (Alt+Z)"
          >
            <WrapIcon />
          </button>
        )}
        <button className="btn small" onClick={props.onNew} title="Start a new program">
          New
        </button>
        <label
          className="btn small file-btn"
          title="Open an .asm source file, a CP/M .COM program or a raw binary"
        >
          Open…
          <input
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) props.onOpenFile(file);
            }}
          />
        </label>
        {!binaryName && (
          <button className="btn small" onClick={download} title="Save the source as an .asm file">
            Download
          </button>
        )}
        {!binaryName && (
          <button
            className="btn small"
            onClick={props.onShare}
            title="Copy a link that opens this program"
          >
            Share
          </button>
        )}
        {!binaryName && !current.isExample && (
          <button className="btn small danger" onClick={props.onDelete} title="Delete this program">
            Delete
          </button>
        )}
      </span>
    </div>
  );
}

// Lines of text, the middle one wrapping round to the next line.
function WrapIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 3.5h12M2 8h9.5a2.25 2.25 0 0 1 0 4.5H8M2 12.5h3M9.5 11 8 12.5 9.5 14" />
    </svg>
  );
}

// The program's name, editable in place.
function ProgramName({ name, onRename }: { name: string; onRename(name: string): void }) {
  const [draft, setDraft] = useState(name);
  return (
    <input
      className="program-name"
      aria-label="Program name"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => (draft.trim() ? onRename(draft) : setDraft(name))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(name);
          const input = e.currentTarget;
          requestAnimationFrame(() => input.blur());
        }
      }}
    />
  );
}
