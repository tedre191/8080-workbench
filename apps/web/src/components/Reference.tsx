import { Display } from '@i8080/core';
import { useState, type ReactNode } from 'react';
import { highlightLine } from '../highlight';
import {
  CONDITION_ROWS,
  FLAG_ROWS,
  INSTRUCTION_GROUPS,
  machineRows,
  OPERAND_KEY,
  SNIPPETS,
  SYNTAX_ROWS,
  type Snippet,
} from '../reference';
import type { Session } from '../session';

interface Props {
  session: Session;
  // Insert code into the open program; absent when there's no source to edit.
  onInsert?(code: string): void;
  onNewProgram(name: string, code: string): void;
}

export const REFERENCE_SEARCH_ID = 'reference-search';

const cssColor = (rgb: number) => '#' + rgb.toString(16).padStart(6, '0');

// A searchable cheat sheet: instructions, flags, syntax, this machine, and snippets.
export function Reference({ session, onInsert, onNewProgram }: Props) {
  const [query, setQuery] = useState('');
  const search = query.trim().toLowerCase();
  const matches = (...text: string[]) => !search || text.join(' ').toLowerCase().includes(search);

  const machine = machineRows(session).filter((row) => matches('machine port device', ...row));

  // Each section also matches a few words describing it, so "flag" finds the flag table.
  const groups = INSTRUCTION_GROUPS.map((group) => ({
    ...group,
    rows: group.rows.filter((row) => matches(row.syntax, row.summary, row.flags, ...row.mnemonics)),
  })).filter((group) => group.rows.length > 0);
  const conditions = CONDITION_ROWS.filter((row) =>
    matches('condition flag compare cmp cpi jump branch', row.cc, row.flag, row.afterCompare),
  );
  const flags = FLAG_ROWS.filter((row) => matches('flag', ...row));
  const operands = OPERAND_KEY.filter((row) => matches('operand', ...row));
  const syntax = SYNTAX_ROWS.filter((row) => matches('syntax', ...row));
  const showPalette = matches('display colour color palette');
  const snippets = SNIPPETS.filter((snippet) =>
    matches('snippet example pattern', snippet.title, snippet.note, snippet.code),
  );
  const sections = [groups, conditions, flags, operands, syntax, machine, snippets];
  const nothing = !showPalette && sections.every((section) => section.length === 0);

  return (
    <div className="reference">
      <div className="panel-tools">
        <input
          id={REFERENCE_SEARCH_ID}
          type="search"
          className="reference-search"
          placeholder="Search: carry, compare, JNZ, port…"
          aria-label="Search the reference"
          autoComplete="off"
          data-1p-ignore
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="reference-body">
        {nothing && <p className="muted">Nothing matches “{query}”.</p>}

        {groups.length > 0 && (
          <Section title="Instructions">
            {operands.length > 0 && <KeyValue rows={operands} />}
            {groups.map((group) => (
              <table key={group.title} className="ref-table">
                <caption>{group.title}</caption>
                <thead>
                  <tr>
                    <th>Syntax</th>
                    <th>Does</th>
                    <th>Flags</th>
                    <th title="Clock cycles (T-states)">Cycles</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.syntax}>
                      <td className="ref-syntax">{row.syntax}</td>
                      <td>{row.summary}</td>
                      <td className="ref-flags">{row.flags}</td>
                      <td className="ref-cycles">{row.cycles}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </Section>
        )}

        {(conditions.length > 0 || flags.length > 0) && (
          <Section title="Flags and conditions">
            {flags.length > 0 && <KeyValue rows={flags} />}
            {conditions.length > 0 && (
              <table className="ref-table">
                <caption>Conditions for Jcc, Ccc and Rcc</caption>
                <thead>
                  <tr>
                    <th>cc</th>
                    <th>When</th>
                    <th>After CMP x or CPI x</th>
                  </tr>
                </thead>
                <tbody>
                  {conditions.map((row) => (
                    <tr key={row.cc}>
                      <td className="ref-syntax">{row.cc}</td>
                      <td className="ref-flags">{row.flag}</td>
                      <td>{row.afterCompare}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        )}

        {syntax.length > 0 && (
          <Section title="Assembler syntax">
            <KeyValue rows={syntax} />
          </Section>
        )}

        {(machine.length > 0 || showPalette) && (
          <Section title="This machine">
            {machine.length > 0 && <KeyValue rows={machine} />}
            {showPalette && (
              <div className="palette" aria-label="Display colours">
                {Display.PALETTE.map((rgb, i) => (
                  <span key={i} className="swatch">
                    <span className="swatch-color" style={{ background: cssColor(rgb) }} />
                    {i}
                  </span>
                ))}
              </div>
            )}
          </Section>
        )}

        {snippets.length > 0 && (
          <Section title="Snippets">
            {snippets.map((snippet) => (
              <SnippetCard
                key={snippet.title}
                snippet={snippet}
                onInsert={onInsert}
                onNewProgram={onNewProgram}
              />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ref-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function KeyValue({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="ref-kv">
      {rows.map(([term, meaning]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

function SnippetCard({
  snippet,
  onInsert,
  onNewProgram,
}: { snippet: Snippet } & Omit<Props, 'session'>) {
  return (
    <div className="snippet">
      <div className="snippet-head">
        <strong>{snippet.title}</strong>
        {snippet.program ? (
          <button
            className="btn small"
            onClick={() => onNewProgram(snippet.title, snippet.code + '\n')}
          >
            New program
          </button>
        ) : (
          <button
            className="btn small"
            disabled={!onInsert}
            title={
              onInsert
                ? 'Insert below the line the cursor is on'
                : 'Open a program with source to insert'
            }
            onClick={() => onInsert?.(snippet.code)}
          >
            Insert
          </button>
        )}
      </div>
      <p className="muted">{snippet.note}</p>
      <pre className="snippet-code">
        {snippet.code.split('\n').map((line, i) => (
          <div key={i}>{highlightLine(line)}</div>
        ))}
      </pre>
    </div>
  );
}
