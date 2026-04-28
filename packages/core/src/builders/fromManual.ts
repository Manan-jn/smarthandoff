import type { Handoff } from '../types.js';

export function fromManual(options: {
  note?: string;
  goal?: string;
  blocker?: string;
}): Partial<Handoff> {
  const partial: Partial<Handoff> = {};

  if (options.note) {
    partial.notes = options.note;
  }

  if (options.goal) {
    partial.goals = [{
      id: 'goal_manual',
      title: options.goal.slice(0, 100),
      description: options.goal,
      status: 'in_progress',
    }];
  }

  if (options.blocker) {
    partial.blockers = [{
      id: 'blocker_manual',
      description: options.blocker,
      severity: 'high',
    }];
  }

  return partial;
}
