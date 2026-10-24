// The user's program library, kept in localStorage. Examples are read-only
// templates: editing one saves a copy into the library.
import { useEffect, useState } from 'react';
import { EXAMPLES, type Example } from './examples';

export interface UserProgram {
  id: string;
  name: string;
  source: string;
}

export type ProgramRef = { kind: 'user'; id: string } | { kind: 'example'; id: string };

// The program shown in the editor, whichever kind it is.
export interface OpenProgram {
  ref: ProgramRef;
  name: string;
  source: string;
  isExample: boolean;
  usesDevices: boolean;
}

interface Library {
  programs: UserProgram[];
  current: ProgramRef;
}

const STORE_KEY = 'i8080.programs.v1';
const DEFAULT_REF: ProgramRef = { kind: 'example', id: EXAMPLES[0].id };

const newId = () => Math.random().toString(36).slice(2, 10);

const fromExample = (ex: Example): OpenProgram => ({
  ref: { kind: 'example', id: ex.id },
  name: ex.name,
  source: ex.source,
  isExample: true,
  usesDevices: ex.usesDevices ?? false,
});

const fromUser = (p: UserProgram): OpenProgram => ({
  ref: { kind: 'user', id: p.id },
  name: p.name,
  source: p.source,
  isExample: false,
  usesDevices: false,
});

const starterSource = (name: string) => `; ${name}

        ORG 0
start:  LXI SP, 0E000h      ; set up the stack

        HLT
`;

// "Untitled", then "Untitled 2", "Untitled 3"... whichever is free.
function uniqueName(base: string, programs: UserProgram[]) {
  const taken = new Set(programs.map((program) => program.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

function load(): Library {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (saved && Array.isArray(saved.programs) && saved.current) return saved;
  } catch {
    // Storage unavailable or corrupt: start fresh.
  }
  return { programs: [], current: DEFAULT_REF };
}

export function usePrograms() {
  const [library, setLibrary] = useState(load);
  const { programs } = library;

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(library));
    } catch {
      // Private mode or storage full: programs just won't be saved.
    }
  }, [library]);

  const find = (ref: ProgramRef): OpenProgram | undefined => {
    if (ref.kind === 'example') {
      const example = EXAMPLES.find((e) => e.id === ref.id);
      return example && fromExample(example);
    }
    const program = programs.find((p) => p.id === ref.id);
    return program && fromUser(program);
  };

  const current = find(library.current) ?? find(DEFAULT_REF)!;

  const updateProgram = (id: string, changes: Partial<UserProgram>) => {
    setLibrary((before) => ({
      ...before,
      programs: before.programs.map((program) =>
        program.id === id ? { ...program, ...changes } : program,
      ),
    }));
  };

  // Create a program and open it.
  const create = (name?: string, source?: string): OpenProgram => {
    const finalName = uniqueName(name?.trim() || 'Untitled', programs);
    const program = { id: newId(), name: finalName, source: source ?? starterSource(finalName) };
    setLibrary((before) => ({
      programs: [program, ...before.programs],
      current: { kind: 'user', id: program.id },
    }));
    return fromUser(program);
  };

  return {
    programs,
    current,
    create,

    open(ref: ProgramRef) {
      const program = find(ref);
      if (program) setLibrary((before) => ({ ...before, current: ref }));
      return program;
    },

    // Save new source for the open program. Editing an example saves a copy
    // instead; its name is returned so the UI can say so.
    edit(source: string): { forked?: string } {
      if (current.isExample) return { forked: create(`${current.name} copy`, source).name };
      updateProgram(current.ref.id, { source });
      return {};
    },

    rename(id: string, name: string) {
      if (name.trim()) updateProgram(id, { name: name.trim() });
    },

    // Delete a program and open the next one (or the first example). Also
    // returns `restore`, which puts the program back where it was and opens it.
    remove(id: string) {
      const index = programs.findIndex((program) => program.id === id);
      const removed = programs[index];
      const rest = programs.filter((program) => program.id !== id);
      const next = rest[0] ? fromUser(rest[0]) : find(DEFAULT_REF)!;
      setLibrary({ programs: rest, current: next.ref });
      const restore = (): OpenProgram => {
        setLibrary((before) => ({
          programs: [...before.programs.slice(0, index), removed, ...before.programs.slice(index)],
          current: { kind: 'user', id },
        }));
        return fromUser(removed);
      };
      return { next, restore };
    },
  };
}
