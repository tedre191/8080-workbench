// Join class names, skipping falsy ones: `cx('row', isPc && 'is-pc')`.
export const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(' ');
