import {
  disassemble,
  findPreviousInstructions,
  hex16,
  hex8,
  type DisassembledInstruction,
} from '@i8080/core';
import { useState } from 'react';
import { cx } from '../cx';
import type { Session } from '../session';
import { AddressInput, resolveAddress } from './AddressInput';

const ROWS = 36;
const ROWS_BEFORE_PC = 6;

export function Disassembly({ session }: { session: Session }) {
  const machine = session.machine;
  // Where the listing starts; null means "keep the current instruction in view".
  const [start, setStart] = useState<number | null>(null);
  const read = (address: number) => machine.peek(address);
  const labels = session.program?.labels;
  const first = start ?? findPreviousInstructions(read, machine.cpu.pc, ROWS_BEFORE_PC);
  const instructions = disassemble(read, first, ROWS, { symbols: labels });

  return (
    <div className="disasm">
      <div className="pane-title">
        <h2>Disassembly</h2>
        <div className="pane-title-tools">
          <AddressInput
            onGo={setStart}
            resolve={(text) => resolveAddress(text, session.program?.symbols)}
          />
          <button
            className={cx('btn', 'small', start === null && 'active')}
            onClick={() => setStart(null)}
            title="Keep the current instruction in view"
          >
            Follow PC
          </button>
        </div>
      </div>
      <div className="disasm-rows" role="list">
        {instructions.map((instruction) => (
          <div key={instruction.address} role="listitem">
            {labels?.has(instruction.address) && (
              <div className="disasm-label">{labels.get(instruction.address)}:</div>
            )}
            <InstructionRow session={session} instruction={instruction} onShowTarget={setStart} />
          </div>
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  session: Session;
  instruction: DisassembledInstruction;
  onShowTarget(address: number): void;
}

function InstructionRow({ session, instruction, onShowTarget }: RowProps) {
  const { address, bytes, info, target } = instruction;
  const hasBreakpoint = session.machine.breakpoints.has(address);
  const isCurrent = address === session.machine.cpu.pc;
  const [mnemonic, ...rest] = instruction.text.split(' ');
  const operands = rest.join(' ');
  const cycles =
    info.cycles === info.cyclesTaken ? info.cycles : `${info.cycles}/${info.cyclesTaken}`;

  return (
    <div
      className={cx(
        'disasm-row',
        isCurrent && 'is-pc',
        hasBreakpoint && 'has-bp',
        info.undocumented && 'undoc',
      )}
    >
      <button
        className="bp-dot"
        title={hasBreakpoint ? 'Remove breakpoint' : 'Add breakpoint'}
        onClick={() => session.toggleBreakpoint(address)}
      />
      <span className="addr">{hex16(address)}</span>
      <span className="bytes">{bytes.map(hex8).join(' ')}</span>
      <span className="mnemonic">
        {mnemonic}{' '}
        {target === undefined ? (
          operands
        ) : (
          <button className="link" onClick={() => onShowTarget(target)} title="Show target">
            {operands}
          </button>
        )}
      </span>
      <span className="cycles" title="Cycles; for conditional calls and returns, not taken/taken">
        {cycles}
      </span>
    </div>
  );
}
