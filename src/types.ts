export interface Note {
  id: string;
  content: string;
  children: Note[];
  isEditing: boolean;
  unsavedContent?: string;
  position: number;
  sequence_number?: number;
  user_id: string;
  project_id: string;
  is_discussion: boolean;
  created_at?: string;
  updated_at?: string;
  images?: NoteImage[];
}

export interface NoteImage {
  id: string;
  note_id: string;
  url: string;
  position: number;
  created_at?: string;
  updated_at?: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  user_id: string;
  note_count: number;
  created_at?: string;
  updated_at?: string;
  last_modified_at?: string;
}

interface Command {
  execute: () => void;
  undo: () => void;
  description: string;
}

export type NoteStore = {
  notes: Note[];
  title: string;
  isEditMode: boolean;
  undoStack: Command[];
  canUndo: boolean;
  canExpandMore: boolean;
  canCollapseMore: boolean;
  currentLevel: number;
  projects: Project[];
  undo: () => void;
  expandOneLevel: () => void;
  collapseOneLevel: () => void;
  expandedNotes: Set<string>;
  setCurrentLevel: (level: number) => void;
  switchProject: (projectId: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  updateTitle: (title: string) => Promise<void>;
  copyProject: (id: string) => Promise<void>;
  loadProjects: () => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  addNote: (parentId: string | null) => Promise<void>;
  updateNote: (id: string, content: string) => Promise<void>;
  toggleEdit: (id: string) => void;
  moveNote: (id: string, parentId: string | null, index: number) => Promise<void>;
  loadNotes: () => Promise<void>;
  setEditMode: (isEditing: boolean) => void;
  addImage: (noteId: string, url: string) => Promise<void>;
  removeImage: (noteId: string, imageId: string) => Promise<void>;
  printNotes: () => string;
  saveNote: (id: string) => Promise<void>;
};