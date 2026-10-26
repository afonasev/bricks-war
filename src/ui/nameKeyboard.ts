/** Familiar letter rows, with separate numeric layout and a wide space key. */
export function nameKeyboardRows(russian: boolean, numeric = false): string[][] {
    return (numeric ? ['1234567890', '-_.'] : russian ? ['ЙЦУКЕНГШЩЗХЪ', 'ФЫВАПРОЛДЖЭ', 'ЯЧСМИТЬБЮ'] : ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']).map(row => [...row]);
}
