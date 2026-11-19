import { afterEach, describe, expect, it, vi } from 'vitest';
import { borderlessUrl, externalTools, isAttendanceTool, isQuiz, isToolAssignment, openCanvasTab } from './canvasTab';

afterEach(() => vi.restoreAllMocks());

describe('canvasTab', () => {
  it('asks Canvas for the page without its menus', () => {
    expect(borderlessUrl('/courses/1/external_tools/27376', 'https://school.test')).toBe('https://school.test/courses/1/external_tools/27376?display=borderless');
    expect(borderlessUrl('https://school.test/courses/1/assignments/5?a=1')).toBe('https://school.test/courses/1/assignments/5?a=1&display=borderless');
  });

  it('opens a new tab (never a window), and says when the browser blocked it', () => {
    const tab = { opener: window } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(tab);
    expect(openCanvasTab('/courses/1/external_tools/2', 'https://school.test')).toBe(true);
    expect(open.mock.calls[0]).toEqual(['https://school.test/courses/1/external_tools/2?display=borderless', '_blank']);
    expect(tab.opener).toBeNull();
    open.mockReturnValue(null);
    expect(openCanvasTab('/x', 'https://school.test')).toBe(false);
  });

  it('tells quizzes and tool assignments apart from the rest', () => {
    expect(isQuiz({ is_quiz_lti_assignment: true, submission_types: ['external_tool'] })).toBe(true);
    expect(isQuiz({ submission_types: ['online_quiz'] })).toBe(true);
    expect(isQuiz({ submission_types: ['external_tool'] })).toBe(false);
    expect(isToolAssignment({ submission_types: ['external_tool'] })).toBe(true);
    expect(isToolAssignment({ submission_types: ['online_upload'] })).toBe(false);
  });

  it('finds the external tools in a course menu, and the attendance one by name', () => {
    const tabs = [
      { id: 'home', label: 'Home', type: 'internal', html_url: '/courses/1' },
      { id: 'context_external_tool_27376', label: 'Asistencia', type: 'external', html_url: '/courses/1/external_tools/27376' },
    ];
    expect(externalTools(tabs).map((tab) => tab.label)).toEqual(['Asistencia']);
    expect(isAttendanceTool('Asistencia')).toBe(true);
    expect(isAttendanceTool('Attendance')).toBe(true);
    expect(isAttendanceTool('Course Analytics')).toBe(false);
  });
});
