import { defineInterface, v } from './schema';

export const NotesInterface = defineInterface('Notes', {
  list: [v.optional(v.string({ max: 200 }))],
  create: [v.optional(v.string({ max: 200000 }))],
  update: [v.int({ min: 1 }), v.string({ max: 200000 })],
  remove: [v.int({ min: 1 })],
  openSource: [v.int({ min: 1 })],
  exportMarkdown: [v.optional(v.int({ min: 1 }))],
});

export interface NoteInfo {
  id: number;
  title: string;
  body: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  spaceId: string | null;
  createdAt: number;
  updatedAt: number;
}
