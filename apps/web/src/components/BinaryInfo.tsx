import { CPU_TESTS } from '../examples';
import type { BinaryImage } from '../session';

// Shown in place of the editor when the machine holds a program without source.
export function BinaryInfo({ binary }: { binary: BinaryImage }) {
  const note = CPU_TESTS.find((test) => test.name === binary.name)?.note;
  return (
    <div className="binary-info">
      <h3>{binary.name}</h3>
      {note && <p>{note}</p>}
      <p className="muted">
        {binary.format === 'com'
          ? 'A CP/M program, loaded at 0100h. Its console output appears in the terminal.'
          : 'A raw binary image, loaded at 0000h.'}{' '}
        There's no source to show, but you can step through it in the disassembly and set
        breakpoints there.
      </p>
    </div>
  );
}
