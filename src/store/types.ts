import { Note, Project } from '../types';

export interface UndoCommand {
  execute: () => void;
  undo: () => void;
  description: string;
}

export interface BaseState {
  undoStack: UndoCommand[];
  canUndo: boolean;
  isEditMode: boolean;
  expandedNotes: Set<string>;
  currentLevel: number;
  canExpandMore: boolean;
  canCollapseMore: boolean;
}

export interface NoteState extends BaseState {
  notes: Note[];
  undo: () => void;
  expandOneLevel: () => void;
  collapseOneLevel: () => void;
  setCurrentLevel: (level: number) => void;
  deleteNote: (id: string) => Promise<void>;
  addNote: (parentId: string | null) => Promise<void>;
  updateNote: (id: string, content: string) => Promise<void>;
  toggleEdit: (id: string) => void;
  moveNote: (id: string, parentId: string | null, index: number) => Promise<void>;
  setEditMode: (isEditing: boolean) => void;
  addImage: (noteId: string, url: string) => Promise<void>;
  removeImage: (noteId: string, imageId: string) => Promise<void>;
  printNotes: () => string;
  saveNote: (id: string) => Promise<void>;
  toggleDiscussion: (id: string, value: boolean) => Promise<void>;
}

export interface ProjectState extends BaseState {
  title: string;
  projects: Project[];
  updateTitle: (title: string) => Promise<void>;
  copyProject: (id: string) => Promise<void>;
  loadProjects: () => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  switchProject: (projectId: string) => Promise<void>;
  loadNotes: () => Promise<void>;
}

export type Store = NoteState & ProjectState;