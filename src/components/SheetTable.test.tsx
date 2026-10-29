import { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { SheetTable } from './FileViewer';
import type { SheetLayout } from '../lib/xlsxStyles';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SheetTable', () => {
  it('draws each cell with its own fill, font and alignment, merged cells once, hidden columns left out', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'Score', 'Hidden'],
      ['Ana', 9.5, 'x'],
    ]);
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }];
    const layout: SheetLayout = {
      cellStyle: new Map([['A1', 1], ['B1', 1]]),
      cols: new Map([[2, { hidden: true }], [0, { widthPx: 120 }]]),
      rows: new Map(),
      defaultColWidthPx: 64,
      defaultRowHeightPx: 20,
      showGridLines: false,
    };
    const xfs = [{}, { bg: '#D9E1F2', bold: true, color: '#C00000', hAlign: 'center' }];
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    await act(async () => root.render(<SheetTable xlsx={XLSX} ws={ws} layout={layout} xfs={xfs} />));

    const cells = [...el.querySelectorAll('tbody td')] as HTMLTableCellElement[];
    expect(cells.map((c) => c.textContent)).toEqual(['Name', 'Score', 'Ana', '9.5']); // column C is hidden
    expect(cells[0].style.backgroundColor).toBe('rgb(217, 225, 242)');
    expect(cells[0].style.fontWeight).toBe('700');
    expect(cells[0].style.color).toBe('rgb(192, 0, 0)');
    expect(cells[0].style.textAlign).toBe('center');
    expect(cells[3].style.textAlign).toBe('right'); // a number, with no alignment of its own
    expect(cells[2].style.borderTopStyle).toBe('none'); // the sheet hides its gridlines
    expect([...el.querySelectorAll('thead th')].map((h) => h.textContent)).toEqual(['', 'A', 'B']);
    act(() => root.unmount());
  });
});
