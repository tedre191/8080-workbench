import { hex16 } from '@i8080/core';
import { cx } from '../cx';
import type { Session } from '../session';

const WORDS_SHOWN = 8;

// The top of the stack, as 16-bit words. Words that look like return
// addresses are labelled.
export function Stack({ session }: { session: Session }) {
  const machine = session.machine;
  const rows = [];
  for (let i = 0; i < WORDS_SHOWN; i++) {
    const address = (machine.cpu.sp + i * 2) & 0xffff;
    const value = machine.peek16(address);
    rows.push(
      <div key={i} className={cx('stack-row', i === 0 && 'top')}>
        <span className="addr">{hex16(address)}</span>
        <span className="val">{hex16(value)}</span>
        <span className="note">
          {isReturnAddress(session, value) && `return to ${nameOf(value, session.program?.labels)}`}
        </span>
      </div>,
    );
  }
  return <div className="stack">{rows}</div>;
}

// A word pointing just past a CALL (or a conditional call) is probably a return address.
function isReturnAddress(session: Session, value: number) {
  if (value < 3) return false;
  const opcode = session.machine.peek(value - 3);
  const isCall = opcode === 0xcd;
  const isConditionalCall = (opcode & 0b11_000_111) === 0b11_000_100;
  return isCall || isConditionalCall;
}

// "loop+3": the nearest label at or before the address, if it's close.
function nameOf(address: number, labels: ReadonlyMap<number, string> | undefined) {
  let nearest: { address: number; name: string } | undefined;
  for (const [labelAddress, name] of labels ?? []) {
    if (labelAddress <= address && (!nearest || labelAddress > nearest.address)) {
      nearest = { address: labelAddress, name };
    }
  }
  if (!nearest || address - nearest.address > 0x100) return hex16(address);
  const offset = address - nearest.address;
  return offset === 0 ? nearest.name : `${nearest.name}+${offset}`;
}
